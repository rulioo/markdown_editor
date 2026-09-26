/**
 * 「要打开的文档路径」的缓冲区——命令行启动、二次启动、macOS 的 open-file
 * 三个来源都汇到这里，再由一个出口交给窗口。
 *
 * ## 为什么需要它
 *
 * 原先的做法是：主进程在 `did-finish-load` 时 `webContents.send` 把路径推给渲染进程。
 * 但 `did-finish-load` 是**页面加载**事件，不是「渲染进程的监听器已注册」事件。
 * 而渲染进程注册监听器之前还要先 `await` 三跳 IPC（读配置、stat 工作区、读目录），
 * 这几跳要多久取决于磁盘 / 杀软 / 工作区大小。
 * `webContents.send` 在没有监听器时是**静默丢弃**的——于是「双击 .md，应用开了，但是空文档」。
 *
 * 这不是「打包才有」的问题：开发态只要工作区够大或磁盘够慢，同样会丢。
 *
 * ## 怎么解决的
 *
 * 出口有两个，都在这条不变式之下：
 *   - **启动**：渲染进程在注册完监听器之后**主动来取**（`takePendingPaths`），
 *     取的那一刻才把 `ready` 置真。所以路径不可能落进「窗口有了、监听器还没有」的空档。
 *   - **运行中**：`ready` 已经是真，路径直接交给 sink 推过去。
 *
 * `second-instance` 也必须过这个缓冲，不能直接推：冷启动那两三秒里用户再双击一个 md，
 * 第二个进程抢锁失败，而此刻第一个窗口的监听器多半还没注册好——推了就是丢。
 *
 * ## 「取走即清空」是刻意的
 *
 * macOS 关掉窗口不退出应用，再次点 Dock 图标会重建窗口。这时如果旧路径还在缓冲里，
 * 就会被重复打开一遍——那意味着**永远关不出一个空窗口**，比「重建后是空的」更意外。
 * 所以规则是：**渲染进程重建则清空，有新的外部输入则重填**
 * （无窗口期的 `open-file` 靠 `resetPathDelivery` 之后的 `queuePaths` 重新入队）。
 *
 * ## 已知假设
 *
 * 单窗口。`takePendingPaths` 是全局的，不区分窗口；`FILE_NEW_WINDOW` 目前还是桩，
 * 等它落地时这里必须改成「认焦点窗口」，否则多窗口会抢同一批路径。
 * 把这句话留在函数旁边，是为了让假设在破裂的那一刻可被发现。
 *
 * 本文件**不 import electron**，因此可以在单测里直接跑（同 `./cli.ts`）。
 */

type PathSink = (paths: string[]) => void

let sink: PathSink | null = null
/** 渲染进程是否已经取过一次——取过就意味着监听器已就绪，可以直推了 */
let ready = false
let pending: string[] = []

/** 由主进程注入真正的投递函数（`sendOpenPaths`） */
export function setPathSink(fn: PathSink): void {
  sink = fn
}

function dedupe(paths: string[]): string[] {
  return [...new Set(paths)]
}

/**
 * 有新的文档路径要打开。三个来源（启动 argv / 二次启动 / open-file）都调它。
 * 渲染进程还没就绪就攒着，已就绪就直接投递。
 */
export function queuePaths(paths: string[]): void {
  const add = dedupe(paths)
  if (add.length === 0) return

  if (!ready) {
    pending = dedupe([...pending, ...add])
    return
  }
  sink?.(add)
}

/**
 * 渲染进程来取启动时要打开的文件（**取走即清空**）。
 * 副作用是把 `ready` 置真：调用方保证此刻监听器已经注册好了。
 *
 * 重复传入同一路径由 `dedupe` 与 store 的 `openPath` 双层兜住，
 * 所以「二次启动恰好与启动路径重合」不需要额外处理。
 */
export function takePendingPaths(): string[] {
  ready = true
  const out = pending
  pending = []
  return out
}

/**
 * 窗口全部关闭时复位，让下一批路径重新走缓冲。
 * 服务于 macOS：窗口关掉但应用还在，此时 Finder 的 open-file 没有窗口可投递，
 * 必须先攒着，等 `activate` 建出的窗口来取。
 */
export function resetPathDelivery(): void {
  ready = false
}
