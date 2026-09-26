/**
 * Markdown 编辑操作（加粗、标题、列表、引用、插入代码块…）。
 *
 * 两条实现纪律：
 *
 * 1. **改动要尽量小。** 例如加列表符号时只插入行首的 `- `，
 *    而不是把整行替换成新文本——后者会让光标跳到行尾，输入体验很差。
 *
 * 2. **支持多选区。** 一律走 `state.changeByRange`，CM6 会为每个光标
 *    分别调用回调并自动合并结果，多光标下行为自然正确。
 */

import { EditorSelection, type ChangeSpec } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'

/* ------------------------------ 行内标记 ------------------------------ */

/**
 * 用标记包裹/取消包裹选区。
 * 选区为空时插入一对标记并把光标放在中间，方便直接开打。
 */
export function toggleInline(view: EditorView, open: string, close: string = open): void {
  const { state } = view
  const result = state.changeByRange((range) => {
    const before = state.sliceDoc(Math.max(0, range.from - open.length), range.from)
    const after = state.sliceDoc(range.to, Math.min(state.doc.length, range.to + close.length))

    // 已被同样的标记包着 → 取消
    if (before === open && after === close) {
      return {
        changes: [
          { from: range.from - open.length, to: range.from },
          { from: range.to, to: range.to + close.length }
        ] as ChangeSpec[],
        range: EditorSelection.range(range.from - open.length, range.to - open.length)
      }
    }

    return {
      changes: [
        { from: range.from, insert: open },
        { from: range.to, insert: close }
      ] as ChangeSpec[],
      range: EditorSelection.range(range.from + open.length, range.to + open.length)
    }
  })
  view.dispatch({ ...result, userEvent: 'input' })
}

/* ------------------------------ 块级标记 ------------------------------ */

/** 块级标记的种类，决定「切换」时该顶掉谁 */
type BlockKind = 'heading' | 'quote' | 'ul' | 'ol' | 'task'

interface BlockMarker {
  kind: BlockKind
  /** 匹配到的完整标记文本长度（含尾随空格），用于精确删除 */
  length: number
  /** 有序列表的序号 */
  order?: number
}

/**
 * 识别行首已有的块级标记。
 * 任务列表必须排在无序列表之前判断——`- [ ] ` 也以 `- ` 开头。
 */
function matchBlockMarker(text: string): BlockMarker | null {
  const task = /^([-*+])\s+\[[ xX]\]\s+/.exec(text)
  if (task) return { kind: 'task', length: task[0].length }

  const heading = /^#{1,6}\s+/.exec(text)
  if (heading) return { kind: 'heading', length: heading[0].length }

  const quote = /^>\s?/.exec(text)
  if (quote) return { kind: 'quote', length: quote[0].length }

  const ol = /^(\d+)\.\s+/.exec(text)
  if (ol) return { kind: 'ol', length: ol[0].length, order: Number(ol[1]) }

  const ul = /^[-*+]\s+/.exec(text)
  if (ul) return { kind: 'ul', length: ul[0].length }

  return null
}

/** 取选区覆盖到的所有行（去重、按文档顺序） */
function selectedLines(state: EditorView['state']): { number: number; from: number; to: number; text: string }[] {
  const seen = new Set<number>()
  const lines: { number: number; from: number; to: number; text: string }[] = []
  for (const range of state.selection.ranges) {
    const start = state.doc.lineAt(range.from).number
    const end = state.doc.lineAt(range.to).number
    for (let n = start; n <= end; n++) {
      if (seen.has(n)) continue
      seen.add(n)
      const line = state.doc.line(n)
      lines.push({ number: n, from: line.from, to: line.to, text: line.text })
    }
  }
  return lines
}

/**
 * 切换块级标记。
 *
 * @param kind   目标标记种类
 * @param prefix 生成标记文本；`index` 是该行在选区中的序号（有序列表用来编号）
 *
 * 全部命中同种标记 → 整段取消；否则统一换成目标标记。
 */
function toggleBlock(view: EditorView, kind: BlockKind, prefix: (index: number) => string): void {
  const { state } = view
  const lines = selectedLines(state)
  if (lines.length === 0) return

  const markers = lines.map((line) => matchBlockMarker(line.text))
  const allSame = markers.every((marker) => marker?.kind === kind)

  const changes: ChangeSpec[] = []
  lines.forEach((line, index) => {
    const marker = markers[index]
    if (allSame) {
      // 整段取消：只删掉标记本身
      if (marker) changes.push({ from: line.from, to: line.from + marker.length })
      return
    }
    // 换成目标标记：顶掉原有标记（若有），插入新标记
    const replaceTo = line.from + (marker?.length ?? 0)
    changes.push({ from: line.from, to: replaceTo, insert: prefix(index) })
  })

  if (changes.length === 0) return
  view.dispatch({ changes, userEvent: 'input' })
}

export const toggleQuote = (view: EditorView): void => toggleBlock(view, 'quote', () => '> ')
export const toggleUnorderedList = (view: EditorView): void => toggleBlock(view, 'ul', () => '- ')
export const toggleTaskList = (view: EditorView): void => toggleBlock(view, 'task', () => '- [ ] ')
export const toggleOrderedList = (view: EditorView): void =>
  toggleBlock(view, 'ol', (index) => `${index + 1}. `)

/** 设为 N 级标题；level 传 0 表示退回正文 */
export function setHeading(view: EditorView, level: number): void {
  const { state } = view
  const lines = selectedLines(state)
  if (lines.length === 0) return

  const prefix = level > 0 ? `${'#'.repeat(level)} ` : ''
  const changes: ChangeSpec[] = []
  for (const line of lines) {
    const marker = matchBlockMarker(line.text)
    const cut = marker?.kind === 'heading' ? marker.length : 0
    // 已经是该级别 → 取消（等效于退回正文）
    if (level > 0 && cut === prefix.length) {
      changes.push({ from: line.from, to: line.from + cut })
      continue
    }
    changes.push({ from: line.from, to: line.from + cut, insert: prefix })
  }

  if (changes.length === 0) return
  view.dispatch({ changes, userEvent: 'input' })
}

/** 读取当前行（选区起始行）的标题级别，正文返回 0 */
export function currentHeadingLevel(view: EditorView): number {
  const line = view.state.doc.lineAt(view.state.selection.main.from)
  const match = /^(#{1,6})\s+/.exec(line.text)
  return match ? match[1].length : 0
}

export function promoteHeading(view: EditorView): void {
  setHeading(view, Math.max(1, currentHeadingLevel(view) - 1))
}

export function demoteHeading(view: EditorView): void {
  const level = currentHeadingLevel(view)
  setHeading(view, Math.min(6, level === 0 ? 1 : level + 1))
}

/* -------------------------------- 缩进 -------------------------------- */

const INDENT = '  '

export function indent(view: EditorView): void {
  const { state } = view
  const changes: ChangeSpec[] = selectedLines(state).map((line) => ({
    from: line.from,
    insert: INDENT
  }))
  if (changes.length === 0) return
  view.dispatch({ changes, userEvent: 'input' })
}

export function outdent(view: EditorView): void {
  const { state } = view
  const changes: ChangeSpec[] = []
  for (const line of selectedLines(state)) {
    if (line.text.startsWith('\t')) {
      changes.push({ from: line.from, to: line.from + 1 })
    } else if (line.text.startsWith(INDENT)) {
      changes.push({ from: line.from, to: line.from + INDENT.length })
    }
  }
  if (changes.length === 0) return
  view.dispatch({ changes, userEvent: 'input' })
}

/* ------------------------------ 整块插入 ------------------------------ */

/**
 * 在光标处插入一个独立区块（代码块 / 表格 / 分隔线…）。
 *
 * `cursorOffset` 是相对插入文本开头的偏移，用来把光标放进
 * 「用户接下来要打字的地方」——例如围栏代码块的中间。
 */
function insertBlock(view: EditorView, text: string, cursorOffset: number): void {
  const { state } = view
  const range = state.selection.main

  // 不在行首就先换行，保证区块独占一行
  const line = state.doc.lineAt(range.from)
  const needsLeadingNewline = range.from > line.from
  const insert = (needsLeadingNewline ? '\n' : '') + text

  const from = range.from
  const to = range.to
  const anchor = from + (needsLeadingNewline ? 1 : 0) + cursorOffset

  view.dispatch({
    changes: { from, to, insert },
    selection: EditorSelection.cursor(anchor),
    userEvent: 'input'
  })
}

export function insertCodeBlock(view: EditorView): void {
  const { state } = view
  const range = state.selection.main
  const selected = state.sliceDoc(range.from, range.to)

  if (selected) {
    const wrapped = `\`\`\`\n${selected}\n\`\`\``
    view.dispatch({
      changes: { from: range.from, to: range.to, insert: wrapped },
      selection: EditorSelection.range(range.from, range.from + wrapped.length),
      userEvent: 'input'
    })
    return
  }

  const text = '```\n\n```'
  // 光标落在两个围栏之间那一行
  insertBlock(view, text, 4)
}

export function insertTable(view: EditorView): void {
  const text = '| 列 1 | 列 2 | 列 3 |\n| --- | --- | --- |\n|  |  |  |'
  // 光标落在第一个表头单元格里
  insertBlock(view, text, 2)
}

export function insertMathBlock(view: EditorView): void {
  insertBlock(view, '$$\n\n$$', 3)
}

export function insertHorizontalRule(view: EditorView): void {
  insertBlock(view, '---\n', 4)
}

/** 插入超链接；有选中文字就作为链接文字，否则用占位符 */
export function insertLink(view: EditorView): void {
  const { state } = view
  const range = state.selection.main
  const label = state.sliceDoc(range.from, range.to) || '链接文字'
  const text = `[${label}](url)`
  // 选中 `url` 占位符，直接输入即可替换
  const urlFrom = range.from + label.length + 3
  view.dispatch({
    changes: { from: range.from, to: range.to, insert: text },
    selection: EditorSelection.range(urlFrom, urlFrom + 3),
    userEvent: 'input'
  })
}

export function insertImage(view: EditorView): void {
  const { state } = view
  const range = state.selection.main
  const alt = state.sliceDoc(range.from, range.to) || '图片描述'
  const text = `![${alt}](url)`
  const urlFrom = range.from + alt.length + 4
  view.dispatch({
    changes: { from: range.from, to: range.to, insert: text },
    selection: EditorSelection.range(urlFrom, urlFrom + 3),
    userEvent: 'input'
  })
}

/** 插入当前日期时间，格式 2026-09-26 14:30 */
export function insertDateTime(view: EditorView, now = new Date()): void {
  const pad = (n: number): string => String(n).padStart(2, '0')
  const text =
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ` +
    `${pad(now.getHours())}:${pad(now.getMinutes())}`
  const range = view.state.selection.main
  view.dispatch({
    changes: { from: range.from, to: range.to, insert: text },
    selection: EditorSelection.cursor(range.from + text.length),
    userEvent: 'input'
  })
}

/* ------------------------------ 大小写 / 清除 ------------------------------ */

export function transformCase(view: EditorView, mode: 'upper' | 'lower'): void {
  const { state } = view
  const result = state.changeByRange((range) => {
    const text = state.sliceDoc(range.from, range.to)
    // 没有选区时转换当前单词，符合大多数编辑器的习惯
    if (!text) {
      const word = state.wordAt(range.from)
      if (!word) return { range }
      const wordText = state.sliceDoc(word.from, word.to)
      const next = mode === 'upper' ? wordText.toUpperCase() : wordText.toLowerCase()
      return {
        changes: { from: word.from, to: word.to, insert: next },
        range: EditorSelection.range(word.from, word.from + next.length)
      }
    }
    const next = mode === 'upper' ? text.toUpperCase() : text.toLowerCase()
    return {
      changes: { from: range.from, to: range.to, insert: next },
      range: EditorSelection.range(range.from, range.from + next.length)
    }
  })
  view.dispatch({ ...result, userEvent: 'input' })
}

/** 清除选中文本里的行内标记（**, *, ~~, `） */
export function clearFormatting(view: EditorView): void {
  const { state } = view
  const result = state.changeByRange((range) => {
    const text = state.sliceDoc(range.from, range.to)
    if (!text) return { range }
    const cleaned = text
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '$1')
      .replace(/~~(.+?)~~/g, '$1')
      .replace(/`(.+?)`/g, '$1')
    if (cleaned === text) return { range }
    return {
      changes: { from: range.from, to: range.to, insert: cleaned },
      range: EditorSelection.range(range.from, range.from + cleaned.length)
    }
  })
  view.dispatch({ ...result, userEvent: 'input' })
}
