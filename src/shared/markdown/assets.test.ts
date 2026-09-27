import { describe, expect, it } from 'vitest'
import { processAssets, type AssetPort } from './assets'
import { markdownToHast, treeToHtml } from './render'
import { sanitizeTree } from './sanitize'

/**
 * 资源内联的遍历逻辑（IO 用假端口，所以这里能精确控制「读得到 / 读不到」）。
 *
 * 真实端口那份的归类表在 `src/main/export/assets.test.ts`，两边分工：
 * 这里测「拿到路径之后怎么改树」，那里测「什么字符串算路径」。
 */

/** 假端口：只认 `.png` 结尾的相对路径，其余一律不是本地文件 */
function fakePort(files: Record<string, string> = { 'a.png': 'data:image/png;base64,AAAA' }): AssetPort {
  return {
    resolveLocal: (value) => (value.endsWith('.png') && !value.includes('://') ? `/dir/${value}` : null),
    readAsDataUrl: async (absPath) => files[absPath.replace('/dir/', '')] ?? null
  }
}

/** 走一遍与导出路径**同样顺序**的四步：解析 → 内联 → 消毒 → 序列化 */
async function render(source: string, embedImages: boolean, port = fakePort()): Promise<string> {
  const tree = markdownToHast(source)
  await processAssets(tree, { port, embedImages })
  sanitizeTree(tree)
  return treeToHtml(tree)
}

describe('内联本地图片', () => {
  it('embedImages 打开时替换成 data: URL', async () => {
    const html = await render('![图](a.png)', true)
    expect(html).toContain('src="data:image/png;base64,AAAA"')
    expect(html).not.toContain('a.png')
  })

  it('embedImages 关闭时一个字节都不动', async () => {
    const html = await render('![图](a.png)', false)
    expect(html).toContain('src="a.png"')
  })

  it('多处引用同一张图都会被替换', async () => {
    const html = await render('![一](a.png)\n\n![二](a.png)', true)
    expect(html.match(/data:image\/png;base64,AAAA/g)).toHaveLength(2)
  })
})

describe('不该碰的图片', () => {
  it('远端图片原样保留（离线导出也不该报错）', async () => {
    const html = await render('![图](https://example.com/a.png)', true)
    expect(html).toContain('src="https://example.com/a.png"')
  })

  it('已经是 data: 的不动', async () => {
    const html = await render('![图](data:image/gif;base64,BBBB)', true)
    expect(html).toContain('src="data:image/gif;base64,BBBB"')
  })

  it('不是本地文件的 src 不会被误判', async () => {
    const html = await render('![图](//cdn.example.com/a.png)', true)
    expect(html).toContain('src="//cdn.example.com/a.png"')
  })
})

describe('报告', () => {
  it('读不到的图片记进 missing，且原值保留', async () => {
    const tree = markdownToHast('![图](missing.png)')
    const report = await processAssets(tree, { port: fakePort(), embedImages: true })
    expect(report.inlined).toBe(0)
    expect(report.missing).toEqual(['missing.png'])
    // 降级不是删除：留个坏链比留个空白强
    expect(treeToHtml(tree)).toContain('src="missing.png"')
  })

  it('统计成功内联的数量', async () => {
    const tree = markdownToHast('![一](a.png)\n\n![二](missing.png)')
    const report = await processAssets(tree, { port: fakePort(), embedImages: true })
    expect(report.inlined).toBe(1)
    expect(report.missing).toHaveLength(1)
  })

  it('embedImages 关闭时不产生报告内容（也没必要遍历）', async () => {
    const tree = markdownToHast('![图](a.png)')
    const report = await processAssets(tree, { port: fakePort(), embedImages: false })
    expect(report).toEqual({ inlined: 0, missing: [] })
  })
})

describe('与 sanitize 的配合（顺序是承重的）', () => {
  it('内联后的 data:image 能通过消毒，而原始 file: 会被剥掉', async () => {
    // 这条锁住的是 processAssets → sanitizeTree → treeToHtml 的顺序：
    // 反过来的话，data: 还没生成，file: 就已经被 sanitize 删了，图片全丢。
    const port: AssetPort = {
      resolveLocal: (value) => (value.startsWith('file:') ? 'E:\\x\\a.png' : null),
      readAsDataUrl: async () => 'data:image/png;base64,AAAA'
    }
    const tree = markdownToHast('![图](file:///E:/x/a.png)')
    await processAssets(tree, { port, embedImages: true })
    sanitizeTree(tree)
    expect(treeToHtml(tree)).toContain('data:image/png;base64,AAAA')
  })

  it('不内联时 file: 图片的 src 会被消毒剥掉（现有行为，刻意保留）', async () => {
    const html = await render('![图](file:///E:/x/a.png)', false)
    expect(html).not.toContain('file:')
  })
})
