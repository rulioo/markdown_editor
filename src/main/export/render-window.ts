/**
 * 临时隐藏窗口：PDF 导出与 Ctrl+P 打印共用的「把一段 HTML 变成渲染好的页面」这一步。
 *
 * 为什么必须落盘成临时文件而不是 `loadURL('data:text/html,…')`：
 * `data:` URL 在 Chromium 里是**不透明来源**（opaque origin），
 * 它的资源加载、字体、相对路径解析规则都与真实文档不同，
 * 而我们要的恰恰是「和浏览器打开同一个文件」的结果——验收标准就是这么写的。
 *
 * 安全姿态与主窗口一致（design.md NFR-3），并且**多一条**：
 * `javascript: false`。导出的是文档，不是应用，页面里不该有任何脚本可执行。
 * 代价是**不能等 `document.fonts.ready`**（那需要脚本），所以壳里只用本地系统字体、
 * 不做字体等待——这两件事在 design.md §5.6.3 里被同时要求过，是互斥的，此处取前者。
 *
 * 权限 handler 不在这里重复设置：它挂在默认 session 上（`window.ts:126`），
 * 这个窗口用的是同一个 session。
 */

import { BrowserWindow } from 'electron'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const TEMP_DIR_NAME = 'marktext-clone'

/** 加载超时。正常加载是几十毫秒级的，15 秒足够；超时说明出了没法自愈的状况 */
const LOAD_TIMEOUT_MS = 15_000

function tempDir(): string {
  return join(tmpdir(), TEMP_DIR_NAME)
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * 等页面加载完。
 *
 * `loadFile()` 自己的 resolve 就是「主框架加载完成」，但它**不会**在
 * 所有 `did-fail-load` 场景下 reject，所以两个来源都接上，靠 `settled` 去重。
 *
 * 关键细节：只认 `isMainFrame` 的失败。子资源失败（离线时的外链图片、
 * 被墙的 CDN 字体）不该毁掉整次导出——那种情况下用户想要的是
 * 「导出来了，只是某张图没加载上」，而不是「导出失败」。
 */
function loadHtml(win: BrowserWindow, file: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false

    const finish = (error?: Error): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      win.webContents.off('did-fail-load', onFailLoad)
      if (error) reject(error)
      else resolve()
    }

    const onFailLoad = (
      _event: Electron.Event,
      errorCode: number,
      errorDescription: string,
      url: string,
      isMainFrame: boolean
    ): void => {
      if (!isMainFrame) return
      finish(new Error(`导出页面加载失败（${errorCode} ${errorDescription}）：${url}`))
    }

    const timer = setTimeout(() => finish(new Error('导出页面加载超时')), LOAD_TIMEOUT_MS)

    win.webContents.on('did-fail-load', onFailLoad)
    win.loadFile(file).then(
      () => finish(),
      (error: unknown) => finish(new Error(`导出页面加载失败：${messageOf(error)}`))
    )
  })
}

/**
 * 把 `html` 写进临时文件、在隐藏窗口里加载、交给 `fn` 使用，然后**无条件**清理。
 *
 * 清理放 `finally`，所以「`fn` 抛错」「加载超时」这两条路径也不会留下临时文件；
 * 进程被强杀留下的残骸由启动时的 `cleanupExportTemp()` 兜底。
 */
export async function withPrintWindow<T>(
  html: string,
  fn: (win: BrowserWindow) => Promise<T>
): Promise<T> {
  const dir = tempDir()
  await fs.mkdir(dir, { recursive: true })
  const file = join(dir, `${randomUUID()}.html`)
  await fs.writeFile(file, html, 'utf8')

  const win = new BrowserWindow({
    // 不显示。**不是** `webPreferences.offscreen`——那是 OSR 帧捕获路径，
    // 与 printToPDF/print 无关，设了反而会走另一套渲染管线。
    show: false,
    width: 900,
    height: 1200,
    // 纸张底色。壳里的 CSS 会盖住它，但导出白底文档时它是兜底
    backgroundColor: '#ffffff',
    title: '导出',
    // 隐藏时仍要绘制。这一项为 false 时 printToPDF 拿到的是**空白页**——
    // 默认值就是 true，显式写出来是为了让它不能被误改。
    // 注意它是 BrowserWindow 的选项，**不在 webPreferences 里**（写在里面会被静默忽略）
    paintWhenInitiallyHidden: true,
    webPreferences: {
      // 这个窗口没有任何 preload：页面是文档，不需要、也不该有桥
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      spellcheck: false,
      // 文档里不该有脚本可执行。见文件头注释的取舍说明
      javascript: false,
      // 隐藏窗口会被 Chromium 降频；不关掉的话打印可能拿到未完成的布局
      backgroundThrottling: false
    }
  })

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  try {
    await loadHtml(win, file)
    return await fn(win)
  } finally {
    if (!win.isDestroyed()) win.destroy()
    await fs.rm(file, { force: true }).catch(() => undefined)
  }
}

/**
 * 清掉整个临时目录。
 *
 * **只在单实例前提下安全**：`index.ts:13` 的 `requestSingleInstanceLock()`
 * 保证了同一时刻只有一个进程在用这个目录，否则这里会把另一个实例正在用的文件删掉。
 * 启动时跑一次（扫上次崩溃的残留），退出时再跑一次。
 */
export async function cleanupExportTemp(): Promise<void> {
  await fs.rm(tempDir(), { recursive: true, force: true }).catch(() => undefined)
}
