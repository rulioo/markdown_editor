/**
 * 导出 HTML 的外壳：把正文片段包成一份**自包含**的 HTML 文档。
 *
 * 自包含 = 样式全部内联、不引用任何外部资源。双击就能在任意浏览器里正确显示，
 * 不需要联网、不需要把 theme.ts 一起拷过去。
 *
 * 本文件是纯字符串函数：**不 import electron、不碰文件系统**，
 * 因此可以单测（`shell.test.ts`）。`test/export-boundary.test.ts` 盯着这条边界。
 */

import { APP_TITLE } from '@shared/app-meta'
import { HIGHLIGHT_CSS, MARKDOWN_BODY_CSS, THEME_VARIABLES_CSS } from '@shared/theme'
import { escapeHtml } from '@shared/markdown/sanitize'
import type { ResolvedTheme } from '@shared/types'

/**
 * 外壳自己的布局样式。
 *
 * 屏幕上要「像一篇文章」（限宽居中），打印时则必须让出页边距——
 * 页边距由 `printToPDF` 的 margins 负责，这里再留 padding 就会叠成两倍。
 * 用 `@media print` 收敛这两种需求，于是一份 HTML 同时当好「网页」和「PDF 源」。
 */
const SHELL_CSS = `
body { margin: 0; background: var(--bg); }
.markdown-body { max-width: 860px; margin: 0 auto; padding: 32px 40px; }

@media print {
  body { background: #fff; }
  /* 页边距交给 printToPDF，这里清零，否则和它叠加 */
  .markdown-body { max-width: none; margin: 0; padding: 0; }
  /* 不加这句，Chromium 会把背景色全部丢掉（pre 的底色、表头底色都会没） */
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
  /* 分页：标题不落单在页尾，代码块/表格/图片/列表项不跨页断开 */
  h1, h2, h3, h4, h5, h6 { break-after: avoid; break-inside: avoid; }
  pre, table, blockquote, img, tr, li, .markdown-toc { break-inside: avoid; }
}
`

export interface HtmlShellInput {
  /** 文档标题（写进 <title>，由本函数负责转义） */
  title: string
  /** `renderMarkdown` 的产物：裸片段，不带 `.markdown-body` 外壳 */
  bodyHtml: string
  theme: ResolvedTheme
  /** BCP-47 语言标签。影响 Chromium 的汉字字形选择（简繁/日韩），不是装饰 */
  lang?: string
}

/**
 * 造一份完整的、自包含的导出 HTML。
 *
 * 两个容易踩的点：
 *
 * 1. **`data-theme` 必须挂在 `<html>` 上。** 暗色变量块的选择器是裸
 *    `[data-theme='dark']`（见 theme.ts），挂到 `<body>` 上也能匹配到，
 *    但渲染进程用的是 `documentElement`——两边必须一致，否则暗色导出会静默变成亮色。
 *
 * 2. **不能写 `<base href>`。** 它会把 `href="#锚点"` 解析成目录 URL，
 *    点目录里的链接会跳去浏览器的目录列表，而不是页内跳转。
 *    相对地址的问题走的是另一条路：PDF/打印路径**强制内联图片**（见 `index.ts`），
 *    于是剩下需要解析的相对路径只有「不方便内联的链接」——那种情况下
 *    「指向哪」本来就不确定，不如保持原样。
 */
export function buildHtmlDocument(input: HtmlShellInput): string {
  const { title, bodyHtml, theme, lang = 'zh-CN' } = input

  return `<!DOCTYPE html>
<html lang="${escapeHtml(lang)}" data-theme="${theme}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="${escapeHtml(APP_TITLE)}">
<title>${escapeHtml(title)}</title>
<style>
${THEME_VARIABLES_CSS}
${MARKDOWN_BODY_CSS}
${HIGHLIGHT_CSS}
${SHELL_CSS}
</style>
</head>
<body>
<article class="markdown-body">
${bodyHtml}
</article>
</body>
</html>
`
}
