import { onScopeDispose, shallowRef, watch, type Ref } from 'vue'

export interface DeferredOptions {
  /** 这个值一变就**立刻**重算，不走防抖（通常是文档 id） */
  resetKey?: () => unknown
  /** 尾沿防抖时长。取值要短到感觉不出延迟，长到能吃掉连续按键 */
  delayMs?: number
}

/**
 * 昂贵的派生值：不要在每次按键时都重算。
 *
 * 背景：编辑区每敲一个字都会把整篇 content 写回 store，而大纲、字数统计、
 * 搜索结果都要遍历整篇文档。1 MB 文档下每次按键就是几十毫秒的扫描，
 * 直接表现为打字卡顿——这是 M1 的验收项之一。
 *
 * 这里做**尾沿防抖**：连续输入时只在停下来之后算一次。
 *
 * 两个刻意的设计：
 * - 换文档必须**立刻**算。否则切标签后的 250ms 里会显示上一篇的目录，
 *   看起来像是串了文档。
 * - 用 shallowRef 而不是 ref。大文档的匹配结果可能有几百个元素，
 *   深层响应式代理它们纯属浪费——这里总是整体替换，不需要逐项追踪。
 */
export function useDeferredValue<T>(
  deps: () => unknown,
  compute: () => T,
  options: DeferredOptions = {}
): Readonly<Ref<T>> {
  const { resetKey, delayMs = 250 } = options

  const value = shallowRef(compute())
  let timer: ReturnType<typeof setTimeout> | undefined
  let lastReset = resetKey?.()

  const stop = watch([deps, () => resetKey?.()], () => {
    if (timer !== undefined) clearTimeout(timer)

    const current = resetKey?.()
    if (current !== lastReset) {
      lastReset = current
      value.value = compute()
      return
    }

    timer = setTimeout(() => {
      timer = undefined
      value.value = compute()
    }, delayMs)
  })

  onScopeDispose(() => {
    if (timer !== undefined) clearTimeout(timer)
    stop()
  })

  return value
}
