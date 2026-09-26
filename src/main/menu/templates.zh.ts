/**
 * 全中文菜单模板。
 *
 * 设计要点：
 * 1. 菜单项不直接执行逻辑，只是把**命令 ID** 发给渲染进程（见 shared/commands.ts）。
 * 2. 剪切/复制/粘贴走 Electron role —— 它们触发标准 DOM 剪贴板事件，
 *    CodeMirror 6 能正确响应；而撤销/重做/全选必须走命令，
 *    否则会绕过 CM6 自己的历史栈与选区模型。
 * 3. 加速键用 CmdOrCtrl，macOS 自动映射为 Command（ADR-07）。
 */

import type { MenuItemConstructorOptions } from 'electron'
import { COMMANDS } from '@shared/commands'

export interface MenuContext {
  /** 把命令派发给渲染进程 */
  send: (commandId: string) => void
  /** 最近打开的文件（绝对路径），用于「打开最近文件」子菜单 */
  recentFiles: string[]
  /** 用户点了某个最近文件 */
  onOpenRecent: (filePath: string) => void
  /** 清空最近记录 */
  onClearRecent: () => void
  /** 是否开发模式（决定是否显示开发者工具项） */
  isDev: boolean
  /** 应用名，用于 macOS 应用菜单 */
  appName: string
}

/**
 * 加速键冲突处理（与 design.md 第 6 节的两处冲突说明对应）：
 *
 * - `Ctrl+B`：菜单层只保留「加粗」。设计稿中「无选区时切换侧边栏」的行为
 *   由渲染进程的 CM6 keymap 实现（有选区则加粗，无选区则切换侧边栏）。
 *   菜单里「显示侧边栏」改用 Ctrl+Shift+B，避免 Electron 加速键重复注册后
 *   其中一个永久失效。
 * - `Ctrl+0`：菜单层保留「正文」（段落），「重置缩放」改用 Ctrl+Shift+0。
 */
export function buildMenuTemplate(ctx: MenuContext): MenuItemConstructorOptions[] {
  const { send, recentFiles, onOpenRecent, onClearRecent, isDev, appName } = ctx
  const isMac = process.platform === 'darwin'

  const cmd = (
    label: string,
    id: string,
    accelerator?: string
  ): MenuItemConstructorOptions => ({
    label,
    accelerator,
    click: () => send(id)
  })

  const recentSubmenu: MenuItemConstructorOptions[] =
    recentFiles.length === 0
      ? [{ label: '（暂无记录）', enabled: false }]
      : [
          ...recentFiles.map<MenuItemConstructorOptions>((filePath) => ({
            label: filePath,
            click: () => onOpenRecent(filePath)
          })),
          { type: 'separator' },
          { label: '清空最近记录', click: () => onClearRecent() }
        ]

  const template: MenuItemConstructorOptions[] = []

  /* ------------------------------ macOS 应用菜单 ------------------------------ */
  if (isMac) {
    template.push({
      label: appName,
      submenu: [
        { label: `关于 ${appName}`, click: () => send(COMMANDS.HELP_ABOUT) },
        { type: 'separator' },
        { label: '偏好设置…', accelerator: 'Cmd+,', click: () => send(COMMANDS.APP_SETTINGS) },
        { type: 'separator' },
        { label: '服务', role: 'services' },
        { type: 'separator' },
        { label: `隐藏 ${appName}`, role: 'hide' },
        { label: '隐藏其他', role: 'hideOthers' },
        { label: '显示全部', role: 'unhide' },
        { type: 'separator' },
        { label: `退出 ${appName}`, accelerator: 'Cmd+Q', click: () => send(COMMANDS.APP_QUIT) }
      ]
    })
  }

  /* --------------------------------- 文件 --------------------------------- */
  template.push({
    label: '文件(&F)',
    submenu: [
      cmd('新建', COMMANDS.FILE_NEW, 'CmdOrCtrl+N'),
      cmd('新建窗口', COMMANDS.FILE_NEW_WINDOW, 'CmdOrCtrl+Shift+N'),
      cmd('打开文件…', COMMANDS.FILE_OPEN, 'CmdOrCtrl+O'),
      cmd('打开文件夹…', COMMANDS.FILE_OPEN_FOLDER, 'CmdOrCtrl+Shift+O'),
      { label: '打开最近文件', submenu: recentSubmenu },
      { type: 'separator' },
      cmd('保存', COMMANDS.FILE_SAVE, 'CmdOrCtrl+S'),
      cmd('另存为…', COMMANDS.FILE_SAVE_AS, 'CmdOrCtrl+Shift+S'),
      cmd('全部保存', COMMANDS.FILE_SAVE_ALL, 'CmdOrCtrl+Alt+S'),
      { type: 'separator' },
      cmd('关闭标签页', COMMANDS.FILE_CLOSE_TAB, 'CmdOrCtrl+W'),
      { type: 'separator' },
      {
        label: '导出',
        submenu: [
          cmd('导出为 HTML…', COMMANDS.EXPORT_HTML),
          cmd('导出为 PDF…', COMMANDS.EXPORT_PDF),
          cmd('导出为 DOCX…', COMMANDS.EXPORT_DOCX)
        ]
      },
      cmd('打印…', COMMANDS.FILE_PRINT, 'CmdOrCtrl+P'),
      { type: 'separator' },
      ...(isMac
        ? []
        : [cmd('偏好设置…', COMMANDS.APP_SETTINGS, 'CmdOrCtrl+,') as MenuItemConstructorOptions]),
      ...(isMac
        ? []
        : [
            { type: 'separator' } as MenuItemConstructorOptions,
            cmd('退出', COMMANDS.APP_QUIT, 'Alt+F4') as MenuItemConstructorOptions
          ])
    ]
  })

  /* --------------------------------- 编辑 --------------------------------- */
  template.push({
    label: '编辑(&E)',
    submenu: [
      // 撤销/重做必须走 CM6 历史栈，不能用 role
      cmd('撤销', COMMANDS.EDIT_UNDO, 'CmdOrCtrl+Z'),
      cmd('重做', COMMANDS.EDIT_REDO, isMac ? 'Cmd+Shift+Z' : 'CmdOrCtrl+Y'),
      { type: 'separator' },
      // 剪贴板三项用原生 role，触发标准 DOM 事件，CM6 可正确响应
      { label: '剪切', role: 'cut', accelerator: 'CmdOrCtrl+X' },
      { label: '复制', role: 'copy', accelerator: 'CmdOrCtrl+C' },
      { label: '粘贴', role: 'paste', accelerator: 'CmdOrCtrl+V' },
      cmd('复制为 Markdown', COMMANDS.EDIT_COPY_MARKDOWN, 'CmdOrCtrl+Shift+C'),
      cmd('粘贴为纯文本', COMMANDS.EDIT_PASTE_PLAIN, 'CmdOrCtrl+Shift+V'),
      cmd('全选', COMMANDS.EDIT_SELECT_ALL, 'CmdOrCtrl+A'),
      { type: 'separator' },
      cmd('查找', COMMANDS.EDIT_FIND, 'CmdOrCtrl+F'),
      cmd('替换', COMMANDS.EDIT_REPLACE, 'CmdOrCtrl+H'),
      cmd('查找下一个', COMMANDS.EDIT_FIND_NEXT, 'F3'),
      cmd('查找上一个', COMMANDS.EDIT_FIND_PREV, 'Shift+F3'),
      { type: 'separator' },
      {
        label: '大小写转换',
        submenu: [
          cmd('转换为大写', COMMANDS.EDIT_UPPER),
          cmd('转换为小写', COMMANDS.EDIT_LOWER)
        ]
      },
      cmd('插入当前日期时间', COMMANDS.EDIT_INSERT_DATETIME)
    ]
  })

  /* --------------------------------- 段落 --------------------------------- */
  template.push({
    label: '段落(&P)',
    submenu: [
      {
        label: '标题',
        submenu: [
          cmd('一级标题', COMMANDS.PARA_HEADING_1, 'CmdOrCtrl+1'),
          cmd('二级标题', COMMANDS.PARA_HEADING_2, 'CmdOrCtrl+2'),
          cmd('三级标题', COMMANDS.PARA_HEADING_3, 'CmdOrCtrl+3'),
          cmd('四级标题', COMMANDS.PARA_HEADING_4, 'CmdOrCtrl+4'),
          cmd('五级标题', COMMANDS.PARA_HEADING_5, 'CmdOrCtrl+5'),
          cmd('六级标题', COMMANDS.PARA_HEADING_6, 'CmdOrCtrl+6')
        ]
      },
      cmd('提升标题级别', COMMANDS.PARA_HEADING_UP, 'CmdOrCtrl+Shift+='),
      cmd('降低标题级别', COMMANDS.PARA_HEADING_DOWN, 'CmdOrCtrl+Shift+-'),
      cmd('正文', COMMANDS.PARA_PARAGRAPH, 'CmdOrCtrl+0'),
      { type: 'separator' },
      cmd('无序列表', COMMANDS.PARA_UL, 'CmdOrCtrl+Shift+]'),
      cmd('有序列表', COMMANDS.PARA_OL, 'CmdOrCtrl+Shift+['),
      cmd('任务列表', COMMANDS.PARA_TASK, 'CmdOrCtrl+Shift+X'),
      cmd('引用', COMMANDS.PARA_QUOTE, 'CmdOrCtrl+Shift+Q'),
      cmd('代码块', COMMANDS.PARA_CODE_BLOCK, 'CmdOrCtrl+Shift+K'),
      cmd('表格', COMMANDS.PARA_TABLE, 'CmdOrCtrl+Shift+T'),
      cmd('数学公式块', COMMANDS.PARA_MATH_BLOCK, 'CmdOrCtrl+Shift+M'),
      cmd('分隔线', COMMANDS.PARA_HR),
      { type: 'separator' },
      cmd('增加缩进', COMMANDS.PARA_INDENT),
      cmd('减少缩进', COMMANDS.PARA_OUTDENT)
    ]
  })

  /* --------------------------------- 格式 --------------------------------- */
  template.push({
    label: '格式(&O)',
    submenu: [
      cmd('加粗', COMMANDS.FMT_BOLD, 'CmdOrCtrl+B'),
      cmd('斜体', COMMANDS.FMT_ITALIC, 'CmdOrCtrl+I'),
      cmd('下划线', COMMANDS.FMT_UNDERLINE, 'CmdOrCtrl+U'),
      cmd('删除线', COMMANDS.FMT_STRIKETHROUGH, 'CmdOrCtrl+D'),
      cmd('行内代码', COMMANDS.FMT_CODE, 'CmdOrCtrl+`'),
      cmd('高亮', COMMANDS.FMT_MARK, 'CmdOrCtrl+Shift+H'),
      { type: 'separator' },
      cmd('超链接…', COMMANDS.FMT_LINK, 'CmdOrCtrl+K'),
      cmd('图片…', COMMANDS.FMT_IMAGE, 'CmdOrCtrl+Shift+I'),
      { type: 'separator' },
      cmd('清除格式', COMMANDS.FMT_CLEAR, 'CmdOrCtrl+\\')
    ]
  })

  /* --------------------------------- 视图 --------------------------------- */
  template.push({
    label: '视图(&V)',
    submenu: [
      cmd('源码模式', COMMANDS.VIEW_SOURCE_MODE, 'CmdOrCtrl+/'),
      cmd('实时预览', COMMANDS.VIEW_LIVE_MODE, 'CmdOrCtrl+Shift+/'),
      cmd('分栏预览', COMMANDS.VIEW_SPLIT_MODE, 'CmdOrCtrl+Shift+P'),
      cmd('仅预览', COMMANDS.VIEW_PREVIEW_MODE),
      { type: 'separator' },
      // 注意：Ctrl+B 已被「加粗」占用，此处改用 Ctrl+Shift+B（见文件头注释）
      cmd('显示侧边栏', COMMANDS.VIEW_TOGGLE_SIDEBAR, 'CmdOrCtrl+Shift+B'),
      {
        label: '侧边栏面板',
        submenu: [
          cmd('文件树', COMMANDS.VIEW_SIDEBAR_FILES, 'CmdOrCtrl+Shift+1'),
          cmd('大纲', COMMANDS.VIEW_SIDEBAR_OUTLINE, 'CmdOrCtrl+Shift+2'),
          cmd('搜索', COMMANDS.VIEW_SIDEBAR_SEARCH, 'CmdOrCtrl+Shift+3')
        ]
      },
      cmd('显示状态栏', COMMANDS.VIEW_TOGGLE_STATUS_BAR),
      { type: 'separator' },
      cmd('打字机模式', COMMANDS.VIEW_TYPEWRITER),
      cmd('专注模式', COMMANDS.VIEW_FOCUS_MODE),
      cmd('显示图片', COMMANDS.VIEW_TOGGLE_IMAGES),
      { type: 'separator' },
      cmd('放大', COMMANDS.VIEW_ZOOM_IN, 'CmdOrCtrl+='),
      cmd('缩小', COMMANDS.VIEW_ZOOM_OUT, 'CmdOrCtrl+-'),
      // 注意：Ctrl+0 已被「正文」占用，此处改用 Ctrl+Shift+0（见文件头注释）
      cmd('重置缩放', COMMANDS.VIEW_ZOOM_RESET, 'CmdOrCtrl+Shift+0'),
      {
        label: '主题',
        submenu: [
          cmd('浅色', COMMANDS.VIEW_THEME_LIGHT),
          cmd('深色', COMMANDS.VIEW_THEME_DARK),
          cmd('跟随系统', COMMANDS.VIEW_THEME_SYSTEM)
        ]
      },
      cmd('全屏', COMMANDS.VIEW_FULLSCREEN, isMac ? 'Ctrl+Cmd+F' : 'F11'),
      ...(isDev
        ? [
            { type: 'separator' } as MenuItemConstructorOptions,
            {
              label: '开发者工具',
              accelerator: isMac ? 'Alt+Cmd+I' : 'CmdOrCtrl+Shift+I',
              role: 'toggleDevTools' as const
            }
          ]
        : [])
    ]
  })

  /* --------------------------------- 窗口 --------------------------------- */
  template.push({
    label: '窗口(&W)',
    submenu: [
      cmd('最小化', COMMANDS.WIN_MINIMIZE, 'CmdOrCtrl+M'),
      cmd('最大化/还原', COMMANDS.WIN_MAXIMIZE),
      cmd('关闭窗口', COMMANDS.WIN_CLOSE, 'CmdOrCtrl+Shift+W')
    ]
  })

  /* --------------------------------- 帮助 --------------------------------- */
  template.push({
    label: '帮助(&H)',
    submenu: [
      cmd('Markdown 语法参考', COMMANDS.HELP_MARKDOWN_REF),
      cmd('快捷键速查', COMMANDS.HELP_SHORTCUTS),
      { type: 'separator' },
      cmd(`关于 ${appName}`, COMMANDS.HELP_ABOUT)
    ]
  })

  return template
}
