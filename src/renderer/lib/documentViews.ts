/**
 * 整篇文档的派生视图（大纲、字数、查找结果）。
 *
 * 这些函数都是 O(文档长度) 的，而编辑区每敲一个字都会更新 content——
 * 所以**调用方必须防抖**（见 composables/useDeferredValue.ts）。
 * 放在这里而不是组件里，是为了能单独测：大文档下的行为光靠手点试不出来。
 *
 * M2 会用统一的 mdast 管线替换这里的正则实现，语义更准（例如缩进代码块、
 * 行内的 `#`），届时保持函数签名不变即可。
 */

export interface Heading {
  level: number
  text: string
  /** 行号从 1 起算，与状态栏、搜索结果保持一致 */
  line: number
}

/**
 * 提取标题。
 *
 * 必须跳过围栏代码块内的内容——否则代码里的 `# 注释` 会被误当成标题。
 */
export function extractHeadings(content: string): Heading[] {
  const result: Heading[] = []
  if (!content) return result

  let insideFence = false
  const lines = content.split('\n')

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]

    if (/^\s*(```|~~~)/.test(line)) {
      insideFence = !insideFence
      continue
    }
    if (insideFence) continue

    const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line)
    if (match) {
      result.push({ level: match[1].length, text: match[2].trim(), line: index + 1 })
    }
  }

  return result
}

/** 汉字算一个字，连续的西文字母/数字算一个词（与 Word 的中文计数一致） */
const WORD_PATTERN = /[一-鿿]|[a-zA-Z0-9_'-]+/g

/**
 * 字数统计。
 *
 * 刻意**不用** `content.match(WORD_PATTERN).length`：那会为每个词分配一个数组元素，
 * 而 1 MB 中文文档约有 54 万个词——等于每次统计都造一个 54 万元素的数组。
 * 实测这会带来明显的 GC 压力（实机打字每隔几次就卡 100ms 以上）。
 * 改成边匹配边计数，同样一遍扫描，但不产生任何中间数组。
 *
 * 字符数不在这里算：调用方用 content.length 即可（O(1)，不必防抖）。
 */
export function countWords(content: string): number {
  if (!content) return 0
  // 模块级正则带 /g，lastIndex 是跨调用共享的，用之前必须归零
  WORD_PATTERN.lastIndex = 0
  let count = 0
  while (WORD_PATTERN.exec(content) !== null) count += 1
  return count
}

export interface SearchMatch {
  line: number
  column: number
  preview: string
}

/** 结果上限：再多大文档也不该把面板撑爆 */
export const MAX_SEARCH_MATCHES = 500
const PREVIEW_LENGTH = 120

/**
 * 当前文档内查找。
 *
 * 注意每行都要按大小写不敏感做一次 toLowerCase——那是逐行的字符串分配，
 * 在大文档上是主要开销，所以这里**一旦达到上限就整体退出**，
 * 而不是继续扫完剩下的行（原来的写法会一直扫到文末，白做功）。
 */
export function findMatches(
  content: string,
  keyword: string,
  caseSensitive = false
): SearchMatch[] {
  if (!keyword || !content) return []

  const needle = caseSensitive ? keyword : keyword.toLowerCase()
  const result: SearchMatch[] = []
  const lines = content.split('\n')

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const haystack = caseSensitive ? line : line.toLowerCase()

    let from = haystack.indexOf(needle)
    while (from !== -1) {
      result.push({
        line: index + 1,
        column: from,
        preview: line.trim().slice(0, PREVIEW_LENGTH) || '（空行）'
      })
      if (result.length >= MAX_SEARCH_MATCHES) return result
      from = haystack.indexOf(needle, from + needle.length)
    }
  }

  return result
}
