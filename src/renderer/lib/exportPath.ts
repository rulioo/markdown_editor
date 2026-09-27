/**
 * 导出目标路径的默认值。
 *
 * 单独成文件是为了可测：这是纯字符串处理，但「.md → .html」这种看似显然的规则
 * 有一堆边角（多个扩展名、大写扩展名、没有扩展名、路径里的点），
 * 而它出错的表现是「默认文件名是 `报告.md.html`」——不致命但很显眼。
 */

import type { ExportFormat } from '@shared/types'

const EXTENSIONS: Record<ExportFormat, string> = {
  html: 'html',
  pdf: 'pdf',
  docx: 'docx'
}

/** 这些扩展名会被替换掉，而不是叠加 */
const REPLACEABLE = /\.(md|markdown|mdown|mkd|txt)$/i

/**
 * 把文档路径换成导出目标的默认路径。
 *
 * - 有源路径：同目录、换扩展名（`E:\a\报告.md` → `E:\a\报告.html`）
 * - 无源路径（未保存文档）：只给文件名，让系统对话框用自己的默认目录
 *
 * 只替换**已知的 Markdown 扩展名**：`v1.2.md` 变成 `v1.2.html` 而不是 `v1.html`，
 * 而 `report` 这种没扩展名的会**补上**而不是替换。
 */
export function defaultExportPath(
  filePath: string | null,
  format: ExportFormat,
  fallbackName: string
): string {
  const extension = EXTENSIONS[format]
  if (!filePath) {
    const base = stripExtension(fallbackName)
    return `${base}.${extension}`
  }
  return `${filePath.replace(REPLACEABLE, '')}.${extension}`
}

/** 去掉结尾的已知扩展名（用于未保存文档的 `未命名-1.md` → `未命名-1`） */
function stripExtension(name: string): string {
  return name.replace(REPLACEABLE, '')
}

/**
 * 导出产物的标题（写进 HTML 的 `<title>` 与 PDF 的文档属性）。
 *
 * 用文件名而不是第一个标题：文件名是用户自己起的，标题可能有一堆。
 * 去掉扩展名，`未命名-1` 之类的名字照原样用。
 */
export function exportTitle(filePath: string | null, fallbackName: string, appTitle: string): string {
  const source = filePath ? (filePath.split(/[\\/]/).pop() ?? filePath) : fallbackName
  const base = stripExtension(source).trim()
  return base || appTitle
}
