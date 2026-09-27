import { describe, expect, it } from 'vitest'
import { APP_TITLE } from '@shared/app-meta'
import { buildHtmlDocument } from './shell'

/**
 * 导出 HTML 的外壳。
 *
 * 这里盯的都是「错了也看不出来」的东西：主题挂错元素（暗色变亮色）、
 * 标题没转义（文件名里一个 `<` 就毁掉整份文档）、少了某份 CSS（样式或高亮缺失）。
 */

function build(overrides: Partial<Parameters<typeof buildHtmlDocument>[0]> = {}): string {
  return buildHtmlDocument({
    title: '测试文档',
    bodyHtml: '<h1 id="标题">标题</h1>',
    theme: 'light',
    ...overrides
  })
}

describe('文档骨架', () => {
  it('以 DOCTYPE 开头', () => {
    expect(build().startsWith('<!DOCTYPE html>')).toBe(true)
  })

  it('charset 落在前 1024 字节内（否则中文会先被按错误编码解一遍）', () => {
    const html = build()
    const index = html.indexOf('<meta charset="UTF-8">')
    expect(index).toBeGreaterThan(-1)
    expect(index).toBeLessThan(1024)
  })

  it('正文片段被包进 .markdown-body', () => {
    // MARKDOWN_BODY_CSS 的每条选择器都要求这个祖先，少了它整份样式都不生效
    expect(build()).toContain('<article class="markdown-body">')
  })

  it('默认语言是 zh-CN，且可覆盖', () => {
    expect(build()).toContain('<html lang="zh-CN"')
    expect(build({ lang: 'ja' })).toContain('<html lang="ja"')
  })

  it('generator 用的是 APP_TITLE（不留第二份硬编码）', () => {
    expect(build()).toContain(`<meta name="generator" content="${APP_TITLE}">`)
  })
})

describe('主题', () => {
  it('data-theme 挂在 <html> 上，不是 <body> 上', () => {
    // theme.ts 的暗色块选择器是裸 [data-theme='dark']，挂哪儿都能匹配；
    // 但渲染进程用的是 documentElement，两边必须一致，否则暗色导出静默变亮色。
    expect(build({ theme: 'dark' })).toContain('<html lang="zh-CN" data-theme="dark">')
    expect(build({ theme: 'light' })).toContain('data-theme="light"')
  })

  it('body 上不再重复挂一次 data-theme', () => {
    expect(build({ theme: 'dark' })).not.toContain('<body data-theme')
  })
})

describe('样式自包含', () => {
  it('四份 CSS 都在（缺哪份就少哪块样式）', () => {
    const html = build()
    expect(html).toContain('--bg-secondary') // THEME_VARIABLES_CSS
    expect(html).toContain('.markdown-body pre') // MARKDOWN_BODY_CSS
    expect(html).toContain('.hljs-keyword') // HIGHLIGHT_CSS
    expect(html).toContain('@media print') // SHELL_CSS
  })

  it('打印时清掉正文 padding（否则和 printToPDF 的页边距叠加）', () => {
    const html = build()
    const printBlock = html.slice(html.indexOf('@media print'))
    expect(printBlock).toContain('print-color-adjust: exact')
    expect(printBlock).toContain('break-inside: avoid')
    expect(printBlock).toContain('padding: 0')
  })

  it('不写 @page（几何以 printToPDF 的参数为准，留着只会误导）', () => {
    expect(build()).not.toContain('@page')
  })

  it('没有任何外部资源引用', () => {
    const html = build()
    expect(html).not.toContain('<link')
    expect(html).not.toContain('<script')
    expect(html).not.toContain('http://')
    expect(html).not.toContain('https://')
  })

  it('没有 <base>（它会把 #锚点 解析成目录 URL）', () => {
    expect(build()).not.toContain('<base')
  })
})

describe('标题转义', () => {
  it('标题里的尖括号被转义（文件名可以是任意字符）', () => {
    const html = build({ title: 'a<script>alert(1)</script>.md' })
    expect(html).not.toContain('<script')
    expect(html).toContain('&lt;script&gt;')
  })

  it('引号与 & 也被转义', () => {
    expect(build({ title: '他说"你好" & 再见' })).toContain('&quot;你好&quot; &amp; 再见')
  })
})
