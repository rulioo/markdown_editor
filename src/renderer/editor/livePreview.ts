/**
 * Live Preview（所见即所得）装饰。
 *
 * 思路是 Typora / MarkText 那一套：**光标所在的行显示源码，其余行渲染成效果**。
 * 具体做法不是另建一份 HTML，而是在 CM6 的语法树上盖两层装饰：
 *
 *   1. `Decoration.mark` —— 给节点套一个 class，由 CSS 把它画成标题/粗体/代码…；
 *   2. `Decoration.replace({})` —— 把 `#`、`**`、`` ` ``、`>` 这些**标记本身抹掉**。
 *
 * 关键约束：**绝不能抹掉光标所在行的标记**，否则光标无处安放、也没法编辑语法。
 * 因此每次构建装饰前先算出选区覆盖了哪些行（activeLines），命中就只上样式、不隐藏标记。
 *
 * 装饰只对 `view.visibleRanges` 内的节点计算——文档再大，开销也只跟视口有关。
 */

import { syntaxTree } from '@codemirror/language'
import type { EditorState, Range } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view'

/** 抹掉标记（零宽替换，不产生任何可见内容） */
const hide = Decoration.replace({})

/**
 * 标记后面还跟着的那一个空格也要一并抹掉。
 *
 * `## 标题` 里 `##` 是 HeaderMark、` 标题` 才是内容。只抹标记的话会剩下一个前导空格，
 * 于是每条标题都比正文多缩进一格——实机验证时一眼就能看出来。
 * 引用 `> 引用` 是同样的问题。
 *
 * 只吃一个空格，且只在确实是空格时才延伸（行尾是换行符，不受影响）。
 */
function pastTrailingSpace(state: EditorState, to: number): number {
  return state.doc.sliceString(to, to + 1) === ' ' ? to + 1 : to
}

/** 节点整体样式 */
const nodeMarks: Record<string, Decoration> = {}
function nodeMark(className: string): Decoration {
  let deco = nodeMarks[className]
  if (!deco) {
    deco = Decoration.mark({ class: className })
    nodeMarks[className] = deco
  }
  return deco
}

/** 行级样式（整行加 class，用于引用块、分隔线、代码块底色） */
const lineMarks: Record<string, Decoration> = {}
function lineMark(className: string): Decoration {
  let deco = lineMarks[className]
  if (!deco) {
    deco = Decoration.line({ class: className })
    lineMarks[className] = deco
  }
  return deco
}

/** 标题 → class。Setext 标题（下划线式）在源码里不抹标记，只上样式 */
const HEADING_CLASS: Record<string, string> = {
  ATXHeading1: 'cm-lp-h1',
  ATXHeading2: 'cm-lp-h2',
  ATXHeading3: 'cm-lp-h3',
  ATXHeading4: 'cm-lp-h4',
  ATXHeading5: 'cm-lp-h5',
  ATXHeading6: 'cm-lp-h6',
  SetextHeading1: 'cm-lp-h1',
  SetextHeading2: 'cm-lp-h2'
}

export interface LineSpan {
  from: number
  to: number
}

/**
 * 选区覆盖的行区间；用区间数组而不是行号集合，避免大段选中时构建出巨大的 Set。
 *
 * 与 isLineActive 一起被 tablePreview.ts 复用——「光标所在行显示源码」这条规则
 * 必须在所有语法上表现一致，所以判定逻辑只能有一份。
 */
export function activeLineSpans(state: EditorState): LineSpan[] {
  return state.selection.ranges.map((range) => ({
    from: state.doc.lineAt(range.from).number,
    to: state.doc.lineAt(range.to).number
  }))
}

export function isLineActive(spans: LineSpan[], lineNumber: number): boolean {
  for (const span of spans) {
    if (lineNumber >= span.from && lineNumber <= span.to) return true
  }
  return false
}

function buildDecorations(view: EditorView): DecorationSet {
  const ranges: Range<Decoration>[] = []
  const { state } = view
  const spans = activeLineSpans(state)

  /** 该节点所在行是否处于编辑状态（是则保留标记） */
  const nodeActive = (from: number, to: number): boolean => {
    const startLine = state.doc.lineAt(from).number
    const endLine = state.doc.lineAt(to).number
    for (let n = startLine; n <= endLine; n++) {
      if (isLineActive(spans, n)) return true
    }
    return false
  }

  for (const { from: viewFrom, to: viewTo } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from: viewFrom,
      to: viewTo,
      enter: (node) => {
        const name = node.name
        const parentName = node.node.parent?.name ?? ''

        /* ------------------------------ 内容样式 ------------------------------ */

        const headingClass = HEADING_CLASS[name]
        if (headingClass) {
          ranges.push(nodeMark(headingClass).range(node.from, node.to))
        } else if (name === 'StrongEmphasis') {
          ranges.push(nodeMark('cm-lp-strong').range(node.from, node.to))
        } else if (name === 'Emphasis') {
          ranges.push(nodeMark('cm-lp-em').range(node.from, node.to))
        } else if (name === 'Strikethrough') {
          ranges.push(nodeMark('cm-lp-strike').range(node.from, node.to))
        } else if (name === 'InlineCode') {
          ranges.push(nodeMark('cm-lp-code').range(node.from, node.to))
        } else if (name === 'Link') {
          ranges.push(nodeMark('cm-lp-link').range(node.from, node.to))
        } else if (name === 'Image') {
          ranges.push(nodeMark('cm-lp-image').range(node.from, node.to))
        } else if (name === 'Blockquote') {
          // 引用块：逐行加左竖线。行数按视口裁剪，长引用块不会拖慢渲染
          const first = Math.max(state.doc.lineAt(node.from).number, state.doc.lineAt(viewFrom).number)
          const last = Math.min(state.doc.lineAt(node.to).number, state.doc.lineAt(viewTo).number)
          for (let n = first; n <= last; n++) {
            ranges.push(lineMark('cm-lp-quote').range(state.doc.line(n).from))
          }
        } else if (name === 'HorizontalRule') {
          ranges.push(lineMark('cm-lp-hr').range(state.doc.lineAt(node.from).from))
        } else if (name === 'FencedCode') {
          const first = Math.max(state.doc.lineAt(node.from).number, state.doc.lineAt(viewFrom).number)
          const last = Math.min(state.doc.lineAt(node.to).number, state.doc.lineAt(viewTo).number)
          for (let n = first; n <= last; n++) {
            ranges.push(lineMark('cm-lp-codeblock').range(state.doc.line(n).from))
          }
        } else if (name === 'TaskMarker') {
          ranges.push(nodeMark('cm-lp-task').range(node.from, node.to))
        }

        /* ------------------------------ 抹掉标记 ------------------------------ */
        // 只处理叶子级标记节点；父节点名用来区分「行内代码的反引号」与「围栏代码块的反引号」
        if (nodeActive(node.from, node.to)) return

        switch (name) {
          case 'HeaderMark':
          case 'QuoteMark':
            // 连同标记后面的那个空格一起抹，否则标题/引用会比正文多缩进一格
            ranges.push(hide.range(node.from, pastTrailingSpace(state, node.to)))
            break
          case 'EmphasisMark':
          case 'StrikethroughMark':
          case 'HorizontalRule':
            // 这些标记紧贴内容（`**粗**`、`~~删~~`），后面没有空格要处理
            ranges.push(hide.range(node.from, node.to))
            break
          // TaskMarker（[ ] / [x]）刻意不抹：抹掉就没有勾选框了。
          // 真正的复选框控件需要 WidgetType，排在 M2 与其余 Live Preview 细节一起做。
          case 'CodeMark':
            // 围栏代码块的 ``` 保留可见——抹掉会让人分不清代码块边界
            if (parentName === 'InlineCode') ranges.push(hide.range(node.from, node.to))
            break
          case 'LinkMark':
          case 'URL':
            // [文字](链接) → 只留「文字」；光标移到该行即可看到完整写法
            if (parentName === 'Link' || parentName === 'Image') {
              ranges.push(hide.range(node.from, node.to))
            }
            break
          default:
            break
        }
      }
    })
  }

  // RangeSetBuilder 要求按 from 严格递增，而这里 mark 与 replace 会交叉嵌套，
  // 交给 Decoration.set 排序更省心（第二个参数 true = 自动排序）
  return Decoration.set(ranges, true)
}

class LivePreviewPlugin {
  decorations: DecorationSet

  constructor(view: EditorView) {
    this.decorations = buildDecorations(view)
  }

  update(update: ViewUpdate): void {
    // 选区变化也要重算：光标移入/移出某行会决定那一行显示源码还是渲染结果
    if (update.docChanged || update.viewportChanged || update.selectionSet) {
      this.decorations = buildDecorations(update.view)
    }
  }
}

export const livePreview = ViewPlugin.fromClass(LivePreviewPlugin, {
  decorations: (plugin) => plugin.decorations
})
