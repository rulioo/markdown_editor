/**
 * preload 通过 contextBridge 暴露给渲染进程的 API 形状。
 *
 * 放在 shared 而不是 preload 目录，是为了让渲染进程能直接 import 类型
 * （两个 tsconfig 的 include 范围都覆盖 src/shared）。
 *
 * 原则：只暴露**具体方法**，绝不暴露 ipcRenderer 本体——
 * 否则渲染进程可以往任意通道发消息，contextIsolation 就形同虚设。
 */

import type { InvokeMap, PushMap, SaveAsRequest, WatchRequest, WriteBinaryRequest, AssetsDirRequest } from './ipc-contract'
import type {
  ExportFormat,
  ExportOptions,
  ExportRequest,
  ExportResult,
  FileReadResult,
  FileStatResult,
  FileWriteRequest,
  FileWriteResult,
  MessageRequest,
  MessageResult,
  OpenFileResult,
  OpenFolderResult,
  SaveAsResult,
  Settings,
  TextEncoding,
  TreeNode,
  WindowStateChanged
} from './types'

export interface RendererApi {
  dialog: {
    openFile(): Promise<OpenFileResult>
    openFolder(): Promise<OpenFolderResult>
    saveAs(request: SaveAsRequest): Promise<SaveAsResult>
    message(request: MessageRequest): Promise<MessageResult>
  }
  fs: {
    readFile(path: string): Promise<FileReadResult>
    writeFile(request: FileWriteRequest): Promise<FileWriteResult>
    readDir(path: string): Promise<TreeNode[]>
    stat(path: string): Promise<FileStatResult>
    watch(request: WatchRequest): Promise<void>
    unwatch(request: WatchRequest): Promise<void>
    assetsDir(request: AssetsDirRequest): Promise<{ dir: string; relPath: string }>
    writeBinary(request: WriteBinaryRequest): Promise<string>
  }
  export: {
    pickTarget(format: ExportFormat, defaultPath?: string): Promise<SaveAsResult>
    run(request: ExportRequest): Promise<ExportResult>
    /** 调起系统打印对话框。用户取消时返回 `{ok:false, canceled:true}`，不是错误 */
    print(request: Omit<ExportRequest, 'targetPath' | 'format'>): Promise<ExportResult>
  }
  settings: {
    get(): Promise<Settings>
    set(patch: Partial<Settings>): Promise<Settings>
  }
  recent: {
    list(): Promise<string[]>
    add(path: string): Promise<string[]>
    clear(): Promise<string[]>
  }
  shell: {
    openExternal(url: string): Promise<void>
    showItemInFolder(path: string): Promise<void>
    openPath(path: string): Promise<string>
  }
  win: {
    minimize(): Promise<void>
    maximize(): Promise<void>
    close(): Promise<void>
    getState(): Promise<WindowStateChanged>
    /** 未保存提示处理完毕后，放行主进程关闭窗口 */
    forceClose(): Promise<void>
  }
  recovery: {
    load(): Promise<InvokeMap['recovery:load']['res']>
    save(payload: InvokeMap['recovery:save']['req']): Promise<void>
    clear(): Promise<void>
  }
  app: {
    info(): Promise<InvokeMap['app:info']['res']>
    /** 上报是否存在未保存内容；主进程据此决定关窗时是否拦截 */
    setDirtyState(dirty: boolean): Promise<void>
    /**
     * 取「命令行指定要打开的文件」（绝对路径，**取走即清空**）。
     * 必须在所有 `window.api.on(...)` 注册完成之后调用——调用本身即向主进程
     * 声明「监听器已就绪，之后可以直接推」。
     */
    takePendingPaths(): Promise<string[]>
  }
  /** 订阅主进程推送；返回取消订阅函数（务必在组件卸载时调用，否则会重复触发） */
  on<K extends keyof PushMap>(
    channel: K,
    callback: (payload: PushMap[K]) => void
  ): () => void
}

export type { ExportOptions, ExportRequest, ExportResult, TextEncoding }
