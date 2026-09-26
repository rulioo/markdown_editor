import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { APP_TITLE, COMPANY_NAME, COPYRIGHT, COPYRIGHT_YEAR } from '@shared/app-meta'

/**
 * 应用元数据的**漂移守卫**。
 *
 * `APP_TITLE` 有几处绕不开的副本：HTML 的 <title> 必须在脚本执行前就存在，
 * electron-builder.yml 是给打包器读的配置，两者都无法 import TypeScript。
 * 副本本身不可怕，可怕的是没人看着它们——「关于 marktext-clone」就是这么来的：
 * 菜单取 `app.getName()`，而 package.json 没有 productName，于是显示开发名。
 *
 * 这个文件把几处副本钉在一起，顺带钉住两条容易被无意破坏的边界：
 *   - cli.ts / pending-paths.ts 不许 import electron（拆出来的唯一理由就是可测性）
 *   - package.json 不许新增 productName（它会搬走 userData 目录，见下）
 */

/** 项目根目录（本文件在 test/ 下，所以只往上一层） */
const ROOT = resolve(__dirname, '..')

function read(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), 'utf8')
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|vue|html)$/.test(entry)) out.push(full)
  }
  return out
}

/** 相对项目根、正斜杠分隔的路径列表 */
function sourceFiles(): string[] {
  return walk(join(ROOT, 'src')).map((f) => f.slice(ROOT.length + 1).split('\\').join('/'))
}

describe('应用元数据的一致性', () => {
  it('APP_TITLE 与 index.html 的 <title> 一致', () => {
    const html = read('src/renderer/index.html')
    const match = /<title>([^<]*)<\/title>/.exec(html)
    expect(match).not.toBeNull()
    expect(match![1]).toBe(APP_TITLE)
  })

  it('APP_TITLE 与 electron-builder.yml 的 productName 一致', () => {
    const match = /^productName:\s*(.+)$/m.exec(read('electron-builder.yml'))
    expect(match).not.toBeNull()
    expect(match![1].trim()).toBe(APP_TITLE)
  })

  it('COPYRIGHT 由年份与公司名拼成', () => {
    expect(COPYRIGHT).toContain(COPYRIGHT_YEAR)
    expect(COPYRIGHT).toContain(COMPANY_NAME)
  })

  it('electron-builder.yml 的 copyright 与 COPYRIGHT 一致（exe 文件属性里的 LegalCopyright）', () => {
    const match = /^copyright:\s*(.+)$/m.exec(read('electron-builder.yml'))
    expect(match).not.toBeNull()
    expect(match![1].trim()).toBe(COPYRIGHT)
  })

  it('package.json 的 author 是公司名（electron-builder 用它推 CompanyName）', () => {
    const pkg = JSON.parse(read('package.json')) as { author?: string }
    expect(pkg.author).toBe(COMPANY_NAME)
  })

  it('没有第二处硬编码「MarkText 克隆版」——副本只允许出现在 app-meta.ts 与 index.html', () => {
    const allowed = new Set(['src/shared/app-meta.ts', 'src/renderer/index.html'])
    const offenders = sourceFiles().filter(
      (f) => !allowed.has(f) && readFileSync(join(ROOT, f), 'utf8').includes(APP_TITLE)
    )
    // 失败时直接报出是哪些文件，省得再去 grep
    expect(offenders).toEqual([])
  })
})

describe('两条刻意维持的边界', () => {
  it('package.json 不含 productName——它会改 app.getName()，进而搬走 userData 目录', () => {
    // app.getName() 同时喂给 app.getPath('userData')。加了 productName，
    // 配置 / 最近文件 / 崩溃恢复会整体搬到新目录，现有安装全部丢失设置。
    // 显示名用 APP_TITLE 就好，存储目录名不必跟着改。
    const pkg = JSON.parse(read('package.json')) as Record<string, unknown>
    expect(pkg).not.toHaveProperty('productName')
  })

  it('cli.ts 与 pending-paths.ts 不 import electron', () => {
    // 这两个文件从 index.ts 拆出来的**唯一理由**就是可测性：
    // index.ts 在模块作用域抢单实例锁，import 它就会真的去抢锁。
    for (const file of ['src/main/cli.ts', 'src/main/pending-paths.ts']) {
      expect(read(file)).not.toMatch(/from ['"]electron['"]/)
    }
  })
})
