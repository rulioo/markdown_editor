/**
 * 崩溃恢复。
 *
 * 只保存「有未保存修改」的文档快照。写入路径与 settings.json 分开，
 * 因为它的写频率高得多（编辑时定期落盘），且损坏了也不该影响用户配置。
 */

import { app } from 'electron'
import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import type { RecoveryPayload } from '@shared/ipc-contract'

/** 超过这个时间的恢复数据视为过期，直接丢弃，避免用户被一周前的残留打扰 */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

function recoveryPath(): string {
  return join(app.getPath('userData'), 'session-recovery.json')
}

export async function loadRecovery(): Promise<RecoveryPayload | null> {
  try {
    const raw = await fs.readFile(recoveryPath(), 'utf8')
    const parsed = JSON.parse(raw) as RecoveryPayload
    if (parsed?.version !== 1 || !Array.isArray(parsed.documents)) return null

    const fresh = parsed.documents.filter(
      (doc) => Date.now() - (doc.savedAt ?? 0) < MAX_AGE_MS
    )
    return fresh.length > 0 ? { version: 1, documents: fresh } : null
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'ENOENT') {
      console.warn('[recovery] 恢复文件读取失败：', error)
    }
    return null
  }
}

export async function saveRecovery(payload: RecoveryPayload): Promise<void> {
  const target = recoveryPath()
  // 没有任何未保存内容时直接清空，省得下次启动弹无意义的恢复提示
  if (!payload?.documents?.length) {
    await clearRecovery()
    return
  }
  try {
    await fs.mkdir(dirname(target), { recursive: true })
    await fs.writeFile(target, JSON.stringify(payload), 'utf8')
  } catch (error) {
    console.error('[recovery] 恢复文件写入失败：', error)
  }
}

export async function clearRecovery(): Promise<void> {
  try {
    await fs.rm(recoveryPath(), { force: true })
  } catch (error) {
    console.warn('[recovery] 恢复文件清理失败：', error)
  }
}
