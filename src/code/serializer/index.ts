/**
 * 图层序列化器（Task 3.5）
 * 沙箱 → UI/LLM 的画布上下文：属性白名单、深度 5 层、>20 个返回统计摘要、过滤非业务节点
 */

import type { SelectionData, SerializedNode } from '../../../types/node.types'
import { rgbToHex } from '../renderer/utils'

/** 序列化最大深度（超过部分不再展开） */
const MAX_DEPTH = 5
/** 选中节点数量超过该值时仅返回统计摘要 */
const MAX_DETAIL_NODES = 20
/** 文本内容截断长度 */
const TEXT_PREVIEW_LENGTH = 50

/** 非业务节点（辅助线、连接线、便签、代码块、批注等） */
const IGNORED_TYPES = new Set<string>([
  'GUIDE',
  'CONNECTOR',
  'STICKY',
  'SHAPE_WITH_TEXT',
  'CODE_BLOCK',
  'CALLOUT',
  'WIDGET',
])

/** 业务节点类型映射（其余类型视为非业务节点过滤） */
const TYPE_MAP: Record<string, string> = {
  FRAME: 'frame',
  TEXT: 'text',
  RECTANGLE: 'rect',
  ELLIPSE: 'ellipse',
  LINE: 'line',
  GROUP: 'group',
  COMPONENT: 'component',
  INSTANCE: 'instance',
}

function isBusinessNode(node: BaseNode): boolean {
  return TYPE_MAP[node.type] !== undefined && !IGNORED_TYPES.has(node.type)
}

/** 取第一个可见纯色填充的主色 hex */
function firstSolidHex(fills: unknown): string | undefined {
  if (!Array.isArray(fills)) return undefined
  for (const paint of fills as Paint[]) {
    if (paint.type === 'SOLID' && paint.visible !== false) {
      return rgbToHex(paint.color)
    }
  }
  return undefined
}

/** 父级引用：页面返回 "page"，其余返回原生 id（供创建时显式指定 parent） */
function parentRef(node: BaseNode): string | undefined {
  const parent = node.parent
  if (!parent) return undefined
  return parent.type === 'PAGE' ? 'page' : parent.id
}

function serializeNode(node: BaseNode, depth: number): SerializedNode | null {
  if (depth > MAX_DEPTH || !isBusinessNode(node)) return null
  const scene = node as SceneNode

  const result: SerializedNode = {
    id: scene.id,
    name: scene.name,
    type: TYPE_MAP[scene.type] ?? scene.type,
    parentId: parentRef(scene),
    x: Math.round(scene.x),
    y: Math.round(scene.y),
    width: Math.round(scene.width),
    height: Math.round(scene.height),
  }

  if ('fills' in scene) {
    const fill = firstSolidHex(scene.fills)
    if (fill) result.fill = fill
  }
  if ('cornerRadius' in scene && typeof scene.cornerRadius === 'number' && scene.cornerRadius > 0) {
    result.cornerRadius = Math.round(scene.cornerRadius)
  }
  if ('layoutMode' in scene && scene.layoutMode !== 'NONE') {
    result.layoutMode = scene.layoutMode === 'VERTICAL' ? 'vertical' : 'horizontal'
    result.itemSpacing = Math.round(scene.itemSpacing)
  }
  if (scene.type === 'TEXT') {
    if (typeof scene.fontSize === 'number') result.fontSize = scene.fontSize
    result.textContent = scene.characters.slice(0, TEXT_PREVIEW_LENGTH)
  }
  if (depth < MAX_DEPTH && 'children' in scene) {
    const children = (scene as unknown as { children: readonly SceneNode[] }).children
    const serialized = children
      .map((child) => serializeNode(child, depth + 1))
      .filter((child): child is SerializedNode => child !== null)
    if (serialized.length) result.children = serialized
  }
  return result
}

/** 统计整棵树的业务节点类型数量，返回总数 */
function countTree(node: BaseNode, typeCounts: Record<string, number>): number {
  let total = 0
  if (isBusinessNode(node)) {
    const type = TYPE_MAP[node.type] ?? node.type
    typeCounts[type] = (typeCounts[type] ?? 0) + 1
    total++
  }
  if ('children' in node) {
    for (const child of (node as { children: readonly BaseNode[] }).children) {
      total += countTree(child, typeCounts)
    }
  }
  return total
}

/** 内部同步实现：序列化指定节点集合 */
function serializeNodes(nodes: readonly BaseNode[]): SelectionData {
  const business = nodes.filter(isBusinessNode)
  if (business.length === 0) {
    return { count: 0, nodes: [] }
  }

  // 超过 20 个时仅返回统计摘要
  if (business.length > MAX_DETAIL_NODES) {
    const typeCounts: Record<string, number> = {}
    let count = 0
    for (const node of business) count += countTree(node, typeCounts)
    return {
      count,
      nodes: [],
      truncated: true,
      summary: JSON.stringify({ count, typeCounts }),
    }
  }

  const serialized = business
    .map((node) => serializeNode(node, 1))
    .filter((node): node is SerializedNode => node !== null)
  return { count: business.length, nodes: serialized }
}

/**
 * 序列化指定节点集合；缺省时序列化当前选中。
 * 兼容消息分发层的 Promise 约定，返回 Promise<SelectionData>。
 */
export async function serializeSelection(nodes?: readonly BaseNode[]): Promise<SelectionData> {
  return serializeNodes(nodes ?? figma.currentPage.selection)
}

/** 包装 figma.currentPage.selection（同步版本） */
export function getCurrentSelection(): SelectionData {
  return serializeNodes(figma.currentPage.selection)
}

/**
 * 选区轻量摘要：只返回顶层节点（不含 children），供 selection:changed 推送使用。
 * 拖动/多选时避免每次事件都深序列化整棵子树。
 */
export function getCurrentSelectionSummary(): SelectionData {
  const selection = figma.currentPage.selection
  const business = selection.filter(isBusinessNode)
  if (business.length === 0) return { count: 0, nodes: [] }

  if (business.length > MAX_DETAIL_NODES) {
    const typeCounts: Record<string, number> = {}
    for (const node of business) {
      const type = TYPE_MAP[node.type] ?? node.type
      typeCounts[type] = (typeCounts[type] ?? 0) + 1
    }
    return {
      count: business.length,
      nodes: [],
      truncated: true,
      summary: JSON.stringify({ count: business.length, typeCounts }),
    }
  }

  return {
    count: business.length,
    nodes: business.map((node) => {
      const scene = node as SceneNode
      return {
        id: scene.id,
        name: scene.name,
        type: TYPE_MAP[scene.type] ?? scene.type,
        parentId: parentRef(scene),
        x: Math.round(scene.x),
        y: Math.round(scene.y),
        width: Math.round(scene.width),
        height: Math.round(scene.height),
      }
    }),
  }
}

/**
 * 当前页顶层结构摘要（参照 e:/figma-countdown/plugin 的 get_document 思路）：
 * 顶层业务节点各带一层子节点（depth 4 使 serializeNode 恰好包含直接 children），
 * 顶层超过 30 个时仅返回统计
 */
export function getCurrentPageSummary(): SelectionData & { pageName: string } {
  const page = figma.currentPage
  const business = page.children.filter(isBusinessNode)
  if (business.length === 0) {
    return { pageName: page.name, count: 0, nodes: [] }
  }
  if (business.length > 30) {
    const typeCounts: Record<string, number> = {}
    let count = 0
    for (const node of business) count += countTree(node, typeCounts)
    return {
      pageName: page.name,
      count,
      nodes: [],
      truncated: true,
      summary: JSON.stringify({ count, typeCounts }),
    }
  }
  // depth 4：serializeNode 在 depth 5 不再展开 children，恰好顶层节点+一层子节点
  const serialized = business
    .map((node) => serializeNode(node, 4))
    .filter((node): node is SerializedNode => node !== null)
  return { pageName: page.name, count: business.length, nodes: serialized }
}
