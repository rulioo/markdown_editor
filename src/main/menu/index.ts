import { BrowserWindow, Menu } from 'electron'
import { buildMenuTemplate } from './templates.zh'
import { isDev } from '../window'
import { getSettings, addRecentFile, clearRecentFiles } from '../store'
import { IPC_PUSH } from '@shared/ipc-contract'
import { COMMANDS } from '@shared/commands'
import { APP_TITLE } from '@shared/app-meta'

/** 把命令派发给当前聚焦窗口的渲染进程 */
function sendCommand(commandId: string): void {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  if (!win || win.isDestroyed()) return
  win.webContents.send(IPC_PUSH.MENU_COMMAND, commandId)
}

/** 二次启动 / 菜单打开文件时，把路径交给渲染进程处理 */
export function sendOpenPaths(paths: string[]): void {
  const win = BrowserWindow.getAllWindows()[0]
  if (!win || win.isDestroyed()) return
  win.webContents.send(IPC_PUSH.OPEN_PATHS, paths)
}

/**
 * 构建并应用应用菜单。
 * 最近文件列表变化后需要重新调用（Electron 菜单是静态的，改子菜单只能重建）。
 */
export function applyAppMenu(): void {
  const template = buildMenuTemplate({
    send: sendCommand,
    theme: getSettings().theme,
    recentFiles: getSettings().recentFiles,
    onOpenRecent: (filePath) => {
      void addRecentFile(filePath).then(() => applyAppMenu())
      sendOpenPaths([filePath])
    },
    onClearRecent: () => {
      void clearRecentFiles().then(() => applyAppMenu())
    },
    isDev,
    // 刻意不用 app.getName()：package.json 没有 productName，它会返回开发名
    // marktext-clone，菜单里就成了「关于 marktext-clone」。详见 shared/app-meta.ts。
    appName: APP_TITLE
  })

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

/** 供外部在最近文件变化后刷新菜单（去抖，避免频繁重建） */
let refreshTimer: NodeJS.Timeout | null = null
export function refreshAppMenuSoon(): void {
  if (refreshTimer) clearTimeout(refreshTimer)
  refreshTimer = setTimeout(() => {
    refreshTimer = null
    applyAppMenu()
  }, 200)
}

export { COMMANDS }
