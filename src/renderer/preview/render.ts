/**
 * Markdown → HTML。
 *
 * M1 阶段只做「够用的预览」：GFM（表格、任务列表、删除线）+ 基础排版。
 * M2 会在此基础上加 KaTeX / 代码高亮 / 沙箱 iframe 渲染。
 *
 * 重要：这条管线**同时供预览和（M3 的）HTML 导出使用**。预览里还有主进程的
 * will-navigate / setWindowOpenHandler 兜底，导出的 HTML 文件可没有——
 * 所以安全处理必须做在管线里，而不是指望运行环境（design.md NFR-5）。
 */

import rehypeStringify from 'rehype-stringify'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import { unified } from 'unified'
import { visit } from 'unist-util-visit'
import type { Root as HastRoot } from 'hast'
import type { Options as RemarkRehypeOptions } from 'remark-rehype'

/** remark-rehype 没有直接导出 Handler，从 Options 上取，省一个显式依赖 */
type Handlers = NonNullable<RemarkRehypeOptions['handlers']>

/**
 * mdast 的 `html` 节点默认被 remark-rehype **丢弃**（不是转义）。
 * 那意味着文档里的 `<br>`、`<details>` 会从预览里凭空消失——查看器丢内容
 * 比显示得难看严重得多。这里改成当作纯文本输出，既能看见，又不会被当标签执行。
 *
 * M2 的沙箱 iframe 会把这里换成真正的渲染；在那之前，「可见的转义文本」
 * 是比「静默消失」严格更好的降级。
 */
const rawHtmlHandlers: Handlers = {
  html: (_state, node: { value: string }) => ({
    type: 'element',
    tagName: 'span',
    properties: { className: ['raw-html'] },
    children: [{ type: 'text', value: node.value }]
  })
}

/** URL 里出现 `scheme:` 前缀的样子；没有匹配就说明是相对路径 / 锚点 */
const HAS_SCHEME = /^([a-z][a-z0-9+.-]*):/i
const ALLOWED_SCHEMES = new Set(['http', 'https', 'mailto', 'tel'])

/**
 * 判断一个 URL 是否可以安全地留在 href/src 里。
 *
 * 用**黑名单式的协议白名单**而不是「安全前缀前缀匹配」：后者会误伤
 * `docs/b.md` 这类不带 `./` 的相对链接。只有真的带了协议头的才需要审查。
 */
function isSafeUrl(value: string, attribute: 'href' | 'src'): boolean {
  const url = value.trim()
  const match = HAS_SCHEME.exec(url)
  if (!match) return true // 相对路径、#锚点、//协议相对 —— 没有可执行的协议
  const scheme = match[1].toLowerCase()
  if (ALLOWED_SCHEMES.has(scheme)) return true
  // 图片允许内联 data: —— 但只限图片，data:text/html 之类一律不留
  return attribute === 'src' && /^data:image\//i.test(url)
}

/** 剥掉 `javascript:` / `data:` / `vbscript:` 之类的可执行 URL */
function sanitizeUrls() {
  return (tree: HastRoot) => {
    visit(tree, 'element', (node) => {
      for (const attribute of ['href', 'src'] as const) {
        const value = node.properties?.[attribute]
        if (typeof value === 'string' && value.trim() && !isSafeUrl(value, attribute)) {
          delete node.properties[attribute]
        }
      }
    })
  }
}

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkRehype, { handlers: rawHtmlHandlers })
  .use(sanitizeUrls)
  .use(rehypeStringify)

/** 同步渲染；调用方负责防抖（大文档下这条管线是 O(n)） */
export function renderMarkdown(source: string): string {
  if (!source.trim()) return ''
  try {
    return String(processor.processSync(source))
  } catch (error) {
    // 语法错误不该让预览整个白掉，降级为等宽纯文本
    const message = error instanceof Error ? error.message : String(error)
    return `<pre class="preview-error">预览渲染失败：${escapeHtml(message)}</pre>`
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
