/**
 * 标题 id 与目录（TOC）。
 *
 * 为什么自研而不是用 `rehype-slug`：反正要把标题收集起来建目录，`rehype-slug` 不做这件事；
 * 用它就得再遍历一次，还要多背一条**隐式顺序依赖**（「slug 必须比收集器先跑，否则目录里的
 * href 指向还不存在的 id」）。本文件里已经有 `rawHtmlHandlers`、`sanitizeUrls` 两个同风格的
 * 自研 transformer 了，多一个一致。
 *
 * **id 恒开、目录可选**：即使不要目录也分配 id。副作用是好的——预览面板从此支持文内
 * `#锚点` 跳转（在此之前没有任何元素带 id，点了没反应）。
 */

import { visit } from 'unist-util-visit'
import type { Element, ElementContent, Root as HastRoot, RootContent } from 'hast'

export interface Heading {
  /** 1..6 */
  depth: number
  /** 已去重、已确保非空的 id（也是锚点的 href） */
  id: string
  /** 纯文本标题，供目录显示 */
  text: string
}

/** 标题列表挂在树的 data 上，而不是插件闭包里——闭包会让 processor 无法复用 */
const HEADINGS_KEY = 'markdownHeadings'

/** 取标题纯文本：hast 的文本节点已经解码过实体，直接拼即可 */
export function toPlainText(node: RootContent | HastRoot): string {
  if (node.type === 'text') return node.value
  // element 的 children 是 ElementContent[]、root 的是 RootContent[]，
  // 分开写两个分支比在联合类型上 map 更好懂，也让 TS 各自收窄
  if (node.type === 'element') return node.children.map((child) => toPlainText(child)).join('')
  if (node.type === 'root') return node.children.map((child) => toPlainText(child)).join('')
  return ''
}

/**
 * 生成 slug。
 *
 * 用 Unicode 属性转义而不是 ASCII 白名单：中文标题（本项目的主要场景）必须留在 id 里，
 * `[\p{L}\p{N}]` 天然包含汉字，无需特判。
 *
 * @param seen 同名计数表。传入同一个 Map 即可得到 `a` / `a-1` / `a-2` 的去重序列。
 */
export function slugify(text: string, seen?: Map<string, number>): string {
  const base =
    text
      .trim()
      .toLowerCase()
      // 保留字母、数字、连字符、下划线；其余（空白、标点、表情）统一先变成分隔符
      .replace(/[^\p{L}\p{N}\-_ ]+/gu, '')
      .replace(/\s+/g, '-')
      .replace(/^-+|-+$/g, '') || 'section'

  if (!seen) return base

  const count = seen.get(base)
  if (count === undefined) {
    seen.set(base, 0)
    return base
  }
  seen.set(base, count + 1)
  return `${base}-${count + 1}`
}

function element(
  tagName: string,
  properties: Element['properties'],
  children: ElementContent[]
): Element {
  return { type: 'element', tagName, properties, children }
}

/** 把标题列表拼成嵌套的 <ul>。深度跳跃（h1 直接到 h3）时只缩进一层，不补空层级 */
function buildToc(headings: Heading[]): Element {
  const rootList = element('ul', {}, [])
  // 栈里存「当前打开的列表及其深度」，depth 0 是哨兵，代表根列表
  const stack: Array<{ depth: number; list: Element }> = [{ depth: 0, list: rootList }]

  for (const heading of headings) {
    // 回到第一个比当前标题浅的层级
    while (stack.length > 1 && stack[stack.length - 1].depth >= heading.depth) stack.pop()

    const top = stack[stack.length - 1]
    if (heading.depth > top.depth && top.list.children.length > 0) {
      // 需要更深一层：挂在上一个 li 下面。已有同层列表就复用，否则新建一个。
      const lastLi = top.list.children[top.list.children.length - 1] as Element
      let sub = lastLi.children.find(
        (child): child is Element => child.type === 'element' && child.tagName === 'ul'
      )
      if (!sub) {
        sub = element('ul', {}, [])
        lastLi.children.push(sub)
      }
      stack.push({ depth: heading.depth, list: sub })
    }

    const list = stack[stack.length - 1].list
    list.children.push(
      element('li', {}, [element('a', { href: `#${heading.id}` }, [{ type: 'text', value: heading.text }])])
    )
  }

  return rootList
}

export interface HeadingsOptions {
  /** 是否把目录作为文档的第一个子节点注入 */
  toc?: boolean
}

/**
 * 给每个 h1..h6 分配去重 id 并收集成列表；`toc:true` 时额外注入
 * `<nav class="markdown-toc">`（整份文档的第一个子节点）。
 */
export function rehypeHeadings(options: HeadingsOptions = {}) {
  const { toc = false } = options

  return (tree: HastRoot): void => {
    const headings: Heading[] = []
    const seen = new Map<string, number>()

    visit(tree, 'element', (node: Element) => {
      if (!/^h[1-6]$/.test(node.tagName)) return
      const text = toPlainText(node).trim()
      const id = slugify(text, seen)
      node.properties = { ...node.properties, id }
      headings.push({ depth: Number(node.tagName[1]), id, text })
    })

    // remark-rehype 造出来的根节点没有 data 字段，不能直接往上写
    const data = (tree.data ?? {}) as Record<string, unknown>
    data[HEADINGS_KEY] = headings
    tree.data = data as NonNullable<HastRoot['data']>

    if (toc && headings.length > 0) {
      tree.children.unshift(
        element('nav', { className: ['markdown-toc'] }, [buildToc(headings)])
      )
    }
  }
}

/** 取回 `rehypeHeadings` 收集到的标题。没跑过这个插件时返回空数组 */
export function readHeadings(tree: HastRoot): Heading[] {
  const value = (tree.data as Record<string, unknown> | undefined)?.[HEADINGS_KEY]
  return Array.isArray(value) ? (value as Heading[]) : []
}
