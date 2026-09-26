import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MARKDOWN_BODY_CSS, THEME_VARIABLES_CSS } from '@shared/theme'

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

describe('主题 CSS 常量的接线', () => {
  it('theme.ts 里至少导出了两个 CSS 常量（防止正则失效后测试变成空转）', () => {
    const names = exportedCssNames()
    expect(names).toContain('THEME_VARIABLES_CSS')
    expect(names).toContain('MARKDOWN_BODY_CSS')
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
    const used = [...MARKDOWN_BODY_CSS.matchAll(/var\((--[a-z-]+)/g)].map((m) => m[1])
    // 带兜底值的写法（var(--md-font-size, 16px)）在别处按需覆盖，这里只管纯变量
    const required = [...new Set(used)].filter((name) =>
      new RegExp(`var\\(${name}\\)`).test(MARKDOWN_BODY_CSS)
    )
    expect(required.length).toBeGreaterThan(0)

    for (const name of required) {
      // 亮色挂在 :root，暗色挂在 [data-theme='dark']，两处都要声明
      expect(THEME_VARIABLES_CSS).toContain(`${name}:`)
    }
  })
})
