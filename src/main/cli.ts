/**
 * 命令行参数解析。
 *
 * 从 `index.ts` 拆出来的**唯一理由是可测性**：`index.ts` 在模块作用域调用了
 * `app.requestSingleInstanceLock()`，import 它就会真的去抢单实例锁，
 * 于是那个文件里的一切都没法在单测里碰。所以这里不 import electron，也不 import 任何有副作用的东西。
 * `test/app-meta.test.ts` 有一条断言盯着这一点，防止日后有人图省事把 `app` 引进来。
 *
 * 使用场景有两个，都来自「双击 .md」：
 *   - 冷启动：`app.exe D:\docs\a.md`
 *   - Windows 文件关联/拖拽到图标
 */

import { resolve } from 'node:path'

/**
 * 能通过命令行打开的扩展名。
 * 与文件对话框的过滤器（`src/renderer/stores/files.ts`）保持**大致**一致，
 * 但这里额外收 `.txt`——双击一个 txt 让编辑器打开它是合理的。
 * `.mdx` 刻意不收：它是带 JSX 的另一种方言，按 markdown 渲染会出错。
 */
const DOC_EXTENSION = /\.(md|markdown|mdown|mkd|txt)$/i

/** 去掉两端成对的引号。Chromium 通常已经拆过词了，这里是保险 */
function stripQuotes(arg: string): string {
  return arg.replace(/^"(.*)"$/, '$1')
}

/**
 * 从命令行参数中挑出可以打开的文档路径（**绝对路径**）。
 *
 * 为什么必须在这里 `resolve`：命令行传进来的可能是相对路径（`marktext demo.md`），
 * 而 CWD 只有主进程知道。渲染进程那侧的 IPC 校验一律拒绝相对路径——
 * 那是有意的安全约束（防止被诱导读写任意相对位置），不该为这个场景放宽。
 *
 * 已知限制：以 `-` 开头的文件名会被当成开关丢掉（`-draft.md`）。
 * 逃生办法是写成 `./-draft.md`——加上路径前缀后首字符不再是 `-`。
 * 单测把这个限制和逃生办法都钉住了，免得日后有人「顺手修好」其中一半。
 */
export function extractDocumentPaths(argv: string[]): string[] {
  const paths: string[] = []

  // argv[0] 是 exe 自己，跳过
  for (const raw of argv.slice(1)) {
    const arg = stripQuotes(raw)

    // Chromium 会把自己的开关原样留在 argv 里（--remote-debugging-port=9223、
    // --inspect…），开关的值还可能作为**独立的裸 token** 跟在后面（9223）。
    // 裸值不以扩展名结尾，所以下面那条正则会挡掉它；这里先用 `-` 前缀挡开关。
    if (arg.startsWith('-')) continue
    if (!DOC_EXTENSION.test(arg)) continue

    const absolute = resolve(arg)
    // 同一个文件可能被重复传入（例如 `a.md ./a.md`）。去重按 resolve 后的**精确字符串**，
    // 大小写变体留给 store 的 normalizePath 处理——那一层才知道 Windows 的大小写不敏感规则。
    if (!paths.includes(absolute)) paths.push(absolute)
  }

  return paths
}
