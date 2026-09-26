import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { EditorMode } from '@shared/types'
import { useSettingsStore } from './settings'

export interface Notice {
  id: number
  text: string
  type: 'info' | 'success' | 'error'
}

const MIN_FONT_SIZE = 12
const MAX_FONT_SIZE = 32
const FONT_STEP = 2
const NOTICE_DURATION = 3200

export const useLayoutStore = defineStore('layout', () => {
  const settingsStore = useSettingsStore()

  /**
   * 持久化的界面状态**不在这里另存一份**，而是直接读写 settings，
   * 避免「store 里一个值、配置文件里另一个值」的经典不同步问题。
   */
  const sidebarVisible = computed(() => settingsStore.settings.sidebar.visible)
  const sidebarWidth = computed(() => settingsStore.settings.sidebar.width)
  const sidebarTab = computed(() => settingsStore.settings.sidebar.tab)
  const mode = computed<EditorMode>(() => settingsStore.settings.editorMode)
  const showStatusBar = computed(() => settingsStore.settings.showStatusBar)
  const fontSize = computed(() => settingsStore.settings.fontSize)
  const typewriter = computed(() => settingsStore.settings.typewriter)
  const focusMode = computed(() => settingsStore.settings.focusMode)
  const showImages = computed(() => settingsStore.settings.showImages)

  async function setMode(next: EditorMode): Promise<void> {
    await settingsStore.update({ editorMode: next })
  }

  async function toggleSidebar(): Promise<void> {
    await settingsStore.update({
      sidebar: { ...settingsStore.settings.sidebar, visible: !sidebarVisible.value }
    })
  }

  async function setSidebarTab(tab: 'files' | 'outline' | 'search'): Promise<void> {
    // 点击已激活的面板页签 = 收起侧边栏（与 MarkText 一致的手感）
    if (sidebarTab.value === tab && sidebarVisible.value) {
      await toggleSidebar()
      return
    }
    await settingsStore.update({ sidebar: { ...settingsStore.settings.sidebar, tab, visible: true } })
  }

  async function setSidebarWidth(width: number): Promise<void> {
    const clamped = Math.min(480, Math.max(200, Math.round(width)))
    await settingsStore.update({
      sidebar: { ...settingsStore.settings.sidebar, width: clamped }
    })
  }

  async function toggleStatusBar(): Promise<void> {
    await settingsStore.update({ showStatusBar: !showStatusBar.value })
  }

  async function toggleTypewriter(): Promise<void> {
    await settingsStore.update({ typewriter: !typewriter.value })
    notify(typewriter.value ? '已开启打字机模式' : '已关闭打字机模式')
  }

  async function toggleFocusMode(): Promise<void> {
    await settingsStore.update({ focusMode: !focusMode.value })
    notify(focusMode.value ? '已开启专注模式' : '已关闭专注模式')
  }

  async function toggleImages(): Promise<void> {
    await settingsStore.update({ showImages: !showImages.value })
    notify(showImages.value ? '已显示图片' : '已隐藏图片')
  }

  async function setFontSize(size: number): Promise<void> {
    const clamped = Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, size))
    if (clamped === fontSize.value) return
    await settingsStore.update({ fontSize: clamped })
  }

  async function zoomIn(): Promise<void> {
    await setFontSize(fontSize.value + FONT_STEP)
  }

  async function zoomOut(): Promise<void> {
    await setFontSize(fontSize.value - FONT_STEP)
  }

  async function zoomReset(): Promise<void> {
    await setFontSize(16)
  }

  /* ------------------------------- 轻提示 ------------------------------- */

  const notices = ref<Notice[]>([])
  let noticeSeq = 0

  function notify(text: string, type: Notice['type'] = 'info'): void {
    const id = ++noticeSeq
    notices.value = [...notices.value, { id, text, type }]
    setTimeout(() => dismissNotice(id), NOTICE_DURATION)
  }

  function dismissNotice(id: number): void {
    notices.value = notices.value.filter((n) => n.id !== id)
  }

  return {
    sidebarVisible,
    sidebarWidth,
    sidebarTab,
    mode,
    showStatusBar,
    fontSize,
    typewriter,
    focusMode,
    showImages,
    setMode,
    toggleSidebar,
    setSidebarTab,
    setSidebarWidth,
    toggleStatusBar,
    toggleTypewriter,
    toggleFocusMode,
    toggleImages,
    setFontSize,
    zoomIn,
    zoomOut,
    zoomReset,
    notices,
    notify,
    dismissNotice
  }
})
