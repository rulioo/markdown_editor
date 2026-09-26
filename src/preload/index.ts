/**
 * 预加载脚本：contextBridge 安全桥。
 *
 * 运行在 sandbox: true 环境下，因此**必须是 CJS**（electron.vite.config.ts 里显式指定了
 * format: 'cjs'），且只允许 require('electron')，不能引入任何 Node 内置模块。
 */

import { contextBridge, ipcRenderer } from 'electron'
import { IPC, IPC_PUSH } from '@shared/ipc-contract'
import type { InvokeMap, PushMap } from '@shared/ipc-contract'
import type { RendererApi } from '@shared/api'

/** 类型安全的 invoke 包装 */
function invoke<K extends keyof InvokeMap>(
  channel: K,
  payload?: InvokeMap[K]['req']
): Promise<InvokeMap[K]['res']> {
  return ipcRenderer.invoke(channel as string, payload) as Promise<InvokeMap[K]['res']>
}

/** 订阅主进程推送，返回取消订阅函数 */
function on<K extends keyof PushMap>(
  channel: K,
  callback: (payload: PushMap[K]) => void
): () => void {
  const listener = (_event: Electron.IpcRendererEvent, payload: PushMap[K]): void => {
    callback(payload)
  }
  ipcRenderer.on(channel as string, listener)
  return () => {
    ipcRenderer.off(channel as string, listener)
  }
}

const api: RendererApi = {
  dialog: {
    openFile: () => invoke(IPC.DIALOG_OPEN_FILE),
    openFolder: () => invoke(IPC.DIALOG_OPEN_FOLDER),
    saveAs: (request) => invoke(IPC.DIALOG_SAVE_AS, request),
    message: (request) => invoke(IPC.DIALOG_MESSAGE, request)
  },
  fs: {
    readFile: (path) => invoke(IPC.FS_READ_FILE, path),
    writeFile: (request) => invoke(IPC.FS_WRITE_FILE, request),
    readDir: (path) => invoke(IPC.FS_READ_DIR, path),
    stat: (path) => invoke(IPC.FS_STAT, path),
    watch: (request) => invoke(IPC.FS_WATCH, request),
    unwatch: (request) => invoke(IPC.FS_UNWATCH, request),
    assetsDir: (request) => invoke(IPC.FS_ASSETS_DIR, request),
    writeBinary: (request) => invoke(IPC.FS_WRITE_BINARY, request)
  },
  export: {
    pickTarget: (format, defaultPath) =>
      invoke(IPC.EXPORT_PICK_TARGET, { format, defaultPath }),
    run: (request) => invoke(IPC.EXPORT_RUN, request)
  },
  settings: {
    get: () => invoke(IPC.SETTINGS_GET),
    set: (patch) => invoke(IPC.SETTINGS_SET, patch)
  },
  recent: {
    list: () => invoke(IPC.RECENT_LIST),
    add: (path) => invoke(IPC.RECENT_ADD, path),
    clear: () => invoke(IPC.RECENT_CLEAR)
  },
  shell: {
    openExternal: (url) => invoke(IPC.SHELL_OPEN_EXTERNAL, url),
    showItemInFolder: (path) => invoke(IPC.SHELL_SHOW_ITEM_IN_FOLDER, path),
    openPath: (path) => invoke(IPC.SHELL_OPEN_PATH, path)
  },
  win: {
    minimize: () => invoke(IPC.WIN_MINIMIZE),
    maximize: () => invoke(IPC.WIN_MAXIMIZE),
    close: () => invoke(IPC.WIN_CLOSE),
    getState: () => invoke(IPC.WIN_GET_STATE),
    forceClose: () => invoke(IPC.WIN_FORCE_CLOSE)
  },
  recovery: {
    load: () => invoke(IPC.RECOVERY_LOAD),
    save: (payload) => invoke(IPC.RECOVERY_SAVE, payload),
    clear: () => invoke(IPC.RECOVERY_CLEAR)
  },
  app: {
    info: () => invoke(IPC.APP_INFO),
    setDirtyState: (dirty) => invoke(IPC.SET_DIRTY_STATE, dirty),
    takePendingPaths: () => invoke(IPC.APP_TAKE_PENDING_PATHS)
  },
  on
}

// 暴露的通道白名单在 preload 内部闭合，渲染进程拿不到 ipcRenderer 本体
contextBridge.exposeInMainWorld('api', api)

export const PUSH_CHANNELS = IPC_PUSH
