<script setup lang="ts">
import { computed, ref } from 'vue'
import { useDeferredValue } from '../composables/useDeferredValue'
import { findMatches, MAX_SEARCH_MATCHES, type SearchMatch } from '../lib/documentViews'
import { useFilesStore } from '../stores/files'

const files = useFilesStore()

const keyword = ref('')
const caseSensitive = ref(false)

/**
 * 当前文档内查找。
 * 工作区级全文检索需要主进程提供递归扫描接口，排在 M2。
 *
 * 要同时盯 keyword 和文档内容：在搜索框里连续输入时同样不该每敲一下都全扫一遍。
 */
const matches = useDeferredValue<SearchMatch[]>(
  () => [keyword.value, caseSensitive.value, files.activeSession?.content],
  () => findMatches(files.activeSession?.content ?? '', keyword.value, caseSensitive.value),
  { resetKey: () => files.activeSession?.id, delayMs: 150 }
)

const truncated = computed(() => matches.value.length >= MAX_SEARCH_MATCHES)

function jumpTo(match: SearchMatch): void {
  window.dispatchEvent(
    new CustomEvent('outline:jump', { detail: { line: match.line, column: match.column } })
  )
}
</script>

<template>
  <div>
    <div style="padding: 8px">
      <input
        v-model="keyword"
        type="search"
        placeholder="在当前文档中查找…"
        style="width: 100%"
      />
      <label
        style="display: flex; align-items: center; gap: 4px; margin-top: 6px; font-size: 12px; color: var(--fg-muted)"
      >
        <input v-model="caseSensitive" type="checkbox" style="width: auto" />
        区分大小写
      </label>
    </div>

    <div v-if="!keyword" class="sidebar__empty">输入关键字以查找</div>
    <div v-else-if="matches.length === 0" class="sidebar__empty">没有找到匹配项</div>
    <template v-else>
      <div class="sidebar__section-title">
        {{ matches.length }} 处匹配{{ truncated ? '（已截断）' : '' }}
      </div>
      <button
        v-for="(match, index) in matches"
        :key="index"
        class="outline-item"
        :title="`第 ${match.line} 行`"
        @click="jumpTo(match)"
      >
        <span style="color: var(--fg-subtle)">{{ match.line }}:</span> {{ match.preview }}
      </button>
    </template>
  </div>
</template>
