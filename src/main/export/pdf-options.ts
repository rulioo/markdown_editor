/**
 * `ExportOptions.pdf` → Chromium 打印参数的映射。
 *
 * 这个文件存在的唯一理由：**两个打印 API 用的单位不一样，而且都很容易记错。**
 * 在 `node_modules/electron/electron.d.ts` 里核实过：
 *
 *  - `PrintToPDFOptions.margins`（printToPDF）—— **英寸**（见 PrintToPDFMargins 的注释）
 *  - `WebContentsPrintOptions.margins`（print）—— **像素**，且必须配 `marginType:'custom'`
 *
 * 而对话框与 `ExportOptions` 一律用**毫米**（用户能理解、能对着尺子量）。
 * 两个转换函数都做成具名的，让调用点一眼看出在换算什么。
 *
 * 纯函数，不 import electron（`Electron.*` 是 electron.d.ts 里的全局命名空间，
 * 类型在编译期就被擦除了）。`test/export-boundary.test.ts` 盯着这条边界。
 */

import type { ExportOptions, ResolvedTheme } from '@shared/types'

const MM_PER_INCH = 25.4
/** CSS px 的约定：96 px / inch */
const PX_PER_INCH = 96

/** 毫米 → 英寸（printToPDF 用） */
export function mmToInch(mm: number): number {
  return mm / MM_PER_INCH
}

/** 毫米 → CSS 像素（print 用） */
export function mmToPx96(mm: number): number {
  return (mm * PX_PER_INCH) / MM_PER_INCH
}

/**
 * 页脚模板。
 *
 * `font-size` 与 `padding` 是**必需项不是美化**：Chromium 把这个模板放进一个没有任何
 * CSS 的裸文档里渲染，不给字号的话文字会以 ~0px 画出来——「页码没出现」十有八九是这个。
 * `padding` 要和 printToPDFOptions 的左右边距对齐，否则页码会贴到纸边外被裁掉。
 *
 * 左边留一个空 `<span>` 是为了让 `justify-content: space-between` 把页码顶到右侧，
 * 而不是居中——居中的页码看起来像页眉。
 */
export const FOOTER_TEMPLATE = `<div style="width:100%;font-size:9px;line-height:1.2;color:#666;font-family:'Microsoft YaHei',sans-serif;padding:0 12mm;display:flex;justify-content:space-between;"><span></span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`

/** 页眉模板必须存在但不能有内容，否则 Chromium 会自己塞一个默认页眉（标题 + 日期） */
const EMPTY_TEMPLATE = '<div></div>'

/** 用户在对话框里能填的边距上限（毫米）。超过这个数就不是「边距」而是「排版事故」了 */
export const MAX_MARGIN_MM = 100

/**
 * 求出打印实际使用的主题。
 *
 * **不能直接用用户的主题**：`printBackground:false` 时 Chromium 仍然会应用文字颜色，
 * 但把所有背景丢掉。暗色主题的前景色是 `#d4d4d4`（浅灰），背景丢了之后就是
 * **白纸上的浅灰字**——导出成功、内容全在、但几乎看不见，属于最难排查的一类问题。
 * 所以在「不打印背景」时强制用亮色。
 */
export function effectivePrintTheme(theme: ResolvedTheme, printBackground: boolean): ResolvedTheme {
  return printBackground ? theme : 'light'
}

/** 组装 `webContents.printToPDF()` 的参数 */
export function buildPrintToPDFOptions(
  pdf: ExportOptions['pdf']
): Electron.PrintToPDFOptions {
  return {
    // 枚举值与 Chromium 的纸张名同名，直通即可
    pageSize: pdf.pageSize,
    landscape: pdf.landscape,
    printBackground: pdf.printBackground,
    margins: {
      // ← 英寸。写成毫米的话 A4 会得到一张几乎全是边距的纸
      top: mmToInch(pdf.margin.top),
      bottom: mmToInch(pdf.margin.bottom),
      left: mmToInch(pdf.margin.left),
      right: mmToInch(pdf.margin.right)
    },
    // 几何以本函数的参数为准；留着 CSS 的 @page 只会让来源变得含糊
    preferCSSPageSize: false,
    displayHeaderFooter: pdf.footer,
    headerTemplate: EMPTY_TEMPLATE,
    footerTemplate: pdf.footer ? FOOTER_TEMPLATE : EMPTY_TEMPLATE
  }
}

/**
 * 组装 `webContents.print()` 的参数（系统打印对话框）。
 *
 * 与 printToPDF 的两处差异：
 * - 边距单位是**像素**，且要显式声明 `marginType:'custom'`，否则 top/left 被忽略；
 * - 页码由系统打印对话框自己的「页眉页脚」选项负责，这里**不注入**模板。
 */
export function buildPrintOptions(pdf: ExportOptions['pdf']): Electron.WebContentsPrintOptions {
  return {
    // 要弹系统对话框，不能静默打印
    silent: false,
    printBackground: pdf.printBackground,
    color: true,
    landscape: pdf.landscape,
    pageSize: pdf.pageSize,
    margins: {
      marginType: 'custom',
      top: mmToPx96(pdf.margin.top),
      bottom: mmToPx96(pdf.margin.bottom),
      left: mmToPx96(pdf.margin.left),
      right: mmToPx96(pdf.margin.right)
    }
  }
}
