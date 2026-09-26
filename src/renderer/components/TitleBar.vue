<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { IPC_PUSH } from '@shared/ipc-contract'
import { APP_TITLE } from '@shared/app-meta'
import { useFilesStore } from '../stores/files'

const files = useFilesStore()
const maximized = ref(false)
let dispose: (() => void) | null = null

// 模板里拿不到 window（Vue 只白名单了 Math/Date 这类全局对象），所以在 setup 里取出来
function minimize(): void {
  void window.api.win.minimize()
}

function toggleMaximize(): void {
  void window.api.win.maximize()
}

function close(): void {
  void window.api.win.close()
}

onMounted(async () => {
  maximized.value = (await window.api.win.getState()).maximized
  dispose = window.api.on(IPC_PUSH.WINDOW_STATE_CHANGED, (state) => {
    maximized.value = state.maximized
  })
})

onUnmounted(() => dispose?.())

const title = computed(() => {
  const session = files.activeSession
  if (!session) return APP_TITLE
  const dirtyMark = files.isDirty(session) ? '● ' : ''
  return `${dirtyMark}${session.name} — ${APP_TITLE}`
})
</script>

<template>
  <header class="title-bar">
    <span class="title-bar__title">{{ title }}</span>
    <div class="title-bar__controls">
      <button class="title-bar__button" title="最小化" @click="minimize">
        <svg width="10" height="10" viewBox="0 0 10 10">
          <path d="M0 5h10" stroke="currentColor" stroke-width="1" />
        </svg>
      </button>
      <button
        class="title-bar__button"
        :title="maximized ? '还原' : '最大化'"
        @click="toggleMaximize"
      >
        <svg width="10" height="10" viewBox="0 0 10 10">
          <rect
            x="0.5"
            y="0.5"
            width="9"
            height="9"
            fill="none"
            stroke="currentColor"
            stroke-width="1"
          />
        </svg>
      </button>
      <button
        class="title-bar__button title-bar__button--close"
        title="关闭"
        @click="close"
      >
        <svg width="10" height="10" viewBox="0 0 10 10">
          <path d="M0 0l10 10M10 0L0 10" stroke="currentColor" stroke-width="1" />
        </svg>
      </button>
    </div>
  </header>
</template>
