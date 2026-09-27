/**
 * 导出子系统入口。
 *
 * 三条出口（HTML / PDF / 打印）共用**同一棵 hast**，因此「预览看到的」和
 * 「导出得到的」结构上就是同一个东西（design.md NFR-5）：
 *
 *   markdownToHast → processAssets → sanitizeTree → treeToHtml → buildHtmlDocument
 *
 * 顺序里有两条是承重的：
 *
 *  - **`processAssets` 必须在 `sanitizeTree` 之前**。sanitize 会剥掉 `file:` 协议，
 *    而本地图片在解析阶段就是 `file:` 那一路的；先内联成 `data:image/` 才活得下来。
 *  - **`sanitizeTree` 必须最后**。它是安全边界，跑完之后不能再有东西往树里塞 URL。
 *    这一点对「导出」比对「预览」更要紧：预览的输出只到这个进程的 DOM，
 *    导出的输出会被双击打开、被邮件转发、被当成附件。
 *
 * 实现进度：M3 完成 HTML / PDF / 打印，M4 完成 DOCX。
 */

import { BrowserWindow, dialog } from 'electron'
import { promises as fs } from 'node:fs'
import { basename, dirname, extname } from 'node:path'
import type { ExportFormat, ExportRequest, ExportResult, ExportOptions } from '@shared/types'
import { markdownToHast, treeToHtml } from '@shared/markdown/render'
import { processAssets } from '@shared/markdown/assets'
import { sanitizeTree } from '@shared/markdown/sanitize'
import { APP_TITLE } from '@shared/app-meta'
import { createAssetPort } from './assets'
import { buildHtmlDocument } from './shell'
import { buildPrintOptions, buildPrintToPDFOptions, effectivePrintTheme } from './pdf-options'
import { withPrintWindow } from './render-window'
import type { PrintRequest } from './validate'

const FORMAT_FILTERS: Record<ExportFormat, Electron.FileFilter[]> = {
  html: [{ name: 'HTML 文件', extensions: ['html', 'htm'] }],
  pdf: [{ name: 'PDF 文件', extensions: ['pdf'] }],
  docx: [{ name: 'Word 文档', extensions: ['docx'] }]
}

const FORMAT_TITLES: Record<ExportFormat, string> = {
  html: '导出为 HTML',
  pdf: '导出为 PDF',
  docx: '导出为 DOCX'
}

/** 弹出导出目标路径选择对话框 */
export async function pickExportTarget(
  win: BrowserWindow | null,
  format: ExportFormat,
  defaultPath?: string
): Promise<{ canceled: boolean; path: string | null }> {
  const options: Electron.SaveDialogOptions = {
    title: FORMAT_TITLES[format] ?? '导出',
    defaultPath,
    filters: FORMAT_FILTERS[format] ?? []
  }
  const result = win
    ? await dialog.showSaveDialog(win, options)
    : await dialog.showSaveDialog(options)
  return { canceled: result.canceled, path: result.filePath ?? null }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * 是否把图片内联成 `data:`。
 *
 * HTML 导出尊重用户的选择（对话框里有开关）；**PDF 与打印强制内联**。
 * 理由：这两条出口把 HTML 写进 `%TEMP%` 再用隐藏窗口加载，页面里的相对路径
 * 会以临时目录为基准解析，指向文档旁边的图片必然失败。而绝对化成 `file:///`
 * 是走不通的——`file:` 会被最后的 `sanitizeTree` 剥掉（见 `assets.ts` 的头注释）。
 * 内联是唯一既安全又能让图片出现在 PDF 里的做法，所以这里不提供开关。
 */
function shouldEmbedImages(format: ExportFormat, options: ExportOptions): boolean {
  return format === 'pdf' || options.embedImages
}

interface DocumentInput {
  markdown: string
  docPath: string | null
  title: string
  options: ExportOptions
  embedImages: boolean
}

/** 把 Markdown 变成一份完整的、自包含的 HTML 文档 */
async function renderDocument(input: DocumentInput): Promise<string> {
  const tree = markdownToHast(input.markdown, input.options.includeToc)

  const report = await processAssets(tree, {
    port: createAssetPort(input.docPath ? dirname(input.docPath) : null),
    embedImages: input.embedImages
  })

  sanitizeTree(tree)

  if (report.missing.length > 0) {
    // 静默吞掉就等于「用户以为导出了带图的文档，实际少了图」。
    // 这里只记主进程日志：ExportResult 没有承载警告的位置，
    // 而把它塞进 error 会把「导出成功但缺 2 张图」谎报成失败。
    console.warn(`[导出] 有 ${report.missing.length} 张图片读不到，已从产物中略过：`, report.missing)
  }

  return buildHtmlDocument({
    title: input.title,
    bodyHtml: treeToHtml(tree),
    // 暗色 + 不打印背景 = 白纸上的浅灰字（见 pdf-options.ts 的说明）
    theme: effectivePrintTheme(input.options.theme, input.options.pdf.printBackground)
  })
}

/** 标题优先用显式传入的，否则从目标文件名推，最后兜底到应用名 */
function resolveTitle(title: string | undefined, targetPath: string | null): string {
  if (title) return title
  if (!targetPath) return APP_TITLE
  const name = basename(targetPath, extname(targetPath)).trim()
  return name || APP_TITLE
}

export async function exportRun(request: ExportRequest): Promise<ExportResult> {
  const { format, markdown, targetPath, docPath, options } = request

  if (format === 'docx') {
    return { ok: false, error: '导出 DOCX 功能尚未实现（计划在 M4 完成）' }
  }

  try {
    const html = await renderDocument({
      markdown,
      docPath,
      title: resolveTitle(request.title, targetPath),
      options,
      embedImages: shouldEmbedImages(format, options)
    })

    if (format === 'html') {
      await fs.writeFile(targetPath, html, 'utf8')
      return { ok: true, path: targetPath }
    }

    const pdf = await withPrintWindow(html, (win) =>
      win.webContents.printToPDF(buildPrintToPDFOptions(options.pdf))
    )
    await fs.writeFile(targetPath, pdf)
    return { ok: true, path: targetPath }
  } catch (error) {
    return { ok: false, error: `导出失败：${messageOf(error)}` }
  }
}

/**
 * Ctrl+P：把文档渲染成页面后调起**系统打印对话框**。
 *
 * 与 PDF 导出的唯一差别在最后一步——同样的 HTML、同样的隐藏窗口，
 * 只是把 `printToPDF` 换成 `print`。页码也交给系统对话框自己的「页眉页脚」选项，
 * 不注入模板（见 `pdf-options.ts`）。
 *
 * 「用户点了取消」不是错误，用 `canceled` 与真失败区分开：调用方据此决定
 * 弹不弹错误框。Chromium 给的 `failureReason` 是英文短语（"Print job canceled"），
 * 所以只能靠模式匹配——匹配不上的一律当失败处理。
 */
export async function printDocument(request: PrintRequest): Promise<ExportResult> {
  const { markdown, docPath, options } = request

  try {
    const html = await renderDocument({
      markdown,
      docPath,
      title: resolveTitle(request.title, null),
      options,
      // 同 PDF：隐藏窗口里的相对路径解析不了，只能内联
      embedImages: true
    })

    let failureReason: string | undefined
    await withPrintWindow(
      html,
      (win) =>
        new Promise<void>((resolve) => {
          win.webContents.print(buildPrintOptions(options.pdf), (success, reason) => {
            if (!success) failureReason = reason
            resolve()
          })
        })
    )

    if (failureReason && /cancel/i.test(failureReason)) return { ok: false, canceled: true }
    if (failureReason) return { ok: false, error: `打印失败：${failureReason}` }
    return { ok: true }
  } catch (error) {
    return { ok: false, error: `打印失败：${messageOf(error)}` }
  }
}
