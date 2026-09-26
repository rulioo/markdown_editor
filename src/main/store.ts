/**
 * 配置持久化。
 *
 * 刻意不使用 electron-store：v9 之后它是**纯 ESM**，无法被 CJS 的主进程产物 require。
 * 我们需要的只是「userData 下一个 JSON 文件的读写 + 默认值合并」，自己实现约 60 行，
 * 既没有模块格式风险，也少一个依赖。
 */

import { app } from 'electron'
import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import { DEFAULT_SETTINGS, type Settings } from '@shared/types'

const MAX_RECENT_FILES = 20
const WRITE_DEBOUNCE_MS = 300

let cache: Settings | null = null
let writeTimer: NodeJS.Timeout | null = null

function configPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 用默认值补齐缺失字段，并递归合并嵌套对象 */
function mergeDefaults<T>(defaults: T, loaded: unknown): T {
  if (!isPlainObject(defaults) || !isPlainObject(loaded)) {
    return loaded === undefined ? defaults : (loaded as T)
  }
  const out: Record<string, unknown> = { ...defaults }
  for (const [key, value] of Object.entries(loaded)) {
    if (value === undefined) continue
    const fallback = (defaults as Record<string, unknown>)[key]
    out[key] =
      isPlainObject(fallback) && isPlainObject(value)
        ? mergeDefaults(fallback, value)
        : value
  }
  return out as T
}

/**
 * 去掉 JSON 文本开头的 BOM。
 *
 * 本应用写配置时是不带 BOM 的，但用户完全可能用记事本或 PowerShell 的
 * `Out-File -Encoding utf8` 打开改一下——它们**默认会写 BOM**，
 * 而 JSON.parse 见到 BOM 会直接抛错。结果是「改了一个字段，所有设置全丢了」，
 * 而且只在控制台留一行警告，用户根本不知道为什么。
 * 文档读取那边本来就支持 utf8-bom 编码，配置这边没理由更严格。
 */
function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

/** 读取配置；文件不存在或损坏时回落到默认值（绝不因配置问题阻塞启动） */
export async function loadSettings(): Promise<Settings> {
  if (cache) return cache
  try {
    const raw = await fs.readFile(configPath(), 'utf8')
    cache = mergeDefaults(DEFAULT_SETTINGS, JSON.parse(stripBom(raw)))
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'ENOENT') {
      console.warn('[store] 配置文件读取失败，已回落到默认配置：', error)
    }
    cache = { ...DEFAULT_SETTINGS }
  }
  return cache
}

/** 同步取当前配置（调用前须确保 loadSettings 已执行） */
export function getSettings(): Settings {
  if (!cache) {
    throw new Error('settings 尚未加载，请先调用 loadSettings()')
  }
  return cache
}

async function flush(): Promise<void> {
  if (!cache) return
  const target = configPath()
  const tmp = `${target}.tmp`
  const data = JSON.stringify(cache, null, 2)
  try {
    await fs.mkdir(dirname(target), { recursive: true })
    // 原子写：先写临时文件再重命名，避免写一半崩溃导致配置损坏
    await fs.writeFile(tmp, data, 'utf8')
    await fs.rename(tmp, target)
  } catch (error) {
    console.error('[store] 配置写入失败：', error)
  }
}

/** 合并并持久化配置（写入做了 300ms 防抖，窗口拖拽时不会疯狂落盘） */
export async function setSettings(patch: Partial<Settings>): Promise<Settings> {
  const current = await loadSettings()
  cache = mergeDefaults(current, patch)
  scheduleWrite()
  return cache
}

function scheduleWrite(): void {
  if (writeTimer) clearTimeout(writeTimer)
  writeTimer = setTimeout(() => {
    writeTimer = null
    void flush()
  }, WRITE_DEBOUNCE_MS)
}

/** 退出前调用，确保防抖中的写入落盘 */
export async function flushSettings(): Promise<void> {
  if (writeTimer) {
    clearTimeout(writeTimer)
    writeTimer = null
  }
  await flush()
}

/* ------------------------------- 最近文件 ------------------------------- */

export async function addRecentFile(filePath: string): Promise<string[]> {
  const current = await loadSettings()
  const next = [filePath, ...current.recentFiles.filter((p) => p !== filePath)].slice(
    0,
    MAX_RECENT_FILES
  )
  await setSettings({ recentFiles: next })
  return next
}

export async function clearRecentFiles(): Promise<string[]> {
  await setSettings({ recentFiles: [] })
  return []
}
