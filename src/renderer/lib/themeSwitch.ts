/**
 * 日夜切换的纯逻辑。
 *
 * 只有三种模式（浅色 / 深色 / 跟随系统），但它们不是同一类东西：
 * 「跟随系统」不是一个颜色，而是一次**委托**——真正生效的是 `resolvedTheme`。
 * 所以「切换」有两种含义，这里分开给两个函数，而不是硬塞进一个：
 *
 * - `nextTheme`：按状态栏的循环顺序走到下一个模式（与状态栏里编码、换行符、
 *   显示模式的交互一致——这个状态栏的约定就是「点一下换下一个」）；
 * - `toggledTheme`：不管当前是什么模式，都切到**与此刻所见相反**的那一档。
 *
 * 分开的关键在「跟随系统」这一档：此刻系统是深色时按 `toggledTheme`，
 * 必须切到浅色。若偷懒写成「跟随系统 → 深色」，界面上就是「按一下没反应」，
 * 而这恰恰是日夜切换最不该有的手感。
 */

import type { ResolvedTheme, ThemeMode } from '@shared/types'

/** 状态栏点击时的循环顺序 */
export const THEME_ORDER: readonly ThemeMode[] = ['light', 'dark', 'system']

const MODE_LABELS: Record<ThemeMode, string> = {
  light: '浅色',
  dark: '深色',
  system: '跟随系统'
}

/** 循环到下一个模式；当前值不在表里（理论上不会）时回到浅色 */
export function nextTheme(current: ThemeMode): ThemeMode {
  const index = THEME_ORDER.indexOf(current)
  return THEME_ORDER[(index + 1) % THEME_ORDER.length] ?? 'light'
}

/**
 * 切到与当前所见相反的一档。
 * `resolved` 只在当前是「跟随系统」时用得上——那一档没有自己的颜色。
 */
export function toggledTheme(current: ThemeMode, resolved: ResolvedTheme): ThemeMode {
  if (current === 'light') return 'dark'
  if (current === 'dark') return 'light'
  return resolved === 'dark' ? 'light' : 'dark'
}

/**
 * 状态栏文案。
 *
 * 「跟随系统」后面必须带上实际生效的那一档：只写「跟随系统」的话，
 * 用户看不出现在到底是深是浅，而这正是他点这个按钮时想知道的事。
 */
export function themeLabel(mode: ThemeMode, resolved: ResolvedTheme): string {
  if (mode === 'system') return `${MODE_LABELS.system}（${MODE_LABELS[resolved]}）`
  return MODE_LABELS[mode]
}
