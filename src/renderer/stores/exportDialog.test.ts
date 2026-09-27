import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { DEFAULT_EXPORT_OPTIONS } from '@shared/types'
import { useExportDialogStore } from './exportDialog'

/**
 * 对话框控制器。
 *
 * 这里值钱的是**重入**那一条：它是「await 永远不返回」型 bug，
 * 现象是菜单点了没反应、且没有任何报错，靠界面测试很难定位。
 */

describe('导出对话框 store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('open 之后 visible 为真，draft 是传入配置的**副本**', () => {
    const store = useExportDialogStore()
    const current = structuredClone(DEFAULT_EXPORT_OPTIONS)
    void store.open('html', current)

    expect(store.visible).toBe(true)
    expect(store.format).toBe('html')
    // 必须是副本：否则在对话框里改选项会当场改到 settings
    store.draft.pdf.margin.top = 42
    expect(current.pdf.margin.top).toBe(DEFAULT_EXPORT_OPTIONS.pdf.margin.top)
  })

  it('confirm 返回完整对象，且与 store 内部状态不共享引用', async () => {
    const store = useExportDialogStore()
    const promise = store.open('pdf', DEFAULT_EXPORT_OPTIONS)
    store.draft.theme = 'dark'
    store.draft.pdf.margin.top = 33
    store.confirm()

    const result = await promise
    expect(result).toEqual({
      ...DEFAULT_EXPORT_OPTIONS,
      theme: 'dark',
      pdf: { ...DEFAULT_EXPORT_OPTIONS.pdf, margin: { ...DEFAULT_EXPORT_OPTIONS.pdf.margin, top: 33 } }
    })
    expect(store.visible).toBe(false)

    // 之后再改 draft 不该影响已经交出去的这份
    store.draft.theme = 'light'
    expect(result!.theme).toBe('dark')
  })

  it('cancel 返回 null', async () => {
    const store = useExportDialogStore()
    const promise = store.open('html', DEFAULT_EXPORT_OPTIONS)
    store.cancel()
    await expect(promise).resolves.toBeNull()
    expect(store.visible).toBe(false)
  })

  it('重入：第二次 open 会把上一个 Promise 以 null 收尾（否则它永远悬着）', async () => {
    const store = useExportDialogStore()
    const first = store.open('html', DEFAULT_EXPORT_OPTIONS)
    const second = store.open('pdf', { ...DEFAULT_EXPORT_OPTIONS, theme: 'dark' })

    // 第一个必须已经了结，不能悬着
    await expect(first).resolves.toBeNull()
    expect(store.format).toBe('pdf')
    expect(store.draft.theme).toBe('dark')

    store.confirm()
    await expect(second).resolves.not.toBeNull()
  })

  it('连按两次 Ctrl+P 不会卡住第一次调用', async () => {
    const store = useExportDialogStore()
    const a = store.open('pdf', DEFAULT_EXPORT_OPTIONS)
    const b = store.open('pdf', DEFAULT_EXPORT_OPTIONS)
    store.cancel()
    await expect(a).resolves.toBeNull()
    await expect(b).resolves.toBeNull()
    expect(store.visible).toBe(false)
  })

  it('settle 之后再 settle 是空操作（不会重复 resolve 或抛错）', async () => {
    const store = useExportDialogStore()
    const promise = store.open('html', DEFAULT_EXPORT_OPTIONS)
    store.cancel()
    expect(() => store.confirm()).not.toThrow()
    await expect(promise).resolves.toBeNull()
  })

  it('没有 pending 时 confirm 不炸', () => {
    const store = useExportDialogStore()
    expect(() => store.confirm()).not.toThrow()
  })

  it('draft 默认值是完整对象（M4 加 DOCX 段时字段已就位）', () => {
    const store = useExportDialogStore()
    expect(store.draft).toEqual(DEFAULT_EXPORT_OPTIONS)
    expect(store.draft.docx.fontFamily).toBe(DEFAULT_EXPORT_OPTIONS.docx.fontFamily)
  })
})
