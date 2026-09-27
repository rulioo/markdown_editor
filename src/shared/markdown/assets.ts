/**
 * 资源内联：把文档里引用的本地图片读成 `data:` URL，让导出的产物成为**单文件**。
 *
 * 为什么走「注入端口」而不是直接 `fs.readFile`：`src/shared/**` 同时被两份 tsconfig
 * 编译（node 与 web），不能 import `node:fs`/`node:path`。所以这里只做**遍历与决策**，
 * 真正的 IO 由主进程注入（`src/main/export/assets.ts` 的 `createAssetPort`）。
 * 好处是这段最容易出错的路径归类逻辑可以脱离文件系统单测。
 *
 * **为什么不做「把相对路径绝对化成 file://」**：本项目的 sanitize 会剥掉 `file:` 协议
 * （这是有意的——导出的 HTML 里一个 `file:` 链接等于给本地文件系统开一个探测器），
 * 而 sanitize 是最后一步。所以绝对化出来的 src 会被自己人删掉，白做。
 * PDF/打印路径改为**强制内联**（见 `src/main/export/index.ts`），
 * 内联产物是 `data:image/...`，本来就在白名单里。
 */

import { visit } from 'unist-util-visit'
import type { Root as HastRoot } from 'hast'

/**
 * 文件系统能力的注入点。实现方负责把「文档里写的那个字符串」变成真实字节，
 * 并且**对任何解析不了的东西返回 null 而不是抛错**（远端图片、不存在的文件、
 * 无权限——这三种在导出时都应该安静降级，而不是让整次导出失败）。
 */
export interface AssetPort {
  /** 解析成本地绝对路径；不是本地文件（远端 / data: / 锚点 / 认不出的协议）返回 null */
  resolveLocal(value: string): string | null
  /** 读成 data: URL；读不到返回 null */
  readAsDataUrl(absPath: string): Promise<string | null>
}

export interface AssetReport {
  /** 成功内联的图片数 */
  inlined: number
  /** 解析到本地文件但读不出来的原值（文件被删/无权限），供调用方提示用户 */
  missing: string[]
}

export interface ProcessAssetsOptions {
  port: AssetPort
  embedImages: boolean
}

/**
 * 就地改写树里的图片 `src`。
 *
 * 只处理 `img` 的 `src`：
 * - 远端图片（http/https/协议相对）与已经是 `data:` 的一律不碰；
 * - 只在内联**失败**时记进 `missing`，其余跳过都是静默的——因为「文档里放了个网络图片」
 *   是合法写法，不该在离线导出时报错。
 */
export async function processAssets(
  tree: HastRoot,
  options: ProcessAssetsOptions
): Promise<AssetReport> {
  const report: AssetReport = { inlined: 0, missing: [] }
  if (!options.embedImages) return report

  /** 收集待处理的 (节点, 绝对路径)，遍历本身保持同步 */
  const pending: Array<{ set: (value: string) => void; original: string; absPath: string }> = []

  visit(tree, 'element', (node) => {
    if (node.tagName !== 'img') return
    const value = node.properties?.src
    if (typeof value !== 'string' || !value.trim()) return

    const absPath = options.port.resolveLocal(value)
    if (!absPath) return

    pending.push({
      set: (next) => {
        node.properties.src = next
      },
      original: value,
      absPath
    })
  })

  for (const item of pending) {
    const dataUrl = await options.port.readAsDataUrl(item.absPath)
    if (dataUrl) {
      item.set(dataUrl)
      report.inlined += 1
    } else {
      report.missing.push(item.original)
    }
  }

  return report
}
