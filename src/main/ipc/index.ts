/**
 * IPC handler 注册总入口。
 *
 * 约定：所有 handler 都不信任渲染进程传入的参数——路径存在性、类型都在这里复核。
 * 出错时抛出 Error，Electron 会把 message 透传给渲染进程的 reject，
 * 因此错误信息统一写成可直接展示给用户的中文。
 */

import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { basename, isAbsolute } from 'node:path'
import { IPC } from '@shared/ipc-contract'
import type {
  AppInfo,
  AssetsDirRequest,
  RecoveryPayload,
  SaveAsRequest
} from '@shared/ipc-contract'
import type {
  MessageRequest,
  MessageResult,
  OpenFileResult,
  OpenFolderResult,
  SaveAsResult,
  Settings,
  TreeNode
} from '@shared/types'
import {
  readDirectory,
  readFile,
  resolveAssetsDir,
  statPath,
  writeBinary,
  writeFile
} from './fs'
import { addRecentFile, clearRecentFiles, flushSettings, getSettings, setSettings } from '../store'
import { watchFile, unwatchFile } from '../watcher'
import { forceCloseWindow, openExternal, setWindowDirty } from '../window'
import { refreshAppMenuSoon } from '../menu'
import { loadRecovery, saveRecovery, clearRecovery } from '../recovery'
import { exportRun, pickExportTarget, printDocument } from '../export'
import { sanitizeExportRequest, sanitizePrintRequest } from '../export/validate'
import { takePendingPaths } from '../pending-paths'

/** 取当前发起请求的窗口 */
function senderWindow(event: Electron.IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender)
}

const MD_FILTERS = [
  { name: 'Markdown 文件', extensions: ['md', 'markdown', 'mdown', 'mkd'] },
  { name: '文本文件', extensions: ['txt'] },
  { name: '所有文件', extensions: ['*'] }
]

export function registerIpcHandlers(): void {
  /* ------------------------------- 对话框 ------------------------------- */

  ipcMain.handle(IPC.DIALOG_OPEN_FILE, async (event): Promise<OpenFileResult> => {
    const win = senderWindow(event)
    const result = win
      ? await dialog.showOpenDialog(win, {
          title: '打开文件',
          properties: ['openFile', 'multiSelections'],
          filters: MD_FILTERS
        })
      : await dialog.showOpenDialog({
          title: '打开文件',
          properties: ['openFile', 'multiSelections'],
          filters: MD_FILTERS
        })
    return { canceled: result.canceled, paths: result.filePaths }
  })

  ipcMain.handle(IPC.DIALOG_OPEN_FOLDER, async (event): Promise<OpenFolderResult> => {
    const win = senderWindow(event)
    const options: Electron.OpenDialogOptions = {
      title: '打开文件夹',
      properties: ['openDirectory']
    }
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options)
    return {
      canceled: result.canceled,
      path: result.filePaths[0] ?? null
    }
  })

  ipcMain.handle(
    IPC.DIALOG_SAVE_AS,
    async (event, request: SaveAsRequest): Promise<SaveAsResult> => {
      const win = senderWindow(event)
      const options: Electron.SaveDialogOptions = {
        title: request?.title ?? '另存为',
        defaultPath: request?.defaultPath,
        filters: request?.filters ?? MD_FILTERS
      }
      const result = win
        ? await dialog.showSaveDialog(win, options)
        : await dialog.showSaveDialog(options)
      return { canceled: result.canceled, path: result.filePath ?? null }
    }
  )

  ipcMain.handle(
    IPC.DIALOG_MESSAGE,
    async (event, request: MessageRequest): Promise<MessageResult> => {
      const win = senderWindow(event)
      const options: Electron.MessageBoxOptions = {
        type: request.type,
        title: request.title,
        message: request.message,
        detail: request.detail,
        buttons: request.buttons,
        defaultId: request.defaultId ?? 0,
        cancelId: request.cancelId,
        noLink: true
      }
      const result = win
        ? await dialog.showMessageBox(win, options)
        : await dialog.showMessageBox(options)
      return { response: result.response }
    }
  )

  /* -------------------------------- 文件 IO -------------------------------- */

  ipcMain.handle(IPC.FS_READ_FILE, async (_event, filePath: string) => {
    if (typeof filePath !== 'string' || !isAbsolute(filePath)) {
      throw new Error('无效的文件路径')
    }
    return readFile(filePath)
  })

  ipcMain.handle(IPC.FS_WRITE_FILE, async (_event, request) => {
    if (!request || typeof request.path !== 'string' || !isAbsolute(request.path)) {
      throw new Error('无效的文件路径')
    }
    const result = await writeFile(request)
    // 保存后刷新最近文件与菜单
    await addRecentFile(request.path)
    refreshAppMenuSoon()
    return result
  })

  ipcMain.handle(IPC.FS_READ_DIR, async (_event, dirPath: string): Promise<TreeNode[]> => {
    if (typeof dirPath !== 'string' || !isAbsolute(dirPath)) {
      throw new Error('无效的目录路径')
    }
    return readDirectory(dirPath)
  })

  ipcMain.handle(IPC.FS_STAT, async (_event, target: string) => {
    if (typeof target !== 'string' || !isAbsolute(target)) {
      throw new Error('无效的路径')
    }
    return statPath(target)
  })

  ipcMain.handle(IPC.FS_WATCH, async (_event, { path: filePath }: { path: string }) => {
    if (typeof filePath === 'string' && isAbsolute(filePath)) watchFile(filePath)
  })

  ipcMain.handle(IPC.FS_UNWATCH, async (_event, { path: filePath }: { path: string }) => {
    if (typeof filePath === 'string') unwatchFile(filePath)
  })

  ipcMain.handle(IPC.FS_ASSETS_DIR, async (_event, request: AssetsDirRequest) =>
    resolveAssetsDir(request?.docPath ?? null, request?.ext ?? 'png')
  )

  ipcMain.handle(IPC.FS_WRITE_BINARY, async (_event, request) => {
    if (!request || !isAbsolute(request.dir)) throw new Error('无效的目录路径')
    // 只允许写入目标目录内的文件，防止 fileName 里塞 ../ 越权写
    const safeName = basename(request.fileName)
    return writeBinary(request.dir, safeName, request.base64)
  })

  /* --------------------------------- 导出 --------------------------------- */

  ipcMain.handle(IPC.EXPORT_PICK_TARGET, async (event, request) => {
    return pickExportTarget(senderWindow(event), request?.format ?? 'html', request?.defaultPath)
  })

  // 这两个 handler 一度是整个文件里仅有的、不校验入参的例外。参数会一路走到
  // Chromium 的打印 API，那里对 NaN / 缺字段的反应是「产出垃圾」而不是报错。
  // 校验模块抛中文异常，`exportRun` 则返回 {ok:false,error}——两种错误通道都要留着：
  // 前者是「调用方写错了」（不该发生），后者是「导出这件事失败了」（会发生）。
  ipcMain.handle(IPC.EXPORT_RUN, async (_event, request) => {
    return exportRun(sanitizeExportRequest(request))
  })

  ipcMain.handle(IPC.EXPORT_PRINT, async (_event, request) => {
    return printDocument(sanitizePrintRequest(request))
  })

  /* --------------------------------- 设置 --------------------------------- */

  ipcMain.handle(IPC.SETTINGS_GET, async (): Promise<Settings> => getSettings())

  ipcMain.handle(IPC.SETTINGS_SET, async (_event, patch: Partial<Settings>) => {
    const previousTheme = getSettings().theme
    const next = await setSettings(patch ?? {})
    // 「主题」子菜单是 radio 单选态，而 Electron 的菜单是静态的：
    // 不打勾就看不出当前在哪一档，所以改了主题必须重建菜单。
    //
    // 两个收敛：只在真的变了时重建（SETTINGS_SET 也被导出选项这类路径调用），
    // 且走 refreshAppMenuSoon 而不是直接重建——状态栏那个按钮是「点一下换一档」，
    // 连点三下会连改三次主题，重建菜单是会关掉已展开菜单的重操作。
    if (next.theme !== previousTheme) refreshAppMenuSoon()
    return next
  })

  /* ------------------------------- 最近文件 ------------------------------- */

  ipcMain.handle(IPC.RECENT_LIST, async () => getSettings().recentFiles)

  ipcMain.handle(IPC.RECENT_ADD, async (_event, filePath: string) => {
    if (typeof filePath !== 'string' || !isAbsolute(filePath)) {
      throw new Error('无效的文件路径')
    }
    const list = await addRecentFile(filePath)
    refreshAppMenuSoon()
    return list
  })

  ipcMain.handle(IPC.RECENT_CLEAR, async () => {
    const list = await clearRecentFiles()
    refreshAppMenuSoon()
    return list
  })

  /* --------------------------------- 外壳 --------------------------------- */

  ipcMain.handle(IPC.SHELL_OPEN_EXTERNAL, async (_event, url: string) => {
    await openExternal(url)
  })

  ipcMain.handle(IPC.SHELL_SHOW_ITEM_IN_FOLDER, async (_event, target: string) => {
    if (typeof target !== 'string' || !isAbsolute(target)) {
      throw new Error('无效的路径')
    }
    shell.showItemInFolder(target)
  })

  ipcMain.handle(IPC.SHELL_OPEN_PATH, async (_event, target: string) => {
    if (typeof target !== 'string' || !isAbsolute(target)) {
      throw new Error('无效的路径')
    }
    const error = await shell.openPath(target)
    return error
  })

  /* --------------------------------- 窗口 --------------------------------- */

  ipcMain.handle(IPC.WIN_MINIMIZE, async (event) => {
    senderWindow(event)?.minimize()
  })

  ipcMain.handle(IPC.WIN_MAXIMIZE, async (event) => {
    const win = senderWindow(event)
    if (!win) return
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })

  ipcMain.handle(IPC.WIN_CLOSE, async (event) => {
    senderWindow(event)?.close()
  })

  ipcMain.handle(IPC.WIN_GET_STATE, async (event) => {
    const win = senderWindow(event)
    return {
      maximized: win?.isMaximized() ?? false,
      fullscreen: win?.isFullScreen() ?? false
    }
  })

  ipcMain.handle(IPC.WIN_FORCE_CLOSE, async (event) => {
    const win = senderWindow(event)
    if (win) forceCloseWindow(win)
  })

  ipcMain.handle(IPC.SET_DIRTY_STATE, async (event, dirty: boolean) => {
    const win = senderWindow(event)
    if (win) setWindowDirty(win, !!dirty)
  })

  /* ------------------------------- 崩溃恢复 ------------------------------- */

  ipcMain.handle(IPC.RECOVERY_LOAD, async (): Promise<RecoveryPayload | null> => loadRecovery())

  ipcMain.handle(IPC.RECOVERY_SAVE, async (_event, payload: RecoveryPayload) => {
    await saveRecovery(payload)
  })

  ipcMain.handle(IPC.RECOVERY_CLEAR, async () => {
    await clearRecovery()
  })

  /* -------------------------------- 应用信息 -------------------------------- */

  ipcMain.handle(
    IPC.APP_INFO,
    async (): Promise<AppInfo> => ({
      name: app.getName(),
      version: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      platform: process.platform
    })
  )

  // 渲染进程登记「监听器已就绪」的同一时刻把启动路径取走。取走即清空，
  // 所以这次调用有副作用——不要把它当成一个纯查询去别处复用。
  ipcMain.handle(IPC.APP_TAKE_PENDING_PATHS, async (): Promise<string[]> => takePendingPaths())
}

/** 退出前清理：把防抖中的配置写入落盘，保证进程能正常结束 */
export function disposeIpcHandlers(): void {
  void flushSettings()
}
