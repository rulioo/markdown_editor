/**
 * 当前编辑器实例的访问点。
 *
 * 命令处理器（commands/index.ts）是普通模块函数，拿不到组件里的实例，
 * 而「加粗」「设为标题」这类命令必须在编辑器上执行。这里用一个模块级引用搭桥，
 * 由 EditorPane 在挂载/卸载时登记。
 *
 * 只登记一个实例是刻意的：应用同一时刻只有一个编辑区，
 * 多窗口各自跑在自己的渲染进程里，互不影响。
 */

import type { EditorHost } from './host'

let current: EditorHost | null = null

export function setActiveEditor(host: EditorHost | null): void {
  current = host
}

export function activeEditor(): EditorHost | null {
  return current
}

/**
 * 在编辑器上执行一段操作。
 * 没有打开的文档时静默跳过——菜单项在无文档时本就该是禁用态，
 * 这里只是兜底，避免弹出无意义的报错。
 */
export function withEditor(fn: (host: EditorHost) => void): void {
  if (current) fn(current)
}
