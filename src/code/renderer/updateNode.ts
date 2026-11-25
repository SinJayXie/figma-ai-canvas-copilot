/**
 * 节点更新逻辑（Task 3.3）
 * - 使用 getNodeByIdAsync（manifest 为 documentAccess: dynamic-page，同步 API 不可用）
 * - 仅修改指令中显式给出的属性：未提供字段一律跳过，避免默认值覆盖现有样式
 * - 文本支持字体族切换与 textAutoResize（不换行）
 */

import type { NodeOp } from '../../../types/node.types'
import { applyAppearance, applyChildSizing } from './applyAppearance'
import { applyLayout } from './layoutMapper'
import { FONT_FAMILY, resolveFamily, resolveFont, resolveFontLike } from './fonts'

export interface UpdateOutcome {
  ok: boolean
  error?: string
}

const OP_TYPE_TO_FIGMA: Record<NodeOp['type'], string> = {
  frame: 'FRAME',
  text: 'TEXT',
  rect: 'RECTANGLE',
  ellipse: 'ELLIPSE',
  line: 'LINE',
}

const MIN_SIZE = 0.01

function clampSize(value: number): number {
  return value > MIN_SIZE ? value : MIN_SIZE
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/**
 * 按 op 更新单个原生节点；返回结果而不抛出。
 * preset 用于批量更新时复用已并行查到的节点，避免逐条串行 getNodeByIdAsync。
 */
export async function updateNodeFromOp(
  op: NodeOp,
  preset?: BaseNode | null,
): Promise<UpdateOutcome> {
  const node = preset !== undefined ? preset : await figma.getNodeByIdAsync(op.id)
  if (!node) {
    return { ok: false, error: `更新失败：节点不存在（id: ${op.id}）` }
  }
  const expected = OP_TYPE_TO_FIGMA[op.type]
  if (expected && node.type !== expected) {
    return {
      ok: false,
      error: `更新失败：类型不匹配（id: ${op.id}，期望 ${expected}，实际 ${node.type}）`,
    }
  }

  try {
    if (op.name) node.name = op.name

    // 坐标：仅当显式给出时设置；Auto Layout 子节点由布局管理位置，失败静默忽略
    if (op.x != null && op.y != null && 'x' in node && 'y' in node) {
      try {
        node.x = op.x
        node.y = op.y
      } catch {
        // 忽略
      }
    }

    if (node.type === 'TEXT') {
      await applyTextProps(node, op)
    }
    applyAppearance(node, op)

    // Auto Layout：仅在显式给出布局配置时应用
    if (node.type === 'FRAME' && op.layout) {
      applyLayout(node, op.layout)
    }

    // 尺寸：仅当显式给出宽高时 resize（文本不换行模式由 textAutoResize 控制）
    // hug 轴由内容决定尺寸，resize 会把 AUTO 改回 FIXED，因此显式 hug 时跳过
    const width = op.width ?? 0
    const height = op.height ?? 0
    const hug =
      op.layout?.sizing?.horizontal === 'hug' || op.layout?.sizing?.vertical === 'hug'
    if (!hug && width > 0 && height > 0 && 'resize' in node) {
      if (node.type === 'LINE') {
        node.resize(clampSize(width), 0)
      } else if (node.type !== 'TEXT' || op.textAutoResize !== 'WIDTH_AND_HEIGHT') {
        node.resize(clampSize(width), clampSize(height))
      }
    }

    // 子级 Fill container / Hug contents：必须在 resize 之后设置，否则会被改回 FIXED
    try {
      applyChildSizing(node, op)
    } catch (e) {
      return {
        ok: false,
        error: `更新失败（id: ${op.id}）：${errorMessage(e)}（填充容器需要父级开启 Auto Layout）`,
      }
    }
  } catch (e) {
    return { ok: false, error: `更新失败（id: ${op.id}）：${errorMessage(e)}` }
  }
  return { ok: true }
}

/** 应用文本属性：字体族/字重/字号/内容/行高/颜色/自适应模式 */
async function applyTextProps(node: TextNode, op: NodeOp): Promise<void> {
  const wantsFontChange =
    op.fontFamily != null || (op.fontWeight ?? 0) > 0 || (op.fontSize ?? 0) > 0 || op.textContent != null

  if (wantsFontChange) {
    const current = typeof node.fontName === 'object' ? node.fontName : null
    const family = op.fontFamily ? resolveFamily(op.fontFamily) : current?.family ?? FONT_FAMILY
    // 仅切换字体族时按原 style 保留字重，否则按指令字重
    const font =
      (op.fontFamily && (op.fontWeight ?? 0) <= 0
        ? await resolveFontLike(family, current?.style)
        : await resolveFont(family, op.fontWeight)) ?? (await resolveFont(FONT_FAMILY, op.fontWeight))
    if (font) {
      try {
        node.fontName = font
      } catch {
        // 字体不可用时保留原字体
      }
    }
  }

  if (op.textContent != null) node.characters = op.textContent
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
  if (op.textAutoResize) {
    try {
      node.textAutoResize = op.textAutoResize
    } catch {
      // 不支持时忽略
    }
  }
}
