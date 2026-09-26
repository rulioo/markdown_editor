/**
 * 主题样式的**单一来源**。
 *
 * 为什么是 TS 字符串而不是 .css 文件：
 * 同一套变量要被三个地方消费——渲染进程的编辑区/预览 iframe，以及主进程生成导出 HTML。
 * 主进程读不到渲染进程构建产物里的 CSS，而把它做成字符串常量后，
 * 两端 `import { THEME_VARIABLES_CSS }` 即可，不存在两份样式漂移的问题。
 */

/** 亮色 / 暗色两套 CSS 变量。暗色挂在 [data-theme='dark'] 上，由渲染进程切换。 */
export const THEME_VARIABLES_CSS = `
:root {
  --bg: #ffffff;
  --bg-secondary: #f6f8fa;
  --bg-tertiary: #eaeef2;
  --bg-hover: #eef1f4;
  --bg-active: #e4e8ec;

  --fg: #1f2328;
  --fg-muted: #656d76;
  --fg-subtle: #8c959f;

  --border: #d1d9e0;
  --border-muted: #e4e8ec;

  --accent: #0969da;
  --accent-hover: #0860ca;
  --accent-fg: #ffffff;
  --accent-subtle: #ddf4ff;

  --code-bg: #f6f8fa;
  --code-fg: #1f2328;
  --quote-border: #d1d9e0;
  --mark-bg: #fff8c5;

  --selection: #b6d7ff;
  --danger: #cf222e;
  --success: #1a7f37;
  --warning: #9a6700;

  --scrollbar: #c9d1d9;
  --scrollbar-hover: #adbac7;
  --shadow: 0 8px 24px rgba(140, 149, 159, 0.2);

  color-scheme: light;
}

[data-theme='dark'] {
  --bg: #1e1e1e;
  --bg-secondary: #252526;
  --bg-tertiary: #2d2d30;
  --bg-hover: #2a2d2e;
  --bg-active: #37373d;

  --fg: #d4d4d4;
  --fg-muted: #9d9d9d;
  --fg-subtle: #6e6e6e;

  --border: #3e3e42;
  --border-muted: #333336;

  --accent: #4daafc;
  --accent-hover: #6fbbfd;
  --accent-fg: #0d1117;
  --accent-subtle: #16324a;

  --code-bg: #2d2d30;
  --code-fg: #d4d4d4;
  --quote-border: #4a4a4f;
  --mark-bg: #5a4a1f;

  --selection: #264f78;
  --danger: #f85149;
  --success: #3fb950;
  --warning: #d29922;

  --scrollbar: #4a4a4f;
  --scrollbar-hover: #5f5f66;
  --shadow: 0 8px 24px rgba(0, 0, 0, 0.5);

  color-scheme: dark;
}
`

/**
 * Markdown 正文样式。
 * 预览 iframe 与导出的 HTML 共用这一份——保证「所见即所得」不是空话。
 * 所有颜色都引用上面的变量，因此同一份样式天然支持两套主题。
 */
export const MARKDOWN_BODY_CSS = `
.markdown-body {
  font-family: var(--md-font-family, "Microsoft YaHei", "PingFang SC", sans-serif);
  font-size: var(--md-font-size, 16px);
  line-height: var(--md-line-height, 1.7);
  color: var(--fg);
  background: var(--bg);
  word-wrap: break-word;
  overflow-wrap: break-word;
}

.markdown-body > *:first-child { margin-top: 0; }
.markdown-body > *:last-child { margin-bottom: 0; }

.markdown-body h1,
.markdown-body h2,
.markdown-body h3,
.markdown-body h4,
.markdown-body h5,
.markdown-body h6 {
  margin: 1.6em 0 0.6em;
  font-weight: 600;
  line-height: 1.3;
}
.markdown-body h1 { font-size: 2em; padding-bottom: 0.3em; border-bottom: 1px solid var(--border); }
.markdown-body h2 { font-size: 1.5em; padding-bottom: 0.3em; border-bottom: 1px solid var(--border); }
.markdown-body h3 { font-size: 1.25em; }
.markdown-body h4 { font-size: 1em; }
.markdown-body h5 { font-size: 0.875em; }
.markdown-body h6 { font-size: 0.85em; color: var(--fg-muted); }

.markdown-body p { margin: 0 0 1em; }

.markdown-body a { color: var(--accent); text-decoration: none; }
.markdown-body a:hover { text-decoration: underline; }

.markdown-body strong { font-weight: 600; }
.markdown-body em { font-style: italic; }
.markdown-body del { text-decoration: line-through; color: var(--fg-muted); }
.markdown-body mark { background: var(--mark-bg); color: inherit; padding: 0.1em 0.2em; border-radius: 3px; }

.markdown-body code {
  font-family: var(--md-code-font-family, Consolas, "Courier New", monospace);
  font-size: 0.9em;
  background: var(--code-bg);
  color: var(--code-fg);
  padding: 0.2em 0.4em;
  border-radius: 4px;
}

.markdown-body pre {
  background: var(--code-bg);
  border-radius: 6px;
  padding: 12px 16px;
  overflow-x: auto;
  margin: 0 0 1em;
  line-height: 1.5;
}
.markdown-body pre code {
  background: none;
  padding: 0;
  font-size: 0.875em;
  white-space: pre;
}

.markdown-body blockquote {
  margin: 0 0 1em;
  padding: 0 1em;
  color: var(--fg-muted);
  border-left: 4px solid var(--quote-border);
}

.markdown-body ul,
.markdown-body ol { margin: 0 0 1em; padding-left: 2em; }
.markdown-body li { margin: 0.25em 0; }
.markdown-body li > ul,
.markdown-body li > ol { margin-bottom: 0; }

.markdown-body li.task-list-item { list-style: none; margin-left: -1.4em; }
.markdown-body li.task-list-item input { margin-right: 0.5em; }

/* 表格样式：预览面板（.markdown-body）与编辑器里的表格 widget（.cm-lp-table）共用。
 * 编辑器里的内容不在 .markdown-body 里，所以每条都要带上伴生选择器——
 * 与其复制一份，不如让两边引用同一处定义，省得日后改一边忘一边。 */
.markdown-body table,
.cm-lp-table table {
  border-collapse: collapse;
  margin: 0 0 1em;
  display: block;
  max-width: 100%;
  overflow-x: auto;
}
.markdown-body th,
.markdown-body td,
.cm-lp-table th,
.cm-lp-table td {
  border: 1px solid var(--border);
  padding: 6px 13px;
}
.markdown-body th,
.cm-lp-table th { background: var(--bg-secondary); font-weight: 600; }
.markdown-body tr:nth-child(2n),
.cm-lp-table tr:nth-child(2n) { background: var(--bg-secondary); }

.markdown-body hr {
  height: 1px;
  border: 0;
  background: var(--border);
  margin: 1.5em 0;
}

.markdown-body img { max-width: 100%; height: auto; }

.markdown-body .footnotes {
  margin-top: 2em;
  padding-top: 1em;
  border-top: 1px solid var(--border);
  font-size: 0.9em;
  color: var(--fg-muted);
}

.markdown-body .katex-display { overflow-x: auto; overflow-y: hidden; padding: 0.5em 0; }
`
