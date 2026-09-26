import { EditorSelection, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterEach, describe, expect, it } from 'vitest'
import * as fmt from './format'

/**
 * 这些测试断言的是**按下命令之后文档长什么样**。
 * 用真实的 EditorView 而不是纯函数，是因为选区映射（光标落在哪）
 * 正是这类操作最容易出错的地方——只比对文本会漏掉。
 */

let view: EditorView | null = null

function makeView(doc: string, from?: number, to?: number): EditorView {
  const parent = document.createElement('div')
  document.body.appendChild(parent)
  view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      // 生产环境里 host.ts 开了这个开关；不开的话多选区会被折叠成主选区，
      // 多光标用例就测不出真实行为了
      extensions: [EditorState.allowMultipleSelections.of(true)],
      selection: from === undefined ? undefined : EditorSelection.range(from, to ?? from)
    })
  })
  return view
}

/** 取当前主选区的 [from, to]，用来验证光标位置 */
function selection(view: EditorView): [number, number] {
  const range = view.state.selection.main
  return [range.from, range.to]
}

afterEach(() => {
  view?.destroy()
  view = null
  document.body.innerHTML = ''
})

describe('toggleInline', () => {
  it('包裹选中的文字', () => {
    const v = makeView('hello world', 0, 5)
    fmt.toggleInline(v, '**')
    expect(v.state.doc.toString()).toBe('**hello** world')
  })

  it('再按一次取消包裹', () => {
    const v = makeView('**hello** world', 2, 7)
    fmt.toggleInline(v, '**')
    expect(v.state.doc.toString()).toBe('hello world')
  })

  it('没有选区时插入一对标记并把光标放中间', () => {
    const v = makeView('ab', 1)
    fmt.toggleInline(v, '**')
    expect(v.state.doc.toString()).toBe('a****b')
    // 光标应落在四个星号中间，直接开打即可
    expect(selection(v)).toEqual([3, 3])
  })

  it('用不同的开合标记包裹（下划线）', () => {
    const v = makeView('text', 0, 4)
    fmt.toggleInline(v, '<u>', '</u>')
    expect(v.state.doc.toString()).toBe('<u>text</u>')
  })

  it('多光标同时加粗', () => {
    const v = makeView('aa bb', undefined)
    v.dispatch({ selection: EditorSelection.create([EditorSelection.range(0, 2), EditorSelection.range(3, 5)]) })
    fmt.toggleInline(v, '**')
    expect(v.state.doc.toString()).toBe('**aa** **bb**')
  })
})

describe('setHeading', () => {
  it('给正文加上标题标记', () => {
    const v = makeView('标题', 0)
    fmt.setHeading(v, 2)
    expect(v.state.doc.toString()).toBe('## 标题')
  })

  it('替换已有的标题级别', () => {
    const v = makeView('### 标题', 0)
    fmt.setHeading(v, 1)
    expect(v.state.doc.toString()).toBe('# 标题')
  })

  it('再设成同一级别则退回正文', () => {
    const v = makeView('## 标题', 0)
    fmt.setHeading(v, 2)
    expect(v.state.doc.toString()).toBe('标题')
  })

  it('level 为 0 时退回正文', () => {
    const v = makeView('###### 标题', 0)
    fmt.setHeading(v, 0)
    expect(v.state.doc.toString()).toBe('标题')
  })

  it('多行选区逐行加标题', () => {
    const v = makeView('第一行\n第二行', 0, 7)
    fmt.setHeading(v, 3)
    expect(v.state.doc.toString()).toBe('### 第一行\n### 第二行')
  })
})

describe('列表与引用', () => {
  it('加无序列表', () => {
    const v = makeView('项目', 0)
    fmt.toggleUnorderedList(v)
    expect(v.state.doc.toString()).toBe('- 项目')
  })

  it('再按一次取消', () => {
    const v = makeView('- 项目', 0)
    fmt.toggleUnorderedList(v)
    expect(v.state.doc.toString()).toBe('项目')
  })

  it('有序列表按顺序编号', () => {
    const v = makeView('甲\n乙\n丙', 0, 5)
    fmt.toggleOrderedList(v)
    expect(v.state.doc.toString()).toBe('1. 甲\n2. 乙\n3. 丙')
  })

  it('无序列表切成有序列表（顶掉原标记而不是叠加）', () => {
    const v = makeView('- 项目', 0)
    fmt.toggleOrderedList(v)
    expect(v.state.doc.toString()).toBe('1. 项目')
  })

  it('任务列表排在无序列表之前判断', () => {
    const v = makeView('- [ ] 待办', 0)
    // 已经是任务列表，再按一次应当取消，而不是变成 `- - [ ] 待办`
    fmt.toggleTaskList(v)
    expect(v.state.doc.toString()).toBe('待办')
  })

  it('加引用', () => {
    const v = makeView('引用内容', 0)
    fmt.toggleQuote(v)
    expect(v.state.doc.toString()).toBe('> 引用内容')
  })

  it('标题切成列表时不会留下 #', () => {
    const v = makeView('## 标题', 0)
    fmt.toggleUnorderedList(v)
    expect(v.state.doc.toString()).toBe('- 标题')
  })
})

describe('缩进', () => {
  it('增加缩进', () => {
    const v = makeView('一行\n二行', 0, 5)
    fmt.indent(v)
    expect(v.state.doc.toString()).toBe('  一行\n  二行')
  })

  it('减少缩进', () => {
    const v = makeView('  一行', 0)
    fmt.outdent(v)
    expect(v.state.doc.toString()).toBe('一行')
  })

  it('对没有缩进的行减少缩进时原样不动', () => {
    const v = makeView('一行', 0)
    fmt.outdent(v)
    expect(v.state.doc.toString()).toBe('一行')
  })
})

describe('插入类操作', () => {
  it('把选中文字变成链接，并选中 url 占位符', () => {
    const v = makeView('点这里', 0, 3)
    fmt.insertLink(v)
    expect(v.state.doc.toString()).toBe('[点这里](url)')
    // 选中的应当是 url，直接输入就能替换
    const [from, to] = selection(v)
    expect(v.state.sliceDoc(from, to)).toBe('url')
  })

  it('无选中文字时用占位符', () => {
    const v = makeView('', 0)
    fmt.insertLink(v)
    expect(v.state.doc.toString()).toBe('[链接文字](url)')
  })

  it('插入代码块后光标在两个围栏之间', () => {
    const v = makeView('', 0)
    fmt.insertCodeBlock(v)
    expect(v.state.doc.toString()).toBe('```\n\n```')
    const line = v.state.doc.lineAt(v.state.selection.main.head)
    expect(line.number).toBe(2)
  })

  it('选中文字时用围栏包起来', () => {
    const v = makeView('const a = 1', 0, 11)
    fmt.insertCodeBlock(v)
    expect(v.state.doc.toString()).toBe('```\nconst a = 1\n```')
  })

  it('插入表格骨架', () => {
    const v = makeView('', 0)
    fmt.insertTable(v)
    const doc = v.state.doc.toString()
    expect(doc.split('\n')).toHaveLength(3)
    expect(doc).toContain('| --- | --- | --- |')
  })

  it('在行中间插入代码块时先换行，保证独占一行', () => {
    const v = makeView('前面', 2)
    fmt.insertCodeBlock(v)
    expect(v.state.doc.toString()).toBe('前面\n```\n\n```')
  })

  it('插入日期时间', () => {
    const v = makeView('', 0)
    fmt.insertDateTime(v, new Date(2026, 8, 26, 14, 5))
    expect(v.state.doc.toString()).toBe('2026-09-26 14:05')
  })
})

describe('大小写与清除格式', () => {
  it('选区转大写', () => {
    const v = makeView('hello', 0, 5)
    fmt.transformCase(v, 'upper')
    expect(v.state.doc.toString()).toBe('HELLO')
  })

  it('无选区时转换光标所在单词', () => {
    const v = makeView('hello world', 3)
    fmt.transformCase(v, 'upper')
    expect(v.state.doc.toString()).toBe('HELLO world')
  })

  it('清除行内标记', () => {
    const source = '**粗** 和 *斜* 和 `码`'
    const v = makeView(source, 0, source.length)
    fmt.clearFormatting(v)
    expect(v.state.doc.toString()).toBe('粗 和 斜 和 码')
  })
})

describe('currentHeadingLevel', () => {
  it('识别当前行的标题级别', () => {
    const v = makeView('# 一\n### 三', 6)
    expect(fmt.currentHeadingLevel(v)).toBe(3)
  })

  it('正文返回 0', () => {
    const v = makeView('正文', 0)
    expect(fmt.currentHeadingLevel(v)).toBe(0)
  })
})
