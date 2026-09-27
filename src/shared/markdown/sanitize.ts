/**
 * 渲染产物的安全处理。
 *
 * 为什么单独成文件：预览和导出**共用**这一份判断，但两者的调用时机不同。
 * 预览是一次性的（渲染完直接塞进 DOM）；导出要先把本地图片内联成 `data:`，
 * 而 `isSafeUrl` 会剥掉 `file:`，所以导出必须在**内联之后**再跑一遍 sanitize。
 * 把 transformer 同时导成「插件工厂」和「直接调用」两种形态，就是为了这件事。
 *
 * 安全底线（design.md D-8）：可执行协议的 URL 一律不留在 href/src 里。
 * 预览里还有主进程的 will-navigate / setWindowOpenHandler 兜底，
 * 导出的 HTML 文件可没有——所以判断必须做在这里。
 */

import { visit } from 'unist-util-visit'
import type { Root as HastRoot } from 'hast'

/** URL 里出现 `scheme:` 前缀的样子；没有匹配就说明是相对路径 / 锚点 */
const HAS_SCHEME = /^([a-z][a-z0-9+.-]*):/i
const ALLOWED_SCHEMES = new Set(['http', 'https', 'mailto', 'tel'])

/**
 * 判断一个 URL 是否可以安全地留在 href/src 里。
 *
 * 用**黑名单式的协议白名单**而不是「安全前缀前缀匹配」：后者会误伤
 * `docs/b.md` 这类不带 `./` 的相对链接。只有真的带了协议头的才需要审查。
 */
export function isSafeUrl(value: string, attribute: 'href' | 'src'): boolean {
  const url = value.trim()
  const match = HAS_SCHEME.exec(url)
  if (!match) return true // 相对路径、#锚点、//协议相对 —— 没有可执行的协议
  const scheme = match[1].toLowerCase()
  if (ALLOWED_SCHEMES.has(scheme)) return true
  // 图片允许内联 data: —— 但只限图片，data:text/html 之类一律不留
  return attribute === 'src' && /^data:image\//i.test(url)
}

/**
 * 剥掉 `javascript:` / `data:` / `vbscript:` 之类的可执行 URL。
 *
 * 就地改树（hast transformer 的惯例），返回 void。
 */
export function sanitizeTree(tree: HastRoot): void {
  visit(tree, 'element', (node) => {
    for (const attribute of ['href', 'src'] as const) {
      const value = node.properties?.[attribute]
      if (typeof value === 'string' && value.trim() && !isSafeUrl(value, attribute)) {
        delete node.properties[attribute]
      }
    }
  })
}

/**
 * unified 插件形态。
 *
 * 必须是**工厂**而不是把 `sanitizeTree` 直接丢给 `.use()`：unified 调用插件时
 * 第一个参数是 processor 而不是树，直接传会把 processor 当成节点去遍历。
 */
export function sanitizeUrls() {
  return sanitizeTree
}

/** HTML 转义。标题、错误信息都要过这道，否则文件名里的 `<` 能破坏整份文档 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
