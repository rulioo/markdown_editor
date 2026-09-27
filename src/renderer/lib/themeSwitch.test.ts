import { describe, expect, it } from 'vitest'
import { nextTheme, themeLabel, toggledTheme, THEME_ORDER } from './themeSwitch'

describe('日夜切换', () => {
  it('循环顺序是 浅色 → 深色 → 跟随系统 → 浅色', () => {
    expect(nextTheme('light')).toBe('dark')
    expect(nextTheme('dark')).toBe('system')
    expect(nextTheme('system')).toBe('light')
  })

  it('循环会走遍每一档（顺序表与实现不许漂移）', () => {
    const seen: string[] = []
    let current = THEME_ORDER[0]!
    for (let i = 0; i < THEME_ORDER.length; i += 1) {
      seen.push(current)
      current = nextTheme(current)
    }
    expect(new Set(seen).size).toBe(THEME_ORDER.length)
    expect(current).toBe(THEME_ORDER[0])
  })

  it('明确选了浅色/深色时，取反就是另一档', () => {
    // 这两种模式没有歧义，resolved 传什么都不该影响结果
    expect(toggledTheme('light', 'light')).toBe('dark')
    expect(toggledTheme('light', 'dark')).toBe('dark')
    expect(toggledTheme('dark', 'light')).toBe('light')
    expect(toggledTheme('dark', 'dark')).toBe('light')
  })

  it('跟随系统时按**当前实际生效**的那一档取反', () => {
    // 这条是整个模块存在的理由：系统是深色时按一下必须变浅色。
    // 写成「跟随系统 → 深色」的话，界面上就是「按一下没反应」。
    expect(toggledTheme('system', 'dark')).toBe('light')
    expect(toggledTheme('system', 'light')).toBe('dark')
  })

  it('取反的结果一定不是「跟随系统」——否则用户按了会看起来没反应', () => {
    const modes = ['light', 'dark', 'system'] as const
    for (const mode of modes) {
      for (const resolved of ['light', 'dark'] as const) {
        expect(toggledTheme(mode, resolved)).not.toBe('system')
      }
    }
  })

  it('文案：明确模式直接给名字', () => {
    expect(themeLabel('light', 'light')).toBe('浅色')
    expect(themeLabel('dark', 'dark')).toBe('深色')
  })

  it('文案：跟随系统要带出生效的那一档', () => {
    expect(themeLabel('system', 'dark')).toBe('跟随系统（深色）')
    expect(themeLabel('system', 'light')).toBe('跟随系统（浅色）')
  })
})
