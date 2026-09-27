/**
 * Markdown → HTML。**唯一**的一条管线。
 *
 * 为什么住在 `src/shared` 而不是渲染进程：预览和导出（M3 的 HTML / PDF、
 * M4 的 DOCX 中间产物）必须看到同一棵 mdast，否则「预览看到的」和「导出得到的」
 * 迟早会分家（design.md NFR-5）。主进程不能 import 渲染进程目录，反过来也不行，
 * 所以共用代码只能放在这里。
 *
 * 本文件**不得** import `node:*` / `Buffer` / `electron`：`src/shared/**` 同时被
 * 两份 tsconfig 编译（node 与 web），任何 node 专有的东西都会把其中一份弄坏。
 * 需要读文件的资源内联走 `assets.ts` 的注入端口。
 */

import rehypeHighlight from 'rehype-highlight'
import rehypeStringify from 'rehype-stringify'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import { unified } from 'unified'
import type { Root as HastRoot } from 'hast'
import type { Options as RemarkRehypeOptions } from 'remark-rehype'
import { rehypeHeadings } from './headings'
import { escapeHtml, sanitizeTree } from './sanitize'

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

/**
 * 造一条管线。
 *
 * **管线上没有 sanitize**，这是刻意的：导出必须先做资源内联（把本地图片读成
 * `data:image/`），而 `sanitizeTree` 会剥掉 `file:` —— 顺序反了图片就全没了。
 * 所以 sanitize 由两个入口各自显式调用，且必须紧贴序列化之前。
 */
function buildProcessor(options: { includeToc: boolean }) {
  return unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype, { handlers: rawHtmlHandlers })
    // detect:false 是默认值，但**显式写出来**：改成 true 会把每个没标语言的围栏
    // 丢给 highlightAuto 去遍历全部 38 个语法，既改变现有文档的渲染结果，
    // 又给 180ms 防抖里那次渲染加上 O(块数 × 38) 的开销。这里不要自动猜测。
    // 未知语言（如 ```mermaid）不会抛错：rehype-highlight 捕获 "Unknown language"
    // 后只记一条 message，节点保持原样。所以不需要额外配置。
    .use(rehypeHighlight, { detect: false })
    // 标题 id 恒开（预览因此支持文内锚点），目录按需注入
    .use(rehypeHeadings, { toc: options.includeToc })
    .use(rehypeStringify)
}

/**
 * 解析器无状态，按 `includeToc` 缓存两份即可。
 *
 * 用 `ReturnType<typeof buildProcessor>` 而不是手写 unified 的泛型：
 * `Processor` 有五个类型参数，写死容易在升级 unified 时变成噪音。
 */
type Pipeline = ReturnType<typeof buildProcessor>
const pipelines = new Map<boolean, Pipeline>()

function pipelineFor(includeToc: boolean): Pipeline {
  let pipeline = pipelines.get(includeToc)
  if (!pipeline) {
    pipeline = buildProcessor({ includeToc })
    pipelines.set(includeToc, pipeline)
  }
  return pipeline
}

/**
 * 解析 + 变换，得到一棵**未消毒**的 hast 树。
 *
 * 调用方拿到树之后必须自己走一遍 `sanitizeTree`——两个入口（预览、导出）都这么做，
 * `test/export-boundary.test.ts` 里有一条断言盯着这件事。
 *
 * 标题列表挂在 `tree.data` 上，用 `readHeadings(tree)` 取——见 `headings.ts`。
 */
export function markdownToHast(source: string, includeToc = false): HastRoot {
  const pipeline = pipelineFor(includeToc)
  return pipeline.runSync(pipeline.parse(source))
}

/** 把 hast 树序列化成 HTML 片段（序列化与 includeToc 无关） */
export function treeToHtml(tree: HastRoot): string {
  return String(pipelineFor(false).stringify(tree))
}

/**
 * 同步渲染；调用方负责防抖（大文档下这条管线是 O(n)）。
 *
 * 返回的是**裸片段**，不带 `.markdown-body` 外壳——外壳由调用方负责
 * （预览是 `PreviewPane.vue` 的 `<article>`，导出是 `shell.ts`）。
 */
export function renderMarkdown(source: string): string {
  if (!source.trim()) return ''
  try {
    const tree = markdownToHast(source)
    sanitizeTree(tree)
    return treeToHtml(tree)
  } catch (error) {
    // 语法错误不该让预览整个白掉，降级为等宽纯文本
    const message = error instanceof Error ? error.message : String(error)
    return `<pre class="preview-error">预览渲染失败：${escapeHtml(message)}</pre>`
  }
}
