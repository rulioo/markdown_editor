/**
 * 路径缓冲区的状态机。
 *
 * 这个状态机手工测不到——它管的是「窗口已建、监听器还没注册」那几百毫秒，
 * 而整个命令行打开文件的方案都压在它上面，所以必须在这里钉死。
 *
 * 模块本身是**有状态的单例**，所以每条用例用 `vi.resetModules()` 换一份全新的实例，
 * 而不是靠手工清零——手工清零漏掉一个变量，测试就会在互相污染中假绿。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

type PendingPaths = typeof import('./pending-paths')

let mod: PendingPaths
/** 记录 sink 收到了什么 */
let delivered: string[][]

beforeEach(async () => {
  vi.resetModules()
  mod = await import('./pending-paths')
  delivered = []
  mod.setPathSink((paths) => delivered.push(paths))
})

describe('pending-paths 状态机', () => {
  it('未就绪时入缓冲，取走时按入队顺序返回', () => {
    mod.queuePaths(['a.md'])
    mod.queuePaths(['b.md', 'c.md'])

    expect(mod.takePendingPaths()).toEqual(['a.md', 'b.md', 'c.md'])
  })

  it('未就绪时不投递——这正是丢文件那个 bug 的形状', () => {
    mod.queuePaths(['a.md'])
    expect(delivered).toEqual([])
  })

  it('取走即清空，第二次取走是空的', () => {
    mod.queuePaths(['a.md'])
    expect(mod.takePendingPaths()).toEqual(['a.md'])
    expect(mod.takePendingPaths()).toEqual([])
  })

  it('没有路径时取走返回空数组，但仍然把状态置为就绪', () => {
    expect(mod.takePendingPaths()).toEqual([])
    mod.queuePaths(['a.md'])
    // 上面那句 take 已经把 ready 置真，所以这次是直接投递
    expect(delivered).toEqual([['a.md']])
  })

  it('取走之后的入队直接走 sink', () => {
    mod.takePendingPaths()
    mod.queuePaths(['a.md'])
    expect(delivered).toEqual([['a.md']])
    expect(mod.takePendingPaths()).toEqual([])
  })

  it('入队的路径与缓冲中已有的去重', () => {
    mod.queuePaths(['a.md'])
    mod.queuePaths(['a.md', 'b.md'])
    expect(mod.takePendingPaths()).toEqual(['a.md', 'b.md'])
  })

  it('同一批里的重复也去重', () => {
    mod.queuePaths(['a.md', 'a.md'])
    expect(mod.takePendingPaths()).toEqual(['a.md'])
  })

  it('空数组是空操作，不会把待取列表变成「有过一次入队」', () => {
    mod.queuePaths([])
    expect(mod.takePendingPaths()).toEqual([])
  })

  it('就绪后投递空数组也是空操作（不会给渲染进程推一次空批次）', () => {
    mod.takePendingPaths()
    mod.queuePaths([])
    expect(delivered).toEqual([])
  })

  it('resetPathDelivery 之后重新入缓冲——macOS 关窗不退出时的一轮', () => {
    mod.queuePaths(['a.md'])
    mod.takePendingPaths()

    // 窗口全部关闭：上一批已交付，且新窗口不该再收到它
    mod.resetPathDelivery()
    expect(mod.takePendingPaths()).toEqual([])

    // 无窗口期来的 open-file 必须重新攒着，等 activate 建出的窗口来取
    mod.resetPathDelivery()
    mod.queuePaths(['b.md'])
    expect(delivered).toEqual([])
    expect(mod.takePendingPaths()).toEqual(['b.md'])
  })

  it('没有 sink 时不会抛——主进程注入之前就来路径是可能的', async () => {
    vi.resetModules()
    const bare = await import('./pending-paths')
    bare.takePendingPaths()
    expect(() => bare.queuePaths(['a.md'])).not.toThrow()
  })
})
