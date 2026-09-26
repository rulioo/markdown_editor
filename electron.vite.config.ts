import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import vue from '@vitejs/plugin-vue'

/**
 * 模块格式策略（重要）：
 * - 主进程输出 CJS（package.json 未声明 "type": "module"）。
 * - unified / remark-* / rehype-* 生态是 **纯 ESM**，无法被 CJS 的 require() 加载，
 *   因此这些包**不打进 external，而是由 rollup 打包进主进程产物**。
 * - docx / iconv-lite / jschardet / katex 自带 CJS 产物，保持 external，
 *   避免 iconv-lite 的动态 require 与 katex 的体积被打包进来。
 * - 预加载脚本在 sandbox: true 下**必须**是 CJS，故显式指定 format: 'cjs'。
 */
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
      rollupOptions: {
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
