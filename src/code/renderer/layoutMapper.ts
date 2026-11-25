/**
 * Auto Layout 属性映射（Task 3.2）
 * NodeLayout（LLM 简化布局模型）→ Figma FrameNode Auto Layout 属性
 */

import type { LayoutSizingMode, NodeLayout } from '../../../types/node.types'

export type FigmaLayoutMode = 'NONE' | 'HORIZONTAL' | 'VERTICAL'
export type FigmaCounterAxisAlignItems = 'MIN' | 'MAX' | 'CENTER' | 'BASELINE'
export type FigmaPrimaryAxisAlignItems = 'MIN' | 'MAX' | 'CENTER' | 'SPACE_BETWEEN'

/** mode vertical/horizontal → layoutMode（none 时不启用 Auto Layout） */
export function mapLayoutMode(mode: NodeLayout['mode'] | undefined): FigmaLayoutMode {
  if (mode === 'vertical') return 'VERTICAL'
  if (mode === 'horizontal') return 'HORIZONTAL'
  return 'NONE'
}

/** alignItems → counterAxisAlignItems（stretch 降级为 MIN，见 DEV.md 7.3） */
export function mapCounterAxisAlignItems(align: string | undefined): FigmaCounterAxisAlignItems {
  switch ((align ?? '').toLowerCase()) {
    case 'center':
      return 'CENTER'
    case 'end':
    case 'flex-end':
      return 'MAX'
    case 'baseline':
      return 'BASELINE'
    default:
      return 'MIN'
  }
}

/** justifyContent → primaryAxisAlignItems */
export function mapPrimaryAxisAlignItems(justify: string | undefined): FigmaPrimaryAxisAlignItems {
  switch ((justify ?? '').toLowerCase()) {
    case 'center':
      return 'CENTER'
    case 'end':
    case 'flex-end':
      return 'MAX'
    case 'space-between':
    case 'space-around':
    case 'space-evenly':
      return 'SPACE_BETWEEN'
    default:
      return 'MIN'
  }
}

/** 写入单轴尺寸模式：vertical 布局时 vertical 为主轴，horizontal 布局时 horizontal 为主轴 */
function applyAxisSizing(
  node: FrameNode,
  layoutMode: NodeLayout['mode'],
  axis: 'horizontal' | 'vertical',
  value: LayoutSizingMode | undefined,
): void {
  if (!value) return
  const sizingMode = value === 'hug' ? 'AUTO' : 'FIXED'
  const primaryAxis = layoutMode === 'vertical' ? 'vertical' : 'horizontal'
  if (axis === primaryAxis) node.primaryAxisSizingMode = sizingMode
  else node.counterAxisSizingMode = sizingMode
}

/**
 * alignItems=stretch 时让子级撑满交叉轴（Figma 通过子级 layoutAlign 实现，无 STRETCH 对齐值）。
 * 只在首次启用布局时写入，避免后续仅修改 gap/padding 时覆盖用户手动设置的 Fill/Fixed。
 */
function applyCounterAxisStretch(node: FrameNode, alignItems: string | undefined): void {
  if ((alignItems ?? '').toLowerCase() !== 'stretch') return
  if (!('children' in node)) return
  for (const child of node.children) {
    if (!('layoutAlign' in child)) continue
    try {
      child.layoutAlign = 'STRETCH'
    } catch {
      // 个别节点类型不支持时忽略
    }
  }
}

/**
 * 将 NodeLayout 应用到 FrameNode。
 * 注意 Figma API 约束：必须先设置 layoutMode，才能设置 padding/itemSpacing 等属性。
 * 轴尺寸：显式 sizing 优先；首次启用布局时默认 FIXED（由调用方随后 resize），
 * 已有布局且未指定 sizing 时保持现值，避免把 hug 的卡片改回固定高度。
 */
export function applyLayout(node: FrameNode, layout: NodeLayout | undefined): void {
  if (!layout) return
  const mode = mapLayoutMode(layout.mode)
  // 显式 "none" 表示不启用/不调整；未提供 mode 时沿用现有布局模式，仅更新间距等属性
  if (layout.mode === 'none') return
  if (mode === 'NONE' && node.layoutMode === 'NONE') return

  const enabling = node.layoutMode === 'NONE'
  if (mode !== 'NONE') node.layoutMode = mode

  const sizing = layout?.sizing
  if (sizing) {
    // 以节点实际布局方向为准（update 时可能未显式提供 mode）
    const axisMode: NodeLayout['mode'] = node.layoutMode === 'HORIZONTAL' ? 'horizontal' : 'vertical'
    applyAxisSizing(node, axisMode, 'horizontal', sizing.horizontal)
    applyAxisSizing(node, axisMode, 'vertical', sizing.vertical)
  } else if (enabling) {
    node.primaryAxisSizingMode = 'FIXED'
    node.counterAxisSizingMode = 'FIXED'
  }

  if (typeof layout?.gap === 'number' && layout.gap >= 0) {
    node.itemSpacing = layout.gap
  }
  if (layout?.wrap != null && 'layoutWrap' in node) {
    node.layoutWrap = layout.wrap ? 'WRAP' : 'NO_WRAP'
  }
  if (node.layoutWrap === 'WRAP' && layout?.counterAxisSpacing != null) {
    node.counterAxisSpacing = Math.max(0, layout.counterAxisSpacing)
  }
  // padding / 对齐：仅在显式提供时写入，避免 update 把现有间距清零
  if (Array.isArray(layout?.padding)) {
    const [top = 0, right = 0, bottom = 0, left = 0] = layout.padding
    node.paddingTop = Math.max(0, top)
    node.paddingRight = Math.max(0, right)
    node.paddingBottom = Math.max(0, bottom)
    node.paddingLeft = Math.max(0, left)
  }
  if (layout?.alignItems) {
    node.counterAxisAlignItems = mapCounterAxisAlignItems(layout.alignItems)
  }
  if (layout?.justifyContent) {
    node.primaryAxisAlignItems = mapPrimaryAxisAlignItems(layout.justifyContent)
  }
  if (enabling) applyCounterAxisStretch(node, layout?.alignItems)
}
