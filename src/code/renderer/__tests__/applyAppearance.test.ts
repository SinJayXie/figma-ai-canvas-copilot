import { describe, expect, it } from 'vitest'
import type { NodeOp } from '../../../../types/node.types'
import { applyAppearance, applyChildSizing } from '../applyAppearance'

/** 轻量节点 mock：只提供 applyAppearance 会访问的属性 */
function makeNode(overrides: Record<string, unknown> = {}): SceneNode {
  return {
    type: 'FRAME',
    fills: [],
    strokes: [],
    ...overrides,
  } as unknown as SceneNode
}

function op(partial: Partial<NodeOp>): NodeOp {
  return { action: 'create', id: 'n1', type: 'frame', name: '测试', children: [], ...partial }
}

describe('applyAppearance', () => {
  it('fill=transparent 时清空填充且不抛错', () => {
    const node = makeNode()
    applyAppearance(node, op({ fill: 'transparent' }))
    expect((node as unknown as { fills: unknown[] }).fills).toEqual([])
  })

  it('正常十六进制填充写入纯色', () => {
    const node = makeNode()
    applyAppearance(node, op({ fill: '#FF0000' }))
    const fills = (node as unknown as { fills: Array<{ type: string }> }).fills
    expect(fills).toHaveLength(1)
    expect(fills[0].type).toBe('SOLID')
  })

  it('非法样式 id 被忽略，不影响其它属性', () => {
    const node = makeNode({ textStyleId: '' })
    applyAppearance(node, op({ fill: '#00FF00', textStyleId: 'S:abc,' }))
    expect((node as unknown as { fills: unknown[] }).fills).toHaveLength(1)
    expect((node as unknown as { textStyleId: string }).textStyleId).toBe('')
  })

  it('合法样式 id 正常写入', () => {
    const node = makeNode({ textStyleId: '' })
    applyAppearance(node, op({ textStyleId: 'S:abc123' }))
    expect((node as unknown as { textStyleId: string }).textStyleId).toBe('S:abc123')
  })
})

describe('applyChildSizing', () => {
  /** 带 layoutSizing 属性与父级信息的节点 mock */
  function makeChild(parentLayoutMode: string | null, initial = 'FIXED') {
    const child = {
      type: 'FRAME',
      fills: [],
      strokes: [],
      layoutSizingHorizontal: initial,
      layoutSizingVertical: initial,
      parent: parentLayoutMode === null ? null : { type: 'FRAME', layoutMode: parentLayoutMode },
    }
    return child as unknown as SceneNode
  }

  it('父级是 Auto Layout 时 fill 映射为 FILL', () => {
    const child = makeChild('VERTICAL')
    applyChildSizing(child, op({ layoutSizing: { horizontal: 'fill' } }))
    expect((child as unknown as { layoutSizingHorizontal: string }).layoutSizingHorizontal).toBe('FILL')
  })

  it('父级不是 Auto Layout 时 fill 抛错，提示开启布局', () => {
    const child = makeChild('NONE')
    expect(() =>
      applyChildSizing(child, op({ layoutSizing: { vertical: 'fill' } })),
    ).toThrow(/Auto Layout/)
  })

  it('hug / fixed 正常映射', () => {
    const child = makeChild('VERTICAL')
    applyChildSizing(child, op({ layoutSizing: { horizontal: 'hug', vertical: 'fixed' } }))
    expect((child as unknown as { layoutSizingHorizontal: string }).layoutSizingHorizontal).toBe('HUG')
    expect((child as unknown as { layoutSizingVertical: string }).layoutSizingVertical).toBe('FIXED')
  })
})
