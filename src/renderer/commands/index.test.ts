import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { COMMANDS } from '@shared/commands'
import { DEFAULT_EXPORT_OPTIONS, DEFAULT_SETTINGS } from '@shared/types'
import type { ExportOptions, Settings } from '@shared/types'
import { setupCommands } from './index'
import { executeCommand } from './registry'
import { useExportDialogStore } from '../stores/exportDialog'
import { useFilesStore } from '../stores/files'
import { useLayoutStore } from '../stores/layout'
import { useSettingsStore } from '../stores/settings'

/**
 * 命令接线层的集成测试。
 *
 * 这一层此前没有任何覆盖，代价很具体：`withActiveDocument` 曾经写成柯里化的
 * `(fn) => () => {...}`，而两个调用点都是 `await withActiveDocument(fn)`。
 * `await` 一个函数是**合法**的——它立刻求值成那个函数本身，回调永远不执行。
 * 于是「导出 HTML」「打印」静默变成空操作：没有报错、没有提示、`tsc` 也拦不住
 * （它只看到「await 了一个非 Promise 值」）。静态检查和单元测试都发现不了，
 * 只有真的跑一遍命令才知道。
 *
 * 所以下面断言的都是**用户可观察的结果**（对话框开了没、IPC 调用带没带上正确的
 * 参数、提示文案是什么），而不是内部的调用形状。
 */

// 编辑器相关的一切都真依赖 CM6 实例；导出流程一行都不碰它们
vi.mock('../editor/active', () => ({ withEditor: (): void => undefined }))
vi.mock('../editor/format', () => ({}))

/** 让链式 await 推进到下一个宏任务 */
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

interface Stubs {
  pickTarget: ReturnType<typeof vi.fn>
  run: ReturnType<typeof vi.fn>
  print: ReturnType<typeof vi.fn>
  settingsSet: ReturnType<typeof vi.fn>
  message: ReturnType<typeof vi.fn>
}

let stubs: Stubs

function installApi(): Stubs {
  let value: Settings = structuredClone(DEFAULT_SETTINGS)
  const api = {
    export: {
      pickTarget: vi.fn(async () => ({ canceled: false, path: 'E:\\out\\probe.html' })),
      run: vi.fn(async () => ({ ok: true, path: 'E:\\out\\probe.html' })),
      print: vi.fn(async () => ({ ok: true }))
    },
    settings: {
      // 主进程真实实现回传的是合并后的完整配置，这里照同样的契约来
      set: vi.fn(async (patch: Partial<Settings>) => {
        value = { ...value, ...patch }
        return value
      })
    },
    dialog: { message: vi.fn(async () => ({ response: 0 })) }
  }
  ;(window as unknown as { api: unknown }).api = api
  return {
    pickTarget: api.export.pickTarget,
    run: api.export.run,
    print: api.export.print,
    settingsSet: api.settings.set,
    message: api.dialog.message
  }
}

/** 开一个已保存的文档，并把内容写成可辨识的值 */
function openDocument(filePath: string | null, content = '# 标题\n\n正文'): void {
  const files = useFilesStore()
  const created = files.newFile()
  const session = files.find(created.id)
  expect(session, 'newFile 之后应该能查到这个会话').not.toBeNull()
  session!.filePath = filePath
  session!.content = content
}

beforeEach(() => {
  vi.restoreAllMocks()
  setActivePinia(createPinia())
  stubs = installApi()
  // setupCommands 每个用例都要重跑：它把 store 实例闭包捕获在工厂函数里，
  // 必须发生在 setActivePinia 之后。registry 是模块级的，因此第二次起会打
  // 「重复注册」告警——那不是被测行为，静音掉；其余告警照常输出。
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  setupCommands()
})

describe('导出命令', () => {
  it('导出 HTML 会真的打开对话框（回归：回调被 await 却从未执行）', async () => {
    openDocument(null)
    const dialog = useExportDialogStore()

    const done = executeCommand(COMMANDS.EXPORT_HTML)
    await tick()

    expect(dialog.visible).toBe(true)
    expect(dialog.format).toBe('html')

    dialog.cancel()
    await done
  })

  it('确认后：按默认路径选目标 → 带上正文调 IPC → 成功提示', async () => {
    openDocument('E:\\docs\\报告.md', '# 报告\n\n正文')
    const dialog = useExportDialogStore()

    const done = executeCommand(COMMANDS.EXPORT_HTML)
    await tick()
    dialog.confirm()
    await done

    expect(stubs.pickTarget).toHaveBeenCalledWith('html', 'E:\\docs\\报告.html')

    expect(stubs.run).toHaveBeenCalledTimes(1)
    const request = stubs.run.mock.calls[0][0] as Record<string, unknown>
    expect(request.format).toBe('html')
    expect(request.markdown).toBe('# 报告\n\n正文')
    expect(request.docPath).toBe('E:\\docs\\报告.md')
    expect(request.title).toBe('报告')

    expect(useLayoutStore().notices.at(-1)).toMatchObject({ type: 'success' })
    expect(useLayoutStore().notices.at(-1)?.text).toContain('已导出')
  })

  it('确认后落库的是**完整** export 块，不是用户改过的那个字段', async () => {
    openDocument('E:\\docs\\报告.md')
    const dialog = useExportDialogStore()

    const done = executeCommand(COMMANDS.EXPORT_HTML)
    await tick()
    dialog.draft.theme = 'dark'
    dialog.confirm()
    await done

    expect(stubs.settingsSet).toHaveBeenCalledTimes(1)
    const patch = stubs.settingsSet.mock.calls[0][0] as { export: ExportOptions }
    // Partial<Settings> 是浅偏特化：只回传 { theme:'dark' } 会把整个 export 块
    // 替换成一个缺字段的对象，所以这里钉住「字段一个不少」
    expect(Object.keys(patch.export).sort()).toEqual(Object.keys(DEFAULT_EXPORT_OPTIONS).sort())
    expect(patch.export.theme).toBe('dark')
  })

  it('取消对话框：不选路径、不落配置、不调 IPC——取消不产生任何副作用', async () => {
    openDocument('E:\\docs\\报告.md')
    const dialog = useExportDialogStore()

    const done = executeCommand(COMMANDS.EXPORT_HTML)
    await tick()
    // 先证明流程真的走到了对话框：否则下面那串 not.toHaveBeenCalled()
    // 在「命令根本没跑」时同样会通过，等于什么都没测
    expect(dialog.visible).toBe(true)
    dialog.cancel()
    await done

    expect(stubs.pickTarget).not.toHaveBeenCalled()
    expect(stubs.run).not.toHaveBeenCalled()
    expect(stubs.settingsSet).not.toHaveBeenCalled()
  })

  it('用户取消选路径对话框：同样不写盘', async () => {
    openDocument('E:\\docs\\报告.md')
    stubs.pickTarget.mockResolvedValue({ canceled: true, path: undefined })
    const dialog = useExportDialogStore()

    const done = executeCommand(COMMANDS.EXPORT_HTML)
    await tick()
    dialog.confirm()
    await done

    expect(stubs.pickTarget).toHaveBeenCalledTimes(1)
    expect(stubs.run).not.toHaveBeenCalled()
  })

  it('没有打开的文档：给出错误提示，且不打开对话框', async () => {
    await executeCommand(COMMANDS.EXPORT_HTML)

    expect(useExportDialogStore().visible).toBe(false)
    expect(useLayoutStore().notices.at(-1)).toMatchObject({
      text: '没有打开的文档',
      type: 'error'
    })
  })

  it('导出返回 {ok:false}：走系统错误框，而不是静默失败', async () => {
    openDocument('E:\\docs\\报告.md')
    stubs.run.mockResolvedValue({ ok: false, error: '磁盘已满' })
    const dialog = useExportDialogStore()

    const done = executeCommand(COMMANDS.EXPORT_PDF)
    await tick()
    dialog.confirm()
    await done

    expect(stubs.message).toHaveBeenCalledTimes(1)
    expect(stubs.message.mock.calls[0][0]).toMatchObject({ type: 'error', detail: '磁盘已满' })
    expect(useLayoutStore().notices).toHaveLength(0)
  })

  it('IPC handler 抛异常：也变成错误框，而不是未捕获的 rejection', async () => {
    openDocument('E:\\docs\\报告.md')
    stubs.run.mockRejectedValue(new Error('导出路径必须是绝对路径'))
    const dialog = useExportDialogStore()

    const done = executeCommand(COMMANDS.EXPORT_HTML)
    await tick()
    dialog.confirm()
    await done

    expect(stubs.message).toHaveBeenCalledTimes(1)
    expect(stubs.message.mock.calls[0][0]).toMatchObject({
      detail: '导出路径必须是绝对路径'
    })
  })
})

describe('主题命令', () => {
  /**
   * 这里只验「命令接线对不对」。
   *
   * 「跟随系统 + 系统是深色 → 应切到浅色」那一条才是 `toggledTheme` 存在的理由，
   * 但它需要把 resolved 拨到深色，而测试环境的 matchMedia 恒为不匹配
   * （见 test/setup.ts），在 store 层面拨不动——所以那条在
   * `lib/themeSwitch.test.ts` 里用纯函数覆盖，不在这里假装测过。
   */
  it('一键切换日夜：明确选了浅色就切到深色', async () => {
    const settings = useSettingsStore()
    await settings.setTheme('light')

    await executeCommand(COMMANDS.VIEW_TOGGLE_THEME)

    expect(settings.settings.theme).toBe('dark')
  })

  it('一键切换日夜：不循环到「跟随系统」（那不是「切到相反的一档」）', async () => {
    const settings = useSettingsStore()
    await settings.setTheme('dark')

    await executeCommand(COMMANDS.VIEW_TOGGLE_THEME)

    expect(settings.settings.theme).toBe('light')
  })

  it('跟随系统时按生效档取反：环境为浅色 ⇒ 切到深色', async () => {
    const settings = useSettingsStore()
    await settings.setTheme('system')
    expect(settings.resolvedTheme).toBe('light')

    await executeCommand(COMMANDS.VIEW_TOGGLE_THEME)

    expect(settings.settings.theme).toBe('dark')
  })

  it('主题选择会落库', async () => {
    await executeCommand(COMMANDS.VIEW_THEME_SYSTEM)
    expect(stubs.settingsSet).toHaveBeenCalledWith({ theme: 'system' })
  })
})

describe('打印命令', () => {
  it('Ctrl+P 走打印通道：不选路径、不写盘、不进导出通道', async () => {
    openDocument('E:\\docs\\报告.md')
    const dialog = useExportDialogStore()

    const done = executeCommand(COMMANDS.FILE_PRINT)
    await tick()
    dialog.confirm()
    await done

    expect(stubs.print).toHaveBeenCalledTimes(1)
    expect(stubs.run).not.toHaveBeenCalled()
    expect(stubs.pickTarget).not.toHaveBeenCalled()
    expect(stubs.print.mock.calls[0][0]).toMatchObject({ docPath: 'E:\\docs\\报告.md' })
    expect(useLayoutStore().notices.at(-1)?.text).toContain('已发送到打印机')
  })

  it('用户在系统打印对话框里取消：不算失败，不弹错误框', async () => {
    openDocument('E:\\docs\\报告.md')
    stubs.print.mockResolvedValue({ ok: false, canceled: true })
    const dialog = useExportDialogStore()

    const done = executeCommand(COMMANDS.FILE_PRINT)
    await tick()
    dialog.confirm()
    await done

    // 同上：先确认打印真的发出去了，再断言「取消不弹框」
    expect(stubs.print).toHaveBeenCalledTimes(1)
    expect(stubs.message).not.toHaveBeenCalled()
    expect(useLayoutStore().notices).toHaveLength(0)
  })

  it('打印真的失败：弹错误框', async () => {
    openDocument('E:\\docs\\报告.md')
    stubs.print.mockResolvedValue({ ok: false, error: '打印机未就绪' })
    const dialog = useExportDialogStore()

    const done = executeCommand(COMMANDS.FILE_PRINT)
    await tick()
    dialog.confirm()
    await done

    expect(stubs.message).toHaveBeenCalledTimes(1)
    expect(stubs.message.mock.calls[0][0]).toMatchObject({
      title: '打印失败',
      detail: '打印机未就绪'
    })
  })
})
