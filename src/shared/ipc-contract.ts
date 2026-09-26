/**
 * IPC 契约单一事实来源。主进程注册 handler、preload 暴露 API、渲染进程调用，
 * 三处都从这里取通道名与类型，避免字符串手写出错。
 */

import type {
  AssetsDirResult,
  Eol,
  ExportRequest,
  ExportResult,
  FileReadResult,
  FileStatResult,
  FileWriteRequest,
  FileWriteResult,
  FsChangeEvent,
  MessageRequest,
  MessageResult,
  OpenFileResult,
  OpenFolderResult,
  SaveAsResult,
  Settings,
  TextEncoding,
  TreeNode,
  WindowStateChanged,
  ExportFormat
} from './types'

/** 渲染进程 → 主进程（请求/响应） */
export const IPC = {
  DIALOG_OPEN_FILE: 'dialog:openFile',
  DIALOG_OPEN_FOLDER: 'dialog:openFolder',
  DIALOG_SAVE_AS: 'dialog:saveAs',
  DIALOG_MESSAGE: 'dialog:message',

  FS_READ_FILE: 'fs:readFile',
  FS_WRITE_FILE: 'fs:writeFile',
  FS_READ_DIR: 'fs:readDir',
  FS_STAT: 'fs:stat',
  FS_WATCH: 'fs:watch',
  FS_UNWATCH: 'fs:unwatch',
  FS_ASSETS_DIR: 'fs:assetsDir',
  FS_WRITE_BINARY: 'fs:writeBinary',

  EXPORT_PICK_TARGET: 'export:pickTarget',
  EXPORT_RUN: 'export:run',

  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',

  RECENT_LIST: 'recent:list',
  RECENT_ADD: 'recent:add',
  RECENT_CLEAR: 'recent:clear',

  SHELL_OPEN_EXTERNAL: 'shell:openExternal',
  SHELL_SHOW_ITEM_IN_FOLDER: 'shell:showItemInFolder',
  SHELL_OPEN_PATH: 'shell:openPath',

  WIN_MINIMIZE: 'win:minimize',
  WIN_MAXIMIZE: 'win:maximize',
  WIN_CLOSE: 'win:close',
  WIN_GET_STATE: 'win:getState',
  /** 渲染进程处理完未保存提示后，命令主进程放行关闭 */
  WIN_FORCE_CLOSE: 'win:forceClose',
  /** 渲染进程主动上报「是否有未保存内容」，主进程据此决定关窗时要不要拦截 */
  SET_DIRTY_STATE: 'app:setDirtyState',

  RECOVERY_LOAD: 'recovery:load',
  RECOVERY_SAVE: 'recovery:save',
  RECOVERY_CLEAR: 'recovery:clear',

  APP_INFO: 'app:info',
  /**
   * 渲染进程启动完成后来取「命令行要打开的文件」。**取走即清空**。
   *
   * 与下面的 `IPC_PUSH.OPEN_PATHS` 是**两个都要留**的一对，别把任一方当成死代码删掉：
   *   - 本通道管**启动**——渲染进程注册好监听器之后主动来拉，因此不存在
   *     「窗口已建、监听器未注册」的时间窗（原先用 did-finish-load 推送就丢在这一段）。
   *   - `OPEN_PATHS` 管**运行中**——窗口早就绪，直接推更省一次往返。
   * 两者共用 `src/main/pending-paths.ts` 的同一个缓冲。
   */
  APP_TAKE_PENDING_PATHS: 'app:takePendingPaths'
} as const

/** 主进程 → 渲染进程（推送） */
export const IPC_PUSH = {
  MENU_COMMAND: 'push:menuCommand',
  FS_CHANGED: 'push:fsChanged',
  WINDOW_STATE_CHANGED: 'push:windowStateChanged',
  /** 运行中把外部要打开的路径推给已就绪的窗口（启动那一批走 IPC.APP_TAKE_PENDING_PATHS） */
  OPEN_PATHS: 'push:openPaths',
  /** 请求渲染进程在退出前确认未保存修改 */
  APP_BEFORE_QUIT: 'push:beforeQuit'
} as const

/* ------------------------------ 请求 / 响应类型表 ----------------------------- */

export interface SaveAsRequest {
  defaultPath?: string
  filters: { name: string; extensions: string[] }[]
  title?: string
}

export interface WatchRequest {
  path: string
}

export interface WriteBinaryRequest {
  /** 目标目录（由 fs:assetsDir 返回） */
  dir: string
  fileName: string
  /** base64 编码的二进制内容 */
  base64: string
}

export interface AssetsDirRequest {
  /** 当前文档路径；未保存文档传 null */
  docPath: string | null
  /** 图片扩展名，如 png */
  ext: string
}

export interface AppInfo {
  name: string
  version: string
  electron: string
  chrome: string
  node: string
  /** 取值见 process.platform；这里用 string 是为了让渲染进程的 tsconfig（不含 @types/node）也能引用 */
  platform: string
}

/**
 * invoke 通道 → { req, res }。
 * preload 与主进程都基于此表推导签名，新增通道时只改这里。
 */
export interface InvokeMap {
  [IPC.DIALOG_OPEN_FILE]: { req: void; res: OpenFileResult }
  [IPC.DIALOG_OPEN_FOLDER]: { req: void; res: OpenFolderResult }
  [IPC.DIALOG_SAVE_AS]: { req: SaveAsRequest; res: SaveAsResult }
  [IPC.DIALOG_MESSAGE]: { req: MessageRequest; res: MessageResult }

  [IPC.FS_READ_FILE]: { req: string; res: FileReadResult }
  [IPC.FS_WRITE_FILE]: { req: FileWriteRequest; res: FileWriteResult }
  [IPC.FS_READ_DIR]: { req: string; res: TreeNode[] }
  [IPC.FS_STAT]: { req: string; res: FileStatResult }
  [IPC.FS_WATCH]: { req: WatchRequest; res: void }
  [IPC.FS_UNWATCH]: { req: WatchRequest; res: void }
  [IPC.FS_ASSETS_DIR]: { req: AssetsDirRequest; res: AssetsDirResult }
  [IPC.FS_WRITE_BINARY]: { req: WriteBinaryRequest; res: string }

  [IPC.EXPORT_PICK_TARGET]: { req: { format: ExportFormat; defaultPath?: string }; res: SaveAsResult }
  [IPC.EXPORT_RUN]: { req: ExportRequest; res: ExportResult }

  [IPC.SETTINGS_GET]: { req: void; res: Settings }
  [IPC.SETTINGS_SET]: { req: Partial<Settings>; res: Settings }

  [IPC.RECENT_LIST]: { req: void; res: string[] }
  [IPC.RECENT_ADD]: { req: string; res: string[] }
  [IPC.RECENT_CLEAR]: { req: void; res: string[] }

  [IPC.SHELL_OPEN_EXTERNAL]: { req: string; res: void }
  [IPC.SHELL_SHOW_ITEM_IN_FOLDER]: { req: string; res: void }
  [IPC.SHELL_OPEN_PATH]: { req: string; res: string }

  [IPC.WIN_MINIMIZE]: { req: void; res: void }
  [IPC.WIN_MAXIMIZE]: { req: void; res: void }
  [IPC.WIN_CLOSE]: { req: void; res: void }
  [IPC.WIN_GET_STATE]: { req: void; res: WindowStateChanged }
  [IPC.WIN_FORCE_CLOSE]: { req: void; res: void }
  [IPC.SET_DIRTY_STATE]: { req: boolean; res: void }

  [IPC.RECOVERY_LOAD]: { req: void; res: RecoveryPayload | null }
  [IPC.RECOVERY_SAVE]: { req: RecoveryPayload; res: void }
  [IPC.RECOVERY_CLEAR]: { req: void; res: void }

  [IPC.APP_INFO]: { req: void; res: AppInfo }
  [IPC.APP_TAKE_PENDING_PATHS]: { req: void; res: string[] }
}

/** 崩溃恢复文档（与 types.ts 的 RecoveryDocument 对应，这里避免循环引用只做别名） */
export type RecoveryPayload = import('./types').RecoveryFile

/** 主进程推送事件的 payload 类型表 */
export interface PushMap {
  [IPC_PUSH.MENU_COMMAND]: string
  [IPC_PUSH.FS_CHANGED]: { path: string; event: FsChangeEvent }
  [IPC_PUSH.WINDOW_STATE_CHANGED]: WindowStateChanged
  [IPC_PUSH.OPEN_PATHS]: string[]
  [IPC_PUSH.APP_BEFORE_QUIT]: void
}

/** 编码选项，供文件对话框与状态栏共用 */
export const ENCODING_LABELS: Record<TextEncoding, string> = {
  utf8: 'UTF-8',
  'utf8-bom': 'UTF-8 (BOM)',
  utf16le: 'UTF-16 LE',
  utf16be: 'UTF-16 BE',
  gbk: 'GBK',
  gb18030: 'GB18030',
  big5: 'Big5',
  latin1: 'ISO-8859-1'
}

export const EOL_LABELS: Record<Eol, string> = {
  lf: 'LF',
  crlf: 'CRLF'
}
