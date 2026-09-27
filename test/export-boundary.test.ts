import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 导出链路上的**结构性边界**。
 *
 * 这些规则都不是「风格偏好」，每一条背后都有一个会静默生效的故障：
 *
 *  1. `src/shared/**` 被两份 tsconfig 同时编译（node 与 web），
 *     import 了 `node:*` 之后渲染进程那份编译不过——而错误信息会指向
 *     electron-vite 的配置，不指向真正违规的那一行。
 *  2. `shell/pdf-options/validate` 是**纯函数**，靠「不 import electron」
 *     才可能单测。一旦有人图省事从里面 import `app`，测试会立刻变成
 *     需要 electron 运行时，这几百行校验逻辑就再也测不了了。
 *  3. 导出 HTML 的暗色主题靠 `<html data-theme="dark">` 匹配 theme.ts 里的
 *     变量块。变量块的选择器是裸 `[data-theme='dark']`；哪一天它被改成
 *     `.app[data-theme='dark']` 之类带前缀的写法，导出的暗色文档会在
 *     没有任何报错的情况下变成亮色。
 *
 * 这些断言全部是「读源码文本」，所以简单、快、不依赖运行时。
 */

const ROOT = resolve(__dirname, '..')

function read(relPath: string): string {
  return readFileSync(join(ROOT, relPath), 'utf8')
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|vue)$/.test(entry)) out.push(full)
  }
  return out
}

/** 去掉注释，避免「注释里提到 `from 'node:fs'`」被误判成真的 import */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

const SHARED_DIR = join(ROOT, 'src/shared')

describe('src/shared 不能依赖 Node 内置模块', () => {
  it('没有 from \'node:...\' / require(...)', () => {
    const offenders: string[] = []
    for (const file of walk(SHARED_DIR)) {
      const source = stripComments(readFileSync(file, 'utf8'))
      if (/from\s+['"]node:/.test(source) || /\brequire\s*\(/.test(source)) {
        offenders.push(relative(ROOT, file))
      }
    }
    expect(offenders).toEqual([])
  })

  it('也没有裸的 fs / path（漏写 node: 前缀的写法）', () => {
    const offenders: string[] = []
    for (const file of walk(SHARED_DIR)) {
      const source = stripComments(readFileSync(file, 'utf8'))
      if (/from\s+['"](fs|path|os|crypto|url)['"]/.test(source)) {
        offenders.push(relative(ROOT, file))
      }
    }
    expect(offenders).toEqual([])
  })
})

describe('纯函数模块不 import electron', () => {
  // 这四个是导出链路里**有单测**的部分。它们能测，前提就是这条边界。
  const PURE_MODULES = [
    'src/main/export/shell.ts',
    'src/main/export/pdf-options.ts',
    'src/main/export/validate.ts',
    'src/main/export/assets.ts'
  ]

  it.each(PURE_MODULES)('%s 不含 from \'electron\'', (relPath) => {
    const source = stripComments(read(relPath))
    expect(source).not.toMatch(/from\s+['"]electron['"]/)
    expect(source).not.toMatch(/\brequire\s*\(\s*['"]electron['"]/)
  })

  it('对照：需要 electron 的模块确实 import 了它（说明上面那条不是恒真）', () => {
    // 没有这条，把 PURE_MODULES 误写成空数组也能通过
    for (const relPath of ['src/main/export/index.ts', 'src/main/export/render-window.ts']) {
      expect(stripComments(read(relPath))).toMatch(/from\s+['"]electron['"]/)
    }
  })

  it('shared 层同样不 import electron（它是渲染进程与主进程的公共面）', () => {
    const offenders: string[] = []
    for (const file of walk(SHARED_DIR)) {
      if (/from\s+['"]electron['"]/.test(stripComments(readFileSync(file, 'utf8')))) {
        offenders.push(relative(ROOT, file))
      }
    }
    expect(offenders).toEqual([])
  })
})

describe('导出外壳与主题变量块的契约', () => {
  const theme = stripComments(read('src/shared/theme.ts'))

  it('暗色块的选择器是裸 [data-theme=\'dark\']，没有被加上祖先限定', () => {
    // 外壳只能控制 <html> 这一个元素（它写在 `<html data-theme="...">` 上），
    // 所以形如 `.app [data-theme='dark']` / `#root[data-theme='dark']` 的写法
    // 会让导出的暗色文档静默变成亮色——本应用没有任何机制能发现这件事。
    const selectorLines = theme
      .split('\n')
      .filter((line) => line.includes("data-theme="))
      .map((line) => line.trim())
    expect(selectorLines.length).toBeGreaterThan(0)
    for (const line of selectorLines) {
      expect(line).toMatch(/^\[data-theme=['"](dark|light)['"]\]/)
    }
  })

  it('外壳把 data-theme 写在 <html> 上，并带上 lang', () => {
    const shell = stripComments(read('src/main/export/shell.ts'))
    expect(shell).toMatch(/<html lang="\$\{escapeHtml\(lang\)\}" data-theme="\$\{theme\}">/)
    expect(shell).toContain('lang = \'zh-CN\'')
  })

  // 「外壳不含 <base> / @page」由 shell.test.ts 对着**真实产物**断言（那里更准，
  // 因为 shell.ts 的注释里就写着这两个词，读源码文本只会读到注释）。
})

describe('主进程的外部依赖必须有明确归属', () => {
  /**
   * 这条断言来自一次真实的运行期故障：
   *
   * electron-vite 默认把 package.json 里**所有** `dependencies` 留成 external
   * （`externalizeDepsPlugin`，见其 `resolveConfigDrivenPlugins`），
   * 所以「没写进 `MAIN_EXTERNAL`」并不等于「会被打包」。而 unified 生态的包清一色是
   * default 导出，CJS 产物里 rollup 把 `import x from 'pkg'` 编成对
   * `require('pkg')` 返回值的**裸引用**——external 时那是个命名空间对象
   * `{__esModule, default}`，于是运行期抛：
   *
   *     Expected usable value but received an empty preset ...
   *
   * 报错发生在 `unified().use(...)` 那一行，看着像用法错误，实际是模块格式问题；
   * 而且**渲染进程永远复现不了**（vite 按真 ESM 打包，default 导入照常工作）。
   * 单测同样测不出来——单测走 vitest 的 ESM 解析，不走主进程的 CJS 产物。
   *
   * 唯一能在提交前发现的时机就是这里：只要 main/shared 里 import 了某个
   * `dependencies` 里的包，它就必须在 `MAIN_EXTERNAL` 或 `MAIN_BUNDLED` 里露过面。
   */
  const config = stripComments(read('electron.vite.config.ts'))

  function stringArrayFrom(name: string): string[] {
    const match = new RegExp(`const ${name} = \\[([^\\]]*)\\]`).exec(config)
    expect(match, `配置里找不到 ${name}`).not.toBeNull()
    return [...match![1].matchAll(/'([^']+)'/g)].map((m) => m[1])
  }

  /** 收集 src/main 与 src/shared 里 import 的**顶层包名**（跳过相对路径与 node:） */
  function importedPackages(): Set<string> {
    const found = new Set<string>()
    for (const dir of [join(ROOT, 'src/main'), SHARED_DIR]) {
      for (const file of walk(dir)) {
        const source = stripComments(readFileSync(file, 'utf8'))
        for (const m of source.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
          const spec = m[1]
          if (spec.startsWith('.') || spec.startsWith('node:')) continue
          const segments = spec.split('/')
          found.add(spec.startsWith('@') ? segments.slice(0, 2).join('/') : segments[0])
        }
      }
    }
    return found
  }

  it('main/shared import 的每个 dependencies 包都在配置里被显式归类', () => {
    const deps = Object.keys(JSON.parse(read('package.json')).dependencies ?? {})
    const classified = new Set([...stringArrayFrom('MAIN_EXTERNAL'), ...stringArrayFrom('MAIN_BUNDLED')])
    const unclassified = [...importedPackages()].filter(
      (name) => deps.includes(name) && !classified.has(name)
    )
    // 新引入一个包时，要么它是 CJS（加进 MAIN_EXTERNAL），
    // 要么它是纯 ESM（加进 MAIN_BUNDLED），不能两处都不写
    expect(unclassified).toEqual([])
  })

  it('MAIN_BUNDLED 里的包都是真的 dependencies（写错了会静默不生效）', () => {
    const deps = Object.keys(JSON.parse(read('package.json')).dependencies ?? {})
    for (const name of stringArrayFrom('MAIN_BUNDLED')) {
      expect(deps, `${name} 不在 dependencies 里，exclude 对它无效`).toContain(name)
    }
  })

  it('两个清单不重叠（同一个包不能既要打包又要 external）', () => {
    const bundled = new Set(stringArrayFrom('MAIN_BUNDLED'))
    const overlap = stringArrayFrom('MAIN_EXTERNAL').filter((name) => bundled.has(name))
    expect(overlap).toEqual([])
  })

  it('管线包确实在 MAIN_BUNDLED 里（这是那次故障的正主）', () => {
    const bundled = stringArrayFrom('MAIN_BUNDLED')
    for (const name of ['unified', 'remark-parse', 'remark-gfm', 'remark-rehype', 'rehype-highlight', 'rehype-stringify']) {
      expect(bundled).toContain(name)
    }
  })
})

describe('导出的三个入口共用同一棵树的顺序', () => {
  const source = stripComments(read('src/main/export/index.ts'))

  it('processAssets 在 sanitizeTree 之前调用', () => {
    const assetsAt = source.indexOf('await processAssets(')
    const sanitizeAt = source.indexOf('sanitizeTree(tree)')
    expect(assetsAt).toBeGreaterThan(-1)
    expect(sanitizeAt).toBeGreaterThan(-1)
    // 反过来的话，内联出来的 data: URL 会先被剥掉，图片在 PDF 里全部消失
    expect(assetsAt).toBeLessThan(sanitizeAt)
  })

  it('sanitizeTree 在 treeToHtml 之前调用', () => {
    const sanitizeAt = source.indexOf('sanitizeTree(tree)')
    const stringifyAt = source.indexOf('treeToHtml(tree)')
    expect(sanitizeAt).toBeGreaterThan(-1)
    expect(stringifyAt).toBeGreaterThan(-1)
    expect(sanitizeAt).toBeLessThan(stringifyAt)
  })

  it('PDF 与打印强制内联图片（隐藏窗口解析不了相对路径）', () => {
    expect(source).toMatch(/format === 'pdf' \|\| options\.embedImages/)
    expect(source).toContain('embedImages: true')
  })
})
