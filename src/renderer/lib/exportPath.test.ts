import { describe, expect, it } from 'vitest'
import { defaultExportPath, exportTitle } from './exportPath'

describe('defaultExportPath', () => {
  it('同目录换扩展名', () => {
    expect(defaultExportPath('E:\\docs\\报告.md', 'html', 'x.md')).toBe('E:\\docs\\报告.html')
    expect(defaultExportPath('/tmp/a.md', 'pdf', 'x.md')).toBe('/tmp/a.pdf')
    expect(defaultExportPath('/tmp/a.md', 'docx', 'x.md')).toBe('/tmp/a.docx')
  })

  it('其它 Markdown 扩展名也认', () => {
    for (const ext of ['markdown', 'mdown', 'mkd', 'txt']) {
      expect(defaultExportPath(`/tmp/a.${ext}`, 'html', 'x.md')).toBe('/tmp/a.html')
    }
  })

  it('大写扩展名不叠加（Windows 上文件名大小写不敏感，但字符串替换是敏感的）', () => {
    expect(defaultExportPath('/tmp/a.MD', 'html', 'x.md')).toBe('/tmp/a.html')
    expect(defaultExportPath('/tmp/a.HTML', 'pdf', 'x.md')).toBe('/tmp/a.HTML.pdf')
  })

  it('路径里的点不会被误伤', () => {
    expect(defaultExportPath('/tmp/v1.2/报告.md', 'html', 'x.md')).toBe('/tmp/v1.2/报告.html')
    expect(defaultExportPath('/tmp/v1.2.md', 'html', 'x.md')).toBe('/tmp/v1.2.html')
  })

  it('没有扩展名时补上', () => {
    expect(defaultExportPath('/tmp/report', 'html', 'x.md')).toBe('/tmp/report.html')
  })

  it('未保存文档：只给文件名，不带目录（让系统对话框用自己的默认目录）', () => {
    expect(defaultExportPath(null, 'pdf', '未命名-1.md')).toBe('未命名-1.pdf')
    expect(defaultExportPath(null, 'html', '无扩展名')).toBe('无扩展名.html')
  })

  it('不认识的扩展名保留原样（宁可叠一层，也不要吞掉用户文件名的一部分）', () => {
    expect(defaultExportPath('/tmp/a.tar.gz', 'html', 'x.md')).toBe('/tmp/a.tar.gz.html')
  })
})

describe('exportTitle', () => {
  it('用文件名去掉扩展名', () => {
    expect(exportTitle('E:\\docs\\季度报告.md', 'x', 'App')).toBe('季度报告')
    expect(exportTitle('/tmp/a.markdown', 'x', 'App')).toBe('a')
  })

  it('未保存文档用标签名', () => {
    expect(exportTitle(null, '未命名-3.md', 'App')).toBe('未命名-3')
  })

  it('退化成空串时兜底到应用名（否则 <title> 是空的）', () => {
    expect(exportTitle(null, '.md', 'MarkText')).toBe('MarkText')
    expect(exportTitle(null, '   ', 'MarkText')).toBe('MarkText')
  })
})
