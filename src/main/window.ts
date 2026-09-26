import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { getSettings, setSettings } from './store'
import { IPC_PUSH } from '@shared/ipc-contract'
import { APP_TITLE } from '@shared/app-meta'

/** electron-vite 在 dev 模式下注入的渲染进程地址；生产构建下为 undefined */
export const RENDERER_DEV_URL = process.env['ELECTRON_RENDERER_URL']
export const isDev = !!RENDERER_DEV_URL

/** 允许在系统浏览器中打开的协议白名单 */
const EXTERNAL_PROTOCOLS = /^(https?|mailto):/i

/**
 * 关闭窗口时的数据保护。
 *
 * 主进程无法知道渲染进程里有没有未保存的文档，所以由渲染进程在脏状态变化时上报。
 * 只有「确实有未保存内容」时才拦截关闭并请渲染进程弹确认框——
 * 没有脏数据时直接放行，避免渲染进程卡死导致窗口关不掉。
 */
const dirtyWindows = new WeakSet<BrowserWindow>()
const forceClosing = new WeakSet<BrowserWindow>()

export function setWindowDirty(win: BrowserWindow, dirty: boolean): void {
  if (dirty) dirtyWindows.add(win)
  else dirtyWindows.delete(win)
}

/** 渲染进程确认可以关闭后调用 */
export function forceCloseWindow(win: BrowserWindow): void {
  forceClosing.add(win)
  win.close()
}

export function createMainWindow(): BrowserWindow {
  const settings = getSettings()

  const win = new BrowserWindow({
    width: settings.window.width,
    height: settings.window.height,
    x: settings.window.x ?? undefined,
    y: settings.window.y ?? undefined,
    minWidth: 680,
    minHeight: 480,
    show: false,
    // 自绘标题栏，保持 MarkText 的观感
    frame: false,
    backgroundColor: settings.theme === 'dark' ? '#1e1e1e' : '#ffffff',
    title: APP_TITLE,
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      // 安全基线（design.md NFR-3）：三件套缺一不可
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      spellcheck: false
    }
  })

  if (settings.window.maximized) win.maximize()

  win.once('ready-to-show', () => win.show())

  /* --------------------------- 窗口状态持久化 --------------------------- */
  const persistBounds = (): void => {
    if (win.isDestroyed()) return
    // 最大化时 getBounds() 返回的是屏幕尺寸，必须用 getNormalBounds() 才能记住还原后的尺寸
    const bounds = win.getNormalBounds()
    void setSettings({
      window: {
        width: bounds.width,
        height: bounds.height,
        x: bounds.x,
        y: bounds.y,
        maximized: win.isMaximized()
      }
    })
  }
  win.on('resize', persistBounds)
  win.on('move', persistBounds)

  /* ------------------------ 窗口状态变化通知渲染进程 ------------------------ */
  const pushWindowState = (): void => {
    if (win.isDestroyed()) return
    win.webContents.send(IPC_PUSH.WINDOW_STATE_CHANGED, {
      maximized: win.isMaximized(),
      fullscreen: win.isFullScreen()
    })
  }
  win.on('maximize', pushWindowState)
  win.on('unmaximize', pushWindowState)
  win.on('enter-full-screen', pushWindowState)
  win.on('leave-full-screen', pushWindowState)
  win.on('restore', persistBounds)

  /* --------------------------- 关闭前的数据保护 --------------------------- */
  win.on('close', (event) => {
    if (forceClosing.has(win)) return
    if (!dirtyWindows.has(win)) return
    // 有未保存内容：拦下来交给渲染进程弹「保存 / 不保存 / 取消」
    event.preventDefault()
    win.webContents.send(IPC_PUSH.APP_BEFORE_QUIT)
  })

  // 渲染进程崩溃时清掉脏标记，否则窗口会永远关不掉
  win.webContents.on('render-process-gone', () => {
    dirtyWindows.delete(win)
  })

  /* ------------------------------ 安全策略 ------------------------------ */
  // 一律不允许应用内开新窗口；外链交给系统浏览器
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (EXTERNAL_PROTOCOLS.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  win.webContents.on('will-navigate', (event, url) => {
    // dev 模式下允许 Vite HMR 的整页刷新
    if (RENDERER_DEV_URL && url.startsWith(RENDERER_DEV_URL)) return
    event.preventDefault()
    if (EXTERNAL_PROTOCOLS.test(url)) void shell.openExternal(url)
  })

  // 拒绝一切权限请求（摄像头、麦克风、通知等）——本应用不需要任何一项
  win.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => {
    callback(false)
  })

  /* ------------------------------ 开发期诊断 ------------------------------ */
  // 渲染进程的报错默认只出现在 DevTools 里，终端完全看不到。
  // 未打包时把 warn/error 转发到主进程终端，否则「窗口白屏」将无从排查。
  if (!app.isPackaged) {
    win.webContents.on('console-message', (event) => {
      if (event.level === 'warning' || event.level === 'error') {
        console.error(`[渲染进程/${event.level}] ${event.message} (${event.sourceId}:${event.lineNumber})`)
      } else {
        console.log(`[渲染进程] ${event.message}`)
      }
    })

    win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, url) => {
      console.error(`[窗口] 页面加载失败 ${errorCode} ${errorDescription} — ${url}`)
    })

    win.webContents.on('render-process-gone', (_event, details) => {
      console.error(`[窗口] 渲染进程退出：${details.reason}`)
    })

    win.webContents.on('preload-error', (_event, preloadPath, error) => {
      console.error(`[窗口] 预加载脚本出错 ${preloadPath}：`, error)
    })
  }

  /* -------------------------------- 加载 -------------------------------- */
  if (RENDERER_DEV_URL) {
    void win.loadURL(RENDERER_DEV_URL)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

/** 在系统浏览器打开链接（协议白名单校验） */
export async function openExternal(url: string): Promise<void> {
  if (!EXTERNAL_PROTOCOLS.test(url)) {
    throw new Error(`已阻止打开非白名单协议的链接：${url}`)
  }
  await shell.openExternal(url)
}
