/// <reference types="vite/client" />

import type { RendererApi } from '@shared/api'

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>
  export default component
}

declare global {
  interface Window {
    /** 由 preload 通过 contextBridge 注入，形状见 shared/api.ts */
    api: RendererApi
  }
}

export {}
