import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { Eol, TextEncoding } from '@shared/types'
import { useLayoutStore } from './layout'

export interface FileSession {
  id: string
  /** null 表示尚未保存的新文档 */
  filePath: string | null
  name: string
  /** 编辑器当前内容（LF 换行） */
  content: string
  /** 磁盘上的内容，用于脏检查 */
  savedContent: string
  encoding: TextEncoding
  eol: Eol
  mtimeMs: number
  readOnly: boolean
  /* 视图状态：切换标签时用于恢复，M1 接入 CodeMirror 后由编辑器回写 */
  cursorLine: number
  cursorCol: number
  scrollTop: number
  /**
   * 内容被**编辑器之外**的来源整体替换时自增（重新载入磁盘内容、外部改动）。
   *
   * 编辑器 → store 的同步是单向的，所以必须有一个显式信号告诉编辑器
   * 「这次 content 变化不是你打的，请重建文档」。靠比对字符串做不到——
   * 用户完全可能手动把内容改回原样。
   */
  revision: number
}

const MD_FILTERS = [
  { name: 'Markdown 文件', extensions: ['md', 'markdown', 'mdown', 'mkd'] },
  { name: '文本文件', extensions: ['txt'] },
  { name: '所有文件', extensions: ['*'] }
]

let sessionSeq = 0
let untitledSeq = 0

/** Windows 路径大小写不敏感，比较前统一规范化 */
function normalizePath(p: string): string {
  const unified = p.replace(/\\/g, '/')
  return /^[a-zA-Z]:/.test(unified) ? unified.toLowerCase() : unified
}

export function baseName(p: string): string {
  return p.split(/[\\/]/).pop() ?? p
}

export function dirName(p: string): string {
  const unified = p.replace(/\\/g, '/')
  const idx = unified.lastIndexOf('/')
  return idx <= 0 ? unified : unified.slice(0, idx)
}

export const useFilesStore = defineStore('files', () => {
  const layout = useLayoutStore()

  const sessions = ref<FileSession[]>([])
  const activeId = ref<string | null>(null)

  const activeSession = computed<FileSession | null>(
    () => sessions.value.find((s) => s.id === activeId.value) ?? null
  )

  const isDirty = (session: FileSession): boolean => session.content !== session.savedContent

  const dirtySessions = computed(() => sessions.value.filter(isDirty))
  const hasDirty = computed(() => dirtySessions.value.length > 0)

  function find(id: string | null): FileSession | null {
    if (!id) return null
    return sessions.value.find((s) => s.id === id) ?? null
  }

  function findByPath(filePath: string): FileSession | null {
    const target = normalizePath(filePath)
    return sessions.value.find((s) => s.filePath && normalizePath(s.filePath) === target) ?? null
  }

  /* ------------------------------ 新建 / 打开 ------------------------------ */

  function newFile(activate = true): FileSession {
    untitledSeq += 1
    const session: FileSession = {
      id: `s${++sessionSeq}`,
      filePath: null,
      name: `未命名-${untitledSeq}.md`,
      content: '',
      savedContent: '',
      encoding: 'utf8',
      eol: 'lf',
      mtimeMs: 0,
      readOnly: false,
      cursorLine: 1,
      cursorCol: 1,
      scrollTop: 0,
      revision: 0
    }
    sessions.value = [...sessions.value, session]
    if (activate) activeId.value = session.id
    return session
  }

  /**
   * 打开文件。已打开的文件不重复读取，只激活对应标签。
   * 返回 null 表示打开失败（调用方据此决定是否更新工作区）。
   */
  async function openPath(filePath: string, activate = true): Promise<FileSession | null> {
    const existing = findByPath(filePath)
    if (existing) {
      if (activate) activeId.value = existing.id
      return existing
    }

    try {
      const stat = await window.api.fs.stat(filePath)
      if (!stat.exists) {
        layout.notify(`文件不存在：${baseName(filePath)}`, 'error')
        return null
      }
      if (stat.isDirectory) {
        layout.notify('这是一个文件夹，请使用「打开文件夹」', 'error')
        return null
      }

      const result = await window.api.fs.readFile(filePath)
      const session: FileSession = {
        id: `s${++sessionSeq}`,
        filePath,
        name: baseName(filePath),
        content: result.content,
        savedContent: result.content,
        encoding: result.encoding,
        eol: result.eol,
        mtimeMs: result.mtimeMs,
        readOnly: false,
        cursorLine: 1,
        cursorCol: 1,
        scrollTop: 0,
        revision: 0
      }

      sessions.value = [...sessions.value, session]
      if (activate) activeId.value = session.id

      await window.api.fs.watch({ path: filePath })
      await window.api.recent.add(filePath)
      return session
    } catch (error) {
      layout.notify(`打开失败：${(error as Error).message}`, 'error')
      return null
    }
  }

  /**
   * 从**外部**打开一批文档：对话框、命令行参数、最近文件、二次启动推送——
   * 全都汇到这里。打开后把侧边栏切到「大纲」，因为刚载入一篇文档时想看的是它。
   *
   * 判据是这个函数的**复数**：在文件树里点来点去走的是上面的 `openPath`（单数），
   * 那是在浏览文件，不该把页签从「文件」抢走。所以这条行为写在这里而不是两个
   * 调用点各写一遍，将来多一条外部入口（例如拖放）也自动适用。
   *
   * 一个都没打开成功时**不动**侧边栏：文件不存在时提示已经给了，再顺手改掉
   * 用户的页签就是纯粹的多余动作。
   */
  async function openPaths(paths: string[]): Promise<void> {
    let last: FileSession | null = null
    for (const p of paths) {
      const session = await openPath(p, false)
      if (session) last = session
    }
    // 多选打开时只激活最后一个，避免标签顺序错乱
    if (!last) return
    activeId.value = last.id
    await layout.showOutline()
  }

  /* -------------------------------- 保存 -------------------------------- */

  async function save(id?: string): Promise<boolean> {
    const session = find(id ?? activeId.value)
    if (!session) return false
    if (!session.filePath) return saveAs(session.id)

    try {
      const result = await window.api.fs.writeFile({
        path: session.filePath,
        content: session.content,
        encoding: session.encoding,
        eol: session.eol
      })
      session.savedContent = session.content
      session.mtimeMs = result.mtimeMs
      layout.notify('已保存', 'success')
      return true
    } catch (error) {
      layout.notify(`保存失败：${(error as Error).message}`, 'error')
      return false
    }
  }

  async function saveAs(id?: string): Promise<boolean> {
    const session = find(id ?? activeId.value)
    if (!session) return false

    const target = await window.api.dialog.saveAs({
      title: '另存为',
      defaultPath: session.filePath ?? session.name,
      filters: MD_FILTERS
    })
    if (target.canceled || !target.path) return false

    // 换路径后原文件不再需要监听
    if (session.filePath) await window.api.fs.unwatch({ path: session.filePath })

    try {
      const result = await window.api.fs.writeFile({
        path: target.path,
        content: session.content,
        encoding: session.encoding,
        eol: session.eol
      })
      session.filePath = target.path
      session.name = baseName(target.path)
      session.savedContent = session.content
      session.mtimeMs = result.mtimeMs
      await window.api.fs.watch({ path: target.path })
      await window.api.recent.add(target.path)
      layout.notify(`已保存到 ${session.name}`, 'success')
      return true
    } catch (error) {
      layout.notify(`保存失败：${(error as Error).message}`, 'error')
      return false
    }
  }

  async function saveAll(): Promise<void> {
    let saved = 0
    for (const session of dirtySessions.value) {
      const ok = await save(session.id)
      // 用户在「另存为」里点了取消，就停止后续保存，避免连环弹窗
      if (!ok) break
      saved += 1
    }
    if (saved > 1) layout.notify(`已保存 ${saved} 个文件`, 'success')
  }

  /* ------------------------------ 关闭标签 ------------------------------ */

  /** 返回 false 表示用户取消了关闭 */
  async function close(id?: string): Promise<boolean> {
    const session = find(id ?? activeId.value)
    if (!session) return true

    if (isDirty(session)) {
      const { response } = await window.api.dialog.message({
        type: 'warning',
        title: '未保存的修改',
        message: `是否保存对「${session.name}」的修改？`,
        detail: '如果不保存，你的修改将会丢失。',
        buttons: ['保存', '不保存', '取消'],
        defaultId: 0,
        cancelId: 2
      })
      if (response === 2) return false
      if (response === 0 && !(await save(session.id))) return false
    }

    if (session.filePath) await window.api.fs.unwatch({ path: session.filePath })

    const index = sessions.value.findIndex((s) => s.id === session.id)
    sessions.value = sessions.value.filter((s) => s.id !== session.id)

    if (activeId.value === session.id) {
      // 关闭后激活相邻标签：优先右边，没有就取左边
      const next = sessions.value[index] ?? sessions.value[index - 1] ?? null
      activeId.value = next?.id ?? null
    }
    return true
  }

  async function closeAll(): Promise<boolean> {
    for (const session of [...sessions.value]) {
      if (!(await close(session.id))) return false
    }
    return true
  }

  /* ------------------------------ 内容与视图 ------------------------------ */

  function updateContent(id: string, content: string): void {
    const session = find(id)
    if (!session || session.content === content) return
    session.content = content
  }

  function updateViewState(
    id: string,
    state: { cursorLine?: number; cursorCol?: number; scrollTop?: number }
  ): void {
    const session = find(id)
    if (!session) return
    if (state.cursorLine !== undefined) session.cursorLine = state.cursorLine
    if (state.cursorCol !== undefined) session.cursorCol = state.cursorCol
    if (state.scrollTop !== undefined) session.scrollTop = state.scrollTop
  }

  async function setEncoding(id: string, encoding: TextEncoding): Promise<void> {
    const session = find(id)
    if (!session) return
    session.encoding = encoding
    layout.notify(`编码已改为 ${encoding}，保存后生效`)
  }

  async function setEol(id: string, eol: Eol): Promise<void> {
    const session = find(id)
    if (!session) return
    session.eol = eol
    layout.notify(`换行符已改为 ${eol === 'crlf' ? 'CRLF' : 'LF'}，保存后生效`)
  }

  function setActive(id: string): void {
    if (find(id)) activeId.value = id
  }

  /* ------------------------------ 外部修改 ------------------------------ */

  /** 外部改动后重新从磁盘加载（丢弃当前编辑内容，调用前须经用户确认） */
  async function reloadFromDisk(id: string): Promise<void> {
    const session = find(id)
    if (!session?.filePath) return
    try {
      const result = await window.api.fs.readFile(session.filePath)
      session.content = result.content
      session.savedContent = result.content
      session.encoding = result.encoding
      session.eol = result.eol
      session.mtimeMs = result.mtimeMs
      // 通知编辑器重建文档（撤销历史随之清空——内容已整体换掉，旧历史没有意义）
      session.revision += 1
      layout.notify('已重新载入磁盘内容', 'success')
    } catch (error) {
      layout.notify(`重新载入失败：${(error as Error).message}`, 'error')
    }
  }

  /** 忽略外部改动：把磁盘内容记为「已知」，后续不再重复提示 */
  function acceptDiskVersion(id: string): void {
    const session = find(id)
    if (!session) return
    session.savedContent = session.content
  }

  return {
    sessions,
    activeId,
    activeSession,
    dirtySessions,
    hasDirty,
    isDirty,
    find,
    findByPath,
    newFile,
    openPath,
    openPaths,
    save,
    saveAs,
    saveAll,
    close,
    closeAll,
    updateContent,
    updateViewState,
    setEncoding,
    setEol,
    setActive,
    reloadFromDisk,
    acceptDiskVersion
  }
})
