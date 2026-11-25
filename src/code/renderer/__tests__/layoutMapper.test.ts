/**
 * layoutMapper 纯函数测试（Task 8.1）
 * mapLayoutMode / mapCounterAxisAlignItems / mapPrimaryAxisAlignItems 为纯映射函数；
 * applyLayout 用轻量对象模拟 FrameNode（仅实现被写入的属性），不依赖 figma API。
 */
import { describe, expect, it } from 'vitest'
import type { NodeLayout } from '../../../../types/node.types'
import {
  applyLayout,
  mapCounterAxisAlignItems,
  mapLayoutMode,
  mapPrimaryAxisAlignItems,
} from '../layoutMapper'

function makeLayout(partial: Partial<NodeLayout>): NodeLayout {
  return {
    mode: 'vertical',
    gap: 0,
    padding: [0, 0, 0, 0],
    alignItems: '',
    justifyContent: '',
    ...partial,
  }
}

/** FrameNode 轻量 mock：只记录 applyLayout 会写入的属性 */
function makeFrameMock(children: Array<{ layoutAlign?: string }> = []) {
  // 新建 frame 的 layoutMode 为 NONE（applyLayout 据此判断是否首次启用布局）
  const written: Record<string, unknown> = {}
  const node = {
    children,
    get layoutMode() {
      return written.layoutMode ?? 'NONE'
    },
    set layoutMode(v: unknown) {
      written.layoutMode = v
    },
    get primaryAxisSizingMode() {
      return written.primaryAxisSizingMode
    },
    set primaryAxisSizingMode(v: unknown) {
      written.primaryAxisSizingMode = v
    },
    get counterAxisSizingMode() {
      return written.counterAxisSizingMode
    },
    set counterAxisSizingMode(v: unknown) {
      written.counterAxisSizingMode = v
    },
    get itemSpacing() {
      return written.itemSpacing
    },
    set itemSpacing(v: unknown) {
      written.itemSpacing = v
    },
    get paddingTop() {
      return written.paddingTop
    },
    set paddingTop(v: unknown) {
      written.paddingTop = v
    },
    get paddingRight() {
      return written.paddingRight
    },
    set paddingRight(v: unknown) {
      written.paddingRight = v
    },
    get paddingBottom() {
      return written.paddingBottom
    },
    set paddingBottom(v: unknown) {
      written.paddingBottom = v
    },
    get paddingLeft() {
      return written.paddingLeft
    },
    set paddingLeft(v: unknown) {
      written.paddingLeft = v
    },
    get counterAxisAlignItems() {
      return written.counterAxisAlignItems
    },
    set counterAxisAlignItems(v: unknown) {
      written.counterAxisAlignItems = v
    },
    get primaryAxisAlignItems() {
      return written.primaryAxisAlignItems
    },
    set primaryAxisAlignItems(v: unknown) {
      written.primaryAxisAlignItems = v
    },
  }
  return { node: node as unknown as FrameNode, written }
}

describe('mapLayoutMode', () => {
  it('vertical/horizontal 分别映射 VERTICAL/HORIZONTAL', () => {
    expect(mapLayoutMode('vertical')).toBe('VERTICAL')
    expect(mapLayoutMode('horizontal')).toBe('HORIZONTAL')
  })

  it('none / undefined / 非法值返回 NONE（不启用 Auto Layout）', () => {
    expect(mapLayoutMode('none')).toBe('NONE')
    expect(mapLayoutMode(undefined)).toBe('NONE')
    expect(mapLayoutMode('diagonal' as NodeLayout['mode'])).toBe('NONE')
  })
})

describe('mapCounterAxisAlignItems', () => {
  it('center → CENTER，end/flex-end → MAX，baseline → BASELINE', () => {
    expect(mapCounterAxisAlignItems('center')).toBe('CENTER')
    expect(mapCounterAxisAlignItems('end')).toBe('MAX')
    expect(mapCounterAxisAlignItems('flex-end')).toBe('MAX')
    expect(mapCounterAxisAlignItems('baseline')).toBe('BASELINE')
  })

  it('start / 未知值 / undefined / 大小写宽松均降级 MIN（stretch 降级见 DEV.md 7.3）', () => {
    expect(mapCounterAxisAlignItems('start')).toBe('MIN')
    expect(mapCounterAxisAlignItems('stretch')).toBe('MIN')
    expect(mapCounterAxisAlignItems('unknown')).toBe('MIN')
    expect(mapCounterAxisAlignItems(undefined)).toBe('MIN')
    expect(mapCounterAxisAlignItems('CENTER')).toBe('CENTER')
  })
})

describe('mapPrimaryAxisAlignItems', () => {
  it('center → CENTER，end/flex-end → MAX，space-between/around/evenly → SPACE_BETWEEN', () => {
    expect(mapPrimaryAxisAlignItems('center')).toBe('CENTER')
    expect(mapPrimaryAxisAlignItems('end')).toBe('MAX')
    expect(mapPrimaryAxisAlignItems('flex-end')).toBe('MAX')
    expect(mapPrimaryAxisAlignItems('space-between')).toBe('SPACE_BETWEEN')
    expect(mapPrimaryAxisAlignItems('space-around')).toBe('SPACE_BETWEEN')
    expect(mapPrimaryAxisAlignItems('space-evenly')).toBe('SPACE_BETWEEN')
  })

  it('start / 未知值 / undefined 降级 MIN，大小写宽松', () => {
    expect(mapPrimaryAxisAlignItems('start')).toBe('MIN')
    expect(mapPrimaryAxisAlignItems('unknown')).toBe('MIN')
    expect(mapPrimaryAxisAlignItems(undefined)).toBe('MIN')
    expect(mapPrimaryAxisAlignItems('CENTER')).toBe('CENTER')
  })
})

describe('applyLayout', () => {
  it('mode=none 时不写入任何 Auto Layout 属性', () => {
    const { node, written } = makeFrameMock()
    applyLayout(node, makeLayout({ mode: 'none', gap: 12 }))
    expect(Object.keys(written)).toHaveLength(0)
  })

  it('layout 为 undefined 时同样跳过', () => {
    const { node, written } = makeFrameMock()
    applyLayout(node, undefined)
    expect(Object.keys(written)).toHaveLength(0)
  })

  it('vertical 布局：先设 layoutMode 与 FIXED sizing，再写入 gap/padding/对齐', () => {
    const { node, written } = makeFrameMock()
    applyLayout(
      node,
      makeLayout({ mode: 'vertical', gap: 16, padding: [24, 16, 24, 16], alignItems: 'center', justifyContent: 'space-between' }),
    )
    expect(written.layoutMode).toBe('VERTICAL')
    expect(written.primaryAxisSizingMode).toBe('FIXED')
    expect(written.counterAxisSizingMode).toBe('FIXED')
    expect(written.itemSpacing).toBe(16)
    expect(written.paddingTop).toBe(24)
    expect(written.paddingRight).toBe(16)
    expect(written.paddingBottom).toBe(24)
    expect(written.paddingLeft).toBe(16)
    expect(written.counterAxisAlignItems).toBe('CENTER')
    expect(written.primaryAxisAlignItems).toBe('SPACE_BETWEEN')
  })

  it('负 gap 不写入（保持原值），负 padding 被钳制为 0，padding 缺省位补 0', () => {
    const { node, written } = makeFrameMock()
    applyLayout(
      node,
      makeLayout({ mode: 'horizontal', gap: -5, padding: [-10, 8] as unknown as NodeLayout['padding'] }),
    )
    expect(written.itemSpacing).toBeUndefined()
    expect(written.paddingTop).toBe(0)
    expect(written.paddingRight).toBe(8)
    expect(written.paddingBottom).toBe(0)
    expect(written.paddingLeft).toBe(0)
  })

  it('padding 未提供（undefined）时不写入，保持现有内边距', () => {
    const { node, written } = makeFrameMock()
    applyLayout(node, makeLayout({ padding: undefined as unknown as NodeLayout['padding'] }))
    expect(written.paddingTop).toBeUndefined()
    expect(written.paddingRight).toBeUndefined()
    expect(written.paddingBottom).toBeUndefined()
    expect(written.paddingLeft).toBeUndefined()
  })

  it('sizing.hug：vertical 布局下主轴设 AUTO，未指定的轴不写入', () => {
    const { node, written } = makeFrameMock()
    applyLayout(node, makeLayout({ mode: 'vertical', sizing: { vertical: 'hug' } }))
    expect(written.primaryAxisSizingMode).toBe('AUTO')
    expect(written.counterAxisSizingMode).toBeUndefined()
  })

  it('sizing.hug：horizontal 布局下 vertical 属于交叉轴', () => {
    const { node, written } = makeFrameMock()
    applyLayout(node, makeLayout({ mode: 'horizontal', sizing: { vertical: 'hug' } }))
    expect(written.counterAxisSizingMode).toBe('AUTO')
    expect(written.primaryAxisSizingMode).toBeUndefined()
  })

  it('已有布局且未指定 sizing 时保持原轴尺寸（不把 hug 改回 fixed）', () => {
    const { node, written } = makeFrameMock()
    written.layoutMode = 'VERTICAL'
    written.primaryAxisSizingMode = 'AUTO'
    written.counterAxisSizingMode = 'AUTO'
    applyLayout(node, makeLayout({ gap: 8 }))
    expect(written.primaryAxisSizingMode).toBe('AUTO')
    expect(written.counterAxisSizingMode).toBe('AUTO')
  })

  it('首次启用布局且 alignItems=stretch 时子级 layoutAlign 撑满交叉轴', () => {
    const child: { layoutAlign?: string } = { layoutAlign: 'INHERIT' }
    const { node } = makeFrameMock([child])
    applyLayout(node, makeLayout({ alignItems: 'stretch' }))
    expect(child.layoutAlign).toBe('STRETCH')
  })

  it('已有布局仅修改 gap 时不覆盖子级 layoutAlign', () => {
    const child: { layoutAlign?: string } = { layoutAlign: 'INHERIT' }
    const { node, written } = makeFrameMock([child])
    written.layoutMode = 'VERTICAL'
    applyLayout(node, makeLayout({ alignItems: 'stretch', gap: 8 }))
    expect(child.layoutAlign).toBe('INHERIT')
  })
})
