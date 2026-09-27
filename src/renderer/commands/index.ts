/**
 * 命令实现注册。
 *
 * 必须在 app.use(pinia) 之后调用 setupCommands()——下面这些 store 的实例化
 * 依赖已激活的 pinia。
 */

import { findNext, findPrevious, openSearchPanel } from '@codemirror/search'
import type { EditorView } from '@codemirror/view'
import { COMMANDS } from '@shared/commands'
import { APP_TITLE, COPYRIGHT } from '@shared/app-meta'
import type { ExportFormat } from '@shared/types'
import { registerCommands } from './registry'
import { withEditor } from '../editor/active'
import * as fmt from '../editor/format'
import { baseName, dirName, useFilesStore } from '../stores/files'
import type { FileSession } from '../stores/files'
import { useWorkspaceStore } from '../stores/workspace'
import { useLayoutStore } from '../stores/layout'
import { useSettingsStore } from '../stores/settings'
import { useExportDialogStore } from '../stores/exportDialog'
import { defaultExportPath, exportTitle } from '../lib/exportPath'
import { toggledTheme } from '../lib/themeSwitch'

/** 错误对话框的标题用得上，也是菜单里已有的说法 */
const FORMAT_LABELS: Record<ExportFormat, string> = {
  html: 'HTML',
  pdf: 'PDF',
  docx: 'DOCX'
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function setupCommands(): void {
  const files = useFilesStore()
  const workspace = useWorkspaceStore()
  const layout = useLayoutStore()
  const settings = useSettingsStore()
  const exportDialog = useExportDialogStore()

  /** 尚未实现的命令：给一条可读的中文提示，而不是静默无反应 */
  const pending = (label: string) => () => {
    layout.notify(`${label}将在后续里程碑中实现`)
  }

  /**
   * 需要编辑器实例的命令统一走这里。
   * 没有打开文档时静默跳过——菜单项在无文档时本就处于禁用态，这里只是兜底。
   */
  const onEditor = (fn: (view: EditorView) => void) => () => {
    withEditor((host) => {
      const view = host.editorView
      if (view) fn(view)
    })
  }

  /**
   * 需要「当前文档」的命令统一走这里。
   *
   * **刻意不写成 `pending`/`onEditor` 那种柯里化形式**（返回 `() => Promise<void>`）。
   * 两个调用点都是 `await withActiveDocument(fn)`：而 `await` 一个函数是合法的，
   * 会立刻求值成那个函数本身——回调永远不执行，命令静默变成空操作，
   * 既不报错也没有任何提示，`tsc` 同样拦不住（它只是「await 了一个非 Promise 值」）。
   * 直接写成 async 函数，`await` 的才是真正要等的那次执行。
   */
  async function withActiveDocument(
    fn: (session: FileSession) => Promise<void>
  ): Promise<void> {
    const session = files.activeSession
    if (!session) {
      layout.notify('没有打开的文档', 'error')
      return
    }
    await fn(session)
  }

  /**
   * 导出流程。HTML / PDF / DOCX 三条出口只有格式不同，所以共用一份。
   *
   * 顺序是**刻意**的：先问选项、再选路径、最后才写盘。
   * - 用户取消对话框 → 既不写盘也不落配置（取消不该产生副作用）；
   * - 配置在**用户确认之后**才保存，所以「打开看一眼又关掉」不会污染偏好设置。
   *
   * `settings.update({ export: options })` 传的是**完整对象**：`Partial<Settings>`
   * 是浅偏特化，只传 `{theme:'dark'}` 会把整个 export 块替换成一个缺字段的对象。
   * （主进程的 `sanitizeExportOptions` 会在运行期兜住这件事，但那是安全网不是设计。）
   */
  async function exportAs(format: ExportFormat): Promise<void> {
    await withActiveDocument(async (session) => {
      const options = await exportDialog.open(format, settings.settings.export)
      if (!options) return
      await settings.update({ export: options })

      const target = await window.api.export.pickTarget(
        format,
        defaultExportPath(session.filePath, format, session.name)
      )
      if (target.canceled || !target.path) return

      try {
        const result = await window.api.export.run({
          format,
          markdown: session.content,
          targetPath: target.path,
          docPath: session.filePath,
          options,
          title: exportTitle(session.filePath, session.name, APP_TITLE)
        })
        if (result.ok) {
          layout.notify(`已导出 ${baseName(result.path ?? target.path)}`, 'success')
        } else {
          await reportFailure(`${FORMAT_LABELS[format]} 导出失败`, result.error)
        }
      } catch (error) {
        // IPC handler 对非法入参是**抛异常**的（返回 {ok:false} 的是「导出失败了」，
        // 抛出来的是「调用方写错了」）。两条通道都要处理，否则会变成未捕获的 rejection。
        await reportFailure(`${FORMAT_LABELS[format]} 导出失败`, messageOf(error))
      }
    })
  }

  /** Ctrl+P：与导出共用对话框，区别只是不落盘、由系统打印对话框接手 */
  async function printActiveDocument(): Promise<void> {
    await withActiveDocument(async (session) => {
      const options = await exportDialog.open('pdf', settings.settings.export)
      if (!options) return
      await settings.update({ export: options })

      try {
        const result = await window.api.export.print({
          markdown: session.content,
          docPath: session.filePath,
          options,
          title: exportTitle(session.filePath, session.name, APP_TITLE)
        })
        if (result.ok) layout.notify('已发送到打印机', 'success')
        // 用户取消打印不是错误：弹错误框会让「我只是点了取消」变成一次惊吓
        else if (!result.canceled) await reportFailure('打印失败', result.error)
      } catch (error) {
        await reportFailure('打印失败', messageOf(error))
      }
    })
  }

  /** 失败一律走系统对话框而不是轻提示：错误信息可能很长，且需要用户看清 */
  async function reportFailure(title: string, detail?: string): Promise<void> {
    await window.api.dialog.message({
      type: 'error',
      title,
      message: title,
      detail: detail ?? '未知错误',
      buttons: ['确定']
    })
  }

  registerCommands({
    /* --------------------------------- 文件 --------------------------------- */

    [COMMANDS.FILE_NEW]: () => {
      files.newFile()
    },

    [COMMANDS.FILE_NEW_WINDOW]: pending('新建窗口'),

    [COMMANDS.FILE_OPEN]: async () => {
      const result = await window.api.dialog.openFile()
      if (result.canceled || result.paths.length === 0) return
      await files.openPaths(result.paths)
      // 打开文件时若还没有工作区，用文件所在目录作为工作区根
      const first = result.paths[0]
      if (first && !workspace.hasWorkspace) await workspace.openFolder(dirName(first))
    },

    [COMMANDS.FILE_OPEN_FOLDER]: async () => {
      const result = await window.api.dialog.openFolder()
      if (result.canceled || !result.path) return
      await workspace.openFolder(result.path)
      await settings.update({ lastOpenFolder: result.path })
      await layout.setSidebarTab('files')
    },

    [COMMANDS.FILE_OPEN_RECENT]: pending('打开最近文件（请使用「文件 → 打开最近文件」子菜单）'),

    [COMMANDS.FILE_SAVE]: async () => {
      await files.save()
    },

    [COMMANDS.FILE_SAVE_AS]: async () => {
      await files.saveAs()
    },

    [COMMANDS.FILE_SAVE_ALL]: async () => {
      await files.saveAll()
    },

    [COMMANDS.FILE_CLOSE_TAB]: async () => {
      await files.close()
    },

    [COMMANDS.FILE_PRINT]: () => printActiveDocument(),

    [COMMANDS.APP_SETTINGS]: pending('偏好设置'),

    [COMMANDS.APP_QUIT]: async () => {
      if (await files.closeAll()) await window.api.win.forceClose()
    },

    /* --------------------------------- 导出 --------------------------------- */

    [COMMANDS.EXPORT_HTML]: () => exportAs('html'),
    [COMMANDS.EXPORT_PDF]: () => exportAs('pdf'),
    // DOCX 的对话框、路径选择、错误处理全部已就位，M4 只需翻转主进程的分支
    [COMMANDS.EXPORT_DOCX]: () => exportAs('docx'),

    /* --------------------------------- 视图 --------------------------------- */

    [COMMANDS.VIEW_SOURCE_MODE]: () => layout.setMode('source'),
    [COMMANDS.VIEW_LIVE_MODE]: () => layout.setMode('live'),
    [COMMANDS.VIEW_SPLIT_MODE]: () => layout.setMode('split'),
    [COMMANDS.VIEW_PREVIEW_MODE]: () => layout.setMode('preview'),

    [COMMANDS.VIEW_TOGGLE_SIDEBAR]: () => layout.toggleSidebar(),
    [COMMANDS.VIEW_SIDEBAR_FILES]: () => layout.setSidebarTab('files'),
    [COMMANDS.VIEW_SIDEBAR_OUTLINE]: () => layout.setSidebarTab('outline'),
    [COMMANDS.VIEW_SIDEBAR_SEARCH]: () => layout.setSidebarTab('search'),
    [COMMANDS.VIEW_TOGGLE_STATUS_BAR]: () => layout.toggleStatusBar(),

    [COMMANDS.VIEW_TYPEWRITER]: () => layout.toggleTypewriter(),
    [COMMANDS.VIEW_FOCUS_MODE]: () => layout.toggleFocusMode(),
    [COMMANDS.VIEW_TOGGLE_IMAGES]: () => layout.toggleImages(),

    [COMMANDS.VIEW_ZOOM_IN]: () => layout.zoomIn(),
    [COMMANDS.VIEW_ZOOM_OUT]: () => layout.zoomOut(),
    [COMMANDS.VIEW_ZOOM_RESET]: () => layout.zoomReset(),

    [COMMANDS.VIEW_THEME_LIGHT]: () => settings.setTheme('light'),
    [COMMANDS.VIEW_THEME_DARK]: () => settings.setTheme('dark'),
    [COMMANDS.VIEW_THEME_SYSTEM]: () => settings.setTheme('system'),
    // 快捷键用的「一键日夜」：处于「跟随系统」时按此刻所见取反，
    // 否则会出现「按一下没反应」
    [COMMANDS.VIEW_TOGGLE_THEME]: () =>
      settings.setTheme(toggledTheme(settings.settings.theme, settings.resolvedTheme)),

    [COMMANDS.VIEW_FULLSCREEN]: async () => {
      const state = await window.api.win.getState()
      // 全屏没有独立的 IPC 通道，用最大化近似（真正的全屏在 M5 补齐）
      if (!state.fullscreen) await window.api.win.maximize()
    },

    /* --------------------------------- 窗口 --------------------------------- */

    [COMMANDS.WIN_MINIMIZE]: () => window.api.win.minimize(),
    [COMMANDS.WIN_MAXIMIZE]: () => window.api.win.maximize(),
    [COMMANDS.WIN_CLOSE]: async () => {
      if (await files.closeAll()) await window.api.win.forceClose()
    },

    /* --------------------------------- 帮助 --------------------------------- */

    [COMMANDS.HELP_MARKDOWN_REF]: () =>
      window.api.shell.openExternal('https://commonmark.org/help/'),
    [COMMANDS.HELP_SHORTCUTS]: pending('快捷键速查'),
    [COMMANDS.HELP_ABOUT]: async () => {
      // 版本号从主进程取（app.getVersion()），渲染进程不另存一份，否则打包后会漂移
      const info = await window.api.app.info()
      await window.api.dialog.message({
        type: 'info',
        title: `关于 ${APP_TITLE}`,
        message: `${APP_TITLE} ${info.version}`,
        detail: `${COPYRIGHT}\n\nElectron ${info.electron} · Chromium ${info.chrome} · Node ${info.node}`,
        buttons: ['确定']
      })
    },

    /* --------------------------------- 编辑 --------------------------------- */

    [COMMANDS.EDIT_UNDO]: () => withEditor((host) => host.undo()),
    [COMMANDS.EDIT_REDO]: () => withEditor((host) => host.redo()),
    [COMMANDS.EDIT_SELECT_ALL]: () => withEditor((host) => host.selectAll()),

    // 查找与替换共用 CM6 的查找面板（面板内自带替换行）
    [COMMANDS.EDIT_FIND]: onEditor((view) => openSearchPanel(view)),
    [COMMANDS.EDIT_REPLACE]: onEditor((view) => openSearchPanel(view)),
    [COMMANDS.EDIT_FIND_NEXT]: onEditor((view) => void findNext(view)),
    [COMMANDS.EDIT_FIND_PREV]: onEditor((view) => void findPrevious(view)),

    [COMMANDS.EDIT_UPPER]: onEditor((view) => fmt.transformCase(view, 'upper')),
    [COMMANDS.EDIT_LOWER]: onEditor((view) => fmt.transformCase(view, 'lower')),
    [COMMANDS.EDIT_INSERT_DATETIME]: onEditor((view) => fmt.insertDateTime(view)),

    // 菜单里的「剪切/复制/粘贴」用的是 Electron role，由系统原生处理，
    // 这两个没有对应 role，排在 M5 用主进程剪贴板通道实现
    [COMMANDS.EDIT_COPY_MARKDOWN]: pending('复制为 Markdown'),
    [COMMANDS.EDIT_PASTE_PLAIN]: pending('粘贴为纯文本'),

    /* --------------------------------- 段落 --------------------------------- */

    [COMMANDS.PARA_HEADING_1]: onEditor((view) => fmt.setHeading(view, 1)),
    [COMMANDS.PARA_HEADING_2]: onEditor((view) => fmt.setHeading(view, 2)),
    [COMMANDS.PARA_HEADING_3]: onEditor((view) => fmt.setHeading(view, 3)),
    [COMMANDS.PARA_HEADING_4]: onEditor((view) => fmt.setHeading(view, 4)),
    [COMMANDS.PARA_HEADING_5]: onEditor((view) => fmt.setHeading(view, 5)),
    [COMMANDS.PARA_HEADING_6]: onEditor((view) => fmt.setHeading(view, 6)),
    [COMMANDS.PARA_HEADING_UP]: onEditor((view) => fmt.promoteHeading(view)),
    [COMMANDS.PARA_HEADING_DOWN]: onEditor((view) => fmt.demoteHeading(view)),
    [COMMANDS.PARA_PARAGRAPH]: onEditor((view) => fmt.setHeading(view, 0)),

    [COMMANDS.PARA_UL]: onEditor((view) => fmt.toggleUnorderedList(view)),
    [COMMANDS.PARA_OL]: onEditor((view) => fmt.toggleOrderedList(view)),
    [COMMANDS.PARA_TASK]: onEditor((view) => fmt.toggleTaskList(view)),
    [COMMANDS.PARA_QUOTE]: onEditor((view) => fmt.toggleQuote(view)),
    [COMMANDS.PARA_CODE_BLOCK]: onEditor((view) => fmt.insertCodeBlock(view)),
    [COMMANDS.PARA_TABLE]: onEditor((view) => fmt.insertTable(view)),
    [COMMANDS.PARA_MATH_BLOCK]: onEditor((view) => fmt.insertMathBlock(view)),
    [COMMANDS.PARA_HR]: onEditor((view) => fmt.insertHorizontalRule(view)),

    [COMMANDS.PARA_INDENT]: onEditor((view) => fmt.indent(view)),
    [COMMANDS.PARA_OUTDENT]: onEditor((view) => fmt.outdent(view)),

    /* --------------------------------- 格式 --------------------------------- */

    [COMMANDS.FMT_BOLD]: onEditor((view) => fmt.toggleInline(view, '**')),
    [COMMANDS.FMT_ITALIC]: onEditor((view) => fmt.toggleInline(view, '*')),
    [COMMANDS.FMT_STRIKETHROUGH]: onEditor((view) => fmt.toggleInline(view, '~~')),
    [COMMANDS.FMT_CODE]: onEditor((view) => fmt.toggleInline(view, '`')),
    // Markdown 没有下划线语法，用 HTML 标签表达（CommonMark 允许内联 HTML）
    [COMMANDS.FMT_UNDERLINE]: onEditor((view) => fmt.toggleInline(view, '<u>', '</u>')),
    // 高亮同理，走 ==高亮== 之外的通行写法：<mark>
    [COMMANDS.FMT_MARK]: onEditor((view) => fmt.toggleInline(view, '<mark>', '</mark>')),
    [COMMANDS.FMT_LINK]: onEditor((view) => fmt.insertLink(view)),
    [COMMANDS.FMT_IMAGE]: onEditor((view) => fmt.insertImage(view)),
    [COMMANDS.FMT_CLEAR]: onEditor((view) => fmt.clearFormatting(view))
  })
}
