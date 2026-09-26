/**
 * 已打开文件的外部修改监听。
 *
 * 注意：fs.watch 在保存一次文件时通常会触发**多次**事件（编辑器先写临时文件再 rename），
 * 且 Windows 上的事件类型不稳定。因此这里统一做 400ms 去抖，
 * 并且只把「change / unlink」两类语义推给渲染进程，由渲染进程结合自身脏状态决定要不要提示。
 */

import { watch, type FSWatcher } from 'node:fs'
import { BrowserWindow } from 'electron'
import { IPC_PUSH } from '@shared/ipc-contract'
import type { FsChangeEvent } from '@shared/types'

const watchers = new Map<string, FSWatcher>()
const timers = new Map<string, NodeJS.Timeout>()

const DEBOUNCE_MS = 400

function broadcast(filePath: string, event: FsChangeEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    win.webContents.send(IPC_PUSH.FS_CHANGED, { path: filePath, event })
  }
}

export function watchFile(filePath: string): void {
  if (watchers.has(filePath)) return
  try {
    const watcher = watch(filePath, { persistent: false }, (eventType) => {
      const event: FsChangeEvent =
        eventType === 'rename' ? 'rename' : 'change'

      const existing = timers.get(filePath)
      if (existing) clearTimeout(existing)
      timers.set(
        filePath,
        setTimeout(() => {
          timers.delete(filePath)
          broadcast(filePath, event)
        }, DEBOUNCE_MS)
      )
    })

    watcher.on('error', (error) => {
      console.warn(`[watcher] 监听失败，已解除：${filePath}`, error)
      unwatchFile(filePath)
    })

    watchers.set(filePath, watcher)
  } catch (error) {
    // 文件不存在或权限不足时不阻塞打开流程，只是失去外部修改感知能力
    console.warn(`[watcher] 无法监听 ${filePath}：`, error)
  }
}

export function unwatchFile(filePath: string): void {
  const watcher = watchers.get(filePath)
  if (watcher) {
    watcher.close()
    watchers.delete(filePath)
  }
  const timer = timers.get(filePath)
  if (timer) {
    clearTimeout(timer)
    timers.delete(filePath)
  }
}

export function unwatchAll(): void {
  for (const filePath of [...watchers.keys()]) unwatchFile(filePath)
}
