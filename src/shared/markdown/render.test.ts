import { describe, expect, it } from 'vitest'
import { renderMarkdown } from './render'

/**
 * 这条管线**预览、编辑器内表格预览、导出**三处共用，所以这里除了「渲染对不对」，
 * 还要盯死两件事：原始 HTML 不能被执行、可执行协议的 URL 不能留在 href/src 里。
 *
 * 管线住在 `src/shared` 是 M3 的决定（主进程要复用），测试跟着一起搬过来的。
 */

describe('基础渲染', () => {
  it('空文档渲染成空串（不产生空的 <p>）', () => {
    expect(renderMarkdown('')).toBe('')
    expect(renderMarkdown('   \n  \n')).toBe('')
  })

  it('标题（带 id，供文内锚点跳转）', () => {
    expect(renderMarkdown('# 标题')).toBe('<h1 id="标题">标题</h1>')
  })

  it('段落与强调', () => {
    expect(renderMarkdown('**粗** 和 *斜*')).toBe('<p><strong>粗</strong> 和 <em>斜</em></p>')
  })

  it('GFM 删除线', () => {
    expect(renderMarkdown('~~删除~~')).toBe('<p><del>删除</del></p>')
  })

  it('GFM 表格', () => {
    const html = renderMarkdown('| a | b |\n| - | - |\n| 1 | 2 |')
    expect(html).toContain('<table>')
    expect(html).toContain('<th>a</th>')
    expect(html).toContain('<td>1</td>')
  })

  it('GFM 任务列表渲染成勾选框', () => {
    const html = renderMarkdown('- [ ] 待办\n- [x] 已办')
    expect(html).toContain('type="checkbox"')
    expect(html).toContain('checked')
  })

  it('围栏代码块带上语言 class（语法高亮靠它）', () => {
    const html = renderMarkdown('```js\nconst a = 1\n```')
    expect(html).toContain('language-js')
  })

  it('代码块里的尖括号被转义，不会变成标签', () => {
    const html = renderMarkdown('```\n<div>\n```')
    expect(html).toContain('&#x3C;div>')
  })
})

describe('代码高亮', () => {
  it('标了语言的围栏产出 hljs 类名与 token 片段', () => {
    const html = renderMarkdown('```js\nconst a = 1\n```')
    expect(html).toContain('class="hljs language-js"')
    expect(html).toContain('hljs-keyword')
  })

  it('高亮只是包了 span，代码原文一个字不丢', () => {
    // 高亮会把 `const a = 1` 拆成若干 <span>，所以不能再对整串做子串断言，
    // 但「拆完之后文本总和不变」是必须成立的——丢代码比不染色严重得多。
    const html = renderMarkdown('```js\nconst s = fetch("u")\n```')
    expect(html.replace(/<[^>]+>/g, '')).toContain('const s = fetch("u")')
  })

  it('未知语言不抛错，也不会产出 token 片段', () => {
    // ```mermaid 这类围栏很常见。rehype-highlight 捕获 "Unknown language"
    // 后只记一条 message，节点原样保留——所以这里断言的是「安静地降级」。
    // 注意它会无条件给 <code> 加上 hljs 类名，所以只能断言没有 hljs-* token。
    const html = renderMarkdown('```mermaid\ngraph TD;\n  A-->B;\n```')
    expect(html).toContain('language-mermaid')
    expect(html).not.toContain('hljs-')
    expect(html).toContain('graph TD;')
  })

  it('没标语言的围栏不高亮（证明 detect:false 生效）', () => {
    // detect 打开的话，这里会被 highlightAuto 猜成某种语言并染色，
    // 既改变现有文档的渲染结果，也给每次预览加上遍历 38 个语法的开销。
    const html = renderMarkdown('```\nconst a = 1\n```')
    expect(html).not.toContain('hljs-')
  })

  it('代码块里的可执行内容仍然只是文本', () => {
    const html = renderMarkdown('```js\nconst s = "<img src=x onerror=alert(1)>"\n```')
    expect(html).not.toContain('<img')
    expect(html).toContain('&#x3C;img')
  })
})

describe('原始 HTML 处理', () => {
  it('行内 HTML 不消失，而是以文本形式可见', () => {
    const html = renderMarkdown('换行<br>测试')
    expect(html).toContain('raw-html')
    expect(html).toContain('&#x3C;br>')
  })

  it('script 标签不会被当成标签输出（只可能是转义后的文本）', () => {
    const html = renderMarkdown('正文 <script>alert(1)</script> 后面')
    expect(html).not.toContain('<script')
    // 标签本身仍然可见，只是被转义了
    expect(html).toContain('&#x3C;script>')
    // 标签之间的文字照常保留
    expect(html).toContain('alert(1)')
  })

  it('块级 HTML 不会整块消失', () => {
    const html = renderMarkdown('<div class="x">块级</div>')
    expect(html).toContain('块级')
    expect(html).not.toContain('<div')
  })
})

describe('URL 安全', () => {
  it('javascript: 链接的 href 被剥掉', () => {
    const html = renderMarkdown('[点我](javascript:alert(1))')
    expect(html).not.toContain('javascript:')
    expect(html).toContain('点我')
  })

  it('javascript: 图片的 src 被剥掉', () => {
    const html = renderMarkdown('![图](javascript:alert(1))')
    expect(html).not.toContain('javascript:')
  })

  it('大小写混写的 JavaScript: 也拦下', () => {
    const html = renderMarkdown('[点我](JaVaScRiPt:alert(1))')
    expect(html.toLowerCase()).not.toContain('javascript:')
  })

  it('vbscript: 与 file: 一并拦下', () => {
    expect(renderMarkdown('[x](vbscript:msgbox)')).not.toContain('vbscript:')
    expect(renderMarkdown('[x](file:///C:/Windows)')).not.toContain('file:')
  })

  it('data: 链接被拦下，但 data:image 图片放行', () => {
    expect(renderMarkdown('[x](data:text/html,<b>hi</b>)')).not.toContain('data:text/html')
    const img = renderMarkdown('![图](data:image/png;base64,AAAA)')
    expect(img).toContain('data:image/png;base64,AAAA')
  })

  it('正常协议与相对路径都保留（别误伤）', () => {
    expect(renderMarkdown('[a](https://example.com)')).toContain('href="https://example.com"')
    expect(renderMarkdown('[a](mailto:x@y.com)')).toContain('href="mailto:x@y.com"')
    // 锚点会被 URI 规范化成百分号编码（中文变成 %E9%94%9A%E7%82%B9），
    // 这是 rehype 的正常行为，只要没被剥掉就行
    expect(renderMarkdown('[a](#锚点)')).toContain('href="#')
    // 不带 ./ 的相对路径最容易在「安全前缀白名单」写法下被误删
    expect(renderMarkdown('[a](docs/b.md)')).toContain('href="docs/b.md"')
    expect(renderMarkdown('[a](./c.md)')).toContain('href="./c.md"')
  })
})

describe('健壮性', () => {
  it('畸形 markdown 不抛错，仍有输出', () => {
    expect(() => renderMarkdown('| 表格 | 缺列\n|---|\n[链接](')).not.toThrow()
    expect(renderMarkdown('# 标题\n\n正文')).toContain('<h1 id="标题">')
  })
})
