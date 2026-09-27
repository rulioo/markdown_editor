import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { HIGHLIGHT_CSS, MARKDOWN_BODY_CSS, THEME_VARIABLES_CSS } from '@shared/theme'

/**
 * shared/theme.ts 里的 CSS 常量是**跨进程共享的字符串**，
 * 它们不会因为「没人用」而被任何机制发现：
 *
 *  - TypeScript 的 noUnusedLocals 只管局部变量，管不到 export；
 *  - 打包器不会警告「导出了但没人 import」；
 *  - 单测测的是渲染函数，而 `renderMarkdown` 只产出 HTML 字符串，
 *    样式在不在跟它无关。
 *
 * 这个盲区真的发生过：`MARKDOWN_BODY_CSS` 导出后始终没被注入渲染进程，
 * 于是分栏预览的表格没有边框、链接是浏览器默认蓝——用户报的
 * 「表格没有渲染出来」有一半是它造成的。所以这里补一条结构性断言，
 * 把「导出了就必须有人用」这条规则钉住。
 */

/** 项目根目录（本文件在 test/ 下，所以只往上一层） */
const ROOT = resolve(__dirname, '..')

/** 会被扫描的源码目录：渲染进程、主进程、共享层 */
const SOURCE_DIRS = ['src']

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|vue)$/.test(entry)) out.push(full)
  }
  return out
}

/** 找出 theme.ts 里所有 `export const XXX_CSS` 的名字 */
function exportedCssNames(): string[] {
  const source = readFileSync(join(ROOT, 'src/shared/theme.ts'), 'utf8')
  return [...source.matchAll(/^export const ([A-Z_]+_CSS)\b/gm)].map((m) => m[1])
}

/** 除 theme.ts 自身外，是否有文件 import 了这个名字 */
function consumersOf(name: string): string[] {
  const files = SOURCE_DIRS.flatMap((d) => walk(join(ROOT, d)))
  return files
    .filter((f) => !f.endsWith(join('shared', 'theme.ts')))
    .filter((f) => !f.endsWith('.test.ts'))
    .filter((f) => new RegExp(`\\b${name}\\b`).test(readFileSync(f, 'utf8')))
    // 统一成正斜杠：Windows 上 join() 产出的是反斜杠，断言里写的却是 'src/renderer/main.ts'
    .map((f) => f.slice(ROOT.length + 1).split('\\').join('/'))
}

/** 去掉 CSS 注释再做文本断言：注释里出现 `background` 是在解释规则本身，不是规则 */
function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

/** 拆出所有「带 .hljs 的选择器」，每条都已去掉首尾空白 */
function hljsSelectors(css: string): string[] {
  return stripCssComments(css)
    .split('\n')
    .flatMap((line) => line.split(','))
    .map((part) => part.trim())
    .filter((part) => part.includes('.hljs'))
}

describe('主题 CSS 常量的接线', () => {
  it('theme.ts 里至少导出了三个 CSS 常量（防止正则失效后测试变成空转）', () => {
    const names = exportedCssNames()
    expect(names).toContain('THEME_VARIABLES_CSS')
    expect(names).toContain('MARKDOWN_BODY_CSS')
    expect(names).toContain('HIGHLIGHT_CSS')
  })

  it('每个导出的 CSS 常量都至少有一个消费方', () => {
    const orphans = exportedCssNames().filter((name) => consumersOf(name).length === 0)
    // 失败时直接报出是哪个常量没人用，省得再去翻 theme.ts
    expect(orphans).toEqual([])
  })

  it('MARKDOWN_BODY_CSS 由渲染进程入口注入（这是它唯一的消费方）', () => {
    expect(consumersOf('MARKDOWN_BODY_CSS')).toContain('src/renderer/main.ts')
  })

  it('正文样式覆盖了表格与代码块这两个「看起来像没渲染」的重灾区', () => {
    // 表格：没有 border-collapse / border，浏览器会把表格画成无边框的散字
    expect(MARKDOWN_BODY_CSS).toContain('.markdown-body table')
    expect(MARKDOWN_BODY_CSS).toContain('border-collapse: collapse')
    // 编辑器里的表格 widget 不在 .markdown-body 里，必须带伴生选择器
    expect(MARKDOWN_BODY_CSS).toContain('.cm-lp-table table')
    expect(MARKDOWN_BODY_CSS).toContain('.cm-lp-table th')
    // 代码块：没有底色就只剩等宽字
    expect(MARKDOWN_BODY_CSS).toContain('.markdown-body pre')
    // 链接配色走主题变量，而不是浏览器默认蓝
    expect(MARKDOWN_BODY_CSS).toContain('var(--accent)')
  })

  it('正文样式引用的主题变量真的有定义（两套主题都要有）', () => {
    // 单看一份看不出问题：MARKDOWN_BODY_CSS 写了 var(--accent)，而 --accent
    // 定义在 THEME_VARIABLES_CSS 里。谁少了一份，样式就会静默回落到继承值。
    // 高亮配色同理，所以两份一起查。
    for (const css of [MARKDOWN_BODY_CSS, HIGHLIGHT_CSS]) {
      const used = [...css.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1])
      // 带兜底值的写法（var(--md-font-size, 16px)）在别处按需覆盖，这里只管纯变量
      const required = [...new Set(used)].filter((name) =>
        new RegExp(`var\\(${name}\\)`).test(css)
      )
      expect(required.length).toBeGreaterThan(0)

      for (const name of required) {
        // 亮色挂在 :root，暗色挂在 [data-theme='dark']，两处都要声明
        expect(THEME_VARIABLES_CSS).toContain(`${name}:`)
      }
    }
  })
})

describe('代码高亮配色的两条承重规则', () => {
  it('HIGHLIGHT_CSS 里没有任何 background（否则代码块会变成双层底色）', () => {
    // `.markdown-body .hljs` 的特异度是 (0,2,0)，压过
    // `.markdown-body pre code { background: none }` 的 (0,1,2)。
    // 只要这里写了底色，`pre` 的底色就会透不出来（或反过来叠一层）。
    expect(stripCssComments(HIGHLIGHT_CSS)).not.toContain('background')
  })

  it('HIGHLIGHT_CSS 不碰 padding / font-size（那些归 pre code 管）', () => {
    const css = stripCssComments(HIGHLIGHT_CSS)
    expect(css).not.toContain('padding')
    expect(css).not.toContain('font-size')
  })

  it('每条 .hljs 选择器都带 .markdown-body 前缀（否则会泄漏到编辑器）', () => {
    // 这份 CSS 会被注入渲染进程的全局 <style>，编辑器那边有自己的一套配色，
    // 不带前缀的 `.hljs-keyword` 会把别处也一起染色。
    const selectors = hljsSelectors(HIGHLIGHT_CSS)
    expect(selectors.length).toBeGreaterThan(10)
    expect(selectors.filter((s) => !s.startsWith('.markdown-body'))).toEqual([])
  })

  it('用 lowlight 展开后的类名（hljs-title function_，不是 hljs-function）', () => {
    // lowlight 把点号作用域拆成「父类名 + 下划线后缀」，写 .hljs-function
    // 会静默匹配不到任何元素——最难发现的一类错误，所以钉一条断言。
    expect(HIGHLIGHT_CSS).toContain('.hljs-title.function_')
    expect(HIGHLIGHT_CSS).toContain('.hljs-title.class_')
    expect(HIGHLIGHT_CSS).not.toContain('.hljs-function')
  })

  it('HIGHLIGHT_CSS 的消费方覆盖渲染进程入口与导出外壳', () => {
    const consumers = consumersOf('HIGHLIGHT_CSS')
    // 预览面板的语法色
    expect(consumers).toContain('src/renderer/main.ts')
    // 导出的 HTML 必须自带这份配色，否则双击打开的 HTML 没有语法色
    expect(consumers).toContain('src/main/export/shell.ts')
  })
})
