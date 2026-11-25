/**
 * 节点创建逻辑（Task 3.1）
 * 按 NodeOp.type 递归创建 Figma 节点：先创建对象（暂不建立层级），样式由渲染主流程统一设置
 */

import type { NodeOp } from '../../../types/node.types'
import { applyAppearance } from './applyAppearance'
import { getResolvedFont, resolveFamily } from './fonts'

/** Figma 允许的最小尺寸，避免 0 尺寸导致 resize 抛错 */
const MIN_SIZE = 0.01

function clampSize(value: number): number {
  return value > MIN_SIZE ? value : MIN_SIZE
}

/** 递归创建产物：节点对象 + 子树（父子关系由渲染主流程统一挂载） */
export interface CreatedNode {
  op: NodeOp
  node: SceneNode
  children: CreatedNode[]
}

/** 指令是否显式声明了填充（fill / fills / fillStyleId 任一即可） */
function hasExplicitFill(op: NodeOp): boolean {
  if (op.fillStyleId) return true
  if (op.fill) return true
  return Array.isArray(op.fills) && op.fills.length > 0
}

/** 按类型创建单个节点（尺寸就位，未设样式与层级）；未知类型抛错由上层跳过 */
export function createNodeByType(op: NodeOp): SceneNode {
  switch (op.type) {
    case 'frame': {
      const node = figma.createFrame()
      node.resize(clampSize(op.width ?? 0), clampSize(op.height ?? 0))
      // Figma 新建 frame 默认自带白色填充：未声明填充时清空，让下层背景/父级底色透出
      if (!hasExplicitFill(op)) node.fills = []
      return node
    }
    case 'text':
      return createTextNodeFromOp(op)
    case 'rect': {
      const node = figma.createRectangle()
      node.resize(clampSize(op.width ?? 0), clampSize(op.height ?? 0))
      return node
    }
    case 'ellipse': {
      const node = figma.createEllipse()
      node.resize(clampSize(op.width ?? 0), clampSize(op.height ?? 0))
      return node
    }
    case 'line': {
      const node = figma.createLine()
      node.resize(clampSize(op.width ?? 0), 0)
      return node
    }
    default:
      throw new Error(`不支持的节点类型: ${(op as { type?: string }).type ?? 'unknown'}`)
  }
}

function createTextNodeFromOp(op: NodeOp): TextNode {
  const node = figma.createText()
  // 必须先切到已加载的字体，再写 characters：新建文本节点的初始字体是 Inter，
  // 若指令使用其它字体族而 Inter 未加载，直接写 characters 会抛错。
  const font =
    getResolvedFont(resolveFamily(op.fontFamily), op.fontWeight) ??
    getResolvedFont(resolveFamily(undefined), 400)
  if (font) {
    try {
      node.fontName = font
    } catch {
      // 字体切换失败时保留默认字体
    }
  }
  if (op.textContent) node.characters = op.textContent
  if ((op.fontSize ?? 0) > 0) node.fontSize = op.fontSize as number
  if (op.lineHeight && op.lineHeight > 0) {
    node.lineHeight = { value: op.lineHeight, unit: 'PIXELS' }
  }
  if (op.letterSpacing != null) {
    node.letterSpacing = { value: op.letterSpacing, unit: 'PIXELS' }
  }
  if (op.paragraphSpacing != null) node.paragraphSpacing = op.paragraphSpacing
  if (op.textAlignHorizontal) node.textAlignHorizontal = op.textAlignHorizontal
  if (op.textAlignVertical) node.textAlignVertical = op.textAlignVertical
  if (op.textCase) node.textCase = op.textCase
  if (op.textDecoration) node.textDecoration = op.textDecoration
  if (op.textTruncation) node.textTruncation = op.textTruncation
  if (op.maxLines != null && op.maxLines > 0) node.maxLines = op.maxLines
  // 文本自适应模式（WIDTH_AND_HEIGHT 表示不换行、宽度随内容），此时不强制 resize
  if (op.textAutoResize) {
    try {
      node.textAutoResize = op.textAutoResize
    } catch {
      // 不支持时忽略
    }
  }
  if (op.textAutoResize !== 'WIDTH_AND_HEIGHT') {
    node.resize(clampSize(op.width ?? 0), clampSize(op.height ?? 0))
  }
  return node
}

/** 递归创建节点树（text 无 children）；仅 frame 递归子级 */
export function buildTree(op: NodeOp): CreatedNode {
  const node = createNodeByType(op)
  const children: CreatedNode[] =
    op.type === 'frame' ? (op.children ?? []).map(buildTree) : []
  return { op, node, children }
}

/**
 * 统一应用样式：图层名 + 外观（填充/描边/圆角/效果/透明度/样式绑定/布局细节）。
 * 线条以描边呈现，描边色缺失时回退 fill。
 */
export function applyStyles(node: SceneNode, op: NodeOp): void {
  if (op.name) node.name = op.name
  applyAppearance(node, op)
}
