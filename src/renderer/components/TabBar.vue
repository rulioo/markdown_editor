<script setup lang="ts">
import { useFilesStore, type FileSession } from '../stores/files'

const files = useFilesStore()

function activate(session: FileSession): void {
  files.setActive(session.id)
}

function closeTab(session: FileSession, event: MouseEvent): void {
  // 阻止冒泡，否则点关闭会先激活该标签
  event.stopPropagation()
  void files.close(session.id)
}

function newTab(): void {
  files.newFile()
}
</script>

<template>
  <div class="tab-bar">
    <div
      v-for="session in files.sessions"
      :key="session.id"
      class="tab"
      :class="{ 'tab--active': session.id === files.activeId }"
      :title="session.filePath ?? session.name"
      @click="activate(session)"
      @mousedown.middle="closeTab(session, $event)"
    >
      <span class="tab__name">{{ session.name }}</span>
      <!-- 未保存时显示圆点，悬停时换成关闭按钮 -->
      <span v-if="files.isDirty(session)" class="tab__dirty" title="未保存" />
      <button class="tab__close" title="关闭标签页" @click="closeTab(session, $event)">×</button>
    </div>
    <button class="tab-bar__new" title="新建标签页" @click="newTab">+</button>
  </div>
</template>
