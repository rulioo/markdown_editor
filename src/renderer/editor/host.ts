/**
 * 编辑器宿主：全应用只保留**一个** EditorView，切换标签时换的是 EditorState。
 *
 * 这样做的两个理由：
 *   1. 每个文档的撤销历史天然独立——EditorState 里带着各自的 history，
 *      切回标签后 Ctrl+Z 不会串到别的文件；
 *   2. DOM 只有一个编辑器，切换标签不需要销毁/重建视图，快且不会闪。
 *
 * 内容与视图状态的同步方向是**单向**的：编辑器 → store。
 * store 里的 content 只在「打开文件 / 重新载入」时反向流入编辑器（走 open()），
 * 避免双向绑定带来的回环。
 */

import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete'
import { defaultKeymap, history, historyKeymap, indentWithTab, redo, undo } from '@codemirror/commands'
import { markdown, markdownLanguage, deleteMarkupBackward, insertNewlineContinueMarkup } from '@codemirror/lang-markdown'
import { bracketMatching, indentOnInput } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search'
import { Compartment, EditorSelection, EditorState, type Extension } from '@codemirror/state'
import {
  EditorView,
  crosshairCursor,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  keymap,
  rectangularSelection
} from '@codemirror/view'
import type { EditorMode } from '@shared/types'
import { chinesePhrases } from './i18n'
import { livePreview } from './livePreview'
import { tablePreview } from './tablePreview'
import { editorTheme } from './theme'

export interface ViewStateSnapshot {
  cursorLine: number
  cursorCol: number
  scrollTop: number
}

export interface EditorHostHandlers {
  /** 文档内容变化（每次键入都会调用，必须保持廉价） */
  onDocChange: (sessionId: string, content: string) => void
  /** 光标或滚动位置变化 */
  onViewState: (sessionId: string, state: ViewStateSnapshot) => void
}

/** 只有 source / live 会用到编辑器实例；split / preview 由外层决定隐藏编辑器 */
export type EditableMode = Extract<EditorMode, 'source' | 'live'>

export class EditorHost {
  private view: EditorView | null = null
  /** 每个标签页的完整编辑器状态，含撤销历史与光标 */
  private states = new Map<string, EditorState>()
  private activeId: string | null = null
  private mode: EditableMode = 'live'

  /** 模式相关扩展单独放进 Compartment，切换模式时只重配这部分，历史不受影响 */
  private readonly modeCompartment = new Compartment()

  constructor(private readonly handlers: EditorHostHandlers) {}

  /* -------------------------------- 生命周期 -------------------------------- */

  mount(parent: HTMLElement): void {
    if (this.view) return
    this.view = new EditorView({
      parent,
      state: EditorState.create({ doc: '', extensions: this.baseExtensions() })
    })
  }

  unmount(): void {
    this.view?.destroy()
    this.view = null
    this.states.clear()
    this.activeId = null
  }

  get editorView(): EditorView | null {
    return this.view
  }

  get currentSessionId(): string | null {
    return this.activeId
  }

  /* -------------------------------- 标签切换 -------------------------------- */

  /**
   * 切换到指定文档。
   * 已打开过的文档会连同撤销历史、光标位置一起恢复。
   */
  open(sessionId: string, content: string, viewState?: ViewStateSnapshot): void {
    const view = this.view
    if (!view) return
    if (this.activeId === sessionId) return

    // 先把当前文档的状态存回去，再换下一个
    if (this.activeId) this.states.set(this.activeId, view.state)

    this.activeId = sessionId
    const restored = this.states.get(sessionId)
    if (restored) {
      view.setState(restored)
    } else {
      this.states.set(
        sessionId,
        EditorState.create({ doc: content, extensions: this.baseExtensions() })
      )
      view.setState(this.states.get(sessionId)!)
    }

    // 存入的状态可能带着旧的模式配置，重新应用一次
    this.applyMode()

    const scrollTop = viewState?.scrollTop ?? 0
    // 等 CM6 完成一次布局再设 scrollTop，否则会被随后的测量覆盖
    requestAnimationFrame(() => {
      if (this.view === view && !view.scrollDOM.isConnected) return
      view.scrollDOM.scrollTop = scrollTop
    })
  }

  /** 关闭标签时丢弃其编辑器状态，避免内存泄漏 */
  drop(sessionId: string): void {
    this.states.delete(sessionId)
    if (this.activeId === sessionId) this.activeId = null
  }

  /** 文档被外部改动后强制用新内容重建该标签的状态（撤销历史随之清空，这是合理的） */
  reset(sessionId: string, content: string): void {
    const next = EditorState.create({ doc: content, extensions: this.baseExtensions() })
    this.states.set(sessionId, next)
    if (this.activeId === sessionId && this.view) {
      this.view.setState(next)
      this.applyMode()
    }
  }

  /* ---------------------------------- 模式 ---------------------------------- */

  setMode(mode: EditableMode): void {
    if (this.mode === mode) return
    this.mode = mode
    this.applyMode()
  }

  private applyMode(): void {
    this.view?.dispatch({
      effects: this.modeCompartment.reconfigure(this.modeExtensions())
    })
  }

  private modeExtensions(): Extension {
    // 表格的块替换必须由 StateField 直接提供——ViewPlugin 提供块装饰会被 CM6 拒绝
    // （RangeError: Block decorations may not be specified via plugins），详见 tablePreview.ts
    return [editorTheme(this.mode), this.mode === 'live' ? [livePreview, tablePreview] : []]
  }

  /* --------------------------------- 状态读写 --------------------------------- */

  /** 把当前光标行列与滚动位置读出来，交给 store 保存 */
  snapshot(): ViewStateSnapshot | null {
    const view = this.view
    if (!view) return null
    const head = view.state.selection.main.head
    const line = view.state.doc.lineAt(head)
    return {
      cursorLine: line.number,
      cursorCol: head - line.from + 1,
      scrollTop: view.scrollDOM.scrollTop
    }
  }

  /** 定位到指定行（**1 起算**，与状态栏显示一致），可选列偏移 */
  jumpTo(lineNumber: number, column = 0): void {
    const view = this.view
    if (!view) return
    const number = Math.max(1, Math.min(view.state.doc.lines, lineNumber))
    const line = view.state.doc.line(number)
    const pos = Math.min(line.from + Math.max(0, column), line.to)

    view.dispatch({
      selection: EditorSelection.cursor(pos),
      effects: EditorView.scrollIntoView(pos, { y: 'center' }),
      userEvent: 'select'
    })
    view.focus()
  }

  focus(): void {
    this.view?.focus()
  }

  /* -------------------------------- 撤销 / 全选 -------------------------------- */

  undo(): void {
    if (this.view) undo(this.view)
  }

  redo(): void {
    if (this.view) redo(this.view)
  }

  selectAll(): void {
    const view = this.view
    if (!view) return
    view.dispatch({
      selection: EditorSelection.range(0, view.state.doc.length),
      userEvent: 'select'
    })
    view.focus()
  }

  /* ---------------------------------- 内部 ---------------------------------- */

  private baseExtensions(): Extension[] {
    return [
      chinesePhrases,
      history(),
      drawSelection(),
      dropCursor(),
      EditorState.allowMultipleSelections.of(true),
      indentOnInput(),
      bracketMatching(),
      closeBrackets(),
      autocompletion(),
      rectangularSelection(),
      crosshairCursor(),
      highlightActiveLine(),
      highlightSelectionMatches(),
      // 查找面板置于顶部；Ctrl+F 由菜单命令触发 openSearchPanel
      search({ top: true }),
      // markdown 语言支持：codeLanguages 让围栏代码块按语言高亮（按需动态加载）
      markdown({ base: markdownLanguage, codeLanguages: languages }),
      EditorView.lineWrapping,
      // 自定义 keymap 必须排在 defaultKeymap 前面，否则会被默认行为抢先
      keymap.of([
        { key: 'Enter', run: insertNewlineContinueMarkup },
        { key: 'Backspace', run: deleteMarkupBackward },
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...searchKeymap,
        ...historyKeymap,
        ...completionKeymap,
        indentWithTab
      ]),
      this.modeCompartment.of(this.modeExtensions()),
      EditorView.updateListener.of((update) => {
        const id = this.activeId
        if (!id) return
        if (update.docChanged) {
          this.handlers.onDocChange(id, update.state.doc.toString())
        }
        if (update.docChanged || update.selectionSet || update.geometryChanged) {
          const snapshot = this.snapshot()
          if (snapshot) this.handlers.onViewState(id, snapshot)
        }
      })
    ]
  }
}
