/**
 * 导出 / 打印请求的**入参校验**。
 *
 * 为什么需要它：`src/main/ipc/index.ts` 的头注释写着「所有 handler 都不信任渲染进程
 * 传入的参数」，而导出这两个 handler 一度是整个文件里仅有的例外。参数会一路走到
 * Chromium 的打印 API，那里对 `NaN` / `Infinity` / 缺字段的反应是「产出垃圾」或
 * 「抛一个看不懂的错」，两种都很难从用户报告里倒推回来。
 *
 * 做法是**重建**而不是就地校验：从 `DEFAULT_EXPORT_OPTIONS` 克隆一份，
 * 只把通过各自检查的字段覆盖上去。于是「渲染进程少传了一个字段」这种 bug
 * 在这里就变成安全默认值，而不是让 `printToPDF` 收到 `undefined`。
 * 这也顺带兜住了 TypeScript 管不到的那一层：`Partial<Settings>` 是浅偏特化，
 * 对话框必须回传完整对象，而这里是运行时的最后一道网。
 */

import { isAbsolute } from 'node:path'
import { DEFAULT_EXPORT_OPTIONS } from '@shared/types'
import type { ExportFormat, ExportOptions, ExportRequest, PdfMargin } from '@shared/types'
import { MAX_MARGIN_MM } from './pdf-options'

/** markdown 源码上限。不是「用户体验」限制，而是单次 IPC 能排多少活的硬边界 */
const MAX_MARKDOWN_BYTES = 64 * 1024 * 1024

const MAX_TITLE_LENGTH = 200
const MIN_FONT_SIZE = 1
const MAX_FONT_SIZE = 72
const MAX_FONT_FAMILY_LENGTH = 100

const FORMATS: ExportFormat[] = ['html', 'pdf', 'docx']
const PAGE_SIZES: Array<ExportOptions['pdf']['pageSize']> = ['A4', 'A3', 'Letter', 'Legal']

/** 这些错误都会以中文直达用户，所以文案要能独立看懂 */
function fail(message: string): never {
  throw new Error(message)
}

/** 与 `store.ts:24` 的 `isPlainObject` 同义：数组也是 object，但数组不是「一份选项」 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 有限数才认，并且夹进区间。NaN / Infinity / 负数一律回落到默认值 */
function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function readShortString(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, MAX_FONT_FAMILY_LENGTH) : fallback
}

function sanitizeMargin(raw: unknown, fallback: PdfMargin): PdfMargin {
  const source = isPlainObject(raw) ? raw : {}
  return {
    top: clampNumber(source.top, fallback.top, 0, MAX_MARGIN_MM),
    right: clampNumber(source.right, fallback.right, 0, MAX_MARGIN_MM),
    bottom: clampNumber(source.bottom, fallback.bottom, 0, MAX_MARGIN_MM),
    left: clampNumber(source.left, fallback.left, 0, MAX_MARGIN_MM)
  }
}

/**
 * 把任意输入变成一份**完整**的 `ExportOptions`。
 *
 * 导出成 public 是因为对话框那侧也想在提交前用同一套规则自查
 * （`validate.test.ts` 里有一条「只传 theme 也回传完整对象」的断言盯着它）。
 */
export function sanitizeExportOptions(raw: unknown): ExportOptions {
  const source = isPlainObject(raw) ? raw : {}
  const pdf = isPlainObject(source.pdf) ? source.pdf : {}
  const docx = isPlainObject(source.docx) ? source.docx : {}
  const defaults = DEFAULT_EXPORT_OPTIONS

  return {
    theme: source.theme === 'dark' ? 'dark' : 'light',
    embedImages: readBoolean(source.embedImages, defaults.embedImages),
    includeToc: readBoolean(source.includeToc, defaults.includeToc),
    pdf: {
      pageSize: PAGE_SIZES.includes(pdf.pageSize as ExportOptions['pdf']['pageSize'])
        ? (pdf.pageSize as ExportOptions['pdf']['pageSize'])
        : defaults.pdf.pageSize,
      landscape: readBoolean(pdf.landscape, defaults.pdf.landscape),
      margin: sanitizeMargin(pdf.margin, defaults.pdf.margin),
      printBackground: readBoolean(pdf.printBackground, defaults.pdf.printBackground),
      footer: readBoolean(pdf.footer, defaults.pdf.footer)
    },
    docx: {
      fontFamily: readShortString(docx.fontFamily, defaults.docx.fontFamily),
      fontSize: clampNumber(docx.fontSize, defaults.docx.fontSize, MIN_FONT_SIZE, MAX_FONT_SIZE),
      codeFontFamily: readShortString(docx.codeFontFamily, defaults.docx.codeFontFamily)
    }
  }
}

/** `null`（未保存文档）或绝对路径；相对路径没有意义，只会让图片解析指向进程的 cwd */
function sanitizeDocPath(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') return null
  return isAbsolute(value) ? value : null
}

function sanitizeTitle(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, MAX_TITLE_LENGTH) : undefined
}

/** 校验导出请求。抛出的都是中文，可直接作为错误对话框的内容 */
export function sanitizeExportRequest(raw: unknown): ExportRequest {
  if (!isPlainObject(raw)) fail('无效的导出请求')

  const { format, markdown } = raw
  if (!FORMATS.includes(format as ExportFormat)) fail('无效的导出格式')
  if (typeof markdown !== 'string') fail('导出内容无效')
  // 按 UTF-8 上界估算，避免真的去 encode 一遍几十兆的字符串
  if (markdown.length > MAX_MARKDOWN_BYTES) fail('文档过大，无法导出')

  const targetPath = raw.targetPath
  if (typeof targetPath !== 'string' || !targetPath.trim()) fail('导出路径无效')
  // 与 fs:writeFile 同一道闸：只接受绝对路径
  if (!isAbsolute(targetPath)) fail('导出路径必须是绝对路径')

  return {
    format: format as ExportFormat,
    markdown,
    targetPath,
    docPath: sanitizeDocPath(raw.docPath),
    options: sanitizeExportOptions(raw.options),
    title: sanitizeTitle(raw.title)
  }
}

export interface PrintRequest {
  markdown: string
  docPath: string | null
  title?: string
  options: ExportOptions
}

/**
 * 校验打印请求。
 *
 * 与导出的差别只有一个：**没有 targetPath**——打印不落盘，路径在选择器里。
 * 其余规则完全一致，所以共用上面那几个 sanitize 函数。
 */
export function sanitizePrintRequest(raw: unknown): PrintRequest {
  if (!isPlainObject(raw)) fail('无效的打印请求')

  const { markdown } = raw
  if (typeof markdown !== 'string') fail('打印内容无效')
  if (markdown.length > MAX_MARKDOWN_BYTES) fail('文档过大，无法打印')

  return {
    markdown,
    docPath: sanitizeDocPath(raw.docPath),
    title: sanitizeTitle(raw.title),
    options: sanitizeExportOptions(raw.options)
  }
}
