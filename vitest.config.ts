import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

/**
 * 单测配置。
 *
 * 与 electron.vite.config.ts 分开：那份配置是三端构建用的，
 * 测试只关心渲染进程里那些纯逻辑（编辑器操作、Live Preview 装饰、Markdown 渲染）。
 *
 * environment 用 jsdom —— CodeMirror 的 EditorView 需要真实 DOM 才能构造，
 * 有了它就能对「按了加粗之后文档变成什么」做真实断言，而不是只测纯函数。
 */
export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@': resolve(__dirname, 'src/renderer')
    }
  },
  test: {
    environment: 'jsdom',
    // test/ 放的是「看整个仓库」的结构性用例（需要 node:fs），不适合混进 src/
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    setupFiles: ['test/setup.ts']
  }
})
