<script setup lang="ts">
import { ref } from 'vue'
import { useLayoutStore } from '../stores/layout'
import FileTree from './FileTree.vue'
import Outline from './Outline.vue'
import SearchPanel from './SearchPanel.vue'

const layout = useLayoutStore()

/**
 * 拖拽期间用本地宽度即时反馈，松手才落盘。
 * 否则 mousemove 每次都走一次 IPC + 配置写入，拖起来会明显发涩。
 */
const dragWidth = ref<number | null>(null)

function startResize(event: MouseEvent): void {
  event.preventDefault()
  const startX = event.clientX
  const startWidth = layout.sidebarWidth
  dragWidth.value = startWidth

  const onMove = (e: MouseEvent): void => {
    dragWidth.value = Math.min(480, Math.max(200, startWidth + (e.clientX - startX)))
  }

  const onUp = (): void => {
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
    if (dragWidth.value !== null) void layout.setSidebarWidth(dragWidth.value)
    dragWidth.value = null
  }

  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
}
</script>

<template>
  <aside class="sidebar" :style="{ width: `${dragWidth ?? layout.sidebarWidth}px` }">
    <div class="sidebar__tabs">
      <button
        class="sidebar__tab"
        :class="{ 'sidebar__tab--active': layout.sidebarTab === 'files' }"
        title="文件树"
        @click="layout.setSidebarTab('files')"
      >
        文件
      </button>
      <button
        class="sidebar__tab"
        :class="{ 'sidebar__tab--active': layout.sidebarTab === 'outline' }"
        title="大纲"
        @click="layout.setSidebarTab('outline')"
      >
        大纲
      </button>
      <button
        class="sidebar__tab"
        :class="{ 'sidebar__tab--active': layout.sidebarTab === 'search' }"
        title="搜索"
        @click="layout.setSidebarTab('search')"
      >
        搜索
      </button>
    </div>

    <div class="sidebar__content">
      <FileTree v-if="layout.sidebarTab === 'files'" />
      <Outline v-else-if="layout.sidebarTab === 'outline'" />
      <SearchPanel v-else />
    </div>

    <div class="sidebar__resizer" @mousedown="startResize" />
  </aside>
</template>
