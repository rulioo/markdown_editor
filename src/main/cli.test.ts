/**
 * 命令行解析的边界。
 *
 * 断言一律写成 `resolve(输入)` 而不是写死绝对路径——测试要能在任何机器、
 * 任何 CWD 下跑，写死盘符就绑死在开发机上了。
 */

import { describe, expect, it } from 'vitest'
import { resolve } from 'node:path'
import { extractDocumentPaths } from './cli'

const EXE = 'C:\\app\\marktext.exe'

describe('extractDocumentPaths', () => {
  it('没有参数时返回空数组', () => {
    expect(extractDocumentPaths([])).toEqual([])
  })

  it('只有 exe 自己时返回空数组', () => {
    expect(extractDocumentPaths([EXE])).toEqual([])
  })

  it('收下所有约定内的文档扩展名', () => {
    const argv = [EXE, 'a.md', 'b.markdown', 'c.mdown', 'd.mkd', 'e.txt']
    expect(extractDocumentPaths(argv)).toEqual([
      resolve('a.md'),
      resolve('b.markdown'),
      resolve('c.mdown'),
      resolve('d.mkd'),
      resolve('e.txt')
    ])
  })

  it('扩展名大小写不敏感，且保留原始大小写交给文件系统', () => {
    // Windows 上大小写不敏感，所以这里只断言「被收下了」，不断言规范化后的形式
    expect(extractDocumentPaths([EXE, 'README.MD'])).toHaveLength(1)
    expect(extractDocumentPaths([EXE, 'README.MD'])[0]).toContain('README.MD')
  })

  it('明确拒绝 .mdx——它是带 JSX 的方言，按 markdown 渲染会出错', () => {
    expect(extractDocumentPaths([EXE, 'component.mdx'])).toEqual([])
  })

  it('拒绝不是文档的普通参数', () => {
    expect(extractDocumentPaths([EXE, 'foo', 'bar.png', 'baz.js'])).toEqual([])
  })

  it('相对路径解析成绝对路径', () => {
    const [absolute] = extractDocumentPaths([EXE, 'docs/guide.md'])
    expect(absolute).toBe(resolve('docs/guide.md'))
  })

  it('路径里的空格不被拆词（Chromium 已按引号拆过，这里不该再动）', () => {
    const [absolute] = extractDocumentPaths([EXE, 'my notes/hello world.md'])
    expect(absolute).toBe(resolve('my notes/hello world.md'))
  })

  it('去掉成对的首尾引号', () => {
    const [absolute] = extractDocumentPaths([EXE, '"my notes/a.md"'])
    expect(absolute).toBe(resolve('my notes/a.md'))
  })

  it('过滤 Chromium 开关，且文档路径出现的位置不影响结果', () => {
    const switches = [
      '--remote-debugging-port=9223',
      '--inspect',
      '--enable-logging'
    ]
    expect(extractDocumentPaths([EXE, ...switches, 'a.md'])).toEqual([resolve('a.md')])
    expect(extractDocumentPaths([EXE, 'a.md', ...switches])).toEqual([resolve('a.md')])
    expect(extractDocumentPaths([EXE, 'a.md', ...switches, 'b.md'])).toEqual([
      resolve('a.md'),
      resolve('b.md')
    ])
  })

  it('开关的裸值（9223）不含扩展名，会被自然挡掉', () => {
    expect(extractDocumentPaths([EXE, '--remote-debugging-port=9223', '9223'])).toEqual([])
  })

  it('以 - 开头的文件名被拒，但加路径前缀后可以逃生', () => {
    // 这是**已知限制**，不是 bug。两条断言钉住限制与逃生办法，
    // 免得日后有人只「修好」其中一半。
    expect(extractDocumentPaths([EXE, '-draft.md'])).toEqual([])
    expect(extractDocumentPaths([EXE, './-draft.md'])).toEqual([resolve('./-draft.md')])
  })

  it('结尾带斜杠的路径不当作文件——交给 store 的目录分支去拒绝', () => {
    // 职责划分：这里只管「像不像文档路径」，能不能打开是 openPath 的事
    expect(extractDocumentPaths([EXE, 'docs.md/'])).toEqual([])
    expect(extractDocumentPaths([EXE, 'docs.md'])).toEqual([resolve('docs.md')])
  })

  it('重复路径按 resolve 后的精确字符串去重', () => {
    expect(extractDocumentPaths([EXE, 'a.md', './a.md', 'a.md'])).toEqual([resolve('a.md')])
  })

  it('保序：先出现的排在前面', () => {
    expect(extractDocumentPaths([EXE, 'z.md', 'a.md'])).toEqual([
      resolve('z.md'),
      resolve('a.md')
    ])
  })
})
