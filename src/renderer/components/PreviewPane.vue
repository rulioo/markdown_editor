<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { useFilesStore } from '../stores/files'
import { renderMarkdown } from '../preview/render'

/**
 * 预览面板（分栏 / 纯预览两种模式共用）。
 *
 * 渲染是 O(n) 的，大文档下每次键入都同步重渲染会卡，所以这里做防抖：
 * 打字停下来 180ms 后才更新一次预览。分栏模式下这比逐字重排的观感更稳。
 */

const PREVIEW_DEBOUNCE_MS = 180

const files = useFilesStore()

const html = ref('')
let timer: ReturnType<typeof setTimeout> | null = null

const source = computed(() => files.activeSession?.content ?? '')

function schedule(content: string): void {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    html.value = renderMarkdown(content)
    timer = null
  }, PREVIEW_DEBOUNCE_MS)
}

// 立即重算一次，避免切换文档时短暂显示上一份内容
watch(
  source,
  (content) => {
    if (!content) {
      if (timer) clearTimeout(timer)
      html.value = ''
      return
    }
    schedule(content)
  },
  { immediate: true }
)

onUnmounted(() => {
  if (timer) clearTimeout(timer)
})
</script>

<template>
  <div class="preview-pane">
    <article v-if="html" class="markdown-body" v-html="html" />
    <div v-else class="preview-pane__empty">这份文档还是空的</div>
  </div>
</template>
