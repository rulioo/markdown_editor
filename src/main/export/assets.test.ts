import { describe, expect, it } from 'vitest'
import { createAssetPort } from './assets'

/**
 * 「哪些字符串算本地图片」的归类表。
 *
 * 这张表错一格的后果不对称：把远端图片误判成本地 → 每次导出都失败一次并报「文件不存在」；
 * 把本地图片误判成远端 → 导出的 HTML 少了图，而且**没有任何提示**。
 * 所以正反两面都要逐条钉死。
 */

const DOC_DIR = 'E:\\docs'

describe('resolveLocal：算本地文件的', () => {
  const port = createAssetPort(DOC_DIR)

  it.each([
    ['相对路径', 'a.png', 'E:\\docs\\a.png'],
    ['带 ./ 的相对路径', './a.png', 'E:\\docs\\a.png'],
    ['子目录', 'sub/a.png', 'E:\\docs\\sub\\a.png'],
    // resolve 会顺带规范化，`..` 被吃掉——这正是想要的
    ['上级目录', '../a.png', 'E:\\a.png'],
    ['Windows 反斜杠绝对路径', 'C:\\x\\a.png', 'C:\\x\\a.png'],
    ['Windows 正斜杠绝对路径', 'C:/x/a.png', 'C:/x/a.png'],
    // 根相对：win32 的 isAbsolute 认它，就按「当前盘的根」处理，不加盘符
    ['根相对路径', '/x/a.png', '/x/a.png'],
    ['UNC 路径', '\\\\srv\\share\\a.png', '\\\\srv\\share\\a.png'],
    ['file:// URL', 'file:///E:/x/a.png', 'E:\\x\\a.png']
  ])('%s', (_label, input, expected) => {
    expect(port.resolveLocal(input)).toBe(expected)
  })

  it('前后空白被忽略', () => {
    expect(port.resolveLocal('  a.png  ')).toBe('E:\\docs\\a.png')
  })
})

describe('resolveLocal：不算本地文件的', () => {
  const port = createAssetPort(DOC_DIR)

  it.each([
    ['http', 'http://x/a.png'],
    ['https', 'https://x/a.png'],
    ['协议相对', '//cdn.x/a.png'],
    ['data:', 'data:image/png;base64,AAAA'],
    ['blob:', 'blob:file:///abc'],
    ['文内锚点', '#section'],
    ['mailto', 'mailto:x@y.com'],
    ['空串', ''],
    ['只有空白', '   ']
  ])('%s', (_label, input) => {
    expect(port.resolveLocal(input)).toBeNull()
  })

  it('认不出的协议一律拒绝（不要当成本地文件名）', () => {
    const port2 = createAssetPort(DOC_DIR)
    expect(port2.resolveLocal('javascript:alert(1)')).toBeNull()
    expect(port2.resolveLocal('vbscript:msgbox')).toBeNull()
  })

  it('相对路径在没有源文档目录时无法解析', () => {
    // 未保存的新文档：相对路径相对于谁都不对，宁可留着原样
    expect(createAssetPort(null).resolveLocal('a.png')).toBeNull()
  })

  it('绝对路径在没有源文档目录时依然可用', () => {
    expect(createAssetPort(null).resolveLocal('C:\\x\\a.png')).toBe('C:\\x\\a.png')
  })
})

describe('readAsDataUrl', () => {
  const port = createAssetPort(DOC_DIR)

  it('把真实文件读成 data: URL（用仓库里一定存在的图标当样本）', async () => {
    const result = await port.readAsDataUrl('build/icon.png')
    expect(result).toMatch(/^data:image\/png;base64,/)
    // 断言内容真的是那张图：解回来必须以 PNG 的魔数开头
    const base64 = result!.slice(result!.indexOf(',') + 1)
    expect(Buffer.from(base64, 'base64').subarray(0, 4)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47])
    )
  })

  it('不认识的扩展名退回 octet-stream，而不是瞎猜一个 image/*', async () => {
    expect(await port.readAsDataUrl('package.json')).toMatch(/^data:application\/octet-stream;base64,/)
  })

  it('文件不存在时返回 null 而不是抛错', async () => {
    await expect(port.readAsDataUrl('E:\\definitely-missing\\nope.png')).resolves.toBeNull()
  })

  it('路径是目录时返回 null 而不是抛错', async () => {
    await expect(port.readAsDataUrl('src')).resolves.toBeNull()
  })
})
