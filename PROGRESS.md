# 进度快照

> 本文记录**现在在哪、下一步做什么**。设计与决策的理由记在 `design.md`（含 D-1～D-30
> 的实现偏差表、§14 的实机验证数据），两者分工不同，别把决策往这里搬。
>
> 最后更新：2026-09-27

## 一句话状态

M0（骨架）、M1（编辑器内核）、M3（导出 HTML / PDF）均已完成。`req.txt` 的三项要求里，
「导出 html、pdf、docx」**已完成 HTML 与 PDF，只剩 DOCX**（M4）——
这是当前唯一没被满足的需求，也是下一个里程碑。

## 里程碑

| 阶段 | 状态 | 说明 |
| --- | --- | --- |
| M0 骨架 | ✅ 完成 | 工程脚手架、IPC 契约、全中文菜单、文件 IO（含编码探测） |
| M1 编辑器内核 | ✅ 完成 | CM6 源码模式、多标签、查找替换、状态栏、Live Preview 装饰 |
| — 表格渲染 + 正文配色修复 | ✅ 完成 | 见 design.md D-15 / D-16 / D-17、§14.4 |
| — 命令行打开文件 + 关于对话框 | ✅ 完成 | 见 design.md D-18 / D-19、§14.5 |
| — 日夜切换强化 | ✅ 完成 | 状态栏常显主题按钮 + `Ctrl+Shift+D` + 菜单主题项 radio 打勾，见 D-29、§14.6 |
| — 载入文档显示大纲 | ✅ 完成 | 从外部打开文档（对话框 / 命令行 / 最近文件）后展开侧边栏并切到「大纲」；文件树内点击不动页签。见 D-30 |
| **M3 导出 HTML + PDF** | ✅ 完成（开发态） | 统一管线、单文件 HTML、隐藏窗口 printToPDF、导出选项对话框、`Ctrl+P`。见 D-20～D-28、§14.6 |
| **M2 视图** | ⬜ 未开始（部分已提前落地） | 分栏预览 / Live Preview / 主题已可用；缺 KaTeX、Mermaid、滚动同步、工作区级搜索 |
| **M4 导出 DOCX** | ⬜ **未开始** | 自研 `mdast→docx`；对话框与路径选择已就位，只需翻转 `exportRun` 的 docx 分支 |
| M5 提质 | ⬜ 未开始 | 自动保存、崩溃恢复接线、偏好设置页、electron-builder 打包 |
| M6（可选） | ⬜ 未开始 | 命令面板、多主题、macOS / Linux 产物 |

## 当前验证状态

```
npm test          →  343 passed / 23 files
npm run typecheck →  干净（node + web 两份 tsconfig 都过）
npm run build     →  干净；out/main/index.js 824,010 字节
```

主进程包的 CJS 内联检查（M3 计划里点名的风险项，两个都必须是 `true`）：

```
$ node -e "const s=require('fs').readFileSync('out/main/index.js','utf8'); \
           console.log(s.includes('Unknown language'), s.includes('hljs-'))"
true true
```

→ highlight.js（CJS）已按预期**内联**进主进程包，没有落到「加进 `MAIN_EXTERNAL`」的退路。

实机验证（CDP 探针）：M1 的性能与六项交互见 §14.2 / §14.4 / §14.5；
M3 的导出与日夜切换见 §14.6；「载入文档显示大纲」见 §14.7。
**§14.6 里有三件事必须人眼确认**——PDF 页码是否真的画在纸上且没被裁、
`Ctrl+P` 是否弹出系统打印对话框、以及打包 exe 内的复验。

## 下一个里程碑：M4 导出 DOCX

`req.txt` 要求的三件里只差 DOCX，而**壳已经搭好了**：

- `src/main/export/index.ts` 的 `exportRun` 有 docx 分支，当前返回
  `{ ok: false, error: '…计划在 M4 完成…' }`——**翻转它即可**，其余不用动。
- 对话框、目标路径选择、两条错误通道（handler 抛异常 / `{ok:false}`）、以及
  `settings.export.docx` 的三个字段（`fontFamily` / `fontSize` / `codeFontFamily`）
  **都已就位并能往返**。
- `src/renderer/components/ExportDialog.vue` 只缺一个 `v-if="format==='docx'"` 的选项段
  （组件头注释里已经写了这句话）。
- 映射表与实现约定见 design.md §5.6 的 DOCX 一节。最容易踩的一条：**中文字体必须显式
  设 `w:eastAsia`**，否则 Word 会用默认宋体渲染中文，看起来像「字体设置没生效」。
- `docx` 包是 external（自带 CJS 产物），**不需要**动 `electron.vite.config.ts`。

## 待你决定的一件事（仍未定）

`lastOpenFolder` 只由菜单的「打开文件夹…」写入（`src/renderer/commands/index.ts` 的
`FILE_OPEN_FOLDER` 分支，当前在 :180），
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
- **勾了「不内联图片」导出的 HTML，换个目录就会丢图**（相对 `src` 指向原目录之外）。
  是取舍不是 bug，但没人会预期到；要单文件就勾「内联图片」。详见 design.md §14.6。

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
   （同理：探针的**输出**带中文时，回传的 JSON 会变成乱码，判断文案要取
   `codePointAt(0).toString(16)`。）
5. **主进程调试**用 `--inspect=9229` + `probe-cdp.ps1 -TargetType node`；调试上下文里
   `require` 是 `undefined`，要用 `process.mainModule.require('electron')`。
6. **`contextBridge` 暴露的 `window.api` 不可写** —— 想在渲染进程里替换某个方法做
   记录行不通，改到主进程 patch 对应模块。
7. **`electron out/main/index.js` 用的不是 `marktext-clone` 那份配置** —— 这种启动方式下
   `app.getName()` 回落到 `"Electron"`，配置落在 `%APPDATA%\Electron\settings.json`，
   与打包态 / `npm run dev`（`%APPDATA%\marktext-clone\`）是**两份互不相干的 profile**。
   探针里读到的主题、最近文件、侧栏状态都可能不是用户那一份。详见 design.md §14.6。
8. **Vue 的响应式对象不能用 `structuredClone`** —— 抛
   `#<Object> could not be cloned`，且 `toRaw()` 只解一层（`options.pdf` 取出来仍是 Proxy）。
   深拷贝 pinia 里的配置要用 `JSON.parse(JSON.stringify(x))`，
   `src/renderer/stores/exportDialog.ts` 的 `clone()` 就是为此存在的。

## 目录速览

```
src/main/       主进程：window / menu / store / watcher / recovery
                cli.ts、pending-paths.ts（刻意不 import electron，可单测）
                export/  shell / pdf-options / validate（纯函数）+ assets / render-window（碰 electron）
src/preload/    contextBridge 桥，通道白名单在内部闭合
src/shared/     ipc-contract.ts 是 IPC 单一事实来源；app-meta.ts 是元数据单一来源
                markdown/ 是预览与导出**共用**的唯一渲染管线（D-20）
                theme.ts 的 CSS 常量被编辑器 / 预览 / 导出三处消费
src/renderer/   Vue3 + Pinia；editor/ 是 CM6 内核
                lib/themeSwitch.ts 是日夜切换的纯逻辑（可单测）
                lib/documentViews.ts 是行号版大纲（与 shared/markdown/headings.ts 不是一回事）
scripts/        run-node.cjs（绕开 Node 22.11 的 require(esm)）、probe-cdp.ps1、fixtures/
test/           跨进程的结构性断言（根目录，需要 node:fs）
```
