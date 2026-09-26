/**
 * 导出子系统入口。
 *
 * 三条流水线（HTML / PDF / DOCX）共用同一棵 mdast，
 * 保证「预览看到的」和「导出得到的」一致（design.md NFR-5）。
 *
 * 实现进度：M3 完成 HTML 与 PDF，M4 完成 DOCX。
 */

import { BrowserWindow, dialog } from 'electron'
import type { ExportFormat, ExportRequest, ExportResult } from '@shared/types'

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

export async function exportRun(request: ExportRequest): Promise<ExportResult> {
  // M3 / M4 实现；此处先返回可读的中文提示，便于 M0 阶段跑通菜单链路
  return {
    ok: false,
    error: `导出 ${request?.format?.toUpperCase() ?? ''} 功能尚未实现（计划在 M3/M4 完成）`
  }
}
