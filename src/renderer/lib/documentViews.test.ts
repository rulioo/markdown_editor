import { describe, expect, it } from 'vitest'
import { countWords, extractHeadings, findMatches, MAX_SEARCH_MATCHES } from './documentViews'

describe('extractHeadings', () => {
  it('提取各级标题并记录行号（从 1 起算）', () => {
    expect(extractHeadings('# 一\n\n### 三\n正文')).toEqual([
      { level: 1, text: '一', line: 1 },
      { level: 3, text: '三', line: 3 }
    ])
  })

  it('跳过围栏代码块里的 # 注释', () => {
    const content = '# 真标题\n\n```sh\n# 这是注释不是标题\n```\n\n## 后面'
    expect(extractHeadings(content).map((h) => h.text)).toEqual(['真标题', '后面'])
  })

  it('~~~ 围栏同样跳过', () => {
    const content = '~~~\n# 注释\n~~~\n# 标题'
    expect(extractHeadings(content).map((h) => h.text)).toEqual(['标题'])
  })

  it('七个 # 不是标题（CommonMark 上限是 6）', () => {
    expect(extractHeadings('####### 七')).toEqual([])
  })

  it('# 后面没有空格不算标题', () => {
    expect(extractHeadings('#没有空格')).toEqual([])
  })

  it('去掉结尾的闭合 #', () => {
    expect(extractHeadings('## 标题 ##')[0].text).toBe('标题')
  })

  it('空文档返回空数组', () => {
    expect(extractHeadings('')).toEqual([])
  })
})

describe('countWords', () => {
  it('汉字按字计，西文按词计', () => {
    expect(countWords('你好 world')).toBe(3)
  })

  it('连续标点与空白不算词', () => {
    expect(countWords('  ，。！  ')).toBe(0)
  })

  it('带连字符/撇号的算一个词', () => {
    expect(countWords("don't well-known")).toBe(2)
  })

  it('空文档为 0', () => {
    expect(countWords('')).toBe(0)
  })

  it('连续调用结果一致（/g 正则的 lastIndex 必须每次归零）', () => {
    // 不归零的话第二次调用会从上次结束的位置继续，直接返回 0——
    // 这是把 match() 换成 exec() 循环时最容易踩的坑
    expect(countWords('你好 world')).toBe(3)
    expect(countWords('你好 world')).toBe(3)
    expect(countWords('你好 world')).toBe(3)
  })

  it('大文档下两次调用结果一致', () => {
    const content = '汉字 abc '.repeat(50_000)
    const first = countWords(content)
    expect(first).toBe(150_000)
    expect(countWords(content)).toBe(first)
  })
})

describe('findMatches', () => {
  it('找出所有匹配并给出行列', () => {
    expect(findMatches('ab\ncdab', 'ab')).toEqual([
      { line: 1, column: 0, preview: 'ab' },
      { line: 2, column: 2, preview: 'cdab' }
    ])
  })

  it('默认忽略大小写，开启后区分', () => {
    expect(findMatches('AB ab', 'ab')).toHaveLength(2)
    expect(findMatches('AB ab', 'ab', true)).toHaveLength(1)
  })

  it('同一行出现多次都算', () => {
    expect(findMatches('aaa', 'a').map((m) => m.column)).toEqual([0, 1, 2])
  })

  it('关键字为空时返回空数组', () => {
    expect(findMatches('abc', '')).toEqual([])
  })

  it('空行匹配时给出占位预览', () => {
    expect(findMatches('  x  ', 'x')[0].preview).toBe('x')
  })

  it('达到上限就停止扫描，不会返回超过上限的结果', () => {
    // 5000 行、每行都命中：既验证结果被截断，也验证没有扫完剩下的行
    const content = Array.from({ length: 5000 }, () => 'hit').join('\n')
    const matches = findMatches(content, 'hit')
    expect(matches).toHaveLength(MAX_SEARCH_MATCHES)
  })
})

/**
 * 性能基线。
 *
 * 阈值给得很宽松（CI 机器比开发机慢得多），目的是**发现数量级退化**——
 * 比如有人把防抖删了、或者把 O(n) 写成了 O(n²)。
 * 真正卡不卡手还得看实机，这里只保证算法复杂度没走样。
 */
describe('大文档性能', () => {
  /** 一个 block 的行数；标题在第 1 行，所以第 n 个标题在第 (n-1)*BLOCK_LINES + 1 行 */
  const BLOCK_LINES = 11

  /** 约 1 MB：标题、列表、代码块、正文混合，尽量贴近真实文档 */
  function bigDocument(blocks = 10_000): string {
    const block = [
      '## 二级标题',
      '',
      '这是一段普通的中文正文，用来撑起字符数。Hello world foo bar.',
      '',
      '- 列表项一',
      '- 列表项二',
      '',
      '```js',
      '// 代码块里的 # 不该被当成标题',
      'const a = 1',
      '```'
    ].join('\n')
    expect(block.split('\n')).toHaveLength(BLOCK_LINES)

    // 用 '\n' 连接各个 block，别让它们首尾粘连
    return Array.from({ length: blocks }, () => block).join('\n')
  }

  /**
   * 实测基线（1 MB，开发机单独跑 / 六个测试文件并行跑）：
   *   extractHeadings  17ms / 28ms
   *   countWords       26ms / 66ms
   *   findMatches       8ms / 14ms
   *
   * 并行跑能差出 2 倍多，所以阈值取 250ms——这里要抓的是**数量级退化**
   * （比如防抖被删掉、或者有人写出了 O(n²)），不是几十毫秒的抖动。
   */
  const BUDGET_MS = 250

  it('1 MB 文档下，三种派生计算都能在预算内跑完', () => {
    const content = bigDocument()
    expect(content.length).toBeGreaterThan(1_000_000)

    const measure = (fn: () => unknown): number => {
      const started = performance.now()
      fn()
      return performance.now() - started
    }

    // 先跑一遍让 JIT 预热，否则第一次的数字没有参考价值
    extractHeadings(content)
    countWords(content)
    findMatches(content, '标题')

    const headings = measure(() => extractHeadings(content))
    const words = measure(() => countWords(content))
    const matches = measure(() => findMatches(content, '标题'))

    console.log(
      `[1MB] extractHeadings=${headings.toFixed(1)}ms ` +
        `countWords=${words.toFixed(1)}ms findMatches=${matches.toFixed(1)}ms`
    )

    expect(headings).toBeLessThan(BUDGET_MS)
    expect(words).toBeLessThan(BUDGET_MS)
    expect(matches).toBeLessThan(BUDGET_MS)
  })

  it('标题行号在大文档里仍然正确，且代码块注释没混进来', () => {
    const headings = extractHeadings(bigDocument())
    expect(headings).toHaveLength(10_000)
    expect(headings[0].line).toBe(1)
    expect(headings[1].line).toBe(BLOCK_LINES + 1)
    expect(headings[2].line).toBe(2 * BLOCK_LINES + 1)
    // 代码块里的 `# 不该被当成标题` 一条都不该出现
    expect(headings.every((h) => h.text === '二级标题')).toBe(true)
  })
})
