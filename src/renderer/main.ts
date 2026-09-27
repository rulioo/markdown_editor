import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { HIGHLIGHT_CSS, MARKDOWN_BODY_CSS, THEME_VARIABLES_CSS } from '@shared/theme'
import App from './App.vue'
import { setupCommands } from './commands'
import './styles/index.css'

/**
 * 主题变量与 Markdown 正文样式以 <style> 注入而不是写死在 .css 文件里，
 * 是为了让渲染进程与主进程（导出 HTML）共用 shared/theme.ts 这一份定义。
 *
 * 三份都**必须**注入：预览面板是 `v-html` 出来的 `<article class="markdown-body">`，
 * 它的表格边框、代码块底色、链接配色全在 MARKDOWN_BODY_CSS 里。曾经只注入了
 * 变量那一份，于是分栏预览的表格没有边框、链接是浏览器默认蓝——
 * 看起来就像「表格没渲染出来」。HIGHLIGHT_CSS 同理：少注入它，代码块语法色全无。
 *
 * 注入到全局是安全的：所有选择器都带 `.markdown-body` / `.cm-lp-table` 前缀，
 * 只有预览面板与编辑器里的表格 widget 会命中。
 */
function injectThemeStyles(): void {
  const style = document.createElement('style')
  style.id = 'theme-styles'
  style.textContent = `${THEME_VARIABLES_CSS}\n${MARKDOWN_BODY_CSS}\n${HIGHLIGHT_CSS}`
  document.head.appendChild(style)
}

injectThemeStyles()

const app = createApp(App)
app.use(createPinia())

// 必须在 pinia 安装之后：命令处理器里会实例化各个 store
setupCommands()

app.mount('#app')

// 挂载日志：主进程在未打包时会把渲染进程日志转发到终端，
// 用于区分「窗口没渲染出来」和「渲染了但是空的」这两种情况
console.info('应用已挂载')
