# MarkText 克隆版 · 设计文档

> 版本：v1.0（2026-09-26）
> 输入需求：`req.txt`
> 状态：待评审 → 评审通过后进入编码（M0）

---

## 1. 项目概述

### 1.1 目标
仿写 MarkText（免费开源 Markdown 编辑器），交付一个**桌面端 Markdown 编辑器**，满足：

1. **查看与编辑** Markdown 文件；
2. **导出**为 HTML / PDF / DOCX 三种格式；
3. **所有菜单项使用中文**。

### 1.2 参考产品
MarkText（Electron + Vue + 自研 Muya 编辑器）——主打「所见即所得」的 Typora 式编辑体验、左侧文件树 / 大纲 / 搜索侧边栏、多标签、多主题、导出 PDF/HTML。

### 1.3 交付物
| 交付物 | 说明 |
| --- | --- |
| Windows 安装包 | `electron-builder` 产出 NSIS 安装版 + 免安装 portable 版 |
| 源码工程 | TypeScript 全量类型化，含构建脚本与开发热更新 |
| 本文档 | 架构、接口、菜单、里程碑、验收标准 |

### 1.4 运行环境要求（实测确认）

> **推荐 Node.js ≥ 22.12.0；实测 v22.11.0 除首次安装外均可正常开发。**

本栈各工具声明的下限：

| 依赖 | engines.node |
| --- | --- |
| vite 7.3.6 | `^20.19.0 \|\| >=22.12.0` |
| electron-vite 5.0.0 | `^20.19.0 \|\| >=22.12.0` |
| vitest 5.0.2 | `^22.12.0 \|\| ^24.0.0 \|\| >=26.0.0` |
| electron 44.4.5 | `>= 22.12.0` |

根因是 **Node 22.12 才默认开启 `require(esm)`**（在 CJS 里直接 `require()` 一个纯 ESM 包）。
凡是内部这么干的依赖，在 22.11 上都会以 `ERR_REQUIRE_ESM` 崩掉。**已发现三处，不止安装那一步**：

| 触发场景 | 崩在哪 | v22.11.0 表现 |
| --- | --- | --- |
| `npm install` | electron 44 的 `install.js` require 了 `@electron/get@5` | postinstall 静默失败，二进制没下下来（npm 只报 `EBADENGINE` 警告），表现为 `npx electron .` 找不到二进制 |
| `npm test` | vitest 5 配置加载时 require 了 `std-env` | 测试**完全跑不起来**，启动即崩 |
| `npm run dist:win` | electron-builder 26 生成 blockmap 时 require 了 `@noble/hashes/blake2.js` | 前端构建成功，打包阶段崩，**不产出任何安装包** |

**不受影响**的（v22.11.0 实测通过、无需任何标志）：

| 命令 | v22.11.0 实测 |
| --- | --- |
| `npm run build`（tsc + vue-tsc + 三端打包） | ✅ 退出码 0 |
| `npm run dev` | ✅ dev server 起于 `[::1]:5173`，HMR 已连接，应用挂载成功 |
| `npx electron .`（生产构建） | ✅ 窗口正常渲染，存活 22s 无崩溃 |

**绕行**：项目自己的两个命令走 `scripts/run-node.cjs` 启动，它会按版本条件补上
`--experimental-require-module`（≥22.12 不加，避免该选项被移除后变成硬错误），
所以 **`npm test` 与 `npm run dist:win` 在 22.11 上开箱可用**。
剩余的 `npm install` 只能手动绕（已验证）：

```bash
cd node_modules/electron && \
  ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ \
  node --experimental-require-module install.js
```

**正解**：升级到 Node 22.12+ / 24 LTS，`run-node.cjs` 会自动退化成直接启动。

为免后来者踩同一个坑，`package.json` 已声明 `engines.node`，并挂了一个 `postinstall`
自检脚本 `scripts/check-env.cjs`：装完依赖后检查 Electron 二进制是否真的就位，
缺失时直接打印上面的补装命令（中文、可复制），把「静默失败」变成「明确提示」。
脚本永不返回非零退出码——安装本身是成功的，只是可能少了二进制。

> **排查提示**：`npm run dev` 若似乎"没反应"，先确认是不是被强制结束进程——
> 主进程 stdout 在非 TTY 下是**带缓冲**的，强杀（`pkill -f` / `Stop-Process -Force`）
> 会丢弃缓冲区，日志看起来像卡在了 `starting electron app...`。
> 让它自然退出即可看到完整输出。

---

## 2. 需求解析

### 2.1 功能需求（FR）

| 编号 | 需求 | 优先级 |
| --- | --- | --- |
| FR-1 | 打开 / 新建 / 保存 / 另存为 Markdown 文件 | P0 |
| FR-2 | Markdown 语法高亮编辑（源码模式） | P0 |
| FR-3 | 实时渲染预览（分栏模式） | P0 |
| FR-4 | 中文菜单栏，含快捷键 | P0 |
| FR-5 | 导出 HTML（单文件，样式内联） | P0 |
| FR-6 | 导出 PDF（A4、可选页码、背景色正确） | P0 |
| FR-7 | 导出 DOCX（Word / WPS 可正常打开） | P0 |
| FR-8 | 所见即所得（Live Preview）编辑 | P1 |
| FR-9 | 多标签页、未保存提示、最近文件 | P1 |
| FR-10 | 侧边栏：文件树 / 大纲 / 全文搜索 | P1 |
| FR-11 | 主题（亮 / 暗）、字号缩放、全屏 | P1 |
| FR-12 | 查找替换、常用格式化快捷键 | P1 |
| FR-13 | 打字机模式 / 专注模式 | P2 |
| FR-14 | 数学公式（KaTeX）、代码高亮、任务列表、表格 | P2 |
| FR-15 | 自动保存 + 崩溃恢复、粘贴图片自动落盘 | P2 |
| FR-16 | 编码自动识别（UTF-8 / GBK）、换行符保持 | P2 |

### 2.2 非功能需求（NFR）

| 编号 | 需求 |
| --- | --- |
| NFR-1 | 冷启动 ≤ 3s（Windows 中端机型） |
| NFR-2 | 1MB / 2 万行 Markdown 编辑不卡顿（视口渲染 + 超阈值降级） |
| NFR-3 | 渲染进程禁用 Node 集成，启用上下文隔离与沙箱 |
| NFR-4 | 预览区不执行任何文档内脚本（防 XSS） |
| NFR-5 | 导出结果与预览渲染一致（同一条解析管线） |
| NFR-6 | 中文不乱码：导出 HTML 声明 UTF-8，DOCX 指定中文字体 |

### 2.3 明确的非目标（Out of Scope）

- 多人协作 / 云同步 / 账号体系；
- 插件市场与第三方扩展机制；
- 移动端（iOS / Android）；
- 与 MarkText 内部编辑器 Muya 的**逐像素等价**（见 3.2 决策）；
- Git / 版本控制集成。

---

## 3. 技术选型与关键决策

### 3.1 选型总览

| 层 | 选型 | 理由 |
| --- | --- | --- |
| 桌面外壳 | **Electron** | MarkText 同源；`Menu` 原生菜单栏是「中文菜单」需求的最直接实现；`printToPDF` 是当前最省事且排版可控的 PDF 方案 |
| 构建 | **Vite + electron-vite** | 主进程 / 预加载 / 渲染进程三端统一构建，HMR 快 |
| 语言 | **TypeScript**（strict） | IPC 契约与导出器需要类型约束 |
| UI 框架 | **Vue 3 + Pinia** | 与 MarkText 技术栈一致，模板语法适配侧边栏 / 标签 / 对话框等中量级 UI |
| 编辑器内核 | **CodeMirror 6** | 视口渲染（大文件友好）、装饰器 API 足以实现 Live Preview、社区活跃 |
| Markdown 解析 | **unified / remark（mdast）** | **单一 AST 源**：预览、HTML 导出、DOCX 导出、大纲共用一条管线，保证三者一致（NFR-5） |
| 代码高亮 | rehype-highlight（highlight.js） | 与 remark 管线天然衔接 |
| 数学公式 | remark-math + rehype-katex | 预览 / HTML / PDF 全覆盖 |
| 图表 | remark-mermaid 占位 + 渲染时 mermaid | 仅预览 / HTML / PDF |
| 配置持久化 | **自实现**（`src/main/store.ts`） | 原计划用 electron-store，但其 v9+ 为**纯 ESM**，无法被 CJS 的主进程产物 `require`。需求只是「userData 下读写一个 JSON + 默认值合并」，自实现约 60 行，少一个依赖且无模块格式风险 |
| 编码探测 | jschardet + iconv-lite | 中文用户 GBK 文件刚需（FR-16） |
| 打包 | electron-builder | NSIS + portable 双产物 |

### 3.2 决策记录（ADR）

**ADR-01：不实现 Muya 式块级 WYSIWYG，改用 CodeMirror 6 Live Preview。**
MarkText 的编辑器是自研的块级富文本内核，等价实现的工作量在数月量级。本方案用 CM6 装饰器实现「光标行显示源码、其余行渲染为富文本」的 Typora 式体验，覆盖 90% 的观感，同时保留源码模式作为保底。**这仍是 Markdown 源码编辑，不是富文本编辑**——这是本项目的核心取舍。

**ADR-02：解析管线统一到 remark（mdast），而非 markdown-it。**
markdown-it 更快，但输出 HTML 字符串，无法直接服务 DOCX 导出。remark 产出 AST，可同时喂给 `rehype`（→HTML/PDF）与自研 `mdast→docx` 转换器，避免两套解析器导致的渲染不一致。

**ADR-03：PDF 走「离屏窗口 + `webContents.printToPDF`」，不自研排版引擎。**
Chromium 的分页排版质量最高，且与预览共用 CSS。缺点是无法精细控制分页符位置——通过 `page-break-inside: avoid` 等打印 CSS 缓解。

**ADR-04：DOCX 直接自研 `mdast → docx`，不经过 HTML 中转。**
用 `docx` 库（dolanmiu）自建 AST 转换器，逐节点映射为 Word 段落 / 文本运行 / 表格对象。
- **放弃 `html-to-docx` 的理由**：该方案本质是把 HTML 塞进文档，对中文字体、标题样式、代码底纹、表格边框、图片尺寸的控制力几乎为零，输出质量不可控；而「导出 DOCX」是本项目的核心需求之一（FR-7），不值得用一次性的捷径换取后期返工。
- **代价**：M4 需要多写约 500 行节点遍历代码，且要自行处理编号（numbering）、样式（styles.xml）、图片（ImageRun）等 OOXML 细节。
- **收益**：中文排版完全可控，且**输出与预览共享同一棵 mdast**（NFR-5），不存在「HTML 渲染正确但 DOCX 走样」的偏差。
- 入口签名固定为 `exportDocx(mdast, options, targetPath)`，内部实现可独立单测（给定 mdast 快照 → 断言 docx 结构）。

**ADR-07：跨平台优先 Windows，代码层面预留 macOS / Linux。**
- 快捷键统一在 `shared/commands.ts` 中以 `Mod`（Windows/Linux 的 `Ctrl`、macOS 的 `Cmd`）声明，菜单模板按 `process.platform === 'darwin'` 分支生成；
- macOS 下补充「应用菜单」（关于 / 服务 / 隐藏 / 退出）与窗口 `role` 语义；
- 文件路径一律走 `path.join` / `path.normalize`，不硬编码分隔符；配置目录走 `app.getPath('userData')`；
- **M0–M6 仅在 Windows 上验证与打包**，macOS / Linux 产物与签名留待需要时再补。

**ADR-05：预览渲染在 `sandbox` iframe 中。**
`<iframe sandbox="" srcdoc="...">` 不执行脚本、不加载外部资源，天然阻断文档内 XSS（NFR-4），无需引入 rehype-sanitize 的规则维护成本。

**ADR-06：渲染进程不直接读写文件，全部经 preload 白名单 IPC。**
`contextIsolation: true` / `nodeIntegration: false` / `sandbox: true`。

---

## 4. 总体架构

### 4.1 进程模型

```
┌─────────────────────────── Main Process (Node) ───────────────────────────┐
│  窗口管理  │  中文菜单 Menu  │  配置 store  │  文件 IO  │  导出子系统        │
│            │                 │              │           │  html / pdf / docx │
└───────────────────────────────────┬────────────────────────────────────────┘
                                    │ IPC (ipcMain.handle / webContents.send)
┌───────────────────────────────────┴────────────────────────────────────────┐
│                    Preload（contextBridge，白名单 API）                      │
└───────────────────────────────────┬────────────────────────────────────────┘
                                    │ window.api.*
┌───────────────────────────────────┴────────────────────────────────────────┐
│                        Renderer (Vue 3 + Pinia + CodeMirror 6)              │
│  布局：标题栏 / 标签栏 / 侧边栏 / 编辑区 / 状态栏                              │
│  编辑区：CM6（源码模式 ⇄ Live Preview） │ 预览区：sandbox iframe              │
└────────────────────────────────────────────────────────────────────────────┘
```

**职责边界**

| 关注点 | 归属 | 说明 |
| --- | --- | --- |
| Markdown 解析 | 渲染进程 | 编辑时需即时重渲染，放主进程会引入 IPC 往返延迟 |
| 导出渲染 | 主进程 | 导出的 HTML 由主进程用同版本 remark 管线再跑一次，保证与文件系统写入原子性 |
| 文件读写 | 主进程 | 唯一持有 fs 权限的地方 |
| 菜单 | 主进程 | Electron 原生菜单，点击后只发 `menu:command` 命令 ID |

> **导出用哪份 AST？** 渲染进程把**当前编辑器内容（字符串）**通过 IPC 传给主进程，主进程重新解析。这样避免在主进程与渲染进程之间序列化 AST（体积大、易失真），代价是一次重复解析（毫秒级）。

### 4.2 目录结构

```
markdown_editor/
├── package.json
├── electron.vite.config.ts
├── electron-builder.yml
├── tsconfig.json
├── design.md
├── req.txt
├── build/                      # 图标、安装包资源
├── resources/
│   ├── themes/                 # 亮/暗主题 CSS 变量
│   └── markdown.css            # 预览与导出共用的正文样式
└── src/
    ├── main/
    │   ├── index.ts            # app 生命周期、主窗口
    │   ├── window.ts           # BrowserWindow 工厂（主窗口 / 离屏导出窗口）
    │   ├── menu/
    │   │   ├── index.ts        # 菜单模板装配
    │   │   └── templates.zh.ts # 全部中文菜单定义
    │   ├── ipc/
    │   │   ├── index.ts        # 注册所有 handler
    │   │   ├── fs.ts           # 读写文件 / 目录树 / 文件监听
    │   │   ├── dialog.ts       # 打开、保存、另存为
    │   │   ├── settings.ts     # 配置读写、最近文件
    │   │   └── shell.ts        # 外部链接、在资源管理器中显示
    │   ├── export/
    │   │   ├── index.ts        # exportHtml / exportPdf / exportDocx 入口
    │   │   ├── pipeline.ts     # md 字符串 → mdast → hast（统一管线）
    │   │   ├── html.ts         # 单文件 HTML 模板与内联
    │   │   ├── pdf.ts          # 离屏窗口 printToPDF
    │   │   └── docx/
    │   │       ├── index.ts       # exportDocx 入口：mdast → Buffer → 写盘
    │   │       ├── fromMdast.ts   # mdast 节点遍历与映射（M4）
    │   │       └── styles.ts      # 中文字体、标题样式、numbering 定义
    │   └── store.ts            # electron-store schema
    ├── preload/
    │   └── index.ts            # contextBridge 暴露 window.api
    ├── shared/
    │   ├── ipc-contract.ts     # 通道名常量 + 请求/响应类型（主/渲染共用）
    │   ├── commands.ts         # 命令 ID 枚举（菜单 ↔ 渲染进程共用）
    │   └── types.ts            # FileSession / Settings / ExportOptions 等
    └── renderer/
        ├── index.html
        ├── main.ts
        ├── App.vue
        ├── components/
        │   ├── TitleBar.vue        # 自定义标题栏（含窗口按钮）
        │   ├── TabBar.vue          # 多标签
        │   ├── Sidebar/
        │   │   ├── FileTree.vue    # 文件树（工作区）
        │   │   ├── Outline.vue     # 大纲（mdast 提取）
        │   │   └── Search.vue      # 全文搜索
        │   ├── EditorPane.vue      # CM6 宿主
        │   ├── PreviewPane.vue     # sandbox iframe 宿主
        │   ├── StatusBar.vue       # 字数 / 光标 / 编码 / 换行 / 模式
        │   └── dialogs/            # 设置、关于、导出选项、语法参考
        ├── editor/
        │   ├── setup.ts            # CM6 扩展装配
        │   ├── livePreview.ts      # ★ 装饰器插件（WYSIWYG 核心）
        │   ├── widgets/            # 图片、KaTeX、复选框、分隔线
        │   ├── keymap.ts           # 快捷键
        │   └── theme.ts            # CM6 主题（跟随亮/暗）
        ├── stores/
        │   ├── files.ts            # 标签、脏状态、会话
        │   ├── workspace.ts        # 工作区文件树
        │   ├── settings.ts         # 配置镜像
        │   └── layout.ts           # 侧边栏显隐、模式、缩放
        ├── commands/
        │   └── registry.ts         # 命令注册表（菜单 / 快捷键 / 命令面板共用）
        └── styles/
```

---

## 5. 模块详细设计

### 5.1 主进程

**窗口**
- `mainWindow`：`1280×800`，`frame: false`（自绘标题栏，保持 MarkText 观感），`minWidth: 680`。
- 窗口状态（尺寸、位置、最大化）退出时持久化到配置。
- 单实例锁：`app.requestSingleInstanceLock()`，二次启动把文件路径透传给已存在实例（支持「用本应用打开 .md」）。

**IPC 契约**（`src/shared/ipc-contract.ts` 单一事实来源）

| 通道 | 方向 | 入参 | 返回 |
| --- | --- | --- | --- |
| `dialog:openFile` | invoke | — | `{ canceled, paths: string[] }` |
| `dialog:openFolder` | invoke | — | `{ canceled, path }` |
| `dialog:saveAs` | invoke | `{ defaultPath, filters }` | `{ canceled, path }` |
| `dialog:message` | invoke | `{ type, title, message, buttons }` | `{ response }` |
| `fs:readFile` | invoke | `path` | `{ content, encoding, eol, mtimeMs }` |
| `fs:writeFile` | invoke | `{ path, content, encoding, eol }` | `{ mtimeMs }` |
| `fs:readDir` | invoke | `path` | `TreeNode[]` |
| `fs:stat` | invoke | `path` | `{ exists, mtimeMs, size }` |
| `fs:watch` / `fs:unwatch` | invoke | `path` | `void` |
| `fs:changed` | **push** | `{ path, event }` | — |
| `fs:assetsDir` | invoke | `{ docPath, fileName }` | `{ dir, relPath }`（粘贴图片落盘） |
| `export:run` | invoke | `{ format, markdown, targetPath, options }` | `{ ok, path?, error? }` |
| `export:pickTarget` | invoke | `format` | `{ canceled, path }` |
| `settings:get` / `settings:set` | invoke | — / `Partial<Settings>` | `Settings` |
| `recent:list` / `recent:add` / `recent:clear` | invoke | — | `string[]` |
| `shell:openExternal` | invoke | `url` | `void`（协议白名单 `http/https/mailto`） |
| `shell:showItemInFolder` | invoke | `path` | `void` |
| `window:minimize` / `maximize` / `close` | invoke | — | `void` |
| `window:stateChanged` | **push** | `{ maximized, fullscreen }` | — |
| `menu:command` | **push** | `commandId` | — |

**安全约定**
- 所有入参在主进程再次校验（类型 + 路径存在性），不信任渲染进程。
- `shell:openExternal` 白名单协议，其余一律拒绝。
- 导出临时文件统一落在 `app.getPath('temp')/marktext-clone/`，退出时清理。

### 5.2 预加载桥

```ts
// window.api 结构（仅暴露以下方法，不暴露 ipcRenderer 本体）
interface Api {
  dialog: { openFile(): Promise<...>; openFolder(): Promise<...>; saveAs(o): Promise<...>; message(o): Promise<...> }
  fs:     { readFile(p): ...; writeFile(o): ...; readDir(p): ...; stat(p): ...;
            watch(p): ...; unwatch(p): ...; assetsDir(o): ... }
  export: { run(o): ...; pickTarget(f): ... }
  settings: { get(): Promise<Settings>; set(p: Partial<Settings>): Promise<Settings> }
  recent: { list(): ...; add(p): ...; clear(): ... }
  shell:  { openExternal(u): ...; showItemInFolder(p): ... }
  win:    { minimize(): ...; maximize(): ...; close(): ... }
  on(channel: 'menu:command' | 'fs:changed' | 'window:stateChanged', cb): () => void  // 返回取消订阅函数
}
```

### 5.3 渲染进程布局

```
┌──────────────────────────────────────────────────────────────┐
│ 自定义标题栏：菜单由原生 Menu 提供，标题栏仅放文档名 + 窗口按钮   │
├──────────┬───────────────────────────────────────────────────┤
│          │ 标签栏  [未命名-1 ×] [README.md ●×]         [+]   │
│  侧边栏   ├───────────────────────────────────────────────────┤
│  文件树   │                                                   │
│  大纲     │              编辑区（CM6）                         │
│  搜索     │        或 分栏：编辑区 │ 预览区                     │
│          │                                                   │
├──────────┴───────────────────────────────────────────────────┤
│ 状态栏：行 12 列 34 │ 字数 1,204 │ UTF-8 │ LF │ 实时预览 │ 100% │
└──────────────────────────────────────────────────────────────┘
```

- 侧边栏宽度可拖拽（`240–480px`），显隐与宽度持久化。
- 分栏模式下 `Ctrl+滚轮` 缩放正文；预览区**双向滚动同步**（按标题锚点对齐，非简单比例映射）。

### 5.4 编辑器内核（CodeMirror 6）

**扩展装配清单**

| 扩展 | 用途 |
| --- | --- |
| `@codemirror/lang-markdown` | Markdown 语法树（含 GFM、代码块内嵌语言） |
| `@codemirror/commands` / `history` | 撤销重做、缩进、列表续行 |
| `@codemirror/search` | 查找替换 |
| `@codemirror/autocomplete` | 代码块语言、链接路径、表情补全 |
| `EditorView.lineWrapping` | 软换行（默认开） |
| `livePreview`（自研） | 见下 |
| `typewriter` / `focusMode`（自研） | 打字机 / 专注模式 |
| `theme`（自研） | 与亮暗主题变量联动 |

**Live Preview 装饰器设计（`editor/livePreview.ts`）**

核心规则：**选区覆盖到的行显示原始 Markdown 源码，其余行渲染为富文本。** 用 `ViewPlugin` + `DecorationSet` 在视口范围内增量构建。

| 语法 | 非光标行处理 | 光标行处理 |
| --- | --- | --- |
| `# 标题` | `Decoration.line` 加类名（字号/字重/上下间距），`#` 标记用 `Decoration.replace` 隐藏 | 显示 `#` |
| `**粗体**` `*斜体*` `~~删除~~` `` `码` `` | 隐藏标记符，内容加对应样式类 | 显示标记符 |
| `[文本](url)` | 隐藏 `](url)`，仅显示文本并加链接样式；`Ctrl+点击` 打开 | 全部显示 |
| `![alt](src)` | 替换为 `ImageWidget`（本地路径 + 网络图，最大宽度约束） | 显示源码 |
| ` ```lang ` 代码块 | 整块加背景 + 等宽字体 + 语言标签，围栏标记隐藏 | 显示围栏 |
| `- [ ] 任务` | 替换为可点击 `CheckboxWidget`，点击改写文档 | 显示源码 |
| `---` 分隔线 | 替换为 `<hr>` Widget | 显示源码 |
| `$公式$` / `$$公式$$` | 替换为 KaTeX Widget | 显示源码 |
| `> 引用` | `Decoration.line` 左边框 + 灰字 | 同左 |
| 表格 | 等宽 + 对齐样式（不重建为真表格，M5 可选） | 同左 |

**实现要点**
- 装饰构建只在 `viewportChanged` / `docChanged` / `selectionSet` 时触发，且只遍历 `view.visibleRanges`，保证大文件性能（NFR-2）。
- `Decoration.replace` 隐藏标记时使用 `block: false`，避免破坏光标定位；跨行语法（引用、代码块）走行级装饰。
- 降级策略：文档 > 1MB 或 > 2 万行时，自动关闭 Live Preview 并提示「已切换为源码模式以保持流畅」。

**打字机模式**：`EditorView.scrollIntoView` + 计算视口中心，使光标行恒定居中（可配置为 40% 高度）。
**专注模式**：对非当前段落所在行加 `opacity: .35` 行装饰。

### 5.5 预览与主题

- **渲染管线**（`main/export/pipeline.ts`，主/渲染共用同一份代码）：
  `remark-parse → remark-gfm → remark-math → remark-frontmatter → remark-rehype(+katex) → rehype-highlight → rehype-stringify`
- 预览：产出的 HTML 片段注入 `sandbox=""` 的 iframe `srcdoc`，样式来自 `resources/markdown.css`（通过 `<style>` 内联进 srcdoc）。
- **主题**：CSS 变量定义于 `resources/themes/{light,dark}.css`（`--bg`、`--fg`、`--accent`、`--code-bg`…），CM6 主题与预览、导出模板三处共用同一组变量，保证「编辑区 / 预览 / 导出」视觉一致。
- 代码高亮样式与主题变量绑定，切换主题时同步替换 highlight.js 配色。

### 5.6 导出子系统

统一入口：

```ts
exportRun({ format: 'html' | 'pdf' | 'docx', markdown: string, targetPath: string, options: ExportOptions })
```

**HTML（`export/html.ts`）**
1. 跑管线得到正文 HTML；
2. 套用单文件模板：`<!doctype html><meta charset="utf-8">` + 内联主题 CSS + 高亮 CSS + 正文；
3. 选项：`embedImages`（本地图片转 base64 内联）、`includeToc`（由 mdast 标题生成目录）、`theme`（亮/暗）；
4. `fs.writeFile(targetPath, html, 'utf8')`（NFR-6）。

**PDF（`export/pdf.ts`）**
1. 生成 HTML，追加打印样式：`@page { size: A4; margin: 20mm }`、`h1..h6 { break-after: avoid }`、`pre, table, img { break-inside: avoid }`；
2. 写入临时文件 `temp/marktext-clone/<uuid>.html`；
3. 新建离屏窗口 `new BrowserWindow({ show: false, webPreferences: { sandbox: true, javascript: false } })`，`loadFile(tmp)`，等待 `did-finish-load` + `document.fonts.ready`；
4. `webContents.printToPDF({ printBackground: true, pageSize: 'A4', margins: {...}, displayHeaderFooter, headerTemplate, footerTemplate })`，页脚模板填页码；
5. 写 Buffer 到目标路径，关闭窗口，删除临时文件；
6. 全程 `try/finally` 保证不残留窗口与临时文件。

**DOCX（`export/docx/fromMdast.ts`，自研）**

流程：`markdown 字符串 → pipeline 解析为 mdast → walk 遍历 → docx 文档对象树 → Packer.toBuffer() → 写盘`。

```ts
// 结构示意（M4 实现）
const children: (Paragraph | Table | ...)[] = mdast.children.flatMap(node => walkNode(node, ctx))
const doc = new Document({ numbering: { config: NUMBERING }, styles: { paragraphStyles: ZH_STYLES }, sections: [{ children }] })
const buffer = await Packer.toBuffer(doc)
await fs.writeFile(targetPath, buffer)
```

关键实现约定：
- **中文字体**：在 `styles.default.document.run.font` 指定「微软雅黑」，并为 `eastAsia` 单独指定（OOXML 必须显式设置 `w:eastAsia`，否则 Word 会用默认宋体渲染中文）；
- **编号列表**：`numbering.config` 预定义 5 级（无序 `•◦▪`，有序 `1. a. i.`），`listItem` 按嵌套深度引用对应级别；任务列表不走向量编号，直接以 `☐ / ☑` 文本前缀 + 悬挂缩进模拟；
- **代码块**：等宽字体 + `shading: { fill: 'F6F8FA' }` + 保留原始换行（`break: 1`），块级前后加段间距；
- **图片**：`ImageRun`，本地路径直接读 Buffer，网络图先下载；按正文可用宽度（A4 减页边距 ≈ 16cm）等比缩放，超出则约束到 100%；
- **`walkNode` 需要携带的上下文**：`listDepth`（嵌套层级）、`quoteDepth`（引用缩进）、`numberingRef`（当前列表的编号引用）——用不可变的 `ctx` 对象向下传递，避免全局状态；
- **单测**：以固定样例文档为输入，断言产出的 docx 文档对象结构（而非二进制对比），覆盖标题 1-6、嵌套列表、表格、代码块、行内格式组合。

| markdown / mdast | docx 映射 |
| --- | --- |
| `heading` (depth 1-6) | `HeadingLevel.HEADING_1..6`，中文字体「微软雅黑」，标题色 `#1F2328` |
| `paragraph` | `Paragraph`，行距 1.5，段后 6pt |
| `strong` / `emphasis` / `delete` | `TextRun{ bold / italics / strike }` |
| `inlineCode` | 等宽字体（Consolas / 等线）+ 浅灰底纹 |
| `list` / `listItem` | 预定义 5 级 `numbering`（无序 `•◦▪`，有序 `1. a. i.`），任务列表用 `☐ / ☑` 前缀 |
| `code` | `Paragraph` 等宽 + 灰底 + 保留换行，可选 `shading` |
| `blockquote` | `Paragraph` + 左边框 + 缩进 |
| `link` | `ExternalHyperlink`（蓝色下划线） |
| `image` | `ImageRun`；本地路径读文件，网络图先下载再嵌入；按正文宽度等比缩放 |
| `table` (GFM) | `Table`，表头底纹 `#F6F8FA`，边框 |
| `footnote` | docx 原生脚注 |
| `math` | **降级为纯文本**（M5 评估 KaTeX→PNG 嵌入） |

**导出选项对话框**（`dialogs/ExportDialog.vue`）：格式、目标路径、主题、页码、目录、图片内联，导出中显示进度与结果提示（成功后可「打开所在文件夹」）。

---

## 6. 菜单设计（全中文）

> 所有菜单项均为中文；点击后统一派发**命令 ID**（`src/shared/commands.ts`），由渲染进程命令注册表执行。这样菜单、快捷键、未来的命令面板（`Ctrl+Shift+P`）共用一套逻辑。

### 6.1 菜单树

**文件(F)**
| 菜单项 | 快捷键 | 命令 ID |
| --- | --- | --- |
| 新建 | `Ctrl+N` | `file.new` |
| 新建窗口 | `Ctrl+Shift+N` | `file.newWindow` |
| 打开文件… | `Ctrl+O` | `file.open` |
| 打开文件夹… | `Ctrl+Shift+O` | `file.openFolder` |
| 打开最近文件 | ▸ 子菜单 | `file.openRecent` |
| — | | |
| 保存 | `Ctrl+S` | `file.save` |
| 另存为… | `Ctrl+Shift+S` | `file.saveAs` |
| 全部保存 | `Ctrl+Alt+S` | `file.saveAll` |
| — | | |
| 导出 | ▸ 导出为 HTML / 导出为 PDF / 导出为 DOCX | `export.html` / `export.pdf` / `export.docx` |
| 打印… | `Ctrl+P` | `file.print` |
| — | | |
| 偏好设置… | `Ctrl+,` | `app.settings` |
| 退出 | `Alt+F4` | `app.quit` |

**编辑(E)**
| 菜单项 | 快捷键 | 命令 ID |
| --- | --- | --- |
| 撤销 | `Ctrl+Z` | `edit.undo` |
| 重做 | `Ctrl+Y` | `edit.redo` |
| — | | |
| 剪切 / 复制 / 粘贴 | `Ctrl+X/C/V` | `edit.cut/copy/paste` |
| 复制为 Markdown | `Ctrl+Shift+C` | `edit.copyMarkdown` |
| 粘贴为纯文本 | `Ctrl+Shift+V` | `edit.pastePlain` |
| 全选 | `Ctrl+A` | `edit.selectAll` |
| — | | |
| 查找 | `Ctrl+F` | `edit.find` |
| 替换 | `Ctrl+H` | `edit.replace` |
| 查找下一个 / 上一个 | `F3` / `Shift+F3` | `edit.findNext/Prev` |
| — | | |
| 转换为大写 / 小写 | — | `edit.upper/lower` |
| 插入当前日期时间 | — | `edit.insertDateTime` |

**段落(P)**
| 菜单项 | 快捷键 | 命令 ID |
| --- | --- | --- |
| 标题 1–6 | `Ctrl+1..6` | `para.heading1..6` |
| 提升标题级别 / 降低标题级别 | `Ctrl+Shift+=` / `Ctrl+Shift+-` | `para.headingUp/Down` |
| 正文 | `Ctrl+0` | `para.paragraph` |
| — | | |
| 无序列表 / 有序列表 / 任务列表 | `Ctrl+Shift+]` / `Ctrl+Shift+[` / `Ctrl+Shift+X` | `para.ul/ol/task` |
| 引用 | `Ctrl+Shift+Q` | `para.quote` |
| 代码块 | `Ctrl+Shift+K` | `para.codeBlock` |
| 表格 | `Ctrl+Shift+T` | `para.table` |
| 数学公式块 | `Ctrl+Shift+M` | `para.mathBlock` |
| 分隔线 | — | `para.hr` |
| — | | |
| 缩进 / 减少缩进 | `Tab` / `Shift+Tab` | `para.indent/outdent` |

**格式(F)**
| 菜单项 | 快捷键 | 命令 ID |
| --- | --- | --- |
| 加粗 | `Ctrl+B` | `fmt.bold` |
| 斜体 | `Ctrl+I` | `fmt.italic` |
| 下划线 | `Ctrl+U` | `fmt.underline` |
| 删除线 | `Ctrl+D` | `fmt.strikethrough` |
| 行内代码 | `Ctrl+`` ` `` | `fmt.code` |
| 高亮 | `Ctrl+Shift+H` | `fmt.mark` |
| 超链接… | `Ctrl+K` | `fmt.link` |
| 图片… | `Ctrl+Shift+I` | `fmt.image` |
| 清除格式 | `Ctrl+\` | `fmt.clear` |

**视图(V)**
| 菜单项 | 快捷键 | 命令 ID |
| --- | --- | --- |
| 源码模式 | `Ctrl+/` | `view.sourceMode` |
| 实时预览 | `Ctrl+Shift+/` | `view.liveMode` |
| 分栏预览 | `Ctrl+Shift+P` | `view.splitMode` |
| 仅预览 | — | `view.previewMode` |
| — | | |
| 显示侧边栏 | `Ctrl+B`（无选区时） | `view.toggleSidebar` |
| 文件树 / 大纲 / 搜索 | `Ctrl+Shift+1/2/3` | `view.sidebar.files/outline/search` |
| 显示状态栏 | — | `view.toggleStatusBar` |
| — | | |
| 打字机模式 | — | `view.typewriter` |
| 专注模式 | — | `view.focusMode` |
| 显示图片 | — | `view.showImages` |
| — | | |
| 放大 / 缩小 / 重置缩放 | `Ctrl+=` / `Ctrl+-` / `Ctrl+0` | `view.zoomIn/Out/Reset` |
| 切换主题（亮 / 暗 / 跟随系统） | — | `view.theme.light/dark/system` |
| 全屏 | `F11` | `view.fullscreen` |

**窗口(W)**：最小化 / 最大化 / 关闭窗口 / 开发者工具（`Ctrl+Shift+I`，仅开发模式可见）
**帮助(H)**：Markdown 语法参考 / 快捷键速查 / 关于 MarkText 克隆版

> 冲突说明：`Ctrl+B` 在「有选区」时为加粗，「无选区」时为切换侧边栏（对齐 MarkText 行为）；`Ctrl+0` 在段落菜单为「正文」、视图菜单为「重置缩放」——实现时以「焦点是否在编辑器内」区分，菜单中注明。

---

## 7. 数据模型

### 7.1 文件会话

```ts
interface FileSession {
  id: string                  // uuid，标签页标识
  filePath: string | null     // null = 未命名新文档
  name: string                // 显示名
  encoding: 'utf8' | 'utf8-bom' | 'gbk' | 'gb18030' | 'big5' | 'latin1'
  eol: 'lf' | 'crlf'
  savedContent: string        // 磁盘内容，用于脏检查（与编辑器内容比对）
  dirty: boolean
  mode: EditorMode            // 'source' | 'live' | 'split' | 'preview'
  viewState: unknown          // CM6 EditorState，切换标签时恢复光标与撤销栈
  scrollTop: number
  readOnly: boolean
  mtimeMs: number             // 用于外部修改检测
}
```

- 编辑器内容不做全量镜像到 store（避免大文档双份内存），改为**节流 300ms** 同步一份 `content` 供字数统计与预览渲染；脏检查用 `content !== savedContent`。
- **外部修改冲突**：`fs:watch` 感知到文件被外部改写且当前 `dirty` 时，弹中文对话框：「文件已被外部修改，是否重新加载？（重新加载 / 保留我的修改 / 查看差异）」。

### 7.2 配置 Schema（electron-store）

```ts
interface Settings {
  theme: 'light' | 'dark' | 'system'
  fontSize: number             // 12-32，默认 16
  lineHeight: number           // 默认 1.6
  fontFamily: string           // 默认 "Microsoft YaHei", Consolas
  editorMode: EditorMode       // 默认 'live'
  autoSave: boolean            // 默认 false
  autoSaveDelay: number        // 默认 5000ms
  livePreview: boolean         // 默认 true
  showImages: boolean          // 默认 true
  typewriter: boolean
  focusMode: boolean
  sidebarVisible: boolean
  sidebarWidth: number
  sidebarTab: 'files' | 'outline' | 'search'
  lastOpenFolder: string | null
  recentFiles: string[]        // 上限 20
  window: { width, height, x, y, maximized }
  export: { defaultDir: string | null; pdfPageSize: 'A4' | 'Letter'; pdfFooter: boolean; htmlEmbedImages: boolean; htmlToc: boolean }
  encoding: { autoDetect: boolean; default: string }
}
```

### 7.3 崩溃恢复
编辑内容节流写入 `app.getPath('userData')/session-recovery.json`（仅未保存文档），启动时若检测到非空则提示「检测到上次异常退出，是否恢复 N 个未保存的文档？」

---

## 8. 关键流程

### 8.1 打开文件
```
渲染: 菜单「打开文件」→ commands.file.open
  → api.dialog.openFile()                    [主进程弹原生对话框]
  → 对每个 path: api.fs.readFile(path)
      主进程: 读 Buffer → jschardet 探测编码 → iconv-lite 解码 → 识别换行符
  → files store 新建 FileSession（已打开则激活既有标签）
  → 若未打开工作区，以文件所在目录作为工作区根 → 加载文件树
  → CM6 挂载 EditorState，按 editorMode 渲染
  → api.fs.watch(path) 监听外部修改
```

### 8.2 保存
```
渲染: Ctrl+S → 若 filePath 为空则转「另存为」
  → api.fs.writeFile({ path, content, encoding, eol })
      主进程: 按 encoding 编码（GBK 文件回写 GBK，避免中文乱码）→ 换行符还原 → 原子写（写 .tmp 再 rename）
  → 更新 savedContent / dirty=false / mtimeMs
  → 状态栏闪烁「已保存」
```

### 8.3 导出
```
渲染: 菜单「导出为 PDF」→ 打开导出选项对话框 → 确认
  → api.export.pickTarget('pdf')  → 原生保存对话框
  → api.export.run({ format:'pdf', markdown, targetPath, options })
      主进程: pipeline(md) → html 模板 → 临时文件 → 离屏窗口 → printToPDF → 写盘 → 清理
  → 渲染: 成功提示（含「打开所在文件夹」按钮）
```
导出期间：状态栏显示进度，按钮禁用；失败弹出中文错误对话框并保留错误详情。

### 8.4 粘贴图片
```
CM6 paste 事件 → 检测 clipboard 图片 → api.fs.assetsDir({ docPath, fileName })
  主进程: 返回 <文档目录>/assets/ 与相对路径（目录不存在则创建）
→ 写 PNG 文件（文件名 <文档名>-<时间戳>.png）
→ 在光标处插入 ![图片](assets/xxx.png)
未保存的新文档：提示先保存文档
```

---

## 9. 非功能设计

| 项 | 方案 |
| --- | --- |
| 性能 | CM6 视口渲染；Live Preview 仅遍历可见区；预览渲染 300ms 防抖；>1MB 文档自动降级源码模式；导出在主进程，不阻塞 UI |
| 安全 | `contextIsolation: true` + `sandbox: true` + `nodeIntegration: false`；预览用 `sandbox=""` iframe；CSP 限制 `default-src 'self'`；外链协议白名单；不使用 `remote` 模块 |
| 编码 | jschardet 探测 + iconv-lite 转换，保存时按原编码回写；BOM 保留 |
| 换行符 | 读取时记录 LF/CRLF，保存时还原；状态栏可点击切换 |
| 大文件 | `fs:readFile` 超过 20MB 时提示「文件过大，是否仍要打开？」 |
| 可访问性 | 所有交互可纯键盘完成；原生菜单天然支持快捷键；对话框聚焦管理 |
| 打包 | electron-builder：NSIS（含中文安装界面）+ portable；`asar` 打包；图标多尺寸 |
| 日志 | 主进程日志写到 `userData/logs/`，保留 7 天 |

---

## 10. 里程碑与验收

| 阶段 | 范围 | 验收标准 |
| --- | --- | --- |
| **M0 骨架** | 工程搭建（electron-vite + Vue3 + TS + Pinia）、主窗口、**全中文菜单栏**、IPC 骨架与 preload 桥、打开/保存/另存为、编码识别 | 能打开 `.md`、编辑、保存；GBK 文件打开不乱码；菜单全中文且快捷键生效 |
| **M1 编辑器** ✅ | CM6 源码模式、语法高亮、多标签、未保存提示、状态栏（行列/字数/编码/换行）、查找替换、格式化快捷键 | **已达成**，实测见 14.1 / 14.2：1MB 文档按键中位数 9.0ms、零样本超 100ms；Ctrl+S/Ctrl+F/Ctrl+B 等按设计工作 |
| **M2 视图** | 分栏预览、Live Preview（标题/粗斜体/代码/链接/图片/任务/分隔线）、滚动同步、亮暗主题、大纲、文件树、搜索、打字机/专注模式 | 切换 4 种模式无异常；Live Preview 光标行显源码、其余行渲染；大纲随编辑更新 |
| **M3 导出 HTML+PDF** | 统一解析管线、单文件 HTML、离屏窗口 printToPDF、导出选项对话框 | 导出 HTML 双击可在浏览器正确显示（样式+高亮齐全）；PDF 分页正确、背景色与中文正常、有页码 |
| **M4 导出 DOCX** | 自研 `mdast→docx` 转换器（`fromMdast.ts` + `styles.ts`）：中文字体 / 标题 1-6 / 嵌套列表 / 表格 / 代码块底纹 / 图片 / 链接 / 引用，含节点级单测 | Word 2016+ 与 WPS 打开无警告；中文渲染为微软雅黑而非宋体；列表编号层级正确；表格有边框与表头底纹；单测覆盖 5.6 映射表全部行 |
| **M5 提质** | KaTeX 公式、Mermaid 图表、粘贴图片、自动保存与崩溃恢复、最近文件、偏好设置页、electron-builder 打包 | 安装包可正常安装卸载并关联 `.md`；异常退出后可恢复未保存文档 |
| **M6（可选）** | 命令面板、多主题、导出图片内联、数学公式转 DOCX 图片、macOS/Linux 产物 | — |

**总体验收（对齐 req.txt）**
1. ✅ 可查看并编辑 Markdown 文件（打开、编辑、保存、另存为、多标签）；
2. ❌ **可导出 HTML / PDF / DOCX 三种格式** —— **尚未实现**。`src/main/export/`
   目前只有路径选择对话框，`exportRun()` 是直接返回 `ok: false` 的桩（M3 / M4 未开工）。
   这一条是 req.txt 的硬要求，**不达成即不能算交付**。
3. ✅ 应用菜单全部为中文。

---

## 11. 风险与对策

| # | 风险 | 影响 | 对策 |
| --- | --- | --- | --- |
| R1 | Live Preview 装饰器复杂度高（光标定位、跨行语法、性能） | M2 延期 | 分栏预览先保底可用；装饰规则按语法逐条增量实现并单测；大文档自动降级源码模式 |
| R2 | DOCX 保真度不足（尤其中文样式、表格、图片） | FR-7 不达标 | ADR-04 两阶段：先打通链路，再自研渲染器；用固定样例文档做人工对照验收 |
| R3 | PDF 分页不理想（表格/代码块跨页断裂） | 观感问题 | 打印 CSS 的 `break-inside: avoid`；提供页边距与纸张选项；必要时按 `h2` 强制分页的可选项 |
| R4 | 中文编码（GBK/Big5）读写乱码 | 数据损坏 | jschardet + iconv-lite，保存回写原编码；固定用例集回归测试 |
| R5 | Electron 版本/依赖安装受网络影响 | 环境阻塞 | 尽早锁定 `package.json` 并配置镜像；M0 第一天完成依赖安装验证 |
| R6 | 数学公式 / Mermaid 在 DOCX 中无法原生呈现 | 功能缺口 | MVP 明确降级为文本/图片，并在文档与 UI 提示中说明 |
| R7 | 大文件 + Live Preview 内存占用 | 卡顿/崩溃 | 视口渲染 + 阈值降级 + 编辑内容不双份镜像 |

---

## 12. 依赖清单（预期）

**运行时**
`electron`、`vue`、`pinia`、`codemirror` / `@codemirror/{state,view,commands,search,autocomplete,lang-markdown}`、`unified`、`remark-parse`、`remark-gfm`、`remark-math`、`remark-frontmatter`、`remark-rehype`、`rehype-katex`、`rehype-highlight`、`rehype-stringify`、`katex`、`mermaid`、`docx`（自研转换器依赖，不引入 `html-to-docx`）、`jschardet`、`iconv-lite`

> `electron-store` 与 `uuid` 均已移除：前者是纯 ESM（见 3.1），后者用自增 ID 即可满足标签页标识需求。

**模块格式约定（`electron.vite.config.ts`）**
- 主进程输出 **CJS**；`unified` / `remark-*` / `rehype-*` 是纯 ESM，**不打进 external，由 rollup 打包进主进程产物**；
- `docx` / `iconv-lite` / `jschardet` / `katex` 自带 CJS 产物，保持 external（避免 iconv-lite 的动态 require 与 katex 体积被卷入）；
- 预加载脚本在 `sandbox: true` 下**必须**是 CJS，故显式指定 `format: 'cjs'`，产物为 `out/preload/index.cjs`。

**开发**
`electron-vite`、`vite`、`vue-tsc`、`typescript`、`@vitejs/plugin-vue`、`electron-builder`、`eslint` + `prettier`、`vitest`

> 具体版本在 M0 安装时锁定（`package-lock.json` 入库）。

---

## 13. 已确认决策（2026-09-26 评审）

| # | 决策 | 结论 |
| --- | --- | --- |
| 1 | 编辑器内核 | **采纳 ADR-01**：CodeMirror 6 + Live Preview，实现源码 / 实时预览 / 分栏 / 纯预览四种模式 |
| 2 | 目标平台 | **Windows 优先，代码层面兼容 macOS / Linux**（采纳 ADR-07）；M0–M6 仅在 Windows 验证打包 |
| 3 | DOCX 策略 | **采纳 ADR-04**：直接自研 `mdast → docx`，不引入 `html-to-docx`，M4 一次到位 |

### 尚未确认（不阻塞 M0）
- `.md` 文件关联与「用本应用打开」右键菜单是否要做（M5 已列入，可裁剪）；
- 是否需要数学公式 / Mermaid 图表（现列于 M5，若不需要可提前完成）。

---

## 14. 实现偏差记录

编码过程中偏离本设计的地方，均在此登记（保持文档与代码一致）。

| # | 原设计 | 实际实现 | 原因 |
| --- | --- | --- | --- |
| D-1 | 配置用 `electron-store` | 自实现 `src/main/store.ts` | electron-store v9+ 纯 ESM，与 CJS 主进程不兼容（见 3.1） |
| D-2 | `Ctrl+B` 同时用于「加粗」与「显示侧边栏」；`Ctrl+0` 同时用于「正文」与「重置缩放」 | 菜单层各保留一个：**显示侧边栏 → `Ctrl+Shift+B`**，**重置缩放 → `Ctrl+Shift+0`** | Electron 加速键无法在同一层重复注册，后注册者永久失效。编辑器内「有选区则加粗、无选区切换侧边栏」的行为由 CM6 keymap 在 M1 实现，菜单注释已注明 |
| D-3 | `FileSession.mode` 每标签独立 | **模式全局**，存于 `Settings.editorMode` | 切换标签不应改变视图模式；与 MarkText 行为一致 |
| D-4 | IPC 表 20 个通道 | 新增 `win:forceClose`、`app:setDirtyState` | **防数据丢失**：主进程无法感知渲染进程的未保存内容，点窗口 X / Alt+F4 会静默丢改动。现由渲染进程上报脏状态，有脏数据时主进程拦截 `close` 并请渲染进程弹中文确认框；无脏数据直接放行，渲染进程崩溃时清除标记，避免窗口关不掉 |
| D-5 | `outline` / `search` 面板基于 mdast | M0 先用正则（跳过围栏代码块），M2 换统一管线 | 分阶段落地；正则版本已正确处理「代码块内的 `#` 不算标题」 |
| D-6 | 搜索面板为工作区全文检索 | M0 实现**当前文档内**查找，M2 补工作区级 | 工作区检索需要主进程提供递归扫描接口，单独排期 |
| D-7 | 分栏预览 / Live Preview 属 M2 | M1 已实现 Live Preview 装饰与基础预览面板 | CM6 装饰器与预览管线是 M1 编辑器内核的自然延伸，提前落地可尽早暴露性能问题（见 D-10）；KaTeX / Mermaid / 代码高亮 / 滚动同步仍留在 M2 |
| D-8 | 预览管线直接透传 mdast | 增加**原始 HTML 转义**与 **URL 协议白名单**两级处理 | 实测 `remark-rehype` 默认会把 `<br>`、`<div>` 整块**丢弃**（不是转义），查看器丢内容比显示得难看严重；同时 `[x](javascript:...)` 的 `href` 会原样输出，预览里有主进程 `will-navigate` 兜底，但 **M3 导出的 HTML 没有**，所以必须做在管线里 |
| D-9 | 配置读取假定文件是规范 JSON | `loadSettings` 先剥离 BOM | 实测用记事本 / PowerShell `Out-File -Encoding utf8` 改配置会写入 BOM，`JSON.parse` 直接抛错 → **全部设置静默回落默认值**（只在控制台留一行警告）。文档读取本就支持 `utf8-bom`，配置没理由更严格 |
| D-10 | 未规定派生视图的刷新策略 | 大纲 / 字数 / 搜索改为**尾沿防抖**（250ms / 150ms），换文档时立即重算 | 见下方实测数据：不防抖时 1 MB 文档每次按键要付 50ms+ 的扫描成本 |
| D-11 | `livePreviewLimitMB` / `largeFileWarnMB` 已进配置 | **尚未实现**，当前对大文件不生效 | 大文件降级是 D-10 之后仍未覆盖的场景，与 M2 的「视口渲染 + 阈值降级」一起做（见 R7） |
| D-12 | 未规定图标来源 | 用 `scripts/make-icon.cjs` **生成** `build/icon.png`（zlib + 手写 CRC32，零依赖） | 原配置指向 `build/icon.ico`，但 `build/` 根本不存在 → 打包必失败。二进制图标没法 review、没法改；脚本换配色只改几个常量重跑即可。electron-builder 接受 ≥256×256 PNG 并自行转 .ico |
| D-13 | `engines.node: >=22.12.0` | 放宽到 `>=22.11.0`，`test` / `dist:win` 改走 `scripts/run-node.cjs` 启动 | §1.4 原判断「只有 npm install 受影响」**已被实测推翻**：vitest 与 electron-builder 同样踩 `require(esm)`。与其要求升降级 Node，不如让脚本自适应（详见 §1.4） |
| D-14 | 未规定如何验证打包产物 | 增加 `scripts/probe-cdp.ps1` / `probe-type.ps1`，用 CDP 在**打包后的 exe** 里执行 JS | 单元测试测不到「打包是否真的可用」——asar 路径、资源收集、图标任一环节出问题都要等用户双击才发现。两个脚本**必须是纯 ASCII**（PowerShell 5.1 按 GBK 读无 BOM 的 .ps1，中文注释会乱码并吞掉代码，实测踩过） |
| D-15 | 表格进 Live Preview | 新增 `editor/tablePreview.ts`，用 **StateField**（不是 ViewPlugin）提供块级替换 | CM6 **禁止 ViewPlugin 提供块级装饰**：`ViewPlugin` 的 decorations 会被注册成函数式来源，`TileUpdate.emit` 直接抛 `RangeError: Block decorations may not be specified via plugins`（已在 jsdom 复现，异常从 `EditorView` 构造函数抛出）。只能走 `EditorView.decorations.from(field)`，与 `@codemirror/language` 的 `foldState` 同路。另一个反直觉点：StateField 看不见 viewport，但 `syntaxTree(state)` 本就只覆盖**已解析的那一段**，遍历它天然等于「只算看得见的」 |
| D-16 | 主题 CSS 常量的使用 | `main.ts` 注入 `THEME_VARIABLES_CSS` **和** `MARKDOWN_BODY_CSS`；新增 `test/theme-wiring.test.ts` 做结构断言 | **用户报的「表格没有渲染出来」有一半来自这里**：`MARKDOWN_BODY_CSS` 导出后始终没有任何 import，而预览面板正是靠它才有表格边框 / 代码块底色 / 链接配色。只注入变量那一份的后果是分栏预览的表格 `border-collapse: separate`、零边框、链接回落成浏览器默认蓝 `rgb(0,0,238)`——**看起来就是「没渲染」**。这类 bug 对现有全部机制隐形：`noUnusedLocals` 管不到 export、打包器不警告、单测测的是 `renderMarkdown` 产出的 HTML 字符串（样式在不在与它无关），所以补一条「导出了就必须有人用」的结构性断言 |
| D-17 | 正文配色的作用域 | 只收敛 `--cm-*` 变量；**保留**代码块内的语法高亮与链接蓝 | 根因是 `@lezer/markdown` 的标签带 `/...`，含义是**节点及其全部后代**：`"OrderedList/... BulletList/..."` → `tags.list` 于是**列表里的整段正文**都被染成橙色 `#953800`。标题 / 列表 / 行内代码统一改近黑，靠字号字重与浅灰底区分；链接是语义色、围栏代码块里的语法高亮是正常预期，都不在「正文」范围内 |
| D-18 | 命令行打开文件「窗口已建、监听器未注册」的丢文件竞态 | 新增 `src/main/pending-paths.ts` 缓冲：启动路径改由渲染进程**主动拉**（新通道 `app:takePendingPaths`），`second-instance` 与 macOS `open-file` 一并过同一个缓冲；渲染进程的监听器注册从 `onMounted` 提到 setup 体内 | `did-finish-load` 是**页面加载**事件，不是「监听器已就绪」事件——中间隔着 `settings.get` + `fs.stat` + `fs.readDir` 三跳 IPC，而 `webContents.send` **在没有监听器时静默丢弃**，表现就是「双击 .md，应用开了但是空文档」。这不是「打包才有」的问题，是**数据相关**的竞态：开发态工作区够大或磁盘够慢同样会丢。缓冲区把「就绪」的定义从「页面加载完」改成「渲染进程自己说它准备好了」，于是不存在可丢的时间窗。另外 `files.newFile()` 原先是**无条件**执行的，即使命令行已给了文件也会多出一个「未命名-1.md」标签，现改为 `files.sessions.length === 0` 守卫 |
| D-19 | 应用显示名与 `app.getName()` | 新增 `src/shared/app-meta.ts` 集中 `APP_TITLE` / `COMPANY_NAME` / `COPYRIGHT`；菜单改用 `APP_TITLE`；**刻意不给 `package.json` 加 `productName`** | ①「关于 marktext-clone」的成因：菜单取 `app.getName()`，而 `package.json` 没有 `productName`（`electron-builder.yml` 里那个不会写回 package.json——已在打包产物的 asar 里核实，33 MB 中 `productName` 出现 0 次），于是开发态与打包态都返回开发名。②**不加 `productName` 是刻意的**：`app.getName()` 同时喂给 `app.getPath('userData')`，加上它会让配置 / 最近文件 / 崩溃恢复**整体搬到新目录**，现有安装（含已分发的便携版）全部丢失设置——已核实 `%APPDATA%` 下只有 `marktext-clone`。显示名归显示名，存储目录名归存储目录名。③打包层的公司名与版权另走 `package.json` 的 `author` 与 `electron-builder.yml` 的 `copyright`（只影响 exe 文件属性，与 `userData` 无关） |

### 14.1 M1 实测性能数据

测量方式：`npm test` 里的性能基线用例（jsdom，取 1 MB 合成文档），
以及通过 DevTools 协议在**真实渲染进程**里用 `beforeinput → DOM 更新` 计时（1.19 M 字符 / 磁盘 2 MB 文档，Live Preview 开启）。

| 项目 | 优化前 | 优化后 |
| --- | --- | --- |
| 单次按键（真实渲染进程，中位数） | 32.7 ms | **9.0 ms** |
| 单次按键 p90 / 最大值 | 119.7 / 1849 ms | **10.4 / 10.6 ms** |
| 超过 100 ms 的按键占比 | 约 16% | **0 / 20** |
| `extractHeadings`（1 MB） | — | 17–28 ms |
| `countWords`（1 MB） | — | 26–66 ms |
| `findMatches`（1 MB） | — | 8–14 ms |
| CM6 强制整树解析（1 MB） | — | 约 495 ms（惰性解析下不会一次性触发） |

两个关键结论：

1. **主要成本不在编辑器内核，而在派生视图。** CM6 自身的 dispatch + 语法树只占 5–7 ms，
   但「每敲一个字就重扫全篇」的大纲 / 字数 / 搜索会把每次按键推到 50 ms 以上。
   防抖后，代价从「每次按键」变成「停下来之后一次」。
2. **`countWords` 的数组分配是真正的元凶。** 原来用 `content.match(/../g).length`，
   1 MB 中文文档约 54 万个词 → 每次都分配一个 54 万元素的数组，GC 压力直接表现为
   每几次按键卡 100 ms+。改成 `exec` 循环边匹配边计数后，最大值从 126 ms 降到 10.6 ms，
   中位数从 32.7 ms 降到 9.0 ms。

> 注：优化前的样本紧接文件加载后采集，优化后的样本先热了 3 次按键再采集，
> 两者的「冷启动」条件不完全对等；但 >100 ms 的**周期性**卡顿消失是明确的。
>
> 另外 `host.ts` 每次改动都调用 `doc.toString()` 把整篇文档拷成字符串写回 store，
> 实测占按键开销约 3/4（jsdom 下 5.1 ms 中的 3.85 ms）。这属于架构层面的代价，
> 不影响当前体验（余量约 2 倍），登记为 M5 的优化目标。

表格 Live Preview（D-15）加入后的复测，`perf.test.ts` 的 `console.log` 原始输出：

```
[1MB 编辑器]  单次按键=5.46ms 其中 doc.toString()=4.09ms
[1MB 编辑器]  强制整树解析=391.9ms
[装饰数量]    小文档=4  1MB 文档=19
[1MB 含表格]  单次按键=3.71ms
```

- 「1 MB 含表格」用的是每 4 个普通块夹一张表的合成文档（16 000 块 ≈ 1.0 MB，
  约 4 000 张表）。**3.71 ms 与不带表格的 5.46 ms 同量级**，说明 `syntaxTree` 的惰性解析
  天然把表格遍历限制在解析前沿内，表格数并不随文档总长线性增长。
- `装饰数量 小文档=4 / 1MB 文档=19` 是「只按可见区域建装饰」这条设计意图的钉子：
  文档大了 4000 倍，装饰数只从 4 涨到 19。真改成遍历全树，这个断言会随文档线性增长而挂掉。
- 解析 391.9 ms 是 `ensureSyntaxTree` **强制**解析整棵树的一次性成本，不是打开文件的成本；
  CM6 平时只解析视口，滚到哪解析到哪。

### 14.2 M1 实机验证记录

均通过 DevTools 协议在真实窗口中执行断言，而非只看日志：

| 验证项 | 结果 |
| --- | --- |
| 打开 2 MB / 1.19 M 字符文档 | 正常挂载，无报错；仅渲染 37 个行元素（CM6 视口虚拟化生效） |
| 大纲提取 | 10 000 条标题全部提取并渲染，无卡顿 |
| 状态栏字数 | 540 000 字 / 1 188 893 字符，与文档一致 |
| Live Preview | 光标行保留 `#`，其余行抹掉标记；标题按级别着色 |
| 大纲跳转 | 点第 9001 条 → 状态栏显示「行 108001」（= (9001-1)×12+1，与文档结构吻合），`scrollTop` 从 0 → 2 942 699（总高 3 270 061） |
| 分栏预览 | 表格、任务列表勾选框、`language-js` 代码块均正确渲染，无降级提示 |
| 带 BOM 的配置文件 | 修复前回落默认值，修复后正确采用 |

---

### 14.3 打包产物（首个可分发 exe）

`npm run dist:win` 产出（electron-builder 26.15.3 / electron 44.4.5 / x64）：

| 产物 | 大小 | 用途 |
| --- | --- | --- |
| `release/MarkText 克隆版 Setup 0.1.0.exe` | 112.5 MB | NSIS 安装包（可选安装目录、建桌面/开始菜单快捷方式、关联 `.md`） |
| `release/MarkText 克隆版 0.1.0.exe` | 112.4 MB | 免安装便携版，双击即用 |
| `release/win-unpacked/` | — | 未压缩目录，便于排查 |

图标链路已打通：`scripts/make-icon.cjs` 生成 PNG → electron-builder 转 `release/.icon-ico/icon.ico`。

**实机验证**（在**打包后的便携版**上，非 dev 构建，通过 CDP 执行真实断言）：

| 验证项 | 结果 |
| --- | --- |
| 进程与窗口 | 正常启动，窗口标题「MarkText 克隆版」，5 个进程（主 + 渲染 + GPU + 工具） |
| 渲染进程挂载 | `.cm-editor` 存在，UI 完整（标签栏、状态栏） |
| UI 中文 | 状态栏读到「行 1，列 1 / 0 字 / 0 字符 / UTF-8 / LF / 实时预览 / 16 px」 |
| 真实输入 | 经 `Input.insertText` 敲入一段 Markdown，内容正确落盘到编辑器 |
| 字数统计 | 单份文档 = 24 字 / 45 字符、7 行；**连打两遍恰好 2 倍**，证明无重复插入 |

> 未完全验证的一项：**关闭有未保存内容的窗口**时，主进程会拦截 `close` 并让渲染进程弹
> 「保存 / 不保存 / 取消」。该弹窗走 Electron 原生 `dialog.showMessageBox`，**不在 DOM 里**，
> 我的 DOM 断言看不到它；曾尝试枚举原生窗口但探针未取到结果，**故此项未证实**，
> 需要在实机上点一下 X 确认。代码路径见 `src/main/window.ts:97`、`src/renderer/app-wiring.ts:96`。

---

### 14.4 表格渲染 + 正文配色修复的实机验证（D-15 / D-16 / D-17）

在**重新打包后的便携版**上执行（`--remote-debugging-port` + `scripts/probe-cdp.ps1`），
打开验证文档 `scripts/fixtures/preview-check.md`（含标题 / 列表 / 行内代码 / 表格 /
引用 / 代码块 / 链接，覆盖本轮改动的全部语法；留着它是为了让这段验证可复现）：

```
release/win-unpacked/MarkText 克隆版.exe --remote-debugging-port=9224 scripts/fixtures/preview-check.md
powershell -File scripts/probe-cdp.ps1 -Port 9224 -Expression "<js>"
```

**表格（D-15）** —— 走完了完整往返，不是只看初始状态：

| 操作 | 实测 |
| --- | --- |
| 光标在表格外 | `.cm-lp-table` ×1，含真 `<table>`，表头「姓名」，4 行；源码 `\| 姓名 \|` 不在 DOM 里 |
| 在表格上按下鼠标 | widget 归 0，`.cm-content` 重新出现 `\| 姓名 \| 年龄 \| 城市 \|` 源码 |
| 点文档末尾（光标离开表格） | widget 回到 1，表头「姓名」，源码再次隐藏 |

> 「点击进表格」此前只是源码层推断（`posAtCoords` 需要真实布局）。**这次实机点通了**：
> 命中位置实测在 `top=356 / 高 135 / 宽 1270`，说明块级 widget 有真实高度，
> `estimatedHeight` 未造成零高度塌陷。

**配色（D-17）** —— 取 `getComputedStyle` 实算值，不是肉眼判断：

| 元素 | 实测 | 结论 |
| --- | --- | --- |
| 标题 / 正文 / **列表项正文** / 行内代码 | `rgb(31,35,40)` | 近黑 ✓（列表原为橙 `#953800`，行内代码原为红 `#cf222e`） |
| 链接 | `rgb(9,105,218)` | 蓝 ✓（刻意保留） |
| 语法标记 `#` `-` | `rgb(140,149,159)` | 灰 ✓（刻意弱化） |

**两栏一致性（D-16）** —— 分栏预览下对比两侧表格的 `<th>` / `<td>` 文本结构：

```
编辑器 widget：表头 ["姓名","年龄","城市"]，3 行数据
预览面板：    表头 ["姓名","年龄","城市"]，3 行数据
完全一致 ✓
```

复用 `renderMarkdown` 这条决定因此得到验证：两侧不是「各实现一遍、靠人同步」，
而是同一条管线，结构必然一致。

> **这一节顺带暴露了 14.2 的一处验证盲区**：14.2 里「分栏预览」那行写的是
> 「表格、任务列表勾选框、`language-js` 代码块**均正确渲染**」——当时断言的是
> **元素存在**（`querySelector('table')` 命中即算通过），而**样式完全没查**。
> 于是 `MARKDOWN_BODY_CSS` 从未注入这个真 bug（D-16）从 14.2 一路漏到了用户手里。
> 教训：验证「渲染」时，元素存在与样式生效是两件事，缺一不可。

---

### 14.5 命令行打开文件 + 关于对话框的实机验证（D-18 / D-19）

在**重新打包后的 exe** 上执行（`release/win-unpacked/MarkText 克隆版.exe`）。
这一轮除了渲染进程的 CDP 探针，还新增了**主进程**探针——`scripts/probe-cdp.ps1`
加了 `-TargetType node`，配合 `--inspect=9229` 连主进程调试目标。菜单结构与
原生对话框的 payload 只有在这一侧才看得到。

| # | 场景 | 实测 |
| --- | --- | --- |
| 1 | `MarkText 克隆版.exe scripts\fixtures\preview-check.md` | 标签 `["preview-check.md"]`——**只有一个**，且**没有 `未命名-1.md`**；侧栏根 `E:/cc/markdown_editor/scripts/fixtures`（= 文件所在目录），树 8 个节点 |
| 2 | 不带参数启动 | 标签 `["未命名-1.md"]`，工作区还原为上次的 `scripts/fixtures` |
| 3 | 带一个**不存在**的路径 | 标签 `["未命名-1.md"]`（空白标签）**且**工作区仍被还原；同时抓到提示 `文件不存在：does-not-exist.md` |
| 4 | 窗口已开时启动第二实例打开 `sub/second.md` | 标签变为 `["preview-check.md","second.md"]`，激活 `second.md`，而侧栏根**仍是** `scripts/fixtures`（未跳到 `sub`） |
| 5 | exe 文件属性 | `CompanyName: 中色丝路资源科技（北京）有限公司`、`LegalCopyright: 版权所有 © 2026 中色丝路资源科技（北京）有限公司`（原为 `marktext-clone` / `Copyright © 2026`） |
| 6 | 菜单文案与关于对话框 | 文件子菜单含「打开文件…」；帮助子菜单为「关于 **MarkText 克隆版**」；拦截到的 `showMessageBox` payload 见下 |

第 6 项捕获到的 payload（在主进程 patch `dialog.showMessageBox` 记录，而非真的弹窗）：

```json
{"type":"info","title":"关于 MarkText 克隆版","message":"MarkText 克隆版 0.1.0",
 "detail":"版权所有 © 2026 中色丝路资源科技（北京）有限公司\n\nElectron 44.4.5 · Chromium 152.0.7977.130 · Node 24.21.0",
 "buttons":["确定"]}
```

整条链路（菜单 click → `MENU_COMMAND` 推送 → 命令 → `app.info()` → `dialog:message`
→ 主进程 `showMessageBox`）都走到了，只有最后的原生绘制没走。

#### 三处需要记住的验证教训

**① 第 3 项如果不抓提示条就是一条空转的断言。** 「带一个不存在的路径 → 空白标签」
与「参数被静默丢弃 → 空白标签」**结果完全相同**。真正把两者区分开的是那条
`文件不存在：…` 提示——它证明路径确实被解析、投递、并走到了 `fs.stat` 分支。
提示条只存活 3.2 s（`NOTICE_DURATION`），第一次探针晚了 8 秒接入，什么也没抓到；
把接入改成「轮询 CDP 端点，就绪即连」后 100 ms 就接上了。

**② 我自己制造了一次假故障。** 第一次跑第 1 项得到 `["未命名-2.md","未命名-3.md"]`
且进程随后消失。原因不是应用：等待打包完成的判据写成了「两个 exe 文件都存在」，
而 `release/MarkText 克隆版 Setup 0.1.0.exe` 是**上一次构建**的遗留文件，
于是判据在 electron-builder 还没跑完时就满足了，我在打包器仍在改写
`release/win-unpacked` 的过程中启动了应用。教训：等待构建结束要等**构建进程本身**，
不要用「产物文件存在」这种会被陈旧文件满足的判据。

**③ `sidebar.visible` 默认是 `true`（`DEFAULT_SETTINGS`），这台机器上是 `false`**
（早先手工关过）。侧栏隐藏时 `.sidebar__section-title` 根本不在 DOM 里，
「侧栏根 = 文件所在目录」这条断言就无从谈起——第一轮探针因此读到 `null`。
验证前把该字段打开，验证后已改回 `false`；`lastOpenFolder` 同样在验证后复位为 `null`。

#### 一条顺带发现（不在本次范围）

`lastOpenFolder` **只由菜单的「打开文件夹…」命令写入**（`commands/index.ts:64`），
`workspace.openFolder()` 自身不写回。因此「用命令行打开一个 md」自动推导出的工作区
**不会被记住**，下次启动不会还原它。第 2 项需要还原工作区，是靠先手工写入
`lastOpenFolder`（等价于用户点过一次「打开文件夹」）才验成的。
这是否是期望行为需要你定：**倾向保持现状**——自动推导出的目录不是用户的选择，
把它当成「上次打开的文件夹」写回去，等于让一次双击悄悄改掉用户的偏好设置。

---

*文档结束 · M0、M1 已完成编码；M1 验收见 14.1 / 14.2，打包产物见 14.3，
表格与配色修复的实机验证见 14.4，命令行打开文件与关于对话框的验证见 14.5，M2 待启动*
