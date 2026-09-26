import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { TreeNode } from '@shared/types'
import { useLayoutStore } from './layout'

/**
 * 工作区文件树。
 *
 * 目录内容是**懒加载**的：主进程的 readDir 只返回一层，
 * 展开某个目录时才去读它的子项，避免打开一个大仓库要遍历几万个文件。
 */
export const useWorkspaceStore = defineStore('workspace', () => {
  const layout = useLayoutStore()

  const rootPath = ref<string | null>(null)
  const rootName = ref('')
  const rootNodes = ref<TreeNode[]>([])
  /** 目录路径 → 该目录的子节点（懒加载缓存） */
  const childrenCache = ref<Record<string, TreeNode[]>>({})
  /** 目录路径 → 是否展开 */
  const expanded = ref<Record<string, boolean>>({})
  const loading = ref(false)

  const hasWorkspace = computed(() => rootPath.value !== null)

  async function openFolder(path: string): Promise<void> {
    loading.value = true
    try {
      const nodes = await window.api.fs.readDir(path)
      rootPath.value = path
      rootName.value = path.split(/[\\/]/).filter(Boolean).pop() ?? path
      rootNodes.value = nodes
      // 换工作区时清空旧的展开状态与缓存，避免路径串味
      childrenCache.value = {}
      expanded.value = {}
    } catch (error) {
      layout.notify(`打开文件夹失败：${(error as Error).message}`, 'error')
    } finally {
      loading.value = false
    }
  }

  function closeWorkspace(): void {
    rootPath.value = null
    rootName.value = ''
    rootNodes.value = []
    childrenCache.value = {}
    expanded.value = {}
  }

  function childrenOf(path: string): TreeNode[] {
    return childrenCache.value[path] ?? []
  }

  async function toggleExpand(node: TreeNode): Promise<void> {
    if (!node.isDirectory) return
    if (expanded.value[node.path]) {
      expanded.value = { ...expanded.value, [node.path]: false }
      return
    }
    if (!childrenCache.value[node.path]) {
      try {
        const children = await window.api.fs.readDir(node.path)
        childrenCache.value = { ...childrenCache.value, [node.path]: children }
      } catch (error) {
        layout.notify(`读取目录失败：${(error as Error).message}`, 'error')
        return
      }
    }
    expanded.value = { ...expanded.value, [node.path]: true }
  }

  /** 重新读取根目录，并丢弃所有已缓存的子目录内容 */
  async function refresh(): Promise<void> {
    if (rootPath.value) await openFolder(rootPath.value)
  }

  /** 文件保存/新建后局部刷新所在目录，比整棵树重建便宜得多 */
  async function refreshDir(dirPath: string): Promise<void> {
    try {
      const children = await window.api.fs.readDir(dirPath)
      if (dirPath === rootPath.value) {
        rootNodes.value = children
      } else if (childrenCache.value[dirPath]) {
        childrenCache.value = { ...childrenCache.value, [dirPath]: children }
      }
    } catch {
      // 目录可能已被删除，静默忽略，用户手动刷新即可
    }
  }

  return {
    rootPath,
    rootName,
    rootNodes,
    expanded,
    loading,
    hasWorkspace,
    childrenOf,
    openFolder,
    closeWorkspace,
    toggleExpand,
    refresh,
    refreshDir
  }
})
