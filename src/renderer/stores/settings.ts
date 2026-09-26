import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { DEFAULT_SETTINGS, type ResolvedTheme, type Settings, type ThemeMode } from '@shared/types'

/** 跟随系统主题：监听操作系统的深浅色偏好 */
const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')

export const useSettingsStore = defineStore('settings', () => {
  const settings = ref<Settings>(structuredClone(DEFAULT_SETTINGS))
  const loaded = ref(false)
  const systemPrefersDark = ref(mediaQuery.matches)

  mediaQuery.addEventListener('change', (event) => {
    systemPrefersDark.value = event.matches
  })

  /** 'system' 解析成实际的 light/dark —— 编辑区、预览、导出都用这个值 */
  const resolvedTheme = computed<ResolvedTheme>(() =>
    settings.value.theme === 'system'
      ? systemPrefersDark.value
        ? 'dark'
        : 'light'
      : settings.value.theme
  )

  async function load(): Promise<void> {
    settings.value = await window.api.settings.get()
    loaded.value = true
  }

  /** 局部更新并持久化；返回主进程合并后的完整配置 */
  async function update(patch: Partial<Settings>): Promise<void> {
    settings.value = await window.api.settings.set(patch)
  }

  async function setTheme(theme: ThemeMode): Promise<void> {
    await update({ theme })
  }

  return { settings, loaded, resolvedTheme, load, update, setTheme }
})
