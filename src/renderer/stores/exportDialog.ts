/**
 * 导出选项对话框的**模态控制器**。
 *
 * 用 Promise 而不是「visible + onConfirm 回调」的理由：调用方（命令实现）的流程是
 * 「问用户要选项 → 用户确认了才继续选路径、才写盘」，写成 Promise 之后这段流程
 * 就是直线代码。回调写法会把「选路径 → 写盘」拆到一个回调里，而那个回调还要
 * 自己处理取消、错误、以及「对话框关掉之后用户又点了别的菜单」这些情况。
 *
 * 格式（html/pdf/docx）只透传给组件用于决定显示哪一段，store 本身不感知——
 * M4 加 DOCX 段时这里一行都不用改。
 */

import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { ExportFormat, ExportOptions } from '@shared/types'
import { DEFAULT_EXPORT_OPTIONS } from '@shared/types'

/**
 * 深拷贝，切断 draft 与 settings 之间的引用（否则编辑 draft 会当场改到配置）。
 *
 * **不能用 `structuredClone`**：pinia 的 state 和 `ref` 里的对象都是 Vue 的响应式
 * Proxy，而结构化克隆算法碰到 Proxy 会直接抛 `DataCloneError: #<Object> could not
 * be cloned`。`toRaw()` 也救不了——它只解一层，`options.pdf` 取出来仍是 Proxy。
 * 这个错会发生在 `open()` 里（`current` 来自 settings），也就是「一打开对话框就炸」。
 *
 * `ExportOptions` 里全是字符串/数字/布尔，JSON 往返既是深拷贝也不会丢东西。
 * 刻意不写通用深拷贝：等真需要递归处理别的类型时，说明类型已经变了。
 */
function clone(options: ExportOptions): ExportOptions {
  return JSON.parse(JSON.stringify(options)) as ExportOptions
}

export const useExportDialogStore = defineStore('exportDialog', () => {
  const visible = ref(false)
  const format = ref<ExportFormat>('html')
  const draft = ref<ExportOptions>(clone(DEFAULT_EXPORT_OPTIONS))

  /**
   * 当前等待中的那个 Promise 的 resolve。
   *
   * 只可能有一个：对话框是模态的，同时开两个没有意义。
   */
  let pending: ((value: ExportOptions | null) => void) | null = null

  /**
   * 打开对话框，返回用户确认的选项；用户取消返回 `null`。
   *
   * **重入时必须先把上一个 Promise 收尾。** 否则第二次打开会覆盖 `pending`，
   * 而第一个 `await` 将永远悬在那里——调用它的命令实现就卡死了，
   * 而且不会有任何报错。理论上模态遮罩挡住了第二次触发，
   * 但键盘快捷键（Ctrl+P 连按两下）走的是菜单命令，绕得过遮罩。
   */
  async function open(nextFormat: ExportFormat, current: ExportOptions): Promise<ExportOptions | null> {
    settle(null)
    format.value = nextFormat
    draft.value = clone(current)
    visible.value = true
    return new Promise<ExportOptions | null>((resolve) => {
      pending = resolve
    })
  }

  function settle(value: ExportOptions | null): void {
    const resolve = pending
    pending = null
    visible.value = false
    if (resolve) resolve(value)
  }

  /** 用户点了「导出」 */
  function confirm(): void {
    // 再克隆一份：draft 还会被下一次 open() 复用，不能让 resolve 出去的对象
    // 与 store 内部状态共享引用
    settle(clone(draft.value))
  }

  /** 用户点了「取消」/ Esc / 点遮罩 */
  function cancel(): void {
    settle(null)
  }

  return { visible, format, draft, open, confirm, cancel }
})
