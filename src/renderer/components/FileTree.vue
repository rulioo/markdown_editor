<script setup lang="ts">
import { useWorkspaceStore } from '../stores/workspace'
import FileTreeNode from './FileTreeNode.vue'

const workspace = useWorkspaceStore()

function chooseFolder(): void {
  void (async () => {
    const result = await window.api.dialog.openFolder()
    if (result.canceled || !result.path) return
    await workspace.openFolder(result.path)
  })()
}
</script>

<template>
  <div>
    <template v-if="workspace.hasWorkspace">
      <div class="sidebar__section-title" :title="workspace.rootPath ?? ''">
        {{ workspace.rootName }}
      </div>
      <div v-if="workspace.loading" class="sidebar__empty">正在读取…</div>
      <template v-else>
        <FileTreeNode
          v-for="node in workspace.rootNodes"
          :key="node.path"
          :node="node"
          :depth="0"
        />
        <div v-if="workspace.rootNodes.length === 0" class="sidebar__empty">
          该目录下没有 Markdown 文件
        </div>
      </template>
    </template>

    <div v-else class="sidebar__empty">
      <p>尚未打开文件夹</p>
      <button class="status-bar__item--button" @click="chooseFolder">打开文件夹…</button>
    </div>
  </div>
</template>
