/**
 * 轻量 Markdown 渲染（marked）
 * - 渲染前转义原始 HTML，禁止模型输出注入 iframe
 * - 只启用 GFM + 软换行，不引入高亮等额外插件
 */
import { marked } from 'marked'

/** 去掉 javascript: 链接，避免点击执行脚本 */
function stripUnsafeLinks(html: string): string {
  return html.replace(/href="\s*javascript:[^"]*"/gi, 'href="#"')
}

export function renderMarkdown(text: string): string {
  if (!text) return ''
  const escaped = text.replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const html = marked.parse(escaped, {
    async: false,
    gfm: true,
    breaks: true,
  })
  return typeof html === 'string' ? stripUnsafeLinks(html) : ''
}

/** ```html 代码块（大小写不敏感，要求语言标记后换行） */
const HTML_FENCE = /```\s*html[ \t]*\r?\n([\s\S]*?)```/gi

/** 提取消息中的 HTML 代码块，用于在聊天气泡里直接渲染预览 */
export function extractHtmlBlocks(text: string): string[] {
  if (!text || !/```\s*html/i.test(text)) return []
  const blocks: string[] = []
  HTML_FENCE.lastIndex = 0
  let matched: RegExpExecArray | null
  while ((matched = HTML_FENCE.exec(text)) !== null) {
    const code = matched[1].trim()
    if (code) blocks.push(code)
  }
  return blocks
}

/** 去掉 HTML 代码块后的剩余文本（预览卡片已包含源码，避免重复展示） */
export function stripHtmlBlocks(text: string): string {
  if (!text) return ''
  HTML_FENCE.lastIndex = 0
  return text.replace(HTML_FENCE, '').trim()
}
