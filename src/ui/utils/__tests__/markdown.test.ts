import { describe, expect, it } from 'vitest'
import { extractHtmlBlocks, renderMarkdown, stripHtmlBlocks } from '../markdown'

describe('renderMarkdown', () => {
  it('渲染基本 Markdown 并保留软换行', () => {
    const html = renderMarkdown('**加粗**\n第二行')
    expect(html).toContain('<strong>加粗</strong>')
    expect(html).toContain('<br')
  })

  it('转义原始 HTML，避免注入 iframe', () => {
    const html = renderMarkdown('<img src=x onerror=alert(1)>')
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;img')
  })

  it('渲染代码块与表格，并拦截 javascript: 链接', () => {
    const code = renderMarkdown('```ts\nconst a = 1\n```')
    expect(code).toContain('<pre>')
    expect(code).toContain('<code')
    expect(code).toContain('const a = 1')

    const link = renderMarkdown('[x](javascript:alert(1))')
    expect(link).not.toContain('javascript:')
  })
})

describe('HTML 预览提取', () => {
  it('提取 ```html 代码块（大小写不敏感）并保留原文', () => {
    const text = '说明\n\n```html\n<div class="a">你好</div>\n```\n\n结尾'
    expect(extractHtmlBlocks(text)).toEqual(['<div class="a">你好</div>'])

    const upper = '```HTML\n<p>x</p>\n```'
    expect(extractHtmlBlocks(upper)).toEqual(['<p>x</p>'])
  })

  it('支持多个代码块，且忽略其它语言', () => {
    const text = '```js\nconsole.log(1)\n```\n```html\n<b>1</b>\n```\n```html\n<i>2</i>\n```'
    expect(extractHtmlBlocks(text)).toEqual(['<b>1</b>', '<i>2</i>'])
  })

  it('stripHtmlBlocks 移除 HTML 代码块后保留其它正文', () => {
    const text = '正文\n```html\n<b>1</b>\n```\n其余'
    expect(stripHtmlBlocks(text)).toBe('正文\n\n其余')
    expect(extractHtmlBlocks('无代码块')).toEqual([])
  })
})
