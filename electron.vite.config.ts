import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import vue from '@vitejs/plugin-vue'

/**
 * 模块格式策略（重要）：
 * - 主进程输出 CJS（package.json 未声明 "type": "module"）。
 * - **electron-vite 默认把 package.json 里所有 `dependencies` 留成 external**
 *   （`externalizeDepsPlugin`，见其 resolveConfigDrivenPlugins）。
 *   所以「不在 MAIN_EXTERNAL 里」并不等于「会被打包」——这是个踩过的坑，
 *   详见下面 MAIN_BUNDLED 的说明。
 * - docx / iconv-lite / jschardet / katex 自带 CJS 产物，保持 external，
 *   避免 iconv-lite 的动态 require 与 katex 的体积被打包进来。
 * - 预加载脚本在 sandbox: true 下**必须**是 CJS，故显式指定 format: 'cjs'。
 */

/**
 * 必须**打包进主进程产物**的纯 ESM 包。
 *
 * 为什么非打包不可：这些包都是 default 导出（`export default remarkParse`），
 * 而 CJS 产物里 rollup 把 `import x from 'pkg'` 编成了对 `require('pkg')` 返回值的
 * **裸引用**。external 时 `require()` 拿到的是模块命名空间对象 `{__esModule, default}`，
 * 于是 `unified().use(命名空间对象)` 在运行期抛：
 *
 *     Expected usable value but received an empty preset, which is probably a mistake:
 *     presets typically come with `plugins` and sometimes with `settings`, but this has neither
 *
 * 这个错看着像 unified 的用法问题，其实是模块格式问题，而且**渲染进程永远复现不了**
 * （vite 把渲染进程按真 ESM 打包，default 导入照常工作）。
 * 实测：Electron 44 / Node 24 下 require() 这些包不报错，报错发生在 .use() 那一步。
 *
 * M2 的 remark-math / remark-frontmatter / rehype-katex 一并列上，免得再踩一次。
 */
const MAIN_BUNDLED = [
  'unified',
  'remark-parse',
  'remark-gfm',
  'remark-rehype',
  'rehype-highlight',
  'rehype-stringify',
  'unist-util-visit',
  'remark-math',
  'remark-frontmatter',
  'rehype-katex'
]

/** 留成 external 的：electron 本身，以及自带 CJS 产物的大块头 */
const MAIN_EXTERNAL = [
  'electron',
  'docx',
  'iconv-lite',
  'jschardet',
  'katex'
]

const alias = {
  '@shared': resolve(__dirname, 'src/shared'),
  '@': resolve(__dirname, 'src/renderer')
}

export default defineConfig({
  main: {
    resolve: { alias },
    build: {
      // 把 MAIN_BUNDLED 从「自动 external」的默认集合里摘出来，让 rollup 真的打包它们
      externalizeDeps: { exclude: MAIN_BUNDLED },
      rollupOptions: {
        // electron 不在 dependencies 里，必须显式列出；其余是上面那批 CJS 大头
        external: MAIN_EXTERNAL,
        input: { index: resolve(__dirname, 'src/main/index.ts') }
      }
    }
  },
  preload: {
    resolve: { alias },
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') },
        output: {
          format: 'cjs',
          entryFileNames: '[name].cjs'
        }
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: { alias },
    plugins: [vue()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/renderer/index.html') }
      },
      // mermaid 体积大，仅在使用时动态引入，避免拖慢首屏
      chunkSizeWarningLimit: 2000
    }
  }
})
