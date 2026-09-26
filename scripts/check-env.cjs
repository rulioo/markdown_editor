/**
 * 安装后环境自检。
 *
 * 背景：Node < 22.12 时，electron 的 postinstall 会静默失败
 * （`require() of ES Module @electron/get`），npm 只报 EBADENGINE 警告，
 * 结果是一个「装完了但跑不起来」的 node_modules —— `npx electron .` 找不到二进制。
 * 这里把那个沉默的失败变成一条明确的中文提示。
 *
 * 永不 return 非零退出码：安装本身是成功的，只是可能少了 Electron 二进制。
 */
const { existsSync, readFileSync } = require('node:fs')
const { join } = require('node:path')

const ROOT = join(__dirname, '..')
const MIN_NODE = [22, 12, 0]

const [major, minor, patch] = process.versions.node.split('.').map(Number)
const tooOld =
  major < MIN_NODE[0] ||
  (major === MIN_NODE[0] && (minor < MIN_NODE[1] || (minor === MIN_NODE[1] && patch < MIN_NODE[2])))

const electronDir = join(ROOT, 'node_modules', 'electron')
const pathTxt = join(electronDir, 'path.txt')

function electronBinaryOk() {
  if (!existsSync(pathTxt)) return false
  const rel = readFileSync(pathTxt, 'utf8').trim()
  return rel.length > 0 && existsSync(join(electronDir, 'dist', rel))
}

const lines = []
lines.push(`[环境自检] Node ${process.versions.node}`)

if (tooOld) {
  lines.push(
    `  ⚠ 低于本栈推荐下限 v${MIN_NODE.join('.')}（vite / electron-vite / electron / vitest 的 engines 均要求）。`,
    '    已知影响：仅 npm install 这一步——项目自己的命令（test / dist:win）都经',
    '    scripts/run-node.cjs 启动，会自动补 --experimental-require-module。',
    '    若 Electron 二进制没下下来，按下面的命令补装。'
  )
}

if (!electronBinaryOk()) {
  lines.push(
    '',
    '  ✗ 未找到 Electron 二进制，应用无法启动。补装命令：',
    '',
    '      cd node_modules/electron',
    '      ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ \\',
    '        node --experimental-require-module install.js',
    '',
    '    Windows PowerShell：',
    '',
    '      cd node_modules/electron',
    '      $env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"',
    '      node --experimental-require-module install.js',
    '',
    '    根治办法：升级到 Node 22.12+ / 24 LTS 后重新 npm install。'
  )
} else if (!tooOld) {
  lines.push('  ✓ 环境正常')
}

console.log('\n' + lines.join('\n') + '\n')
