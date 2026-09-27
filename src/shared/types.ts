/**
 * 主进程与渲染进程共用的数据类型。
 * 这里只放**跨进程边界**的类型；纯渲染进程内部状态（如 CodeMirror 的 EditorState）不放这里。
 */

/* ---------------------------------- 基础枚举 --------------------------------- */

/** 编辑器显示模式 */
export type EditorMode = 'source' | 'live' | 'split' | 'preview'

/** 主题模式（system 仅存在于设置中；导出时会解析为 light/dark） */
export type ThemeMode = 'light' | 'dark' | 'system'

/** 导出时可用的主题（已解析，无 system） */
export type ResolvedTheme = 'light' | 'dark'

export type ExportFormat = 'html' | 'pdf' | 'docx'

/**
 * 支持的文本编码。
 * 中文用户场景下 GBK/GB18030 是刚需——读写必须对称，否则保存即损坏原文件。
 */
export type TextEncoding =
  | 'utf8'
  | 'utf8-bom'
  | 'utf16le'
  | 'utf16be'
  | 'gbk'
  | 'gb18030'
  | 'big5'
  | 'latin1'

/** 换行符，读取时识别、保存时还原 */
export type Eol = 'lf' | 'crlf'

/* ---------------------------------- 文件 IO --------------------------------- */

export interface FileReadResult {
  content: string
  encoding: TextEncoding
  eol: Eol
  mtimeMs: number
  /** 字节数（非字符数） */
  size: number
}

export interface FileWriteRequest {
  path: string
  content: string
  encoding: TextEncoding
  eol: Eol
}

export interface FileWriteResult {
  mtimeMs: number
  size: number
}

export interface FileStatResult {
  exists: boolean
  isDirectory: boolean
  mtimeMs: number
  size: number
}

/** 工作区文件树节点 */
export interface TreeNode {
  name: string
  path: string
  isDirectory: boolean
  /** 目录才有；未展开时为 undefined（懒加载） */
  children?: TreeNode[]
  /** 目录是否因权限/数量被截断 */
  truncated?: boolean
}

export type FsChangeEvent = 'change' | 'unlink' | 'rename'

/** 粘贴图片落盘后的结果 */
export interface AssetsDirResult {
  /** 绝对目录路径，如 E:\docs\assets */
  dir: string
  /** 相对文档所在目录的路径，用于写进 Markdown，如 assets/xxx.png */
  relPath: string
}

/* ---------------------------------- 导出 ---------------------------------- */

export interface PdfMargin {
  top: number
  right: number
  bottom: number
  left: number
}

export interface ExportOptions {
  theme: ResolvedTheme
  /** HTML/PDF：把本地图片转 base64 内联，产出单文件 */
  embedImages: boolean
  /** HTML/PDF：生成目录 */
  includeToc: boolean
  pdf: {
    pageSize: 'A4' | 'A3' | 'Letter' | 'Legal'
    landscape: boolean
    /** 单位：毫米 */
    margin: PdfMargin
    printBackground: boolean
    /** 页脚显示页码 */
    footer: boolean
  }
  docx: {
    /** 正文中文字体（会同时写入 w:eastAsia，否则 Word 用宋体渲染中文） */
    fontFamily: string
    /** 正文字号，单位 pt */
    fontSize: number
    codeFontFamily: string
  }
}

export const DEFAULT_EXPORT_OPTIONS: ExportOptions = {
  theme: 'light',
  embedImages: false,
  includeToc: false,
  pdf: {
    pageSize: 'A4',
    landscape: false,
    margin: { top: 20, right: 20, bottom: 20, left: 20 },
    printBackground: true,
    footer: true
  },
  docx: {
    fontFamily: '微软雅黑',
    fontSize: 11,
    codeFontFamily: 'Consolas'
  }
}

export interface ExportRequest {
  format: ExportFormat
  markdown: string
  targetPath: string
  /** 源文档路径，用于解析相对路径的图片；未保存文档为 null */
  docPath: string | null
  options: ExportOptions
  /** 文档标题（不含扩展名），写进 HTML 的 <title> 与 PDF 的文档属性 */
  title?: string
}

export interface ExportResult {
  ok: boolean
  path?: string
  /** 失败时的中文错误信息，可直接展示给用户 */
  error?: string
  /** 用户主动取消（如关掉打印对话框）。不是错误，调用方不该弹错误框 */
  canceled?: boolean
}

/* ---------------------------------- 对话框 --------------------------------- */

export interface OpenFileResult {
  canceled: boolean
  paths: string[]
}

export interface OpenFolderResult {
  canceled: boolean
  path: string | null
}

export interface SaveAsResult {
  canceled: boolean
  path: string | null
}

export type MessageType = 'info' | 'warning' | 'error' | 'question'

export interface MessageRequest {
  type: MessageType
  title: string
  message: string
  detail?: string
  buttons: string[]
  defaultId?: number
  cancelId?: number
  /** 危险操作（如丢弃修改）时把默认按钮标红 */
  dangerId?: number
}

export interface MessageResult {
  response: number
}

/* ---------------------------------- 设置 ---------------------------------- */

export interface SidebarState {
  visible: boolean
  width: number
  tab: 'files' | 'outline' | 'search'
}

export interface WindowState {
  width: number
  height: number
  x: number | null
  y: number | null
  maximized: boolean
}

export interface Settings {
  theme: ThemeMode
  fontSize: number
  lineHeight: number
  fontFamily: string
  codeFontFamily: string
  editorMode: EditorMode
  autoSave: boolean
  autoSaveDelay: number
  livePreview: boolean
  showImages: boolean
  typewriter: boolean
  focusMode: boolean
  showStatusBar: boolean
  sidebar: SidebarState
  lastOpenFolder: string | null
  recentFiles: string[]
  window: WindowState
  export: ExportOptions
  encoding: {
    autoDetect: boolean
    default: TextEncoding
  }
  /** 单文件超过该体积（MB）时提示用户 */
  largeFileWarnMB: number
  /** 超过该体积（MB）自动降级为源码模式，关闭 Live Preview */
  livePreviewLimitMB: number
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  fontSize: 16,
  lineHeight: 1.7,
  fontFamily: '"Microsoft YaHei", "PingFang SC", "Segoe UI", sans-serif',
  codeFontFamily: 'Consolas, "Courier New", monospace',
  editorMode: 'live',
  autoSave: false,
  autoSaveDelay: 5000,
  livePreview: true,
  showImages: true,
  typewriter: false,
  focusMode: false,
  showStatusBar: true,
  sidebar: { visible: true, width: 260, tab: 'files' },
  lastOpenFolder: null,
  recentFiles: [],
  window: { width: 1280, height: 800, x: null, y: null, maximized: false },
  export: DEFAULT_EXPORT_OPTIONS,
  encoding: { autoDetect: true, default: 'utf8' },
  largeFileWarnMB: 20,
  livePreviewLimitMB: 1
}

/* -------------------------------- 崩溃恢复 -------------------------------- */

/** 未保存文档的快照，用于异常退出后恢复 */
export interface RecoveryDocument {
  /** 原文件路径，未命名文档为 null */
  filePath: string | null
  name: string
  content: string
  encoding: TextEncoding
  eol: Eol
  savedAt: number
}

export interface RecoveryFile {
  version: 1
  documents: RecoveryDocument[]
}

/* ---------------------------------- 其他 ---------------------------------- */

export interface WindowStateChanged {
  maximized: boolean
  fullscreen: boolean
}

export interface MenuCommandPayload {
  commandId: string
}
