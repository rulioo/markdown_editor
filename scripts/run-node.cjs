#!/usr/bin/env node
/**
 * 通用 Node 入口启动器：`node scripts/run-node.cjs <入口文件> [...参数]`
 *
 * 为什么需要它：本机是 Node 22.11，而 `require(esm)`（在 CJS 里直接 require 一个
 * 纯 ESM 包）直到 **Node 22.12** 才默认开启。至少有两个工具会踩到：
 *   - vitest 5：配置加载时 require 了 std-env
 *   - electron-builder 26：生成 blockmap 时 require 了 @noble/hashes/blake2.js
 * 在 22.11 上它们都会以 ERR_REQUIRE_ESM 直接崩掉——**这不是项目代码的问题**，
 * 详见 design.md §1.4。
 *
 * 所以这里按 Node 版本条件性地补上 `--experimental-require-module`：
 *  - Node < 22.12：需要这个开关，否则起不来
 *  - Node ≥ 22.12：默认已开启，不加（避免未来版本移除该选项后变成硬错误）
 *
 * 用 node 脚本而不是在 npm script 里写 `NODE_OPTIONS=... tool`：
 * 后者是 shell 语法，在 Windows 的 cmd 下会直接报错。
 * 环境变量会被子进程继承，所以 electron-builder 自己拉起的 node 子进程也生效。
 */

const { spawn } = require('node:child_process')
const { join, isAbsolute } = require('node:path')

const [entry, ...args] = process.argv.slice(2)
if (!entry) {
  console.error('用法：node scripts/run-node.cjs <入口文件> [...参数]')
  process.exit(2)
}

const [major, minor] = process.versions.node.split('.').map(Number)
const needsFlag = major < 22 || (major === 22 && minor < 12)

const env = { ...process.env }
if (needsFlag && !(env.NODE_OPTIONS ?? '').includes('--experimental-require-module')) {
  env.NODE_OPTIONS = `${env.NODE_OPTIONS ?? ''} --experimental-require-module`.trim()
}

// 相对入口按项目根目录解析，这样从任何 cwd 调用都能找到
const target = isAbsolute(entry) ? entry : join(__dirname, '..', entry)

const child = spawn(process.execPath, [target, ...args], {
  stdio: 'inherit',
  env
})

child.on('exit', (code, signal) => {
  process.exit(signal ? 1 : (code ?? 0))
})
