import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState } from '@codemirror/state'
import { EditorView, type DecorationSet } from '@codemirror/view'
import { afterEach, describe, expect, it } from 'vitest'
import { livePreview } from './livePreview'

/**
 * Live Preview 的核心行为只有一条：**光标行显示源码，其余行隐藏标记**。
 *
 * 这里断言装饰集合而不是 DOM：装饰才是这套实现的实质，DOM 只是它的投影。
 * 每个用例都把「被测语法」放在第一行、把光标放到别的行——
 * jsdom 没有真实布局，CM6 只会为可见区域构建装饰，第一行必然在视口内。
 */

let view: EditorView | null = null

function makeView(doc: string, cursor: number): EditorView {
  const parent = document.createElement('div')
  document.body.appendChild(parent)
  view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      selection: EditorSelection.cursor(cursor),
      extensions: [markdown({ base: markdownLanguage }), livePreview]
    })
  })
  return view
}

/** 取出所有「抹掉标记」装饰覆盖到的文本 */
function hiddenTexts(v: EditorView): string[] {
  const set = v.plugin(livePreview)?.decorations as DecorationSet | undefined
  if (!set) return []
  const result: string[] = []
  const iter = set.iter()
  while (iter.value) {
    const spec = iter.value.spec as { class?: string; widget?: unknown }
    // hide 是唯一一种「既无 class 也无 widget」的装饰
    if (spec.class === undefined && spec.widget === undefined && iter.from < iter.to) {
      result.push(v.state.doc.sliceString(iter.from, iter.to))
    }
    iter.next()
  }
  return result
}

afterEach(() => {
  view?.destroy()
  view = null
  document.body.innerHTML = ''
})

describe('Live Preview 装饰', () => {
  it('光标在别处时，标题的 # 被抹掉', () => {
    const v = makeView('# 标题\n\n正文', 6)
    // 抹掉的范围含标记后的空格，所以这里只断言「以 # 开头」，不写死具体长度
    expect(hiddenTexts(v).some((t) => t.startsWith('#'))).toBe(true)
  })

  it('标题标记后面的空格一并抹掉（否则每条标题都多缩进一格）', () => {
    const v = makeView('## 标题\n\n正文', 7)
    // 实测踩过的坑：只抹 `##` 会剩下 " 标题"，实机上一眼就能看出标题没对齐
    expect(hiddenTexts(v)).toContain('## ')
  })

  it('引用的 > 连同后面的空格一起抹掉', () => {
    const v = makeView('正文\n\n> 引用内容', 0)
    expect(hiddenTexts(v)).toContain('> ')
  })

  it('# 后面没有空格时不多抹（不能把内容吃掉一个字）', () => {
    // 注：# 后无空格本就不是合法标题，这里只是确保不会越界多抹
    const v = makeView('正文\n\n#标题', 0)
    const hidden = hiddenTexts(v)
    expect(hidden).not.toContain('#标')
  })

  it('光标在标题行时，# 保持可见（否则没法编辑语法）', () => {
    const v = makeView('# 标题\n\n正文', 2)
    expect(hiddenTexts(v)).not.toContain('#')
  })

  it('光标在别处时，粗体的 ** 被抹掉', () => {
    const v = makeView('a **粗** b\n\n第二段', 14)
    expect(hiddenTexts(v).filter((t) => t === '**')).toHaveLength(2)
  })

  it('光标在粗体所在行时，** 保持可见', () => {
    const v = makeView('a **粗** b\n\n第二段', 5)
    expect(hiddenTexts(v).filter((t) => t === '**')).toHaveLength(0)
  })

  it('行内代码的反引号被抹掉', () => {
    const v = makeView('a `code` b\n\n第二段', 14)
    expect(hiddenTexts(v).filter((t) => t === '`')).toHaveLength(2)
  })

  it('围栏代码块的 ``` 必须保留（抹掉就看不出块边界了）', () => {
    const v = makeView('正文\n\n```js\nconst a = 1\n```\n', 0)
    expect(hiddenTexts(v).some((t) => t.includes('```'))).toBe(false)
  })

  it('链接只保留文字，URL 被抹掉', () => {
    const v = makeView('[链接文字](https://example.com)\n\n第二段', 32)
    const hidden = hiddenTexts(v)
    expect(hidden).toContain('https://example.com')
    expect(hidden).toContain('[')
    expect(hidden).toContain(']')
  })


  it('强调与删除线的标记被抹掉', () => {
    const v = makeView('*斜* 与 ~~删~~\n\n第二段', 16)
    const hidden = hiddenTexts(v)
    expect(hidden).toContain('*')
    expect(hidden).toContain('~~')
  })

  it('分隔线 --- 在光标不在该行时被抹掉', () => {
    const v = makeView('正文\n\n---\n\n后面', 0)
    expect(hiddenTexts(v)).toContain('---')
  })

  it('任务列表的 [ ] 不抹掉（还要当勾选框用）', () => {
    const v = makeView('- [ ] 待办\n\n第二段', 12)
    expect(hiddenTexts(v)).not.toContain('[ ]')
  })
})

describe('Live Preview 内容样式', () => {
  /** 取出盖在某段文本上的 class（mark 装饰） */
  function classOn(v: EditorView, text: string): string[] {
    const set = v.plugin(livePreview)?.decorations as DecorationSet | undefined
    if (!set) return []
    const result: string[] = []
    const iter = set.iter()
    while (iter.value) {
      const spec = iter.value.spec as { class?: string }
      if (spec.class && v.state.doc.sliceString(iter.from, iter.to).includes(text)) {
        result.push(spec.class)
      }
      iter.next()
    }
    return result
  }

  it('普通段落不挂任何 class（确保上面的断言不是因为「整行都被盖住」而通过）', () => {
    const v = makeView('### 三级\n\n正文', 8)
    expect(classOn(v, '正文')).toEqual([])
  })

  it('标题按级别挂上对应的 class', () => {
    const v = makeView('### 三级\n\n正文', 8)
    expect(classOn(v, '三级')).toContain('cm-lp-h3')
  })

  it('粗体挂上 cm-lp-strong', () => {
    const v = makeView('**粗**\n\n正文', 8)
    expect(classOn(v, '粗')).toContain('cm-lp-strong')
  })

  it('行内代码挂上 cm-lp-code', () => {
    const v = makeView('`code`\n\n正文', 8)
    expect(classOn(v, 'code')).toContain('cm-lp-code')
  })

  it('链接挂上 cm-lp-link', () => {
    const v = makeView('[文字](https://a.com)\n\n正文', 22)
    expect(classOn(v, '文字')).toContain('cm-lp-link')
  })
})
