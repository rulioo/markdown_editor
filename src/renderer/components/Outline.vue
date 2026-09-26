<script setup lang="ts">
import { useDeferredValue } from '../composables/useDeferredValue'
import { extractHeadings, type Heading } from '../lib/documentViews'
import { useFilesStore } from '../stores/files'

const files = useFilesStore()

// 遍历整篇文档，必须防抖——否则大文档下每敲一个字都要重扫一遍
const headings = useDeferredValue<Heading[]>(
  () => files.activeSession?.content,
  () => extractHeadings(files.activeSession?.content ?? ''),
  { resetKey: () => files.activeSession?.id }
)

function jumpTo(heading: Heading): void {
  window.dispatchEvent(new CustomEvent('outline:jump', { detail: { line: heading.line } }))
}
</script>

<template>
  <div>
    <div v-if="headings.length === 0" class="sidebar__empty">当前文档没有标题</div>
    <button
      v-for="(heading, index) in headings"
      :key="`${heading.line}-${index}`"
      class="outline-item"
      :style="{ paddingLeft: `${(heading.level - 1) * 12 + 12}px` }"
      :title="heading.text"
      @click="jumpTo(heading)"
    >
      {{ heading.text }}
    </button>
  </div>
</template>
