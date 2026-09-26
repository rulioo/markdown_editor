/**
 * CodeMirror 内置 UI 的中文化。
 *
 * CM6 的所有界面文案都走 `phrase()` 查 `EditorState.phrases` 这张表，
 * 不翻译就会出现「菜单全中文、查找面板全英文」的割裂感——而需求明确要求全中文。
 *
 * 键名从各包的 dist 里提取，共 18 条。新增 CM6 插件时若发现英文残留，
 * 用同样的办法捞一遍：grep 出所有 `phrase(x, "...")` 的第一个参数。
 */

import { EditorState } from '@codemirror/state'

export const EDITOR_PHRASES: Record<string, string> = {
  /* 查找替换面板（@codemirror/search） */
  Find: '查找',
  Replace: '替换',
  next: '下一个',
  previous: '上一个',
  all: '全部',
  'match case': '区分大小写',
  'by word': '全词匹配',
  regexp: '正则表达式',
  replace: '替换',
  'replace all': '全部替换',
  close: '关闭',

  /* 跳转到行 */
  'Go to line': '跳转到行',
  go: '跳转',

  /* 替换结果提示（$ 是 CM6 的占位符，必须保留） */
  'current match': '当前匹配',
  'on line': '位于行',
  'replaced match on line $': '已替换第 $ 行的匹配项',
  'replaced $ matches': '已替换 $ 处匹配项',

  /* 自动补全（@codemirror/autocomplete） */
  Completions: '补全建议'
}

/** 供扩展列表使用 */
export const chinesePhrases = EditorState.phrases.of(EDITOR_PHRASES)
