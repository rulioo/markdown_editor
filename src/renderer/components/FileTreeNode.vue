<script setup lang="ts">
import { computed } from 'vue'
import type { TreeNode } from '@shared/types'
import { useWorkspaceStore } from '../stores/workspace'
import { useFilesStore } from '../stores/files'

const props = defineProps<{ node: TreeNode; depth: number }>()

const workspace = useWorkspaceStore()
const files = useFilesStore()

const isOpen = computed(() => workspace.expanded[props.node.path] === true)
const children = computed(() => workspace.childrenOf(props.node.path))
const isActive = computed(() => {
  const active = files.activeSession
  return !!active?.filePath && active.filePath === props.node.path
})

function onClick(): void {
  if (props.node.isDirectory) {
    void workspace.toggleExpand(props.node)
  } else {
    void files.openPath(props.node.path)
  }
}
</script>

<template>
  <div>
    <div
      class="tree-node"
      :class="{ 'tree-node--active': isActive }"
      :style="{ paddingLeft: `${depth * 12 + 8}px` }"
      :title="node.path"
      @click="onClick"
    >
      <span class="tree-node__arrow" :class="{ 'tree-node__arrow--open': isOpen }">
        {{ node.isDirectory ? '▶' : '' }}
      </span>
      <span class="tree-node__icon">{{ node.isDirectory ? (isOpen ? '📂' : '📁') : '📄' }}</span>
      <span class="tree-node__name">{{ node.name }}</span>
    </div>

    <!-- 递归渲染子节点；组件通过文件名自引用 -->
    <template v-if="node.isDirectory && isOpen">
      <FileTreeNode
        v-for="child in children"
        :key="child.path"
        :node="child"
        :depth="depth + 1"
      />
      <div
        v-if="children.length === 0"
        class="tree-node"
        :style="{ paddingLeft: `${(depth + 1) * 12 + 8}px`, color: 'var(--fg-subtle)' }"
      >
        （空目录）
      </div>
    </template>
  </div>
</template>
