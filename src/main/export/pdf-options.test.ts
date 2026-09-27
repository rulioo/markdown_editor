import { describe, expect, it } from 'vitest'
import { DEFAULT_EXPORT_OPTIONS } from '@shared/types'
import {
  FOOTER_TEMPLATE,
  buildPrintOptions,
  buildPrintToPDFOptions,
  effectivePrintTheme,
  mmToInch,
  mmToPx96
} from './pdf-options'

/**
 * 打印参数映射。
 *
 * 这里最值钱的两条断言是**单位**：printToPDF 收英寸、print 收像素，
 * 而 ExportOptions 用毫米。写错单位的症状是「导出的 PDF 边距大得离谱」
 * 或者「设了 40mm 却看不出区别」，都不会报错。
 */

const pdf = (patch: Partial<typeof DEFAULT_EXPORT_OPTIONS.pdf> = {}) => ({
  ...DEFAULT_EXPORT_OPTIONS.pdf,
  ...patch
})

describe('单位换算', () => {
  it('毫米 → 英寸', () => {
    expect(mmToInch(25.4)).toBe(1)
    expect(mmToInch(20)).toBeCloseTo(0.7874, 4)
    expect(mmToInch(0)).toBe(0)
  })

  it('毫米 → CSS 像素（96dpi）', () => {
    expect(mmToPx96(25.4)).toBeCloseTo(96, 6)
    expect(mmToPx96(20)).toBeCloseTo(75.59, 2)
  })

  it('两个换算不是同一个数（写混了就会差 96 倍）', () => {
    expect(mmToPx96(20)).not.toBeCloseTo(mmToInch(20), 2)
  })
})

describe('buildPrintToPDFOptions', () => {
  it('四边边距按**英寸**换算', () => {
    const options = buildPrintToPDFOptions(
      pdf({ margin: { top: 25.4, right: 12.7, bottom: 25.4, left: 12.7 } })
    )
    expect(options.margins).toEqual({ top: 1, bottom: 1, left: 0.5, right: 0.5 })
  })

  it('纸张、方向、背景原样透传', () => {
    const options = buildPrintToPDFOptions(pdf({ pageSize: 'A3', landscape: true, printBackground: false }))
    expect(options.pageSize).toBe('A3')
    expect(options.landscape).toBe(true)
    expect(options.printBackground).toBe(false)
  })

  it('页脚开关决定 displayHeaderFooter 与 footerTemplate', () => {
    expect(buildPrintToPDFOptions(pdf({ footer: true })).displayHeaderFooter).toBe(true)
    expect(buildPrintToPDFOptions(pdf({ footer: true })).footerTemplate).toBe(FOOTER_TEMPLATE)
    expect(buildPrintToPDFOptions(pdf({ footer: false })).displayHeaderFooter).toBe(false)
    expect(buildPrintToPDFOptions(pdf({ footer: false })).footerTemplate).not.toContain('pageNumber')
  })

  it('页眉模板永远是空的（留空会触发 Chromium 的默认页眉：标题 + 日期）', () => {
    for (const footer of [true, false]) {
      const template = buildPrintToPDFOptions(pdf({ footer })).headerTemplate!
      expect(template).not.toContain('pageNumber')
      expect(template).not.toContain('title')
    }
  })

  it('preferCSSPageSize 恒为 false（几何只由本函数的参数决定）', () => {
    expect(buildPrintToPDFOptions(pdf()).preferCSSPageSize).toBe(false)
  })
})

describe('页脚模板', () => {
  it('含页码与总页数两个占位符', () => {
    expect(FOOTER_TEMPLATE).toContain('class="pageNumber"')
    expect(FOOTER_TEMPLATE).toContain('class="totalPages"')
  })

  it('显式给了 font-size（不给就是 0px，页码「不显示」的根因）', () => {
    expect(FOOTER_TEMPLATE).toMatch(/font-size:\s*\d+px/)
  })

  it('给了左右内边距，免得页码贴到纸边被裁掉', () => {
    expect(FOOTER_TEMPLATE).toMatch(/padding:[^;]*\d/)
  })

  it('用 flex 把页码顶到右侧，而不是居中', () => {
    expect(FOOTER_TEMPLATE).toContain('justify-content:space-between')
  })
})

describe('buildPrintOptions', () => {
  it('边距按**像素**换算，且声明 marginType:custom（否则 top/left 被忽略）', () => {
    const margins = buildPrintOptions(pdf({ margin: { top: 25.4, right: 0, bottom: 25.4, left: 0 } }))
      .margins!
    // 逐项 toBeCloseTo 而不是 toEqual：这是浮点换算（25.4*96/25.4 = 95.99999999999999），
    // 差在最后一位上不该让测试红。**这里断言的是量级**——写成英寸的话 25.4 会得到 1。
    expect(margins.marginType).toBe('custom')
    expect(margins.top).toBeCloseTo(96, 6)
    expect(margins.bottom).toBeCloseTo(96, 6)
    expect(margins.left).toBe(0)
    expect(margins.right).toBe(0)
  })

  it('不静默打印（Ctrl+P 要弹系统对话框）', () => {
    expect(buildPrintOptions(pdf()).silent).toBe(false)
  })

  it('纸张与方向与 PDF 导出保持同一套设置', () => {
    const options = buildPrintOptions(pdf({ pageSize: 'Letter', landscape: true }))
    expect(options.pageSize).toBe('Letter')
    expect(options.landscape).toBe(true)
  })

  it('不注入自定义页眉页脚（那是系统打印对话框自己的选项）', () => {
    const options = buildPrintOptions(pdf({ footer: true }))
    expect(options.header).toBeUndefined()
    expect(options.footer).toBeUndefined()
  })
})

describe('effectivePrintTheme', () => {
  it('打印背景时沿用用户选的主题', () => {
    expect(effectivePrintTheme('dark', true)).toBe('dark')
    expect(effectivePrintTheme('light', true)).toBe('light')
  })

  it('不打印背景时强制亮色（否则白纸上是浅灰字，几乎看不见）', () => {
    expect(effectivePrintTheme('dark', false)).toBe('light')
    expect(effectivePrintTheme('light', false)).toBe('light')
  })
})
