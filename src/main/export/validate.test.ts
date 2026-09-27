import { describe, expect, it } from 'vitest'
import { DEFAULT_EXPORT_OPTIONS } from '@shared/types'
import { sanitizeExportOptions, sanitizeExportRequest, sanitizePrintRequest } from './validate'

/**
 * 入参校验。
 *
 * 这个文件的重点是**恶意/畸形输入**，不是正常路径：渲染进程是我们的代码，
 * 但它是唯一会传 `NaN`、少字段、相对路径过来的地方，而参数最终会进 Chromium 的
 * 打印 API。这里每一条都对应一种「看起来导出成功、文件却是坏的」的故障。
 */

const ABS = process.platform === 'win32' ? 'E:\\out\\a.html' : '/tmp/a.html'

function request(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    format: 'html',
    markdown: '# 标题',
    targetPath: ABS,
    docPath: null,
    options: DEFAULT_EXPORT_OPTIONS,
    ...patch
  }
}

describe('sanitizeExportRequest：拒绝的输入', () => {
  it('不是对象', () => {
    for (const bad of [null, undefined, 'x', 42, []]) {
      expect(() => sanitizeExportRequest(bad)).toThrow('无效的导出请求')
    }
  })

  it('未知格式', () => {
    expect(() => sanitizeExportRequest(request({ format: 'txt' }))).toThrow('无效的导出格式')
    expect(() => sanitizeExportRequest(request({ format: undefined }))).toThrow('无效的导出格式')
  })

  it('markdown 不是字符串', () => {
    expect(() => sanitizeExportRequest(request({ markdown: { toString: () => 'x' } }))).toThrow(
      '导出内容无效'
    )
  })

  it('目标路径为空', () => {
    for (const bad of ['', '   ', null, 42]) {
      expect(() => sanitizeExportRequest(request({ targetPath: bad }))).toThrow('导出路径无效')
    }
  })

  it('目标路径是相对路径（这是 EXPORT_RUN 过去完全没设的一道闸）', () => {
    // 相对路径会落到进程的 cwd 上，那是个用户完全看不见的地方
    for (const bad of ['a.html', './a.html', 'sub/a.html']) {
      expect(() => sanitizeExportRequest(request({ targetPath: bad }))).toThrow(
        '导出路径必须是绝对路径'
      )
    }
  })

  it('docPath 是相对路径时回落到 null（而不是拒绝整次导出）', () => {
    const result = sanitizeExportRequest(request({ docPath: 'a.md' }))
    expect(result.docPath).toBeNull()
  })
})

describe('sanitizeExportRequest：放行的输入', () => {
  it('合法请求原样通过（幂等）', () => {
    const once = sanitizeExportRequest(request())
    const twice = sanitizeExportRequest(once)
    expect(twice).toEqual(once)
  })

  it('docPath 可以是绝对路径', () => {
    const docPath = process.platform === 'win32' ? 'E:\\docs\\a.md' : '/tmp/a.md'
    expect(sanitizeExportRequest(request({ docPath })).docPath).toBe(docPath)
  })

  it('title 去空白并截断，空串当作没给', () => {
    expect(sanitizeExportRequest(request({ title: '  报告  ' })).title).toBe('报告')
    expect(sanitizeExportRequest(request({ title: '   ' })).title).toBeUndefined()
    expect(sanitizeExportRequest(request({ title: 42 })).title).toBeUndefined()
    expect(sanitizeExportRequest(request({ title: 'x'.repeat(500) })).title).toHaveLength(200)
  })
})

describe('sanitizeExportOptions：重建而不是就地校验', () => {
  it('只传 theme 也回传一份完整对象', () => {
    // 对话框必须回传完整对象是 TypeScript 的约束（Partial<Settings> 是浅的），
    // 但运行时不能指望它——所以这里补上默认值。
    const options = sanitizeExportOptions({ theme: 'dark' })
    expect(options).toEqual({ ...DEFAULT_EXPORT_OPTIONS, theme: 'dark' })
  })

  it('undefined / 不是对象 都得到完整默认值', () => {
    for (const bad of [undefined, null, 'x', 42]) {
      expect(sanitizeExportOptions(bad)).toEqual(DEFAULT_EXPORT_OPTIONS)
    }
  })

  it('嵌套字段缺失时逐个回落，不整块丢掉', () => {
    // 只给了 pdf.margin.top：其余三边与 pdf 的其它字段都要还在
    const options = sanitizeExportOptions({ pdf: { margin: { top: 30 } } })
    expect(options.pdf.margin).toEqual({ top: 30, right: 20, bottom: 20, left: 20 })
    expect(options.pdf.pageSize).toBe(DEFAULT_EXPORT_OPTIONS.pdf.pageSize)
    expect(options.pdf.footer).toBe(DEFAULT_EXPORT_OPTIONS.pdf.footer)
  })

  it('NaN / Infinity 回落成默认值（不能流到 printToPDF）', () => {
    const options = sanitizeExportOptions({
      pdf: { margin: { top: NaN, right: Infinity, bottom: -Infinity, left: 'x' } }
    })
    expect(options.pdf.margin).toEqual(DEFAULT_EXPORT_OPTIONS.pdf.margin)
  })

  it('负数与超大数被夹进 [0,100] 毫米', () => {
    const options = sanitizeExportOptions({
      pdf: { margin: { top: -5, right: 1e6, bottom: 0, left: 100 } }
    })
    expect(options.pdf.margin).toEqual({ top: 0, right: 100, bottom: 0, left: 100 })
  })

  it('未知纸张名回落到默认', () => {
    expect(sanitizeExportOptions({ pdf: { pageSize: 'A0' } }).pdf.pageSize).toBe('A4')
    expect(sanitizeExportOptions({ pdf: { pageSize: 'B5' } }).pdf.pageSize).toBe('A4')
    expect(sanitizeExportOptions({ pdf: { pageSize: 'A3' } }).pdf.pageSize).toBe('A3')
  })

  it('主题只认 dark，其余一律 light', () => {
    expect(sanitizeExportOptions({ theme: 'dark' }).theme).toBe('dark')
    expect(sanitizeExportOptions({ theme: 'system' }).theme).toBe('light')
    expect(sanitizeExportOptions({ theme: 1 }).theme).toBe('light')
  })

  it('布尔字段只认真正的 true', () => {
    // 'false' 这种字符串如果被当成真值，用户勾掉「内联图片」却还是内联了
    const options = sanitizeExportOptions({ embedImages: 'false', includeToc: 1, pdf: { footer: 'yes' } })
    expect(options.embedImages).toBe(false)
    expect(options.includeToc).toBe(false)
    expect(options.pdf.footer).toBe(DEFAULT_EXPORT_OPTIONS.pdf.footer)
  })

  it('docx 字号被夹进 [1,72]，字体名去空白并截断', () => {
    const options = sanitizeExportOptions({
      docx: { fontSize: 999, fontFamily: '  宋体  ', codeFontFamily: 'x'.repeat(500) }
    })
    expect(options.docx.fontSize).toBe(72)
    expect(options.docx.fontFamily).toBe('宋体')
    expect(options.docx.codeFontFamily).toHaveLength(100)
  })

  it('空字体名回落成默认（空串会让 Word 用默认字体渲染，中文可能变宋体）', () => {
    expect(sanitizeExportOptions({ docx: { fontFamily: '   ' } }).docx.fontFamily).toBe(
      DEFAULT_EXPORT_OPTIONS.docx.fontFamily
    )
  })
})

describe('sanitizePrintRequest', () => {
  it('不需要 targetPath（打印不落盘）', () => {
    const result = sanitizePrintRequest({ markdown: '# x', options: DEFAULT_EXPORT_OPTIONS })
    expect(result.markdown).toBe('# x')
    expect(result.docPath).toBeNull()
  })

  it('仍然校验内容', () => {
    expect(() => sanitizePrintRequest(null)).toThrow('无效的打印请求')
    expect(() => sanitizePrintRequest({ markdown: 42 })).toThrow('打印内容无效')
  })

  it('选项走同一套规则（不存在第二条校验路径）', () => {
    const result = sanitizePrintRequest({ markdown: '# x', options: { theme: 'dark' } })
    expect(result.options).toEqual({ ...DEFAULT_EXPORT_OPTIONS, theme: 'dark' })
  })
})
