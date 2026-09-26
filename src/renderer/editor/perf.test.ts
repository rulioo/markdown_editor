import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language'
import { afterEach, describe, expect, it } from 'vitest'
import { livePreview } from './livePreview'
import { tablePreview } from './tablePreview'

/**
 * 大文档下的编辑器开销基线（M1 验收项之一）。
 *
 * 这里量的是「敲一个字要付多少代价」，拆成三段分别看：
 *  1. dispatch 本身
 *  2. updateListener 里的 doc.toString()——host.ts 每次都把整篇文档拷成字符串
 *  3. Live Preview 重建装饰
 *
 * 阈值刻意宽松：CI 机器比开发机慢，这里只抓**数量级退化**。
 * jsdom 没有真实布局，所以视口相关的部分（实际渲染的行数）不代表实机，
 * 但字符串拷贝、语法树解析、装饰构建这些是真实成本。
 */

const TARGET_BYTES = 1_000_000

let view: EditorView | null = null

afterEach(() => {
  view?.destroy()
  view = null
  document.body.innerHTML = ''
})

/** 构造约 1 MB 的 markdown：标题 / 正文 / 列表 / 代码块都有 */
function bigDocument(blocks = 10_000): string {
  const block = [
    '## 二级标题',
    '',
    '这是一段普通的中文正文，用来撑起字符数。Hello world foo bar.',
    '',
    '- 列表项一',
    '- 列表项二',
    '',
    '```js',
    '// 代码块里的 # 不该被当成标题',
    'const a = 1',
    '```'
  ].join('\n')
  return Array.from({ length: blocks }, () => block).join('\n')
}

describe('大文档下的编辑器开销', () => {
  /**
   * 实测基线（1 MB，单独跑 / 六个文件并行跑）：单次按键 5.1ms / 6.8ms，
   * 其中 doc.toString() 占 3.9ms / 5.3ms——也就是说**每次按键约 3/4 的开销
   * 只是把整篇文档拷成字符串**（host.ts 要把它写回 store）。
   * 这已经记进 design.md §14，是 M5 的优化目标。
   *
   * 阈值给 50ms：正常打字约 10 次/秒，5ms 一次意味着 20 倍余量；
   * 真涨到 50ms 用户就会明显感到粘手了。
   */
  it('打开 1 MB 文档后，单次按键（dispatch + toString + 重建装饰）不超过 50ms', () => {
    const doc = bigDocument()
    expect(doc.length).toBeGreaterThan(TARGET_BYTES)

    let toStringMs = 0
    view = new EditorView({
      state: EditorState.create({
        doc,
        extensions: [
          markdown({ base: markdownLanguage }),
          livePreview,
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return
            // 复刻 host.ts 的行为：每次改动都把整篇文档导出成字符串
            const started = performance.now()
            void update.state.doc.toString()
            toStringMs += performance.now() - started
          })
        ]
      })
    })

    const v = view
    // 预热：让 lezer 先解析一遍、JIT 编译热路径，否则第一次的数字没有参考价值
    for (let i = 0; i < 5; i += 1) {
      v.dispatch({ changes: { from: 0, insert: 'x' } })
      v.dispatch({ changes: { from: 0, to: 1 } })
      syntaxTree(v.state)
    }
    toStringMs = 0

    const ROUNDS = 30
    const started = performance.now()
    for (let i = 0; i < ROUNDS; i += 1) {
      // 在文档开头插入再删掉，模拟真实按键
      v.dispatch({ changes: { from: 0, insert: 'x' } })
      v.dispatch({ changes: { from: 0, to: 1 } })
      syntaxTree(v.state)
    }
    const perKeystroke = (performance.now() - started) / (ROUNDS * 2)

    console.log(
      `[1MB 编辑器] 单次按键=${perKeystroke.toFixed(2)}ms ` +
        `其中 doc.toString()=${(toStringMs / (ROUNDS * 2)).toFixed(2)}ms`
    )

    expect(perKeystroke).toBeLessThan(50)
  })

  it('强制解析整棵 1 MB 语法树的耗时可接受（这是打开大文件的一次性成本）', () => {
    const doc = bigDocument()
    view = new EditorView({
      state: EditorState.create({
        doc,
        extensions: [markdown({ base: markdownLanguage }), livePreview]
      })
    })

    // 注意：syntaxTree() 只是取当前已解析的树，**不会**触发解析，
    // 拿它计时永远是 0。必须用 ensureSyntaxTree 强制解析到指定位置。
    const started = performance.now()
    const tree = ensureSyntaxTree(view.state, view.state.doc.length, 10_000)
    const parseMs = performance.now() - started

    console.log(`[1MB 编辑器] 强制整树解析=${parseMs.toFixed(1)}ms`)
    expect(tree).not.toBeNull()

    // 实测约 500ms。注意这**不是**打开文件的真实成本——CM6 是惰性解析的，
    // 平时只解析视口，滚到哪解析到哪（分片进行，不会一次卡 500ms）。
    // 这里强制整树解析是为了量出「万一有人写出遍历全树的功能」的天花板。
    expect(parseMs).toBeLessThan(3000)
  })

  it('Live Preview 只按可见区域建装饰，不会因为整篇文档大而变慢', () => {
    // 视口在 jsdom 里是假的，所以这里只验证「装饰数量与文档大小无关」这个设计意图：
    // 如果哪天有人改成遍历整棵树，装饰数会随文档线性增长，这个断言就会挂。
    const small = document.createElement('div')
    const big = document.createElement('div')
    document.body.append(small, big)

    const make = (parent: HTMLElement, text: string): EditorView =>
      new EditorView({
        parent,
        state: EditorState.create({
          doc: text,
          extensions: [markdown({ base: markdownLanguage }), livePreview]
        })
      })

    const smallView = make(small, '# 标题\n\n正文 **粗**\n')
    const bigView = make(big, bigDocument())

    const count = (v: EditorView): number => {
      let n = 0
      const iter = v.plugin(livePreview)?.decorations?.iter()
      while (iter?.value) {
        n += 1
        iter.next()
      }
      return n
    }

    const smallCount = count(smallView)
    const bigCount = count(bigView)

    console.log(`[装饰数量] 小文档=${smallCount} 1MB 文档=${bigCount}`)
    expect(smallCount).toBeGreaterThan(0)
    // 允许有差异（视口内的行构成不同），但不能是几千倍这种线性增长
    expect(bigCount).toBeLessThan(smallCount * 20)

    smallView.destroy()
    bigView.destroy()
  })
})

/**
 * 表格 widget 的开销。
 *
 * 关键在于「renderMarkdown 只在 toDOM 里调，不在构造函数里调」：
 * 装饰集每次事务都重建，若在构造里渲染，一个满是表格的大文档每次按键都要跑上百次
 * remark 解析。这里用一个含大量表格的 1 MB 文档把这条决定钉住。
 */
describe('表格 Live Preview 的开销', () => {
  /**
   * 约 1 MB，每 4 个块夹一张表格。
   *
   * blocks 的取值是量出来的，不是估的：每个普通块约 63 字符，
   * 16000 个块 ≈ 1.0 MB、含约 4000 张表格。
   */
  function documentWithTables(blocks = 16_000): string {
    const plain = [
      '## 二级标题',
      '',
      '这是一段普通的中文正文，用来撑起字符数。Hello world foo bar.',
      '',
      '- 列表项一',
      '- 列表项二'
    ].join('\n')
    const table = '| 列一 | 列二 | 列三 |\n| --- | --- | --- |\n| 值一 | 值二 | 值三 |'
    // 每 4 个普通块夹一张表
    return Array.from({ length: blocks }, (_, i) => (i % 4 === 3 ? table : plain)).join('\n\n')
  }

  it('含表格的 1 MB 文档，单次按键不超过 60ms', () => {
    const doc = documentWithTables()
    expect(doc.length).toBeGreaterThan(TARGET_BYTES)
    expect(doc).toContain('| 列一 |')

    view = new EditorView({
      state: EditorState.create({
        doc,
        extensions: [
          markdown({ base: markdownLanguage }),
          livePreview,
          tablePreview,
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return
            void update.state.doc.toString()
          })
        ]
      })
    })

    const v = view
    for (let i = 0; i < 5; i += 1) {
      v.dispatch({ changes: { from: 0, insert: 'x' } })
      v.dispatch({ changes: { from: 0, to: 1 } })
    }

    const ROUNDS = 20
    const started = performance.now()
    for (let i = 0; i < ROUNDS; i += 1) {
      v.dispatch({ changes: { from: 0, insert: 'x' } })
      v.dispatch({ changes: { from: 0, to: 1 } })
    }
    const perKeystroke = (performance.now() - started) / (ROUNDS * 2)

    console.log(`[1MB 含表格] 单次按键=${perKeystroke.toFixed(2)}ms`)

    // 比不带表格的基线（50ms）只宽一点：表格数随解析前沿增长，
    // 而 jsdom 里解析前沿本就很小；真涨上去说明有人在每次事务里渲染了整篇文档的表格。
    expect(perKeystroke).toBeLessThan(60)
  })
})
