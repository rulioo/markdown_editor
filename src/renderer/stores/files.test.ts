import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { DEFAULT_SETTINGS } from '@shared/types'
import type { Settings } from '@shared/types'
import { useFilesStore } from './files'
import { useLayoutStore } from './layout'
import { useSettingsStore } from './settings'

/**
 * 「载入文档就显示大纲」的落点测试。
 *
 * 这条行为的判据是 `openPath`（单数，文件树里点）与 `openPaths`（复数，从外面打开）
 * 的**区分**，所以两个方向都要钉住：外部打开必须切到大纲，树内点击必须一动不动。
 * 只测前者的话，把 `showOutline()` 挪进 `openPath` 里也照样全绿——而那正是要防的退化：
 * 你正浏览文件树，点一个文件它就把页签抢走。
 */

interface Stubs {
  settingsSet: ReturnType<typeof vi.fn>
  stat: ReturnType<typeof vi.fn>
  readFile: ReturnType<typeof vi.fn>
}

let stubs: Stubs

function installApi(): Stubs {
  let value: Settings = structuredClone(DEFAULT_SETTINGS)
  const api = {
    fs: {
      stat: vi.fn(async () => ({ exists: true, isDirectory: false, size: 12, mtimeMs: 1 })),
      readFile: vi.fn(async () => ({
        content: '# 标题\n\n正文',
        encoding: 'utf8',
        eol: 'lf',
        mtimeMs: 1
      })),
      watch: vi.fn(async () => undefined),
      unwatch: vi.fn(async () => undefined)
    },
    recent: { add: vi.fn(async () => []) },
    settings: {
      // 与主进程同一份契约：回传的是合并后的**完整**配置
      set: vi.fn(async (patch: Partial<Settings>) => {
        value = { ...value, ...patch }
        return value
      })
    }
  }
  ;(window as unknown as { api: unknown }).api = api
  return {
    settingsSet: api.settings.set,
    stat: api.fs.stat,
    readFile: api.fs.readFile
  }
}

beforeEach(() => {
  vi.restoreAllMocks()
  setActivePinia(createPinia())
  stubs = installApi()
})

describe('从外部载入文档后的侧边栏', () => {
  it('打开文档：展开侧边栏并切到「大纲」', async () => {
    const files = useFilesStore()
    const settings = useSettingsStore()
    // 先证明起点确实是「文件」——否则下面的断言在「本来就停在大纲」时也会通过
    expect(settings.settings.sidebar).toMatchObject({ visible: true, tab: 'files' })

    await files.openPaths(['E:\\docs\\报告.md'])

    expect(settings.settings.sidebar).toMatchObject({ visible: true, tab: 'outline' })
    expect(files.activeSession?.name).toBe('报告.md')
  })

  it('侧边栏原本是收起的：照样展开（这是明确选过的口径）', async () => {
    const settings = useSettingsStore()
    await settings.update({
      sidebar: { ...settings.settings.sidebar, visible: false, tab: 'files' }
    })

    await useFilesStore().openPaths(['E:\\docs\\报告.md'])

    expect(settings.settings.sidebar).toMatchObject({ visible: true, tab: 'outline' })
  })

  it('用户已手动切回「文件」后，再打开一篇又会回到「大纲」', async () => {
    const files = useFilesStore()
    const settings = useSettingsStore()

    await files.openPaths(['E:\\docs\\一.md'])
    await settings.update({ sidebar: { ...settings.settings.sidebar, tab: 'files' } })
    await files.openPaths(['E:\\docs\\二.md'])

    expect(settings.settings.sidebar.tab).toBe('outline')
  })

  it('一个都没打开成功：不动侧边栏，也不多写一次配置', async () => {
    stubs.stat.mockResolvedValue({ exists: false, isDirectory: false, size: 0, mtimeMs: 0 })
    const files = useFilesStore()
    const settings = useSettingsStore()

    await files.openPaths(['E:\\docs\\不存在.md'])

    expect(settings.settings.sidebar).toMatchObject({ visible: true, tab: 'files' })
    expect(stubs.settingsSet).not.toHaveBeenCalled()
    expect(useLayoutStore().notices.at(-1)).toMatchObject({ type: 'error' })
  })

  it('已经停在大纲上：不重复落库', async () => {
    const settings = useSettingsStore()
    await settings.update({ sidebar: { ...settings.settings.sidebar, tab: 'outline' } })
    stubs.settingsSet.mockClear()

    await useFilesStore().openPaths(['E:\\docs\\报告.md'])

    expect(stubs.settingsSet).not.toHaveBeenCalled()
  })

  it('反复打开同一篇已打开的文档：一样切到大纲', async () => {
    const files = useFilesStore()
    const settings = useSettingsStore()

    await files.openPaths(['E:\\docs\\报告.md'])
    await settings.update({ sidebar: { ...settings.settings.sidebar, tab: 'files' } })
    await files.openPaths(['E:\\docs\\报告.md'])

    expect(settings.settings.sidebar.tab).toBe('outline')
    // 已打开的路径不会重读磁盘
    expect(stubs.readFile).toHaveBeenCalledTimes(1)
  })
})

describe('新建文档', () => {
  it('不走 openPaths：不切页签（空文档没有标题，弹大纲没有意义）', async () => {
    const files = useFilesStore()
    const settings = useSettingsStore()

    files.newFile()

    expect(files.activeSession?.name).toBe('未命名-1.md')
    expect(settings.settings.sidebar).toMatchObject({ visible: true, tab: 'files' })
    expect(stubs.settingsSet).not.toHaveBeenCalled()
  })
})

describe('在文件树里点文件', () => {
  it('走 openPath（单数）：不抢走当前页签，也不碰配置', async () => {
    const files = useFilesStore()
    const settings = useSettingsStore()

    await files.openPath('E:\\docs\\报告.md')

    expect(files.activeSession?.name).toBe('报告.md')
    expect(settings.settings.sidebar).toMatchObject({ visible: true, tab: 'files' })
    expect(stubs.settingsSet).not.toHaveBeenCalled()
  })

  it('收起状态下在树里点文件：不会把侧边栏弹开', async () => {
    const files = useFilesStore()
    const settings = useSettingsStore()
    await settings.update({
      sidebar: { ...settings.settings.sidebar, visible: false }
    })
    stubs.settingsSet.mockClear()

    await files.openPath('E:\\docs\\报告.md')

    expect(settings.settings.sidebar.visible).toBe(false)
    expect(stubs.settingsSet).not.toHaveBeenCalled()
  })
})
