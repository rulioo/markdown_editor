# 进度快照

> 本文记录**现在在哪、下一步做什么**。设计与决策的理由记在 `design.md`（含 D-1～D-19
> 的实现偏差表、§14 的实机验证数据），两者分工不同，别把决策往这里搬。
>
> 最后更新：2026-09-26

## 一句话状态

M0（骨架）与 M1（编辑器内核）已完成并实机验证。**req.txt 的三项要求里，「导出
HTML / PDF / DOCX」一项完全未做** —— 这是当前最大的缺口，也是唯一没被满足的需求。

## 里程碑

| 阶段 | 状态 | 说明 |
| --- | --- | --- |
| M0 骨架 | ✅ 完成 | 工程脚手架、IPC 契约、全中文菜单、文件 IO（含编码探测） |
| M1 编辑器内核 | ✅ 完成 | CM6 源码模式、多标签、查找替换、状态栏、Live Preview 装饰 |
| — 表格渲染 + 正文配色修复 | ✅ 完成 | 见 design.md D-15 / D-16 / D-17、§14.4 |
| — 命令行打开文件 + 关于对话框 | ✅ 完成 | 见 design.md D-18 / D-19、§14.5 |
| **M2 视图** | ⬜ 未开始 | 分栏预览已可用；缺 KaTeX、Mermaid、代码高亮、滚动同步、工作区级搜索 |
| **M3 导出 HTML + PDF** | ⬜ **未开始** | `exportRun()` 仍是桩，见下 |
| **M4 导出 DOCX** | ⬜ 未开始 | 自研 `mdast→docx` |
| M5 提质 | ⬜ 未开始 | 自动保存、崩溃恢复接线、偏好设置页 |
| M6（可选） | ⬜ 未开始 | 命令面板、多主题、macOS / Linux 产物 |

## 当前验证状态

```
npm test        →  154 passed / 11 files
npm run typecheck →  干净（node + web 两份 tsconfig 都过）
npm run dist:win  →  产出 release/win-unpacked + Setup + portable
```

实机验证（打包后的 exe，CDP 探针）最近一轮覆盖六项，全部通过，清单与数据见
`design.md` §14.5。

## 最大缺口：导出（M3 / M4）

`req.txt` 明确要求「导出 html、pdf、docx」。当前实情：

- `src/main/export/index.ts` —— `pickExportTarget()` 是好的（路径选择对话框能用），
  但 `exportRun()` 直接 `return { ok: false, error: '…尚未实现…' }`。
- 渲染管线 `src/renderer/preview/render.ts` **已经可用**（`remark-parse` + GFM +
  `remark-rehype` + 转义与协议白名单，见 D-8），M3 应当复用它而不是另起一条管线
  （这是 design.md NFR-5「预览与导出一致」的落点）。
- 依赖已经装好了：`docx`、`katex`、`rehype-katex`、`rehype-highlight`、
  `highlight.js`、`mermaid` 都在 `package.json` 里，M3/M4 不必再装包。

## 待你决定的一件事

`lastOpenFolder` 只由菜单的「打开文件夹…」写入（`src/renderer/commands/index.ts:64`），
`workspace.openFolder()` 自身不写回。所以「用命令行打开一个 md」自动推导出的工作区
**不会被记住**，下次启动不还原。

我的倾向是**保持现状**（自动推导出的目录不是用户的选择，写回去等于让一次双击
悄悄改掉用户偏好），但这条已写成待决项而不是既定行为。详见 design.md §14.5 末节。

## 已知未做实的小项（都不阻塞）

- `dangerId` 在 `src/shared/types.ts` 里有声明与注释（危险操作默认按钮标红），
  但 `src/main/ipc/index.ts` 的 `dialog:message` 从未转发它 → 「不保存」按钮不会变红。
  一行可修。
- `FILE_NEW_WINDOW` 仍是桩。**多窗口落地时 `src/main/pending-paths.ts` 必须改成
  「认焦点窗口」**——现在 `takePendingPaths()` 是全局的，多窗口会抢同一批路径。
  这句话已经写在 `pending-paths.ts` 里，就是为了让假设在破裂时能被发现。
- 崩溃恢复（`RECOVERY_LOAD` / `RECOVERY_SAVE`）主进程侧已实现，**渲染进程无调用方**。
  接线时要定义「恢复的文档」与「命令行打开的文档」是否并存（建议并存，恢复的排后面）。

## 本机验证环境须知（踩过的坑）

1. **强杀会吞日志** —— 主进程 stdout 在重定向下带缓冲，`Stop-Process -Force` 会让
   缓冲区直接丢失，看起来像卡住。让进程自然退出再读日志。
2. **Bash 工具的沙箱挡住 localhost** —— `curl http://127.0.0.1:PORT` 恒返回
   `HTTP 000`。判断服务/应用是否起来要用 PowerShell 的 `Invoke-RestMethod`。
3. **别用「产物文件存在」判断打包结束** —— `release/` 里上一次构建的 Setup exe
   会让判据提前满足，于是应用会在打包器仍在改写 `win-unpacked` 时被启动，
   现象酷似应用崩溃。等构建进程本身结束。
4. **`scripts/probe-cdp.ps1` 必须是纯 ASCII** —— PowerShell 5.1 按 GBK 读无 BOM 的
   `.ps1`，UTF-8 中文注释会变成乱码并可能吞掉后续代码。
5. **主进程调试**用 `--inspect=9229` + `probe-cdp.ps1 -TargetType node`；调试上下文里
   `require` 是 `undefined`，要用 `process.mainModule.require('electron')`。
6. **`contextBridge` 暴露的 `window.api` 不可写** —— 想在渲染进程里替换某个方法做
   记录行不通，改到主进程 patch 对应模块。

## 目录速览

```
src/main/       主进程：window / menu / store / watcher / recovery
                cli.ts、pending-paths.ts（刻意不 import electron，可单测）
                export/（M3/M4 待填）
src/preload/    contextBridge 桥，通道白名单在内部闭合
src/shared/     ipc-contract.ts 是 IPC 单一事实来源；app-meta.ts 是元数据单一来源
src/renderer/   Vue3 + Pinia；editor/ 是 CM6 内核，preview/ 是统一渲染管线
scripts/        run-node.cjs（绕开 Node 22.11 的 require(esm)）、probe-cdp.ps1、fixtures/
test/           跨进程的结构性断言（根目录，需要 node:fs）
```
