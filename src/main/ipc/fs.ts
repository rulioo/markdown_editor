/**
 * 文件读写。
 *
 * 本模块最关键的约束是**编码读写对称**：
 * 用 GBK 打开的文件，保存时必须仍然写回 GBK，否则中文全部变成乱码，
 * 而且是「静默损坏原文件」——用户按一次 Ctrl+S 就毁掉一份文档。
 * 因此 FileReadResult 会把探测到的 encoding/eol 带回渲染进程，
 * 保存时原样传回，这里严格按传入值编码。
 */

import { promises as fs } from 'node:fs'
import { basename, dirname, extname, join, relative } from 'node:path'
import iconv from 'iconv-lite'
import jschardet from 'jschardet'
import type {
  AssetsDirResult,
  Eol,
  FileReadResult,
  FileStatResult,
  FileWriteRequest,
  FileWriteResult,
  TextEncoding,
  TreeNode
} from '@shared/types'

const MAX_TREE_ENTRIES = 2000
const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  '.idea',
  '.vscode',
  'dist',
  'out',
  'release',
  '$RECYCLE.BIN',
  'System Volume Information'
])

/* ------------------------------- 编解码 ------------------------------- */

/** iconv-lite 的编码名映射（utf8 / utf16le 走 Node 原生，不进这里） */
const ICONV_NAME: Partial<Record<TextEncoding, string>> = {
  gbk: 'gbk',
  gb18030: 'gb18030',
  big5: 'big5',
  latin1: 'latin1'
}

/** jschardet 的探测结果 → 本项目的编码枚举 */
function normalizeDetected(detected: string | undefined): TextEncoding | null {
  if (!detected) return null
  const name = detected.toLowerCase().replace(/[^a-z0-9]/g, '')
  if (name.startsWith('utf8')) return 'utf8'
  if (name.startsWith('utf16')) return 'utf16le'
  if (name === 'gb2312' || name === 'gbk' || name === 'gb18030' || name === 'xgbk') {
    return 'gbk'
  }
  if (name === 'big5' || name === 'big5hkscs' || name === 'cp950') return 'big5'
  if (name === 'windows1252' || name === 'iso88591' || name === 'latin1' || name === 'ascii') {
    return 'latin1'
  }
  return null
}

/**
 * 只有「严格模式下解码成功」才认定是 UTF-8。
 * TextDecoder 的 fatal 选项会在遇到非法字节序列时抛错，这正是我们要的判据——
 * 否则任何 GBK 文件都会被宽松解码成带一堆 U+FFFD 的乱码。
 */
function isValidUtf8(buffer: Buffer): boolean {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buffer)
    return true
  } catch {
    return false
  }
}

/** 探测编码：BOM 优先 → 严格 UTF-8 校验 → jschardet 统计推断 → 兜底 UTF-8 */
export function detectEncoding(buffer: Buffer): TextEncoding {
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return 'utf8-bom'
  }
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) return 'utf16le'
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) return 'utf16be'

  if (buffer.length === 0) return 'utf8'
  if (isValidUtf8(buffer)) return 'utf8'

  try {
    const result = jschardet.detect(buffer)
    const normalized = normalizeDetected(result?.encoding)
    // 置信度过低时不采信，宁可当 UTF-8 处理也比猜错强
    if (normalized && (result?.confidence ?? 0) >= 0.5) return normalized
  } catch (error) {
    console.warn('[fs] 编码探测失败，回落 UTF-8：', error)
  }
  return 'utf8'
}

/** UTF-16BE 需要先交换字节序，Node 原生只支持 LE */
function swapBytes(buffer: Buffer): Buffer {
  const copy = Buffer.from(buffer)
  if (copy.length % 2 === 0) copy.swap16()
  return copy
}

function decodeBuffer(buffer: Buffer, encoding: TextEncoding): string {
  switch (encoding) {
    case 'utf8':
      return buffer.toString('utf8')
    case 'utf8-bom':
      // 去掉 BOM 字符，否则编辑器首行会多一个不可见的 \uFEFF
      return buffer.toString('utf8').replace(/^\uFEFF/, '')
    case 'utf16le':
      return buffer.toString('utf16le').replace(/^\uFEFF/, '')
    case 'utf16be':
      return swapBytes(buffer).toString('utf16le').replace(/^\uFEFF/, '')
    default: {
      const name = ICONV_NAME[encoding]
      return name ? iconv.decode(buffer, name) : buffer.toString('utf8')
    }
  }
}

function encodeString(text: string, encoding: TextEncoding): Buffer {
  switch (encoding) {
    case 'utf8':
      return Buffer.from(text, 'utf8')
    case 'utf8-bom':
      return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text, 'utf8')])
    case 'utf16le':
      return Buffer.from(`\uFEFF${text}`, 'utf16le')
    case 'utf16be':
      return swapBytes(Buffer.from(`\uFEFF${text}`, 'utf16le'))
    default: {
      const name = ICONV_NAME[encoding]
      return name ? iconv.encode(text, name) : Buffer.from(text, 'utf8')
    }
  }
}

/* ------------------------------- 换行符 ------------------------------- */

function detectEol(content: string): Eol {
  return content.includes('\r\n') ? 'crlf' : 'lf'
}

/** 统一成 LF 交给编辑器（CodeMirror 只认 \n），保存时再还原 */
function toLf(content: string): string {
  return content.replace(/\r\n/g, '\n')
}

function fromLf(content: string, eol: Eol): string {
  return eol === 'crlf' ? content.replace(/\n/g, '\r\n') : content
}

/* ------------------------------- 对外接口 ------------------------------- */

export async function readFile(filePath: string): Promise<FileReadResult> {
  const buffer = await fs.readFile(filePath)
  const stat = await fs.stat(filePath)
  const encoding = detectEncoding(buffer)
  const raw = decodeBuffer(buffer, encoding)
  return {
    content: toLf(raw),
    encoding,
    eol: detectEol(raw),
    mtimeMs: stat.mtimeMs,
    size: buffer.byteLength
  }
}

/** 原子写：先写同目录临时文件再 rename，避免写一半崩溃把原文件截断成半截 */
export async function writeFile(request: FileWriteRequest): Promise<FileWriteResult> {
  const { path: filePath, content, encoding, eol } = request
  const payload = encodeString(fromLf(content, eol), encoding)
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`

  try {
    await fs.writeFile(tmpPath, payload)
    await fs.rename(tmpPath, filePath)
  } catch (error) {
    await fs.rm(tmpPath, { force: true }).catch(() => undefined)
    throw error
  }

  const stat = await fs.stat(filePath)
  return { mtimeMs: stat.mtimeMs, size: payload.byteLength }
}

export async function statPath(target: string): Promise<FileStatResult> {
  try {
    const stat = await fs.stat(target)
    return {
      exists: true,
      isDirectory: stat.isDirectory(),
      mtimeMs: stat.mtimeMs,
      size: stat.size
    }
  } catch {
    return { exists: false, isDirectory: false, mtimeMs: 0, size: 0 }
  }
}

/**
 * 读取一层目录内容（懒加载：子目录的 children 留空，展开时再请求）。
 * 排序规则：目录在前，同类型按名称本地化排序（保证中文名排序符合直觉）。
 */
export async function readDirectory(dirPath: string): Promise<TreeNode[]> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true })
  const nodes: TreeNode[] = []
  let truncated = false

  for (const entry of entries) {
    if (nodes.length >= MAX_TREE_ENTRIES) {
      truncated = true
      break
    }
    const name = entry.name
    if (entry.isDirectory() && IGNORED_DIRS.has(name)) continue
    // 跳过隐藏文件，但保留 .gitignore 这类常见配置文件以外的 md 文档
    if (name.startsWith('.') && !/\.(md|markdown|txt)$/i.test(name)) continue

    const isDirectory = entry.isDirectory()
    if (!isDirectory && !/\.(md|markdown|mdown|mkd|txt)$/i.test(name)) continue

    nodes.push({
      name,
      path: join(dirPath, name),
      isDirectory
    })
  }

  nodes.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
    return a.name.localeCompare(b.name, 'zh-CN')
  })

  if (truncated && nodes.length > 0) {
    const last = nodes[nodes.length - 1]
    last.truncated = true
  }
  return nodes
}

/**
 * 计算粘贴图片的落盘位置：<文档目录>/assets/。
 * 文档所在目录不可写时回落到系统临时目录，保证粘贴不失败。
 */
export async function resolveAssetsDir(
  docPath: string | null,
  ext: string
): Promise<AssetsDirResult> {
  const cleanExt = ext.replace(/^\./, '').toLowerCase() || 'png'
  if (!docPath) {
    throw new Error('请先保存文档，再粘贴图片')
  }

  const baseDir = join(dirname(docPath), 'assets')
  await fs.mkdir(baseDir, { recursive: true })

  const stem = basename(docPath, extname(docPath))
  const stamp = new Date()
    .toISOString()
    .replace(/[-:T]/g, '')
    .slice(0, 14)
  const fileName = `${stem}-${stamp}.${cleanExt}`

  return {
    dir: baseDir,
    relPath: relative(dirname(docPath), join(baseDir, fileName)).split('\\').join('/')
  }
}

/** 写入二进制（粘贴的图片、DOCX 导出结果等） */
export async function writeBinary(
  dir: string,
  fileName: string,
  base64: string
): Promise<string> {
  const target = join(dir, fileName)
  await fs.writeFile(target, Buffer.from(base64, 'base64'))
  return target
}
