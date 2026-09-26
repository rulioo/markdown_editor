import { effectScope, nextTick, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDeferredValue } from './useDeferredValue'

/**
 * 这个组合式函数是「1 MB 文档打字不卡」的关键机制，所以它本身也要测。
 * 重点在两条容易写错的语义：
 *  - 连续变化只算一次（尾沿防抖）
 *  - 换文档（resetKey 变化）必须立刻算，不能等防抖
 */

const DELAY = 250

let scope: ReturnType<typeof effectScope>

beforeEach(() => {
  vi.useFakeTimers()
  scope = effectScope()
})

afterEach(() => {
  scope.stop()
  vi.useRealTimers()
})

describe('useDeferredValue', () => {
  it('初次就有值，不是空的', () => {
    const source = ref('a')
    const value = scope.run(() => useDeferredValue(() => source.value, () => source.value))!
    expect(value.value).toBe('a')
  })

  it('依赖变化后在 delay 之内不会更新', async () => {
    const source = ref('a')
    const value = scope.run(() => useDeferredValue(() => source.value, () => source.value))!

    source.value = 'b'
    await nextTick()
    expect(value.value).toBe('a')

    vi.advanceTimersByTime(DELAY - 1)
    expect(value.value).toBe('a')
  })

  it('延迟到点后更新', async () => {
    const source = ref('a')
    const value = scope.run(() => useDeferredValue(() => source.value, () => source.value))!

    source.value = 'b'
    await nextTick()
    vi.advanceTimersByTime(DELAY)
    expect(value.value).toBe('b')
  })

  it('连续变化只计算一次（关键：别每敲一个字都算）', async () => {
    const source = ref('a')
    let calls = 0
    const value = scope.run(() =>
      useDeferredValue(
        () => source.value,
        () => {
          calls += 1
          return source.value
        }
      )
    )!

    expect(calls).toBe(1) // 初次

    // 模拟连续敲 5 个字，每次间隔都短于防抖时长
    for (const text of ['b', 'c', 'd', 'e', 'f']) {
      source.value = text
      await nextTick()
      vi.advanceTimersByTime(DELAY - 50)
    }
    expect(calls).toBe(1)

    // 停下来之后才真正算一次
    vi.advanceTimersByTime(DELAY)
    expect(calls).toBe(2)
    expect(value.value).toBe('f')
  })

  it('resetKey 变化时立刻重算，不等防抖（否则切标签会显示上一篇的目录）', async () => {
    const id = ref('doc1')
    const content = ref('第一篇')
    let calls = 0
    const value = scope.run(() =>
      useDeferredValue(
        () => content.value,
        () => {
          calls += 1
          return content.value
        },
        { resetKey: () => id.value }
      )
    )!

    expect(calls).toBe(1)

    id.value = 'doc2'
    content.value = '第二篇'
    await nextTick()

    // 没有推进任何定时器，就应该已经是新文档的内容
    expect(calls).toBe(2)
    expect(value.value).toBe('第二篇')
  })

  it('作用域销毁后不再计算（定时器要被清掉）', async () => {
    const source = ref('a')
    let calls = 0
    const value = scope.run(() =>
      useDeferredValue(
        () => source.value,
        () => {
          calls += 1
          return source.value
        }
      )
    )!

    source.value = 'b'
    await nextTick()
    scope.stop()
    vi.advanceTimersByTime(DELAY * 4)

    expect(calls).toBe(1)
    expect(value.value).toBe('a')
  })

  it('delayMs 可调', async () => {
    const source = ref('a')
    const value = scope.run(() =>
      useDeferredValue(() => source.value, () => source.value, { delayMs: 50 })
    )!

    source.value = 'b'
    await nextTick()
    vi.advanceTimersByTime(50)
    expect(value.value).toBe('b')
  })
})
