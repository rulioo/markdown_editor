/**
 * 表格的 Live Preview：光标不在表格里时，把整段表格源码换成渲染好的 <table>。
 *
 * 为什么单独一个模块、而不是并进 livePreview.ts 的 ViewPlugin：
 * **CM6 不允许 ViewPlugin 提供块级装饰**。ViewPlugin 的 decorations 会被注册成
 * `EditorView.decorations.of(view => ...)`，DocView.updateDeco 用 `typeof d == "function"`
 * 判定「动态来源」，而动态来源在 TileUpdate.emit 里会直接抛：
 *
 *     RangeError: Block decorations may not be specified via plugins
 *
 * 官方文档（EditorView.decorations）同样写明：函数式提供的装饰「不得引入块级 widget
 * 或跨行的替换装饰」——它们在视口算完之后才算，会打乱纵向布局。实机验证过，确实抛。
 * 所以块替换只能由 StateField 直接提供（`EditorView.decorations.from(field)`），
 * 这也是 @codemirror/language 里 foldState 的既有做法。
 *
 * 另一个反直觉的点：StateField 看不见 viewport，但这里**不需要**看见。
 * 语法树是惰性解析的，syntaxTree(state) 本来就只覆盖「已解析的那一段」（视口 + 预读），
 * 遍历它天然就是「只算看得见的地方」；代价是解析前沿推进时要重算一次，见下面 update。
 *
 * 表格源码交给 renderMarkdown 渲染，与分栏预览共用同一条管线——
 * 两处对表格的渲染结果因此必然一致，不用靠人去同步两套实现。
 */

import { syntaxTree } from '@codemirror/language'
import { StateField, type EditorState, type Range } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, WidgetType } from '@codemirror/view'
import { renderMarkdown } from '../preview/render'
import { activeLineSpans, isLineActive } from './livePreview'

/**
 * 可能作为 Table 祖先的节点。markdown 的表格只长在文档根、引用块和列表项里
 * （列表项外面还套着 BulletList / OrderedList）。
 *
 * 命中这些节点才继续往下走，其余一律 return false 剪掉——于是遍历的只是「块的骨架」，
 * 而不是每个段落里的每个 inline 节点。表格通常很少，剪枝省下的才是大头。
 */
const CONTAINERS = new Set(['Document', 'Blockquote', 'BulletList', 'OrderedList', 'ListItem'])

/** 表格源码在文档里的行对齐区间 */
interface TableRange {
  /** 表格首行的行首 */
  from: number
  /** 表格末行的行尾，**不含**换行符 */
  to: number
  /** 表格源码，直接喂给 renderMarkdown */
  source: string
}

interface TableState {
  /**
   * 已解析区域里的表格。只随文档 / 语法树变化，与选区无关——
   * 分开缓存是为了让方向键（只有选区变）不必重扫整棵树。
   */
  tables: TableRange[]
  decorations: DecorationSet
}

/**
 * 表格 widget。
 *
 * 关键：**renderMarkdown 只在 toDOM / updateDOM 里调，绝不在构造函数里调**。
 * 装饰集每次事务都会重建，构造函数里渲染等于「文档里每张表每次按键都跑一遍 remark」；
 * 而 toDOM 只在 widget 真正进入 DOM 时才被调用（CM6 只渲染视口内的部分）。
 */
class TableWidget extends WidgetType {
  constructor(private readonly source: string) {
    super()
  }

  /** 源码没变就复用原来的 DOM——在文档别处打字不该让表格重新渲染 */
  eq(other: TableWidget): boolean {
    return other.source === this.source
  }

  toDOM(): HTMLElement {
    const dom = document.createElement('div')
    dom.className = 'cm-lp-table'
    // renderMarkdown 已做两层防护：原始 HTML 转义进 <span class="raw-html">、
    // sanitizeUrls 剥掉非白名单协议。这里是新的 innerHTML 落点，单测会钉住这两点。
    dom.innerHTML = renderMarkdown(this.source)
    return dom
  }

  /** 表格内容变了就地换 innerHTML，省掉一次 DOM 重建 */
  updateDOM(dom: HTMLElement): boolean {
    dom.innerHTML = renderMarkdown(this.source)
    return true
  }

  /**
   * 放行 mousedown，其余事件当作外部事件忽略。
   *
   * WidgetType 默认 ignoreEvent 返回 true，整个 widget 会变成「死区」——鼠标点上去
   * 什么都不会发生。放行 mousedown 后 CM6 的 posAtCoords 会把点击映射到块的首/尾，
   * 于是点表格就能把光标放进表格、进而显示源码继续编辑。
   *
   * 代价：渲染出来的表格里的链接点不动。MarkText 里表格也是渲染态，行为一致。
   */
  ignoreEvent(event: Event): boolean {
    return event.type !== 'mousedown'
  }
}

/** 找出已解析区域里的所有表格，并做行对齐 */
function findTables(state: EditorState): TableRange[] {
  const tables: TableRange[] = []

  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name === 'Table') {
        // 行对齐：块替换必须整行整行地覆盖，否则行首行尾会剩半截文本。
        // 但**不能**把末行的换行符圈进来——圈进去会把表格后面那个空行一起吃掉，
        // 实机对比过，「表格 — 空行 — 正文」会变成「表格 — 正文」。
        const from = state.doc.lineAt(node.from).from
        const to = state.doc.lineAt(node.to).to
        tables.push({ from, to, source: state.doc.sliceString(from, to) })
        return false
      }
      // 不在白名单里的节点不可能含表格，连同子树一起剪掉
      return CONTAINERS.has(node.name) ? undefined : false
    }
  })

  return tables
}

/** 把「不在活动行上的表格」换成块级 widget */
function decorate(tables: TableRange[], state: EditorState): DecorationSet {
  const spans = activeLineSpans(state)
  const ranges: Range<Decoration>[] = []

  for (const table of tables) {
    const first = state.doc.lineAt(table.from).number
    const last = state.doc.lineAt(table.to).number

    let active = false
    for (let n = first; n <= last; n += 1) {
      if (isLineActive(spans, n)) {
        active = true
        break
      }
    }
    // 光标在表格里：保持源码可编辑
    if (active) continue

    ranges.push(
      Decoration.replace({ block: true, widget: new TableWidget(table.source) }).range(
        table.from,
        table.to
      )
    )
  }

  // 无需 RangeSetBuilder：这里的 range 天然按 from 递增，但沿用 livePreview 的写法，
  // 交给 Decoration.set 排序更省心（第二个参数 true = 自动排序）
  return Decoration.set(ranges, true)
}

export const tablePreview = StateField.define<TableState>({
  create(state) {
    const tables = findTables(state)
    return { tables, decorations: decorate(tables, state) }
  },

  update(value, tr) {
    // 语法树变了也要重算：parseWorker 推进解析前沿时会 dispatch 一个**不带**
    // docChanged / selection 的事务（滚动就会触发）。只认 docChanged 的话，
    // 往下滚出来的表格要等到下一次按键才会渲染。
    const treeChanged = syntaxTree(tr.startState) !== syntaxTree(tr.state)

    if (!tr.docChanged && !treeChanged) {
      // 只有选区动了：表格区间和源码都还能用，只需重算「哪几张表要还原成源码」。
      // 方向键是最高频的操作，跳过整棵树的重扫就值这个分支。
      if (!tr.selection) return value
      return { tables: value.tables, decorations: decorate(value.tables, tr.state) }
    }

    const tables = findTables(tr.state)
    return { tables, decorations: decorate(tables, tr.state) }
  },

  /** 直接提供（不是函数）：块级装饰只允许来自直接来源 */
  provide: (field) => EditorView.decorations.from(field, (value) => value.decorations)
})
