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
