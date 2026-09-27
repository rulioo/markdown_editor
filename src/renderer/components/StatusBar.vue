<script setup lang="ts">
import { computed } from 'vue'
import { EOL_LABELS, ENCODING_LABELS } from '@shared/ipc-contract'
import type { TextEncoding } from '@shared/types'
import { useDeferredValue } from '../composables/useDeferredValue'
import { countWords } from '../lib/documentViews'
import { nextTheme, themeLabel } from '../lib/themeSwitch'
import { useFilesStore } from '../stores/files'
import { useLayoutStore } from '../stores/layout'
import { useSettingsStore } from '../stores/settings'

const files = useFilesStore()
const layout = useLayoutStore()
const settings = useSettingsStore()

const session = computed(() => files.activeSession)

// 字符数只是 content.length，O(1)，所以保持实时——状态栏要有个立刻响应的数字
const chars = computed(() => session.value?.content.length ?? 0)

// 字数要正则扫全篇，必须防抖，否则大文档下每次按键都要分配一个巨大的匹配数组
const words = useDeferredValue(
  () => session.value?.content,
  () => countWords(session.value?.content ?? ''),
  { resetKey: () => session.value?.id }
)

const MODE_LABELS: Record<string, string> = {
  source: '源码模式',
  live: '实时预览',
  split: '分栏预览',
  preview: '仅预览'
}

async function pickEncoding(): Promise<void> {
  if (!session.value) return
  // M5 会做成下拉菜单；当前先循环切换到下一个常用编码
  const cycle: TextEncoding[] = ['utf8', 'utf8-bom', 'gbk', 'gb18030', 'big5']
  const index = cycle.indexOf(session.value.encoding)
  const next = cycle[(index + 1) % cycle.length]
  await files.setEncoding(session.value.id, next)
}

async function toggleEol(): Promise<void> {
  if (!session.value) return
  await files.setEol(session.value.id, session.value.eol === 'lf' ? 'crlf' : 'lf')
}

function cycleMode(): void {
  const order = ['source', 'live', 'split', 'preview'] as const
  const index = order.indexOf(layout.mode as (typeof order)[number])
  void layout.setMode(order[(index + 1) % order.length])
}

/**
 * 主题按钮。与上面几个按钮同一套交互：点一下换下一个。
 *
 * 和它们不同的是，这一项**没有文档时也要在**——主题是界面属性，
 * 不该因为一个文件都没打开就没法改。所以它和占位符的 spacer 一起
 * 留在 `v-if="session"` 块外面。
 */
const themeText = computed(() => themeLabel(settings.settings.theme, settings.resolvedTheme))

function cycleTheme(): void {
  void settings.setTheme(nextTheme(settings.settings.theme))
}
</script>

<template>
  <footer class="status-bar">
    <template v-if="session">
      <span class="status-bar__item">
        行 {{ session.cursorLine }}，列 {{ session.cursorCol }}
      </span>
      <span class="status-bar__item">{{ words }} 字</span>
      <span class="status-bar__item">{{ chars }} 字符</span>

      <button
        class="status-bar__item status-bar__item--button"
        title="点击切换编码（保存后生效）"
        @click="pickEncoding"
      >
        {{ ENCODING_LABELS[session.encoding] }}
      </button>
      <button
        class="status-bar__item status-bar__item--button"
        title="点击切换换行符（保存后生效）"
        @click="toggleEol"
      >
        {{ EOL_LABELS[session.eol] }}
      </button>
      <button
        class="status-bar__item status-bar__item--button"
        title="点击切换显示模式"
        @click="cycleMode"
      >
        {{ MODE_LABELS[layout.mode] ?? layout.mode }}
      </button>
      <span class="status-bar__item">{{ layout.fontSize }} px</span>
    </template>

    <template v-else>
      <span class="status-bar__item">就绪</span>
    </template>

    <!-- 主题与 spacer 在 v-if 之外：没有打开的文档时也要能切主题 -->
    <span class="status-bar__spacer" />
    <button
      class="status-bar__item status-bar__item--button"
      title="点击切换主题（浅色 → 深色 → 跟随系统），Ctrl+Shift+D 直接切换日夜"
      @click="cycleTheme"
    >
      {{ themeText }}
    </button>
  </footer>
</template>
