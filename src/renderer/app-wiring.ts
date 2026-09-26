/**
 * 应用级装配：把主进程推送的事件接到 store 与命令注册表上。
 *
 * 在 App.vue 的 setup 中同步调用——watch 必须在 setup 同步阶段创建，
 * 才能被组件的 effect scope 收集并在卸载时自动清理。
 */

import { onMounted, onUnmounted, watch } from 'vue'
import { IPC_PUSH } from '@shared/ipc-contract'
import { executeCommand } from './commands/registry'
import { dirName, useFilesStore } from './stores/files'
import { useWorkspaceStore } from './stores/workspace'
import { useLayoutStore } from './stores/layout'
import { useSettingsStore } from './stores/settings'

export function setupAppWiring(): void {
  const files = useFilesStore()
  const workspace = useWorkspaceStore()
  const layout = useLayoutStore()
  const settings = useSettingsStore()

  const disposers: Array<() => void> = []

  /** 主题写到 <html>：CSS 变量选择器是 :root[data-theme='dark'] */
  watch(
    () => settings.resolvedTheme,
    (theme) => document.documentElement.setAttribute('data-theme', theme),
    { immediate: true }
  )

  /** 字体大小等排版变量挂在 <html> 上，编辑区与预览共用 */
  watch(
    () => settings.settings,
    (s) => {
      const root = document.documentElement
      root.style.setProperty('--md-font-size', `${s.fontSize}px`)
      root.style.setProperty('--md-line-height', `${s.lineHeight}`)
      root.style.setProperty('--md-font-family', s.fontFamily)
      root.style.setProperty('--md-code-font-family', s.codeFontFamily)
    },
    { immediate: true, deep: true }
  )

  /** 脏状态上报主进程：窗口关闭时据此决定要不要拦截 */
  watch(
    () => files.hasDirty,
    (dirty) => {
      void window.api.app.setDirtyState(dirty)
    },
    { immediate: true }
  )

  /* ------------------------------ 事件处理 ------------------------------ */

  async function openExternalPaths(paths: string[]): Promise<void> {
    if (paths.length === 0) return
    await files.openPaths(paths)
    // 只在还没有工作区时用文件所在目录顶上（冷启动走的就是这条）。
    // 窗口已开的情况下不动文件树：多选跨目录时 dirName(paths[0]) 本就是任意的，
    // 而用户本次已经显式选过工作区，双击一个文件就把它换掉是未经请求的可见改动。
    if (!workspace.hasWorkspace) await workspace.openFolder(dirName(paths[0]))
  }

  /** 还原上次打开的文件夹；路径已失效就静默跳过（不打断启动） */
  async function restoreLastFolder(): Promise<void> {
    const lastFolder = settings.settings.lastOpenFolder
    if (!lastFolder) return
    const stat = await window.api.fs.stat(lastFolder)
    if (stat.exists && stat.isDirectory) await workspace.openFolder(lastFolder)
  }

  /** 文件被外部程序修改 */
  async function handleExternalChange(
    filePath: string,
    event: 'change' | 'unlink' | 'rename'
  ): Promise<void> {
    const session = files.findByPath(filePath)
    if (!session) return

    if (event === 'unlink') {
      // 有些编辑器保存时会先删再建，这里不立刻下结论，交给后续 stat 判断
      const stat = await window.api.fs.stat(filePath)
      if (stat.exists) return
      layout.notify(`文件已被删除：${session.name}`, 'error')
      return
    }

    if (files.isDirty(session)) {
      const { response } = await window.api.dialog.message({
        type: 'warning',
        title: '文件已被外部修改',
        message: `「${session.name}」在磁盘上已被其他程序修改，而你有未保存的更改。`,
        detail: '重新载入会丢弃你的修改；保留修改则磁盘上的内容将在下次保存时被覆盖。',
        buttons: ['重新载入', '保留我的修改'],
        defaultId: 1,
        cancelId: 1
      })
      if (response === 0) await files.reloadFromDisk(session.id)
      else files.acceptDiskVersion(session.id)
      return
    }

    await files.reloadFromDisk(session.id)
  }

  /** 主进程在关窗前询问（存在未保存内容） */
  async function handleBeforeQuit(): Promise<void> {
    if (await files.closeAll()) await window.api.win.forceClose()
  }

  /* ------------------------------- 监听器注册 ------------------------------- */

  // 必须留在 setup 体内（同步），不能挪进下面的 onMounted：
  // onMounted 里在取命令行文件之前还有若干跳 await IPC，而主进程的推送
  // ——webContents.send 在没有监听器时是**静默丢弃**的——就落在那段空档里。
  // 放在这里，「先注册再 await」就是结构性质，不是一条靠人记住的顺序约定。
  disposers.push(
    window.api.on(IPC_PUSH.MENU_COMMAND, (commandId) => {
      void executeCommand(commandId)
    }),
    window.api.on(IPC_PUSH.OPEN_PATHS, (paths) => {
      void openExternalPaths(paths)
    }),
    window.api.on(IPC_PUSH.FS_CHANGED, ({ path, event }) => {
      void handleExternalChange(path, event)
    }),
    window.api.on(IPC_PUSH.APP_BEFORE_QUIT, () => {
      void handleBeforeQuit()
    })
  )

  /* ------------------------------- 生命周期 ------------------------------- */

  onMounted(async () => {
    await settings.load()

    // 取命令行指定的文件。调用本身即向主进程声明「监听器已就绪」，
    // 此后新路径会直接推过来，所以这一句必须在上面注册完之后。
    const pending = await window.api.app.takePendingPaths()
    if (pending.length > 0) await openExternalPaths(pending)

    // 三条守卫而不是 if/else：命令行给的文件可能已被删除，此时 openExternalPaths
    // 不会建立工作区，用户仍应拿到上次的工作区 + 空白标签，而不是一个空窗口。
    if (!workspace.hasWorkspace) await restoreLastFolder()

    // 空窗口体验很差，先给一个空白文档
    if (files.sessions.length === 0) files.newFile()
  })

  onUnmounted(() => {
    for (const dispose of disposers) dispose()
  })
}
