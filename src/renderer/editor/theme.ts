/**
 * CodeMirror 6 外观。
 *
 * 所有颜色都走 CSS 变量（定义在 styles/index.css 的 :root / [data-theme='dark']），
 * 因此**切换亮暗主题不需要重配编辑器**——浏览器自己会把变量解析成新颜色。
 * 这点很重要：若把颜色写死在 EditorView.theme() 里，每次切主题都得
 * reconfigure 一遍 compartment，既慢又容易丢掉临时状态。
 *
 * 同理，字号/行高/字体也取自 app-wiring 写在 <html> 上的 --md-* 变量。
 */

import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import type { Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { tags as t } from '@lezer/highlight'

/** 编辑器骨架：尺寸、内边距、光标、选区、活动行 */
const baseTheme = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: 'var(--md-font-size, 16px)',
    backgroundColor: 'var(--bg)',
    color: 'var(--fg)'
  },
  '&.cm-focused': {
    // CM6 默认会给聚焦的编辑器加 outline，这里去掉——编辑区铺满窗口，描边很难看
    outline: 'none'
  },
  '.cm-scroller': {
    fontFamily: 'inherit',
    lineHeight: 'var(--md-line-height, 1.7)',
    overflow: 'auto'
  },
  '.cm-content': {
    // 上下留白 + 左右居中栏宽，接近 MarkText 的阅读感
    padding: '24px 0',
    caretColor: 'var(--accent)'
  },
  '.cm-line': {
    padding: '0 32px'
  },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: 'var(--accent)',
    borderLeftWidth: '2px'
  },
  // 原生选区在 CM6 里默认被隐藏，改由 .cm-selectionBackground 绘制
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: 'var(--selection)'
  },
  '.cm-activeLine': {
    backgroundColor: 'var(--cm-active-line)'
  },
  '.cm-selectionMatch': {
    backgroundColor: 'var(--cm-selection-match)'
  },
  // 查找面板（Ctrl+F）——CM6 自带，样式需跟上整体风格
  '.cm-panels': {
    backgroundColor: 'var(--bg-secondary)',
    color: 'var(--fg)',
    borderColor: 'var(--border)'
  },
  '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--border)' },
  '.cm-panels.cm-panels-bottom': { borderTop: '1px solid var(--border)' },
  '.cm-panel input, .cm-panel button, .cm-panel select': {
    fontFamily: 'inherit',
    fontSize: '12px',
    padding: '3px 8px',
    color: 'var(--fg)',
    backgroundColor: 'var(--bg)',
    border: '1px solid var(--border)',
    borderRadius: '4px'
  },
  '.cm-panel button': { cursor: 'pointer' },
  '.cm-panel button:hover': { backgroundColor: 'var(--bg-hover)' },
  '.cm-searchMatch': {
    backgroundColor: 'var(--cm-search-match)',
    outline: '1px solid var(--cm-search-match-border)'
  },
  '.cm-searchMatch.cm-searchMatch-selected': {
    backgroundColor: 'var(--cm-search-match-active)'
  },
  '.cm-tooltip': {
    backgroundColor: 'var(--bg-secondary)',
    border: '1px solid var(--border)',
    color: 'var(--fg)'
  },
  '.cm-tooltip-autocomplete ul li[aria-selected]': {
    backgroundColor: 'var(--accent)',
    color: 'var(--accent-fg)'
  }
})

/**
 * 语法着色。
 *
 * 标签来自 @lezer/markdown 的语法树；未列出的标签会退回浏览器默认色。
 */
const highlightStyle = HighlightStyle.define([
  { tag: t.heading1, color: 'var(--cm-heading)', fontWeight: '700' },
  { tag: t.heading2, color: 'var(--cm-heading)', fontWeight: '700' },
  { tag: t.heading3, color: 'var(--cm-heading)', fontWeight: '600' },
  { tag: t.heading4, color: 'var(--cm-heading)', fontWeight: '600' },
  { tag: t.heading5, color: 'var(--cm-heading)', fontWeight: '600' },
  { tag: t.heading6, color: 'var(--cm-heading)', fontWeight: '600' },

  { tag: t.strong, fontWeight: '700', color: 'var(--cm-strong)' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through', color: 'var(--fg-muted)' },

  { tag: t.link, color: 'var(--cm-link)' },
  { tag: t.url, color: 'var(--cm-url)' },

  { tag: t.monospace, color: 'var(--cm-code)', fontFamily: 'var(--md-code-font-family)' },
  { tag: t.quote, color: 'var(--fg-muted)', fontStyle: 'italic' },

  { tag: t.list, color: 'var(--cm-list)' },
  { tag: t.contentSeparator, color: 'var(--cm-marker)' },

  // 语法标记本身（# ** ` > 等）弱化显示，避免抢视线
  { tag: t.processingInstruction, color: 'var(--cm-marker)' },
  { tag: t.labelName, color: 'var(--cm-link)' },

  // 代码块内的语言高亮（由 language-data 按需加载对应语言）
  { tag: t.keyword, color: 'var(--cm-keyword)' },
  { tag: t.string, color: 'var(--cm-string)' },
  { tag: t.number, color: 'var(--cm-number)' },
  { tag: t.comment, color: 'var(--cm-comment)', fontStyle: 'italic' },
  { tag: t.typeName, color: 'var(--cm-type)' },
  { tag: t.function(t.variableName), color: 'var(--cm-function)' },
  { tag: t.definition(t.variableName), color: 'var(--cm-function)' },
  { tag: t.operator, color: 'var(--cm-operator)' },
  { tag: t.bool, color: 'var(--cm-number)' },
  { tag: t.null, color: 'var(--cm-number)' },
  { tag: t.invalid, color: 'var(--danger)' }
])

/**
 * 源码模式用等宽字体，Live Preview 用正文字体——
 * 这是两种模式观感差异的主要来源，靠外层容器的 class 切换。
 */
const fontTheme = EditorView.theme({
  '.cm-content': { fontFamily: 'var(--md-code-font-family, Consolas, monospace)' }
})

const liveFontTheme = EditorView.theme({
  '.cm-content': { fontFamily: 'var(--md-font-family, sans-serif)' }
})

export function editorTheme(mode: 'source' | 'live'): Extension[] {
  return [baseTheme, syntaxHighlighting(highlightStyle), mode === 'live' ? liveFontTheme : fontTheme]
}
