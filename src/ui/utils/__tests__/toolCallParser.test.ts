import { describe, expect, it } from 'vitest'
import type { LlmToolCall } from '../../../../types/llm.types'
import {
  MAX_NODE_COUNT,
  normalizeOps,
  parseToolCalls,
  type ToolCallInput,
} from '../toolCallParser'

function asToolCall(name: string, args: unknown): ToolCallInput {
  return { name, args: typeof args === 'string' ? args : JSON.stringify(args) }
}

describe('parseToolCalls', () => {
  it('解析 create_ops 并补齐缺失字段默认值', () => {
    const result = parseToolCalls([
      asToolCall('create_ops', {
        ops: [
          {
            action: 'create',
            id: 'n1',
            type: 'frame',
            name: '登录页',
            children: [{ type: 'text', textContent: '欢迎登录', fontSize: 24 }],
          },
        ],
      }),
    ])
    expect('error' in result).toBe(false)
    if ('error' in result) return
    expect(result.kind).toBe('create')
    expect(result.ops).toHaveLength(1)
    const root = result.ops[0]
    // frame 未指定填充时保持透明（不注入白色兜底）
    expect(root.fill).toBeUndefined()
    expect(root.layout!.mode).toBe('none')
    expect(root.width).toBe(375)
    expect(root.height).toBe(812)
    // 子节点递归兜底：id 自动生成、名称按类型补默认、字重默认 400
    const child = root.children[0]
    expect(child.id).toMatch(/^n_/)
    expect(child.name).toBe('文本')
    expect(child.fontWeight).toBe(400)
    expect(child.textContent).toBe('欢迎登录')
  })

  it('文本未给宽高时默认按内容自适应，给定尺寸则不覆盖', () => {
    const auto = parseToolCalls([
      asToolCall('create_ops', {
        ops: [{ action: 'create', id: 't1', type: 'text', name: '标题', textContent: '标题' }],
      }),
    ])
    expect('error' in auto).toBe(false)
    if ('error' in auto) return
    expect(auto.ops[0].textAutoResize).toBe('WIDTH_AND_HEIGHT')

    const fixed = parseToolCalls([
      asToolCall('create_ops', {
        ops: [
          {
            action: 'create',
            id: 't2',
            type: 'text',
            name: '说明',
            textContent: '说明',
            width: 200,
          },
        ],
      }),
    ])
    expect('error' in fixed).toBe(false)
    if ('error' in fixed) return
    expect(fixed.ops[0].textAutoResize).toBeUndefined()
  })

  it('create / update 都保留 parent 与 insertAfter / insertBefore', () => {
    const created = parseToolCalls([
      asToolCall('create_ops', {
        ops: [
          {
            action: 'create',
            id: 'n_title',
            type: 'text',
            name: '卡片标题',
            parent: '2010:107',
            insertBefore: '2010:108',
            textContent: '创建账户',
            children: [],
          },
        ],
      }),
    ])
    expect('error' in created).toBe(false)
    if ('error' in created) return
    expect(created.ops[0].parent).toBe('2010:107')
    expect(created.ops[0].insertBefore).toBe('2010:108')

    const updated = parseToolCalls([
      asToolCall('update_ops', {
        ops: [
          {
            action: 'update',
            id: '2010:132',
            parent: '2010:107',
            insertAfter: '2010:113',
            insertBefore: '2010:112',
            cornerRadius: 8,
          },
        ],
      }),
    ])
    expect('error' in updated).toBe(false)
    if ('error' in updated) return
    // update 保留 parent（跨容器移动）与锚点（调整子节点顺序）
    expect(updated.ops[0].parent).toBe('2010:107')
    expect(updated.ops[0].insertAfter).toBe('2010:113')
    expect(updated.ops[0].insertBefore).toBe('2010:112')
  })

  it('遮罩字段 isMask / maskType 在 create 与 update 中都保留', () => {
    const created = parseToolCalls([
      asToolCall('create_ops', {
        ops: [
          {
            action: 'create',
            id: 'n_mask',
            type: 'ellipse',
            name: '头像遮罩',
            isMask: true,
            maskType: 'ALPHA',
            children: [],
          },
        ],
      }),
    ])
    expect('error' in created).toBe(false)
    if ('error' in created) return
    expect(created.ops[0].isMask).toBe(true)
    expect(created.ops[0].maskType).toBe('ALPHA')

    const updated = parseToolCalls([
      asToolCall('update_ops', { ops: [{ action: 'update', id: '1:2', isMask: false }] }),
    ])
    expect('error' in updated).toBe(false)
    if ('error' in updated) return
    expect(updated.ops[0].isMask).toBe(false)
  })

  it('兼容 llm.types 的 LlmToolCall 结构并识别 update_ops', () => {
    const call: LlmToolCall = {
      id: 'call_1',
      type: 'function',
      function: {
        name: 'update_ops',
        arguments: JSON.stringify({ ops: [{ action: 'update', id: '123:45', cornerRadius: 16 }] }),
      },
    }
    const result = parseToolCalls([call])
    expect('error' in result).toBe(false)
    if ('error' in result) return
    expect(result.kind).toBe('update')
    expect(result.ops[0].id).toBe('123:45')
    expect(result.ops[0].cornerRadius).toBe(16)
  })

  it('无 tool_calls / 未知工具名返回结构化错误', () => {
    expect(parseToolCalls([])).toHaveProperty('error')
    const unknown = parseToolCalls([asToolCall('rename_ops', { ops: [] })])
    expect('error' in unknown && unknown.error).toContain('create_ops')
  })

  it('arguments 非法 JSON / 缺少 ops 返回结构化错误', () => {
    const badJson = parseToolCalls([{ name: 'create_ops', args: '{ops: [非法]' }])
    expect('error' in badJson && badJson.error).toContain('JSON')
    const noOps = parseToolCalls([asToolCall('create_ops', { other: true })])
    expect('error' in noOps && noOps.error).toContain('ops')
  })

  it('update 操作缺少原生图层 ID 报错', () => {
    const result = parseToolCalls([
      asToolCall('update_ops', { ops: [{ action: 'update', type: 'rect', name: '卡片' }] }),
    ])
    expect('error' in result && result.error).toContain('update')
  })

  it('节点总数超过 300 报错', () => {
    const ops = Array.from({ length: MAX_NODE_COUNT + 1 }, (_, i) => ({
      action: 'create',
      id: `n${i}`,
      type: 'rect',
      name: `矩形${i}`,
    }))
    const result = parseToolCalls([asToolCall('create_ops', { ops })])
    expect('error' in result && result.error).toContain('300')
  })

  it('strip 未知字段并宽松转换字段类型', () => {
    const result = parseToolCalls([
      asToolCall('create_ops', {
        ops: [
          {
            action: 'create',
            id: 'n1',
            type: 'rect',
            name: '卡片',
            unknownField: '应被剔除',
            width: '375',
            layout: { padding: 24 },
          },
        ],
      }),
    ])
    expect('error' in result).toBe(false)
    if ('error' in result) return
    const op = result.ops[0] as unknown as Record<string, unknown>
    expect(op.unknownField).toBeUndefined()
    expect(result.ops[0].width).toBe(375)
    expect(result.ops[0].layout!.padding).toEqual([24, 24, 24, 24])
  })

  it('padding 支持四元组与二元组', () => {
    const result = normalizeOps([{ type: 'frame', layout: { padding: [8, 16, 8, 16] } }])
    expect(result[0].layout!.padding).toEqual([8, 16, 8, 16])
    const result2 = normalizeOps([{ type: 'frame', layout: { padding: [8, 16] } }])
    expect(result2[0].layout!.padding).toEqual([8, 16, 8, 16])
    const result3 = normalizeOps([{ type: 'frame', layout: { padding: 'bad' } }])
    expect(result3[0].layout!.padding).toEqual([0, 0, 0, 0])
  })

  it('保留顶层 parent / position，children 的 parent 被剔除', () => {
    const result = parseToolCalls([
      asToolCall('create_ops', {
        ops: [
          {
            type: 'frame',
            name: '卡片',
            parent: ' 123:45 ',
            position: 'absolute',
            x: 24,
            y: 120,
            children: [{ type: 'text', textContent: '标题', parent: '123:45' }],
          },
        ],
      }),
    ])
    expect('error' in result).toBe(false)
    if ('error' in result) return
    const root = result.ops[0]
    expect(root.parent).toBe('123:45')
    expect(root.position).toBe('absolute')
    expect(root.children[0].parent).toBeUndefined()
  })

  it('update 保留 parent（跨容器移动），丢弃 create 专属的 position', () => {
    const result = normalizeOps([{ action: 'update', id: '1:2', position: 'absolute', parent: '1:3' }])
    expect(result[0].parent).toBe('1:3')
    expect(result[0].position).toBeUndefined()
  })
})

describe('normalizeOps', () => {
  it('兜底补默认值：action/id/名称/尺寸', () => {
    const ops = normalizeOps([{ type: 'text', textContent: '标题' }])
    expect(ops).toHaveLength(1)
    const op = ops[0]
    expect(op.action).toBe('create')
    expect(op.id).toMatch(/^n_/)
    expect(op.name).toBe('文本')
    expect(op.width).toBe(100)
    expect(op.height).toBe(100)
    expect(op.fontSize).toBe(16)
    expect(op.fontWeight).toBe(400)
    // 文本不注入 fill（颜色由 textColor 控制）
    expect(op.fill).toBeUndefined()
    expect(op.children).toEqual([])
  })

  it('兼容 { ops: [...] } 包裹结构', () => {
    const ops = normalizeOps({ ops: [{ type: 'ellipse', name: '圆点' }] })
    expect(ops).toHaveLength(1)
    expect(ops[0].type).toBe('ellipse')
  })

  it('剔除无效元素', () => {
    const ops = normalizeOps(['garbage', { type: 'line', name: '分隔线' }])
    expect(ops).toHaveLength(1)
    expect(ops[0].type).toBe('line')
  })
})

describe('紧凑写法归一化', () => {
  it('短 key、顶层布局与类型推断', () => {
    const ops = normalizeOps([
      {
        n: 'Login',
        w: 375,
        h: 812,
        mode: 'vertical',
        gap: 16,
        padding: 24,
        children: [
          { txt: '标题', fs: 24, tc: '#FFFFFF' },
          { t: 'ellipse', w: 48, h: 48, bg: '#0A84FF' },
        ],
      },
    ])
    expect(ops).toHaveLength(1)
    const root = ops[0]
    expect(root.type).toBe('frame')
    expect(root.name).toBe('Login')
    expect(root.width).toBe(375)
    expect(root.height).toBe(812)
    expect(root.layout?.mode).toBe('vertical')
    expect(root.layout?.gap).toBe(16)
    expect(root.layout?.padding).toEqual([24, 24, 24, 24])

    const text = root.children[0]
    expect(text.type).toBe('text')
    expect(text.textContent).toBe('标题')
    expect(text.fontSize).toBe(24)
    expect(text.textColor).toBe('#FFFFFF')

    const circle = root.children[1]
    expect(circle.type).toBe('ellipse')
    expect(circle.fill).toBe('#0A84FF')
  })

  it('layout 短 key 与嵌套写法等价', () => {
    const ops = normalizeOps([
      { n: 'Card', l: { m: 'horizontal', g: 8, p: [8, 16] } },
      { n: 'Card2', layout: { mode: 'horizontal', gap: 8, padding: [8, 16] } },
    ])
    expect(ops[0].layout).toEqual(ops[1].layout)
  })

  it('update 通过别名提供的字段不会被默认值清理掉', () => {
    const ops = normalizeOps([{ action: 'update', id: '1:2', n: '卡片', w: 400 }])
    expect(ops).toHaveLength(1)
    expect(ops[0].name).toBe('卡片')
    expect(ops[0].width).toBe(400)
    // 未显式提供的字段不注入 create 默认值
    expect(ops[0].height).toBeUndefined()
    expect(ops[0].fill).toBeUndefined()
    expect(ops[0].fontSize).toBeUndefined()
  })
})
