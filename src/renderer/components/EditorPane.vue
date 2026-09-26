<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useFilesStore } from '../stores/files'
import { useLayoutStore } from '../stores/layout'
import { setActiveEditor } from '../editor/active'
import { EditorHost, type EditableMode } from '../editor/host'
import PreviewPane from './PreviewPane.vue'

/**
 * 编辑区。
 *
 * 组件本身只管三件事：把 CM6 挂到 DOM 上、跟着 store 切标签、跟着设置切模式。
 * 所有编辑逻辑都在 editor/ 下，这里不碰文档内容。
 */

const files = useFilesStore()
const layout = useLayoutStore()

const hostEl = ref<HTMLElement | null>(null)

const host = new EditorHost({
  // 这两个回调每次键入都会调用，必须保持廉价
  onDocChange: (id, content) => files.updateContent(id, content),
  onViewState: (id, state) => files.updateViewState(id, state)
})

const mode = computed(() => layout.mode)
/** 编辑器的两种形态；split / preview 下编辑器依然存在，只是被隐藏 */
const editableMode = computed<EditableMode>(() => (mode.value === 'source' ? 'source' : 'live'))
const hasSession = computed(() => files.activeSession !== null)
const showEditor = computed(() => hasSession.value && mode.value !== 'preview')
const showPreview = computed(
  () => hasSession.value && (mode.value === 'split' || mode.value === 'preview')
)

/* ------------------------------ 标签切换 ------------------------------ */

watch(
  () => files.activeId,
  () => {
    const session = files.activeSession
    if (!session) return
    host.open(session.id, session.content, {
      cursorLine: session.cursorLine,
      cursorCol: session.cursorCol,
      scrollTop: session.scrollTop
    })
  }
)

/** 标签关闭后丢弃其编辑器状态（撤销历史、光标），避免内存只增不减 */
let knownIds = new Set<string>()
watch(
  () => files.sessions.map((s) => s.id),
  (ids) => {
    const alive = new Set(ids)
    for (const id of knownIds) {
      if (!alive.has(id)) host.drop(id)
    }
    knownIds = alive
  },
  { immediate: true, deep: true }
)

/** 磁盘内容整体替换了当前文档（重新载入）→ 重建编辑器文档 */
watch(
  () => files.activeSession?.revision,
  () => {
    const session = files.activeSession
    if (session) host.reset(session.id, session.content)
  }
)

/* -------------------------------- 模式 -------------------------------- */

watch(
  editableMode,
  async (next) => {
    host.setMode(next)
    // 从隐藏状态恢复时 CM6 需要重新测量，否则光标与滚动位置都不准
    await nextTick()
    host.editorView?.requestMeasure()
  },
  { immediate: true }
)

/* ------------------------------ 外部跳转 ------------------------------ */

/**
 * 大纲 / 搜索面板点击后跳转。
 * 事件契约：`line` 为 **1 起算** 的行号（与状态栏显示一致），`column` 为 0 起算的列偏移。
 */
function onJumpEvent(event: Event): void {
  const detail = (event as CustomEvent<{ line: number; column?: number }>).detail
  if (!detail) return
  host.jumpTo(detail.line, detail.column ?? 0)
}

/* ------------------------------ 生命周期 ------------------------------ */

onMounted(() => {
  if (hostEl.value) host.mount(hostEl.value)
  setActiveEditor(host)
  window.addEventListener('outline:jump', onJumpEvent)

  // 挂载时 activeId 可能已经有值（恢复了上次的会话），主动同步一次
  const session = files.activeSession
  if (session) {
    host.open(session.id, session.content, {
      cursorLine: session.cursorLine,
      cursorCol: session.cursorCol,
      scrollTop: session.scrollTop
    })
  }
})

onUnmounted(() => {
  window.removeEventListener('outline:jump', onJumpEvent)
  setActiveEditor(null)
  host.unmount()
})
</script>

<template>
  <section class="editor-pane" :class="`editor-pane--${mode}`">
    <div
      v-show="showEditor"
      ref="hostEl"
      class="editor-pane__host"
      :class="editableMode === 'source' ? 'editor-pane__host--source' : 'editor-pane__host--live'"
    />

    <PreviewPane v-if="showPreview" />

    <div v-if="!hasSession" class="editor-pane__placeholder">
      <p>没有打开的文档</p>
      <p>
        按 <kbd>Ctrl</kbd> + <kbd>N</kbd> 新建，或 <kbd>Ctrl</kbd> + <kbd>O</kbd> 打开文件
      </p>
      <p style="font-size: 12px">菜单栏「文件」下也有全部操作</p>
    </div>
  </section>
</template>
