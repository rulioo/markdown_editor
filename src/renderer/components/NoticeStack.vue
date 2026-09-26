<script setup lang="ts">
import { useLayoutStore } from '../stores/layout'

const layout = useLayoutStore()
</script>

<template>
  <div class="notice-stack">
    <div
      v-for="notice in layout.notices"
      :key="notice.id"
      class="notice"
      :class="`notice--${notice.type}`"
      @click="layout.dismissNotice(notice.id)"
    >
      {{ notice.text }}
    </div>
  </div>
</template>
