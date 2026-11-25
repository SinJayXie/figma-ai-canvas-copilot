import { describe, expect, it } from 'vitest'
import type { ChatMessage, LlmContentPart } from '../../../../types/llm.types'
import {
  buildMessages,
  buildSystemPrompt,
  estimateTokens,
  IMAGE_TOKEN_ESTIMATE,
  MAX_HISTORY_ROUNDS,
} from '../promptBuilder'

describe('estimateTokens', () => {
  it('空串为 0，中英文都能给出正数估算', () => {
    expect(estimateTokens('')).toBe(0)
    expect(estimateTokens('你好')).toBeGreaterThan(0)
    expect(estimateTokens('大家好，这是一个测试')).toBeGreaterThan(estimateTokens('你好'))
    expect(estimateTokens('hello world')).toBeGreaterThan(0)
  })

  it('图片片段按固定经验值计入', () => {
    const parts: LlmContentPart[] = [
      { type: 'text', text: 'hi' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,xxx' } },
    ]
    expect(estimateTokens(parts)).toBe(estimateTokens('hi') + IMAGE_TOKEN_ESTIMATE)
  })
})

describe('buildSystemPrompt', () => {
  const canvasContext = JSON.stringify({
    count: 2,
    nodes: [
      { id: '123:1', name: '标题', type: 'text', x: 0, y: 0, width: 200, height: 24, textContent: '登录' },
      { id: '123:2', name: '卡片', type: 'frame', x: 0, y: 24, width: 375, height: 120 },
    ],
  })

  it('包含内置规范：tool call 约定 + 设计规范', () => {
    const prompt = buildSystemPrompt('')
    expect(prompt).toContain('tool_calls')
    expect(prompt).toContain('create_ops')
    expect(prompt).toContain('update_ops')
    expect(prompt).toContain('8px')
    expect(prompt).toContain('375px')
    expect(prompt).toContain('1440px')
  })

  it('包含语气与措辞规范', () => {
    const prompt = buildSystemPrompt('')
    expect(prompt).toContain('# Voice and wording')
    expect(prompt).toContain("same language as the user's latest message")
    expect(prompt).toContain('Lead with the answer or the action')
    expect(prompt).toContain('Do not introduce yourself')
    expect(prompt).toContain('Ask at most one clarifying question')
  })

  it('拼接自定义提示词', () => {
    const prompt = buildSystemPrompt('所有主按钮必须使用品牌色 #2563EB')
    expect(prompt).toContain('# User custom rules')
    expect(prompt).toContain('#2563EB')
  })

  it('有画布上下文时注入 JSON，无上下文时不注入', () => {
    const withContext = buildSystemPrompt('', canvasContext)
    expect(withContext).toContain('# Canvas context')
    expect(withContext).toContain('"id":"123:1"')
    const withoutContext = buildSystemPrompt('', null)
    expect(withoutContext).not.toContain('# Canvas context')
    expect(buildSystemPrompt('', '   ')).not.toContain('# Canvas context')
  })

  it('有会话记忆时注入 Session memory，空记忆不注入', () => {
    const memory = '- create_ops → 2 nodes: Login Page (1:23), Email Field (1:24)'
    const withMemory = buildSystemPrompt('', canvasContext, memory)
    expect(withMemory).toContain('# Session memory')
    expect(withMemory).toContain('1:23')
    expect(buildSystemPrompt('', canvasContext, '   ')).not.toContain('# Session memory')
    expect(buildSystemPrompt('', canvasContext, null)).not.toContain('# Session memory')
  })

  it('覆盖新增读写能力的提示：文本区间/图片/样式/字体/组件属性/变量模式', () => {
    const prompt = buildSystemPrompt('')
    expect(prompt).toContain('set_text_range')
    expect(prompt).toContain('create_image_from_url')
    expect(prompt).toContain('get_css')
    expect(prompt).toContain('list_available_fonts')
    expect(prompt).toContain('set_component_property_references')
    expect(prompt).toContain('set_variable_mode_on_node')
  })

  it('覆盖批次二新增能力：矢量/批注/选区配色/库变量/文件版本', () => {
    const prompt = buildSystemPrompt('')
    expect(prompt).toContain('create_vector')
    expect(prompt).toContain('set_annotations')
    expect(prompt).toContain('get_selection_colors')
    expect(prompt).toContain('import_variable_by_key')
    expect(prompt).toContain('save_file_version')
  })

  it('批次二提示词包含使用边界与不变量', () => {
    const prompt = buildSystemPrompt('')
    expect(prompt).toContain('Never invent component / style / variable keys')
    expect(prompt).toContain('create_slice only for export regions')
    expect(prompt).toContain('get_local_variables')
    expect(prompt).toContain('beforeStyleId null moves the preset to the end')
    expect(prompt).toContain('only when asked')
    expect(prompt).toContain('get_current_user')
    expect(prompt).toContain('never guess roles')
    expect(prompt).toContain('lacks edit access')
  })

  it('任务模式开启时注入任务列表与单步约束', () => {
    const prompt = buildSystemPrompt('', null, null, true)
    expect(prompt).toContain('# Task mode')
    expect(prompt).toContain('update_tasks')
    expect(prompt).toContain('Never output the whole page at once')
    expect(buildSystemPrompt('', null, null, false)).not.toContain('# Task mode')
  })
})

describe('buildMessages', () => {
  const system = 'SYSTEM_PROMPT'

  function makeRounds(count: number, contentSize = 1): ChatMessage[] {
    const messages: ChatMessage[] = []
    for (let i = 0; i < count; i++) {
      messages.push({ role: 'user', content: `问题${i}: ${'测'.repeat(contentSize)}` })
      messages.push({ role: 'assistant', content: `回答${i}: ${'答'.repeat(contentSize)}` })
    }
    return messages
  }

  it('结构为 system + 历史 + 当前用户输入', () => {
    const messages = buildMessages(system, makeRounds(2), '画一个登录页')
    expect(messages[0]).toEqual({ role: 'system', content: system })
    expect(messages[messages.length - 1]).toEqual({ role: 'user', content: '画一个登录页' })
    expect(messages).toHaveLength(1 + 4 + 1)
  })

  it('滑动窗口只保留最近 20 轮', () => {
    const messages = buildMessages(system, makeRounds(MAX_HISTORY_ROUNDS + 5), '当前指令')
    const history = messages.slice(1, -1)
    expect(history).toHaveLength(MAX_HISTORY_ROUNDS * 2)
    expect(history[0].content).toContain('问题5')
    expect(messages.some((m) => String(m.content).includes('问题4'))).toBe(false)
  })

  it('丢弃历史开头孤立的 assistant 消息', () => {
    const history: ChatMessage[] = [
      { role: 'assistant', content: '孤立回复' },
      ...makeRounds(1),
    ]
    const messages = buildMessages(system, history, '继续')
    expect(messages[1].role).toBe('user')
    expect(messages[1].content).toContain('问题0')
  })

  it('超出上下文预算时从最早历史开始截断', () => {
    // 每条消息约 21 token，每轮约 42 token；当前问题 4 token
    const messages = buildMessages('', makeRounds(10, 20), '当前问题', 4096, [], 60)
    const history = messages.slice(1, -1)
    // 截断到仅剩最近一轮（且以 user 开头）
    expect(history.map((m) => m.content)).toEqual([
      `问题9: ${'测'.repeat(20)}`,
      `回答9: ${'答'.repeat(20)}`,
    ])
    expect(messages.some((m) => String(m.content).includes('问题0'))).toBe(false)
    const historyTokens = history.reduce((sum, m) => sum + estimateTokens(m.content), 0)
    expect(historyTokens).toBeLessThanOrEqual(60)
  })

  it('文本附件拼进用户消息，图片附件生成多模态片段', () => {
    const messages = buildMessages(system, [], '看下这份需求', 4096, [
      { id: 'a1', kind: 'text', name: '需求.md', mime: 'text/markdown', size: 10, text: '做一个登录页' },
      { id: 'a2', kind: 'image', name: '参考.png', mime: 'image/png', size: 100, dataUrl: 'data:image/png;base64,AAA' },
    ])
    const last = messages[messages.length - 1]
    expect(Array.isArray(last.content)).toBe(true)
    const parts = last.content as LlmContentPart[]
    expect(parts[0].type).toBe('text')
    expect(parts[0].type === 'text' && parts[0].text).toContain('需求.md')
    expect(parts[0].type === 'text' && parts[0].text).toContain('做一个登录页')
    expect(parts.some((part) => part.type === 'image_url')).toBe(true)
  })

  it('只有文本附件时保持字符串 content', () => {
    const messages = buildMessages(system, [], '参考文件', 4096, [
      { id: 'a1', kind: 'text', name: 'a.txt', mime: 'text/plain', size: 1, text: '内容' },
    ])
    const last = messages[messages.length - 1]
    expect(typeof last.content).toBe('string')
    expect(String(last.content)).toContain('a.txt')
  })
})
