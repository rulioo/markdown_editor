/**
 * 测试环境补齐。
 *
 * jsdom 没实现 CodeMirror 依赖的几个浏览器 API，缺了会在构造 EditorView 时直接抛错。
 * 这里给出**够用的空实现**——测试断言的是文档内容与装饰范围，不依赖这些 API 的真实行为。
 */

// CM6 用它监听编辑器尺寸变化
if (!('ResizeObserver' in globalThis)) {
  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver
}

// CM6 用它判断选区是否被遮挡 / 计算坐标
if (!('Range' in globalThis) || !Range.prototype.getClientRects) {
  const proto = globalThis.Range?.prototype
  if (proto) {
    proto.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} }) as unknown as DOMRectList
    proto.getBoundingClientRect = () => new DOMRect()
  }
}

// jsdom 有 requestAnimationFrame，但个别版本缺 cancel 的成对实现，这里兜底
if (!globalThis.cancelAnimationFrame) {
  globalThis.cancelAnimationFrame = (handle: number) => clearTimeout(handle)
}

/**
 * jsdom 没有 matchMedia。
 *
 * settings store 在**模块顶层**就调用它监听系统深浅色，所以任何 import 到该 store
 * 的测试都会在「导入期」炸掉——不是「用到主题功能时」才炸。永远返回不匹配，
 * 也就是测试环境固定按浅色解析；需要暗色的用例自己显式设主题。
 *
 * 判据用 `typeof !== 'function'` 而不是 `'matchMedia' in window`：这个环境下属性
 * 存在但**不是函数**，`in` 会判成「有」，于是补丁被跳过、照样炸。
 */
if (typeof window.matchMedia !== 'function') {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false
  })) as unknown as typeof window.matchMedia
}
