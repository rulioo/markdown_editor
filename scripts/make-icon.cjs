#!/usr/bin/env node
/**
 * 生成应用图标（build/icon.png，256×256）。
 *
 * 为什么要写脚本而不是直接丢一个 png 进仓库：二进制资源没法 review、没法改。
 * 需要换配色或调整形状时，改这里的几个常量重跑一次即可：
 *   node scripts/make-icon.cjs
 *
 * electron-builder 接受 ≥256×256 的 PNG，并会自己转换成 Windows 需要的 .ico。
 *
 * 图形：圆角方块 + 几条长短不一的「文本行」+ 一个向下的箭头（暗示「导出」）。
 * 只用矩形和三角形拼，不依赖任何绘图库——也就避免了为一个图标引入依赖。
 */

const fs = require('node:fs')
const path = require('node:path')
const zlib = require('node:zlib')

const SIZE = 256
const RADIUS = 52
const BG = [37, 99, 235] // #2563eb
const TEXT_LINE = [255, 255, 255]
const ARROW = [147, 197, 253] // #93c5fd，比正文行浅一档，避免抢视线

/** 圆角矩形的覆盖判定 */
function insideRoundedRect(x, y) {
  const r = RADIUS
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return false
  // 四个角各自按圆判断
  const cx = x < r ? r : x > SIZE - 1 - r ? SIZE - 1 - r : x
  const cy = y < r ? r : y > SIZE - 1 - r ? SIZE - 1 - r : y
  if (cx === x && cy === y) return true
  const dx = x - cx
  const dy = y - cy
  return dx * dx + dy * dy <= r * r
}

/** 抗锯齿：对每个像素做 4×4 超采样，边缘才不会是一格一格的 */
const SS = 4

/** 判断某个子采样点属于图标主体还是某条文本行；返回颜色或 null（透明） */
function sampleColor(px, py) {
  if (!insideRoundedRect(px, py)) return null

  // 文本行：5 条，长短不一，模拟一段文字
  const lines = [
    { top: 74, height: 16, left: 56, right: 200 },
    { top: 104, height: 16, left: 56, right: 168 },
    { top: 134, height: 16, left: 56, right: 200 },
    { top: 164, height: 16, left: 56, right: 140 }
  ]
  for (const line of lines) {
    if (
      py >= line.top &&
      py < line.top + line.height &&
      px >= line.left &&
      px < line.right &&
      px < SIZE - 1 - RADIUS + RADIUS // 保持在圆角内
    ) {
      return TEXT_LINE
    }
  }

  // 右下角的向下箭头
  const arrowCx = 188
  const stemTop = 158
  const stemBottom = 194
  const stemHalf = 9
  if (py >= stemTop && py <= stemBottom && Math.abs(px - arrowCx) <= stemHalf) return ARROW
  // 三角箭头头部
  const headTop = stemBottom
  const headHeight = 26
  const headHalf = 26
  const t = (py - headTop) / headHeight
  if (t >= 0 && t <= 1 && Math.abs(px - arrowCx) <= headHalf * (1 - t)) return ARROW

  return BG
}

function render() {
  const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1))
  for (let y = 0; y < SIZE; y += 1) {
    const rowStart = y * (SIZE * 4 + 1)
    raw[rowStart] = 0 // filter type 0 (None)
    for (let x = 0; x < SIZE; x += 1) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          const c = sampleColor(x + (sx + 0.5) / SS, y + (sy + 0.5) / SS)
          if (c) {
            r += c[0]
            g += c[1]
            b += c[2]
            a += 255
          }
        }
      }
      const n = SS * SS
      const offset = rowStart + 1 + x * 4
      if (a > 0) {
        // 颜色按「有覆盖的采样点」平均，alpha 按总采样点平均
        const cover = a / 255
        raw[offset] = Math.round(r / cover)
        raw[offset + 1] = Math.round(g / cover)
        raw[offset + 2] = Math.round(b / cover)
        raw[offset + 3] = Math.round(a / n)
      }
    }
  }
  return raw
}

/* ------------------------------ PNG 封装 ------------------------------ */

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(typeAndData), 0)
  return Buffer.concat([length, typeAndData, crc])
}

function toPng(raw) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(SIZE, 0)
  ihdr.writeUInt32BE(SIZE, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type: RGBA
  ihdr[10] = 0 // compression
  ihdr[11] = 0 // filter
  ihdr[12] = 0 // interlace
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

const target = path.join(__dirname, '..', 'build', 'icon.png')
fs.mkdirSync(path.dirname(target), { recursive: true })
fs.writeFileSync(target, toPng(render()))
console.log(`已生成 ${target}（${SIZE}×${SIZE}，${fs.statSync(target).size} 字节）`)
