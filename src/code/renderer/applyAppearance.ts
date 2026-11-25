/**
 * 外观属性写入（create / update 共用）
 * 仅写入指令中显式提供的字段，避免默认值覆盖现有样式。
 * 覆盖：填充（纯色/渐变/多填充）、描边细节、圆角、效果、透明度、混合模式、
 *      样式绑定、尺寸约束、布局网格、子级 sizing / 绝对定位、裁剪。
 */

import type { NodeOp } from '../../../types/node.types'
import { applyCornerRadii, hexToRgb, hexToRgba, makeEffect, makePaint, makeSolidPaint } from './utils'

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

/** 模型常用 transparent / none 表示无填充，不能按十六进制解析 */
function isTransparent(value: string | null | undefined): boolean {
  return !!value && /^(transparent|none)$/i.test(value.trim())
}

/**
 * 安全写入样式 id：格式非法（如模型输出带尾随逗号）或样式不存在时静默跳过，
 * 避免一个无效 id 让整段外观设置抛错、导致节点样式只应用一半。
 */
function tryAssignStyle(node: SceneNode, key: string, styleId: string | undefined): void {
  if (!styleId || !(key in node)) return
  if (!/^S:[0-9a-f]+$/i.test(styleId)) return
  try {
    ;(node as unknown as Record<string, unknown>)[key] = styleId
  } catch {
    // 无效 / 不存在的样式 id：忽略，继续应用其它属性
  }
}

/** 图层级外观（不含文字排版，文字在 applyTextProps 中处理） */
export function applyAppearance(node: SceneNode, op: NodeOp): void {
  // 填充：fills 优先，其次 fill / textColor（文本）；transparent / none 表示无填充
  if ('fills' in node) {
    if (op.fills && op.fills.length > 0) {
      node.fills = op.fills
        .filter((item) => !(typeof item === 'string' && isTransparent(item)))
        .map(makePaint)
    } else if (node.type === 'TEXT') {
      const color = op.textColor || op.fill
      if (color) node.fills = isTransparent(color) ? [] : [makeSolidPaint(hexToRgb(color))]
    } else if (op.fill) {
      node.fills = isTransparent(op.fill) ? [] : [makeSolidPaint(hexToRgb(op.fill))]
    }
  }

  // 描边
  if ('strokes' in node) {
    if (node.type === 'LINE') {
      // 线条以描边呈现：没有描边色时用填充色兜底
      const lineColor = op.stroke || op.fill
      node.strokes =
        lineColor && !isTransparent(lineColor) ? [makeSolidPaint(hexToRgb(lineColor))] : []
    } else if (op.stroke === null || (op.stroke && isTransparent(op.stroke))) {
      node.strokes = []
    } else if (op.stroke) {
      node.strokes = [makeSolidPaint(hexToRgb(op.stroke))]
    }
    if ((op.strokeWeight ?? 0) > 0) node.strokeWeight = op.strokeWeight as number
    if (op.strokeAlign && 'strokeAlign' in node) {
      node.strokeAlign = op.strokeAlign
    }
    if (op.dashPattern && 'dashPattern' in node) node.dashPattern = op.dashPattern
    if (op.strokeWeights) {
      const weights = node as unknown as Record<string, unknown>
      if (op.strokeWeights.top != null && 'strokeTopWeight' in node) {
        weights.strokeTopWeight = op.strokeWeights.top
      }
      if (op.strokeWeights.right != null && 'strokeRightWeight' in node) {
        weights.strokeRightWeight = op.strokeWeights.right
      }
      if (op.strokeWeights.bottom != null && 'strokeBottomWeight' in node) {
        weights.strokeBottomWeight = op.strokeWeights.bottom
      }
      if (op.strokeWeights.left != null && 'strokeLeftWeight' in node) {
        weights.strokeLeftWeight = op.strokeWeights.left
      }
    }
  }

  // 圆角：cornerRadii 优先于统一 cornerRadius
  if (
    (node.type === 'FRAME' || node.type === 'RECTANGLE' || node.type === 'ELLIPSE') &&
    (op.cornerRadius ?? 0) > 0
  ) {
    node.cornerRadius = op.cornerRadius as number
  }
  if (op.cornerRadii) applyCornerRadii(node, op.cornerRadii)

  // 效果 / 透明度 / 混合模式
  if (op.effects && 'effects' in node) {
    node.effects = op.effects.map(makeEffect)
  }
  if (op.opacity != null && 'opacity' in node) {
    node.opacity = clamp01(op.opacity)
  }
  if (op.blendMode && 'blendMode' in node) {
    node.blendMode = op.blendMode as BlendMode
  }

  // 设计系统样式绑定（无效 id 不影响其它属性）
  tryAssignStyle(node, 'fillStyleId', op.fillStyleId)
  tryAssignStyle(node, 'strokeStyleId', op.strokeStyleId)
  tryAssignStyle(node, 'textStyleId', op.textStyleId)
  tryAssignStyle(node, 'effectStyleId', op.effectStyleId)

  // 尺寸约束 / 裁剪
  if (op.constraints && 'constraints' in node) node.constraints = op.constraints
  if ('minWidth' in node && op.minWidth != null) node.minWidth = op.minWidth
  if ('maxWidth' in node && op.maxWidth != null) node.maxWidth = op.maxWidth
  if ('minHeight' in node && op.minHeight != null) node.minHeight = op.minHeight
  if ('maxHeight' in node && op.maxHeight != null) node.maxHeight = op.maxHeight
  if ('clipsContent' in node && op.clipsContent != null) {
    node.clipsContent = op.clipsContent
  }

  // 遮罩：先设 isMask，再设类型（Figma 仅在 isMask=true 时允许改 maskType）
  if (op.isMask != null && 'isMask' in node) {
    node.isMask = op.isMask
    if (op.isMask && op.maskType && 'maskType' in node) {
      node.maskType = op.maskType
    }
  }

  // 布局网格
  if (op.layoutGrids && 'layoutGrids' in node) {
    node.layoutGrids = op.layoutGrids.map((grid) => {
      const base = {
        pattern: grid.pattern,
        visible: grid.visible !== false,
        color: hexToRgba(grid.color ?? '#FF0000'),
      }
      if (grid.pattern === 'GRID') {
        return { ...base, sectionSize: Math.max(1, grid.sectionSize ?? 8) } as LayoutGrid
      }
      return {
        ...base,
        alignment: grid.alignment ?? 'MIN',
        gutterSize: Math.max(0, grid.gutterSize ?? 16),
        count: Math.max(1, grid.count ?? 12),
        offset: grid.offset ?? 0,
        ...(grid.pattern === 'ROWS' && grid.sectionSize
          ? { sectionSize: Math.max(1, grid.sectionSize) }
          : {}),
      } as LayoutGrid
    })
  }

  // 子级在 Auto Layout 中的尺寸行为（layoutSizing）需要节点已挂载到父级后设置，
  // 由调用方在挂载完成后再调用 applyChildSizing，这里不再处理。
  if (op.layoutPositioning && 'layoutPositioning' in node) {
    node.layoutPositioning = op.layoutPositioning
  }
}

/**
 * 应用子级尺寸行为（Fill container / Hug contents / Fixed）。
 * 必须在节点已经挂载到最终父级之后调用：
 * - FILL 要求父级是 Auto Layout；
 * - HUG 要求节点自身是 Auto Layout 容器，或文本节点。
 * 同时把 layoutSizing 映射到 Figma 文档模型里的 layoutAlign / layoutGrow（旧版属性兜底）。
 */
export function applyChildSizing(node: SceneNode, op: NodeOp): void {
  const sizing = op.layoutSizing
  if (!sizing) return
  const map = { fixed: 'FIXED', hug: 'HUG', fill: 'FILL' } as const
  const parent = node.parent as (BaseNode & { layoutMode?: string }) | null
  const parentAutoLayout = !!parent && 'layoutMode' in parent && parent.layoutMode !== 'NONE'

  if (sizing.horizontal && 'layoutSizingHorizontal' in node) {
    if (sizing.horizontal === 'fill' && !parentAutoLayout) {
      throw new Error('父级不是 Auto Layout，无法填充容器')
    }
    node.layoutSizingHorizontal = map[sizing.horizontal]
  }
  if (sizing.vertical && 'layoutSizingVertical' in node) {
    if (sizing.vertical === 'fill' && !parentAutoLayout) {
      throw new Error('父级不是 Auto Layout，无法填充容器')
    }
    node.layoutSizingVertical = map[sizing.vertical]
  }
}
