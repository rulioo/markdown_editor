<script setup lang="ts">
import TitleBar from './components/TitleBar.vue'
import TabBar from './components/TabBar.vue'
import Sidebar from './components/Sidebar.vue'
import EditorPane from './components/EditorPane.vue'
import StatusBar from './components/StatusBar.vue'
import NoticeStack from './components/NoticeStack.vue'
import ExportDialog from './components/ExportDialog.vue'
import { setupAppWiring } from './app-wiring'
import { useLayoutStore } from './stores/layout'

// 必须在 setup 同步阶段调用：内部的 watch 需要被组件 scope 收集
setupAppWiring()

const layout = useLayoutStore()
</script>

<template>
  <div class="app">
    <TitleBar />
    <div class="app-body">
      <Sidebar v-if="layout.sidebarVisible" />
      <main class="app-main">
        <TabBar />
        <EditorPane />
      </main>
    </div>
    <StatusBar v-if="layout.showStatusBar" />
    <NoticeStack />
    <ExportDialog />
  </div>
</template>
