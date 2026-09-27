import { describe, expect, it } from 'vitest'
import { readHeadings, slugify, toPlainText } from './headings'
import { markdownToHast, treeToHtml } from './render'

/**
 * 标题 id / 目录。
 *
 * 这里的断言分两类：slug 算法本身（纯函数，直接测），以及「目录注入的位置与结构」
 * （要走一遍真实管线，因为 id 和它对应的 href 必须**同时**产生、不能各算各的）。
 */

function render(source: string, includeToc = true): string {
  return treeToHtml(markdownToHast(source, includeToc))
}

describe('slugify', () => {
  it('转小写、空格转连字符', () => {
    expect(slugify('Hello World')).toBe('hello-world')
  })

  it('标点与表情被去掉', () => {
    expect(slugify('你好，世界！')).toBe('你好世界')
    expect(slugify('API: 使用说明')).toBe('api-使用说明')
    expect(slugify('🎉 发布')).toBe('发布')
  })

  it('保留中文、数字、连字符与下划线', () => {
    expect(slugify('第 2 章')).toBe('第-2-章')
    expect(slugify('a-b_c')).toBe('a-b_c')
  })

  it('首尾多余的连字符被去掉', () => {
    expect(slugify('  前后有空格  ')).toBe('前后有空格')
    expect(slugify('---')).toBe('section')
  })

  it('空标题兜底成 section（否则会产出 id="" 的锚点）', () => {
    expect(slugify('')).toBe('section')
    expect(slugify('!!!')).toBe('section')
  })

  it('同名标题按 -1 / -2 去重', () => {
    const seen = new Map<string, number>()
    expect(slugify('重复', seen)).toBe('重复')
    expect(slugify('重复', seen)).toBe('重复-1')
    expect(slugify('重复', seen)).toBe('重复-2')
  })

  it('不传 seen 时不去重（纯函数形态）', () => {
    expect(slugify('重复')).toBe('重复')
    expect(slugify('重复')).toBe('重复')
  })
})

describe('标题 id', () => {
  it('每个 h1..h6 都拿到 id', () => {
    expect(render('# 标题')).toContain('<h1 id="标题">标题</h1>')
  })

  it('标题里的行内标记被压平进 id', () => {
    // `npm` 是 <code>，**粗** 是 <strong>，纯文本取出来都是字面文字
    expect(render('## 用 `npm` 安装')).toContain('id="用-npm-安装"')
    expect(render('## 注意 **重要** 事项')).toContain('id="注意-重要-事项"')
  })

  it('同名标题在真实管线里也去重', () => {
    const html = render('# 重复\n\n# 重复\n\n# 重复')
    expect(html).toContain('id="重复"')
    expect(html).toContain('id="重复-1"')
    expect(html).toContain('id="重复-2"')
  })

  it('includeToc 关闭时依然分配 id（预览的文内锚点靠它）', () => {
    expect(render('# 标题', false)).toContain('id="标题"')
  })
})

describe('目录注入', () => {
  it('includeToc 打开时 nav 是文档的第一个子节点', () => {
    const html = render('# 一\n\n正文\n\n## 二')
    expect(html.startsWith('<nav class="markdown-toc">')).toBe(true)
    // 正文必须排在目录之后
    expect(html.indexOf('<nav')).toBeLessThan(html.indexOf('正文'))
  })

  it('includeToc 关闭时不注入任何 nav', () => {
    expect(render('# 一\n\n## 二', false)).not.toContain('<nav')
  })

  it('没有标题时也不注入空的 nav', () => {
    expect(render('只有正文', true)).not.toContain('<nav')
  })

  it('目录只列标题，且按文档顺序', () => {
    const html = render('# 甲\n\n## 乙\n\n### 丙')
    const nav = html.slice(0, html.indexOf('</nav>'))
    expect(nav.indexOf('甲')).toBeLessThan(nav.indexOf('乙'))
    expect(nav.indexOf('乙')).toBeLessThan(nav.indexOf('丙'))
    // 正文里的标题不在 nav 内
    expect(nav).not.toContain('<h1')
  })

  it('href 与正文里的 id 完全一致（同一个 slug 算出来的）', () => {
    const html = render('# 用 `npm` 安装\n\n## 用 `npm` 安装')
    expect(html).toContain('href="#用-npm-安装"')
    expect(html).toContain('href="#用-npm-安装-1"')
    expect(html).toContain('id="用-npm-安装-1"')
  })

  it('层级按深度嵌套，且深度跳跃不补空层', () => {
    // h1 → h3：h3 只比 h1 深一层，不产生「空的 h2 层」
    const html = render('# 一\n\n### 三')
    const nav = html.slice(0, html.indexOf('</nav>'))
    expect(nav).toContain('<ul><li><a href="#一">一</a><ul><li><a href="#三">三</a>')
  })

  it('同级标题不会越嵌越深（去重后回到同一层）', () => {
    const html = render('# 一\n\n## 甲\n\n## 乙\n\n## 丙')
    const nav = html.slice(0, html.indexOf('</nav>'))
    // 三个 h2 应该在同一个 <ul> 里，而不是层层嵌套
    expect(nav).toContain('<li><a href="#甲">甲</a></li><li><a href="#乙">乙</a></li>')
  })
})

describe('readHeadings', () => {
  it('返回的 id 与正文里的 id 一致（往返一致）', () => {
    const tree = markdownToHast('# 甲\n\n## 乙')
    const headings = readHeadings(tree)
    expect(headings.map((h) => h.id)).toEqual(['甲', '乙'])
    const html = treeToHtml(tree)
    for (const heading of headings) {
      expect(html).toContain(`id="${heading.id}"`)
    }
  })

  it('带上深度与纯文本', () => {
    expect(readHeadings(markdownToHast('# 甲\n\n### 丙'))).toEqual([
      { depth: 1, id: '甲', text: '甲' },
      { depth: 3, id: '丙', text: '丙' }
    ])
  })

  it('没跑过插件的树返回空数组而不是抛错', () => {
    expect(readHeadings({ type: 'root', children: [] })).toEqual([])
  })
})

describe('toPlainText', () => {
  it('拼平嵌套的行内节点', () => {
    expect(
      toPlainText({
        type: 'element',
        tagName: 'h2',
        properties: {},
        children: [
          { type: 'text', value: '用 ' },
          { type: 'element', tagName: 'code', properties: {}, children: [{ type: 'text', value: 'npm' }] },
          { type: 'text', value: ' 安装' }
        ]
      })
    ).toBe('用 npm 安装')
  })
})
