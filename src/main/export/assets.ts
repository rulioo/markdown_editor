/**
 * `AssetPort` 的真实实现：**全项目里唯一**碰 `node:fs` / `node:path` / `node:url`
 * 来做资源解析的地方。
 *
 * 抽出来的理由有两个：一是 `src/shared` 不能 import node 内建模块（它同时被 web
 * 那份 tsconfig 编译），二是「哪些字符串算本地图片」这件判断错得最隐蔽——
 * 放在这里就能用一张表把各种写法逐个钉死（`assets.test.ts`）。
 */

import { readFile } from 'node:fs/promises'
import { extname, isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AssetPort } from '@shared/markdown/assets'

/** Windows 盘符路径：`C:\x` 与 `C:/x` 都算 */
const WINDOWS_DRIVE = /^[a-zA-Z]:[\\/]/
/** UNC：`\\server\share`。注意正斜杠的 `//host/share` 按协议相对处理（同浏览器语义） */
const WINDOWS_UNC = /^\\\\/
/** 协议前缀，与 sanitize.ts 里的判断同源 */
const HAS_SCHEME = /^([a-z][a-z0-9+.-]*):/i

/**
 * 扩展名 → MIME。
 *
 * 刻意不做字节嗅探、也不引 mime 库：markdown 里写的就是这个扩展名，
 * 「按扩展名给一个诚实的 MIME」比多背一个依赖划算。认不出的给
 * `application/octet-stream`——`<img>` 会加载失败，但那本来就是张认不出的图。
 */
const MIME_BY_EXTENSION: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.avif': 'image/avif'
}

const FALLBACK_MIME = 'application/octet-stream'

export function createAssetPort(docDir: string | null): AssetPort {
  return {
    resolveLocal(value: string): string | null {
      const raw = value.trim()
      if (!raw) return null
      // 文内锚点：`#foo` 是跳转不是文件
      if (raw.startsWith('#')) return null
      // 已经内联的、以及 blob（渲染进程临时对象）都不是文件
      if (/^(data|blob):/i.test(raw)) return null
      // 协议相对的 `//cdn/x.png` 归远端；UNC 用的是反斜杠，不受影响
      if (raw.startsWith('//')) return null
      // 盘符必须排在协议判断**之前**：`C:/x.png` 里的 `C:` 长得就像一个 scheme
      if (WINDOWS_DRIVE.test(raw) || WINDOWS_UNC.test(raw) || isAbsolute(raw)) return raw

      const scheme = HAS_SCHEME.exec(raw)
      if (scheme) {
        // file:// 是唯一能落回本地文件的协议；http/mailto/javascript 等一律不是
        if (scheme[1].toLowerCase() !== 'file') return null
        try {
          return fileURLToPath(raw)
        } catch {
          return null
        }
      }

      // 相对路径：没有源文档路径（未保存的新文档）时无从解析，只能放弃
      return docDir ? resolve(docDir, raw) : null
    },

    async readAsDataUrl(absPath: string): Promise<string | null> {
      try {
        const buffer = await readFile(absPath)
        const mime = MIME_BY_EXTENSION[extname(absPath).toLowerCase()] ?? FALLBACK_MIME
        return `data:${mime};base64,${buffer.toString('base64')}`
      } catch {
        // ENOENT / EACCES / EISDIR：都当作「这张图内联不了」，不中断整次导出
        return null
      }
    }
  }
}
