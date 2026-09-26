import { forceParsing } from '@codemirror/language'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState } from '@codemirror/state'
import { EditorView, type DecorationSet } from '@codemirror/view'
import { afterEach, describe, expect, it } from 'vitest'
import { tablePreview } from './tablePreview'

/**
 * 表格 Live Preview 的核心行为：**光标不在表格里就渲染成表格，在里面就显示源码**。
 *
 * 与 livePreview.test.ts 同样的取舍：断言装饰集合并辅以 DOM 断言，不做布局断言——
 * jsdom 没有真实布局，widget 会构建 DOM 但量不到尺寸。
 *
 * 两个 jsdom 相关的注意点：
 *  1. 语法树是惰性解析的，jsdom 里的解析前沿只有几 KB。所有用例的文档都很短，
 *     并统一用 forceParsing 把解析推到底，否则「表格没渲染」会被误判成 bug。
 *  2. 块级装饰由 StateField 直接提供（不是 ViewPlugin），所以读的是
 *     `view.state.field(tablePreview)`，而不是 `view.plugin(...)`。
 */

const TABLE = '| 姓名 | 年龄 |\n| --- | --- |\n| 张三 | 28 |'

let view: EditorView | null = null

function makeView(doc: string, cursor: number): EditorView {
  const parent = document.createElement('div')
  document.body.appendChild(parent)
  view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      selection: EditorSelection.cursor(cursor),
      extensions: [markdown({ base: markdownLanguage }), tablePreview]
    })
  })
  forceParsing(view, view.state.doc.length, 5000)
  return view
}

function moveCursor(v: EditorView, pos: number): void {
  v.dispatch({ selection: EditorSelection.cursor(pos) })
}

/** 所有「块级替换」装饰覆盖到的文本（即被换成表格 widget 的那些行） */
function replacedTables(v: EditorView): string[] {
  const set = v.state.field(tablePreview).decorations as DecorationSet
  const result: string[] = []
  const iter = set.iter()
  while (iter.value) {
    if ((iter.value.spec as { widget?: unknown }).widget !== undefined) {
      result.push(v.state.doc.sliceString(iter.from, iter.to))
    }
    iter.next()
  }
  return result
}

/** widget 渲染出来的 DOM（只有视口内的才会真正 toDOM） */
function tableDom(v: EditorView): HTMLElement[] {
  return Array.from(v.contentDOM.querySelectorAll<HTMLElement>('.cm-lp-table'))
}

/** 把光标挪到表格外的文档末尾 */
function cursorToEnd(v: EditorView): void {
  moveCursor(v, v.state.doc.length)
}

afterEach(() => {
  view?.destroy()
  view = null
  document.body.innerHTML = ''
})

describe('表格 Live Preview', () => {
  it('光标在表格外时，整张表被替换，并渲染出真正的 table', () => {
    const v = makeView(`${TABLE}\n\n后面的正文`, 0)
    cursorToEnd(v)

    expect(replacedTables(v)).toEqual([TABLE])
    const dom = tableDom(v)
    expect(dom).toHaveLength(1)
    expect(dom[0].querySelector('table')).not.toBeNull()
    expect(dom[0].querySelector('th')?.textContent).toBe('姓名')
    expect(dom[0].querySelectorAll('td')[1].textContent).toBe('28')
  })

  it('光标在表格里时，还原成源码（可编辑）', () => {
    const v = makeView(`${TABLE}\n\n后面的正文`, 5)

    expect(replacedTables(v)).toEqual([])
    expect(tableDom(v)).toHaveLength(0)
    expect(v.contentDOM.textContent).toContain('| 姓名 | 年龄 |')
  })

  it('从表格外移进表格，同一次事务里就还原成源码', () => {
    const v = makeView(`${TABLE}\n\n后面的正文`, 0)
    cursorToEnd(v)
    expect(replacedTables(v)).toHaveLength(1)

    // 进入表格第二行
    moveCursor(v, v.state.doc.line(2).from + 1)
    expect(replacedTables(v)).toEqual([])
  })

  it('选区横跨表格边界时还原成源码', () => {
    const v = makeView(`${TABLE}\n\n后面的正文`, 0)
    v.dispatch({ selection: EditorSelection.range(0, v.state.doc.length) })

    expect(replacedTables(v)).toEqual([])
  })

  it('表格的替换范围是行对齐的', () => {
    const v = makeView(`前面的正文\n\n${TABLE}\n\n后面的正文`, 0)
    expect(replacedTables(v)).toEqual([TABLE])

    const set = v.state.field(tablePreview).decorations as DecorationSet
    const iter = set.iter()
    expect(iter.from).toBe(v.state.doc.line(3).from)
    expect(iter.to).toBe(v.state.doc.line(5).to)
  })

  it('表格后面的空行不会被吃掉', () => {
    // 「不把行尾换行符圈进替换范围」的钉子：
    // 圈进去的话，表格与正文之间的空行会一起消失
    const v = makeView(`前面的正文\n\n${TABLE}\n\n后面的正文`, 0)
    const set = v.state.field(tablePreview).decorations as DecorationSet
    const iter = set.iter()

    expect(v.state.doc.sliceString(iter.to, iter.to + 1)).toBe('\n')
    expect(v.state.doc.lineAt(iter.to + 1).text).toBe('')
  })

  it('两张表格，光标在其中一张里时，另一张仍然渲染', () => {
    const second = '| a | b |\n| --- | --- |\n| 1 | 2 |'
    const v = makeView(`${TABLE}\n\n中间的正文\n\n${second}`, 0)

    const secondStart = v.state.doc.toString().indexOf('| a | b |')
    moveCursor(v, secondStart + 3)

    expect(replacedTables(v)).toEqual([TABLE])
  })

  it('引用块与列表项里的表格也能被找到', () => {
    // 钉住 CONTAINERS 剪枝：剪错的话这两处的表格会找不到
    const quoted = makeView(`> ${TABLE.replace(/\n/g, '\n> ')}\n\n尾`, 0)
    cursorToEnd(quoted)
    expect(replacedTables(quoted)).toHaveLength(1)
    quoted.destroy()

    const listed = makeView(`- 列表项\n\n  ${TABLE.replace(/\n/g, '\n  ')}\n\n尾`, 0)
    cursorToEnd(listed)
    expect(replacedTables(listed)).toHaveLength(1)
  })

  it('单列表格也能渲染', () => {
    const v = makeView('| 只有一列 |\n| --- |\n| 值 |\n\n尾', 0)
    cursorToEnd(v)

    expect(replacedTables(v)).toHaveLength(1)
    expect(tableDom(v)[0].querySelector('th')?.textContent).toBe('只有一列')
  })

  it('只有表头没有表体时也能渲染', () => {
    const v = makeView('| a | b |\n| --- | --- |\n\n尾', 0)
    cursorToEnd(v)

    expect(replacedTables(v)).toHaveLength(1)
    expect(tableDom(v)[0].querySelectorAll('th')).toHaveLength(2)
  })

  it('不齐的行与空单元格都不会抛错', () => {
    const v = makeView('| a | b | c |\n| --- | --- | --- |\n| 1 |\n|  |  |  |\n\n尾', 0)
    expect(() => cursorToEnd(v)).not.toThrow()
    expect(replacedTables(v)).toHaveLength(1)
  })

  it('在文档别处打字不会重建表格 DOM', () => {
    // 保护「renderMarkdown 只在 toDOM 里调」这个决定：
    // 若有人把它挪进构造函数，每次按键都会重建 DOM。
    // 用**节点引用是否还是同一个**来判定，比数调用次数更直接。
    const v = makeView(`${TABLE}\n\n结尾正文`, 0)
    cursorToEnd(v)

    const before = tableDom(v)[0]
    expect(before).toBeDefined()

    for (let i = 0; i < 5; i += 1) {
      v.dispatch({ changes: { from: v.state.doc.length, insert: 'x' } })
    }
    forceParsing(v, v.state.doc.length, 5000)

    const after = tableDom(v)
    expect(after).toHaveLength(1)
    // 同一个 DOM 节点 —— 说明没有重建
    expect(after[0]).toBe(before)
    expect(after[0].querySelector('th')?.textContent).toBe('姓名')
  })

  it('单元格里的 HTML 不会变成真标签', () => {
    const v = makeView(
      '| a | b |\n| --- | --- |\n| <script>alert(1)</script> | 2 |\n\n尾',
      0
    )
    cursorToEnd(v)

    const dom = tableDom(v)[0]
    expect(dom.querySelector('script')).toBeNull()
    expect(dom.innerHTML).toContain('raw-html')
  })

  it('单元格里的 javascript: 链接的 href 被删掉', () => {
    const v = makeView('| a |\n| --- |\n| [x](javascript:alert(1)) |\n\n尾', 0)
    cursorToEnd(v)

    const anchor = tableDom(v)[0].querySelector('a')
    expect(anchor).not.toBeNull()
    expect(anchor?.getAttribute('href')).toBeNull()
  })

  it('没有 tablePreview 扩展时（源码模式）不产生任何表格 widget', () => {
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    const sourceView = new EditorView({
      parent,
      state: EditorState.create({
        doc: `${TABLE}\n\n后面的正文`,
        extensions: [markdown({ base: markdownLanguage })]
      })
    })
    forceParsing(sourceView, sourceView.state.doc.length, 5000)

    expect(sourceView.contentDOM.querySelectorAll('.cm-lp-table')).toHaveLength(0)
    sourceView.destroy()
  })
})
