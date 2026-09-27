import { app, BrowserWindow } from 'electron'
import { createMainWindow } from './window'
import { applyAppMenu, sendOpenPaths } from './menu'
import { flushSettings, loadSettings } from './store'
import { registerIpcHandlers } from './ipc'
import { extractDocumentPaths } from './cli'
import { queuePaths, resetPathDelivery, setPathSink } from './pending-paths'
import { cleanupExportTemp } from './export/render-window'

// Windows 任务栏分组与通知需要显式设置 AppUserModelID
app.setAppUserModelId('com.marktextclone.app')

// 单实例：第二次启动时把文件路径透传给已运行的实例，而不是开新进程
const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  app.quit()
} else {
  // 路径缓冲区唯一的出口。渲染进程就绪之前入队的路径都不投递，只攒着，
  // 等它主动来取（IPC.APP_TAKE_PENDING_PATHS）——详见 pending-paths.ts 的说明。
  setPathSink(sendOpenPaths)

  app.on('second-instance', (_event, argv) => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
    // 必须过缓冲区而不是直接推：冷启动那两三秒里窗口已建、监听器还没注册，
    // 此刻推等于丢。缓冲区会攒到渲染进程来取的那一刻。
    queuePaths(extractDocumentPaths(argv))
  })

  // macOS：Finder 里双击文件打开。这个事件可能在 whenReady 之前触发，
  // 因此必须在模块作用域同步注册，不能放进 whenReady 里。
  app.on('open-file', (event, filePath) => {
    event.preventDefault()
    queuePaths(extractDocumentPaths([process.argv[0], filePath]))
  })

  app.whenReady().then(async () => {
    // 配置必须在建窗口之前加载：窗口尺寸/主题都来自配置
    await loadSettings()

    // 扫掉上次崩溃留下的导出临时文件。能安全整目录删的前提是单实例锁（见上方）
    await cleanupExportTemp()

    // 建窗口之前入队，保证「窗口刚出现就拿到文件」而不是「先空一下再补上」。
    // 此刻一定还没就绪，所以只会入缓冲——正合期望。
    queuePaths(extractDocumentPaths(process.argv))

    registerIpcHandlers()
    applyAppMenu()
    createMainWindow()

    app.on('activate', () => {
      // macOS：点击 Dock 图标且无窗口时重建
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
    })
  })

  app.on('window-all-closed', () => {
    // 关窗即复位投递状态。macOS 上应用不会退出，重建出的窗口必须重新走「拉」，
    // 否则上一批路径会在新窗口里再打开一遍——那样永远关不出一个空窗口。
    resetPathDelivery()
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('before-quit', () => {
    // 配置写入有 300ms 防抖，退出前必须强制落盘
    void flushSettings()
    // 正常退出不留临时文件（崩溃残留由下次启动时的 cleanupExportTemp 兜底）
    void cleanupExportTemp()
  })
}
