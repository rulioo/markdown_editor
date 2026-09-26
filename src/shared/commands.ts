/**
 * 命令 ID 单一事实来源。
 *
 * 菜单项点击后不直接执行业务逻辑，而是把命令 ID 通过 `menu:command` 发给渲染进程，
 * 由渲染进程的命令注册表统一执行。好处：
 *   1. 菜单、快捷键、工具栏、未来的命令面板共用同一套实现；
 *   2. 需要文档上下文的命令（如「加粗」要改编辑器选区）天然只能住在渲染进程；
 *   3. 主进程不需要知道任何业务状态。
 */

export const COMMANDS = {
  /* 文件 */
  FILE_NEW: 'file.new',
  FILE_NEW_WINDOW: 'file.newWindow',
  FILE_OPEN: 'file.open',
  FILE_OPEN_FOLDER: 'file.openFolder',
  FILE_OPEN_RECENT: 'file.openRecent',
  FILE_SAVE: 'file.save',
  FILE_SAVE_AS: 'file.saveAs',
  FILE_SAVE_ALL: 'file.saveAll',
  FILE_CLOSE_TAB: 'file.closeTab',
  FILE_PRINT: 'file.print',
  APP_SETTINGS: 'app.settings',
  APP_QUIT: 'app.quit',

  /* 导出 */
  EXPORT_HTML: 'export.html',
  EXPORT_PDF: 'export.pdf',
  EXPORT_DOCX: 'export.docx',

  /* 编辑 */
  EDIT_UNDO: 'edit.undo',
  EDIT_REDO: 'edit.redo',
  EDIT_CUT: 'edit.cut',
  EDIT_COPY: 'edit.copy',
  EDIT_PASTE: 'edit.paste',
  EDIT_COPY_MARKDOWN: 'edit.copyMarkdown',
  EDIT_PASTE_PLAIN: 'edit.pastePlain',
  EDIT_SELECT_ALL: 'edit.selectAll',
  EDIT_FIND: 'edit.find',
  EDIT_REPLACE: 'edit.replace',
  EDIT_FIND_NEXT: 'edit.findNext',
  EDIT_FIND_PREV: 'edit.findPrev',
  EDIT_UPPER: 'edit.upper',
  EDIT_LOWER: 'edit.lower',
  EDIT_INSERT_DATETIME: 'edit.insertDateTime',

  /* 段落 */
  PARA_HEADING_1: 'para.heading1',
  PARA_HEADING_2: 'para.heading2',
  PARA_HEADING_3: 'para.heading3',
  PARA_HEADING_4: 'para.heading4',
  PARA_HEADING_5: 'para.heading5',
  PARA_HEADING_6: 'para.heading6',
  PARA_HEADING_UP: 'para.headingUp',
  PARA_HEADING_DOWN: 'para.headingDown',
  PARA_PARAGRAPH: 'para.paragraph',
  PARA_UL: 'para.ul',
  PARA_OL: 'para.ol',
  PARA_TASK: 'para.task',
  PARA_QUOTE: 'para.quote',
  PARA_CODE_BLOCK: 'para.codeBlock',
  PARA_TABLE: 'para.table',
  PARA_MATH_BLOCK: 'para.mathBlock',
  PARA_HR: 'para.hr',
  PARA_INDENT: 'para.indent',
  PARA_OUTDENT: 'para.outdent',

  /* 格式 */
  FMT_BOLD: 'fmt.bold',
  FMT_ITALIC: 'fmt.italic',
  FMT_UNDERLINE: 'fmt.underline',
  FMT_STRIKETHROUGH: 'fmt.strikethrough',
  FMT_CODE: 'fmt.code',
  FMT_MARK: 'fmt.mark',
  FMT_LINK: 'fmt.link',
  FMT_IMAGE: 'fmt.image',
  FMT_CLEAR: 'fmt.clear',

  /* 视图 */
  VIEW_SOURCE_MODE: 'view.sourceMode',
  VIEW_LIVE_MODE: 'view.liveMode',
  VIEW_SPLIT_MODE: 'view.splitMode',
  VIEW_PREVIEW_MODE: 'view.previewMode',
  VIEW_TOGGLE_SIDEBAR: 'view.toggleSidebar',
  VIEW_SIDEBAR_FILES: 'view.sidebar.files',
  VIEW_SIDEBAR_OUTLINE: 'view.sidebar.outline',
  VIEW_SIDEBAR_SEARCH: 'view.sidebar.search',
  VIEW_TOGGLE_STATUS_BAR: 'view.toggleStatusBar',
  VIEW_TYPEWRITER: 'view.typewriter',
  VIEW_FOCUS_MODE: 'view.focusMode',
  VIEW_TOGGLE_IMAGES: 'view.toggleImages',
  VIEW_ZOOM_IN: 'view.zoomIn',
  VIEW_ZOOM_OUT: 'view.zoomOut',
  VIEW_ZOOM_RESET: 'view.zoomReset',
  VIEW_THEME_LIGHT: 'view.theme.light',
  VIEW_THEME_DARK: 'view.theme.dark',
  VIEW_THEME_SYSTEM: 'view.theme.system',
  VIEW_FULLSCREEN: 'view.fullscreen',
  VIEW_DEV_TOOLS: 'view.devTools',

  /* 窗口 */
  WIN_MINIMIZE: 'win.minimize',
  WIN_MAXIMIZE: 'win.maximize',
  WIN_CLOSE: 'win.close',

  /* 帮助 */
  HELP_MARKDOWN_REF: 'help.markdownRef',
  HELP_SHORTCUTS: 'help.shortcuts',
  HELP_ABOUT: 'help.about'
} as const

export type CommandId = (typeof COMMANDS)[keyof typeof COMMANDS]

/** 取得所有命令 ID，便于命令面板与测试遍历 */
export const ALL_COMMANDS: CommandId[] = Object.values(COMMANDS)

/**
 * 这些命令不需要文档上下文，即使没有打开任何标签页也应可用（或由主进程直接处理）。
 * 用于菜单项的 enabled 计算。
 */
export const GLOBAL_COMMANDS: ReadonlySet<string> = new Set<string>([
  COMMANDS.FILE_NEW,
  COMMANDS.FILE_NEW_WINDOW,
  COMMANDS.FILE_OPEN,
  COMMANDS.FILE_OPEN_FOLDER,
  COMMANDS.FILE_OPEN_RECENT,
  COMMANDS.FILE_SAVE_ALL,
  COMMANDS.FILE_PRINT,
  COMMANDS.APP_SETTINGS,
  COMMANDS.APP_QUIT,
  COMMANDS.EXPORT_HTML,
  COMMANDS.EXPORT_PDF,
  COMMANDS.EXPORT_DOCX,
  COMMANDS.VIEW_SOURCE_MODE,
  COMMANDS.VIEW_LIVE_MODE,
  COMMANDS.VIEW_SPLIT_MODE,
  COMMANDS.VIEW_PREVIEW_MODE,
  COMMANDS.VIEW_TOGGLE_SIDEBAR,
  COMMANDS.VIEW_SIDEBAR_FILES,
  COMMANDS.VIEW_SIDEBAR_OUTLINE,
  COMMANDS.VIEW_SIDEBAR_SEARCH,
  COMMANDS.VIEW_TOGGLE_STATUS_BAR,
  COMMANDS.VIEW_TYPEWRITER,
  COMMANDS.VIEW_FOCUS_MODE,
  COMMANDS.VIEW_TOGGLE_IMAGES,
  COMMANDS.VIEW_ZOOM_IN,
  COMMANDS.VIEW_ZOOM_OUT,
  COMMANDS.VIEW_ZOOM_RESET,
  COMMANDS.VIEW_THEME_LIGHT,
  COMMANDS.VIEW_THEME_DARK,
  COMMANDS.VIEW_THEME_SYSTEM,
  COMMANDS.VIEW_FULLSCREEN,
  COMMANDS.VIEW_DEV_TOOLS,
  COMMANDS.WIN_MINIMIZE,
  COMMANDS.WIN_MAXIMIZE,
  COMMANDS.WIN_CLOSE,
  COMMANDS.HELP_MARKDOWN_REF,
  COMMANDS.HELP_SHORTCUTS,
  COMMANDS.HELP_ABOUT
])
