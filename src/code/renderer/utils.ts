/**
 * 渲染引擎工具函数：颜色转换 / 画笔构建（Task 3）
 */

import type { EffectInput, FillInput } from '../../../types/node.types'

/** 0~1 归一化 RGB（与 Figma Paint.color 一致） */
export interface RGB {
  r: number
  g: number
  b: number
}

/** 支持十六进制 #RGB / #RRGGBB，解析失败抛出错误（由上层按节点捕获跳过） */
export function hexToRgb(hex: string): RGB {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec((hex ?? '').trim())
  if (!match) throw new Error(`无效的颜色值: ${hex}`)
  let value = match[1]
  if (value.length === 3) {
    value = value
      .split('')
      .map((c) => c + c)
      .join('')
  }
  const num = parseInt(value, 16)
  return {
    r: ((num >> 16) & 255) / 255,
    g: ((num >> 8) & 255) / 255,
    b: (num & 255) / 255,
  }
}

/** 0~1 RGB → #RRGGBB */
export function rgbToHex(color: RGB): string {
  const toHex = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v * 255)))
      .toString(16)
      .padStart(2, '0')
  return `#${toHex(color.r)}${toHex(color.g)}${toHex(color.b)}`
}

export function makeSolidPaint(color: RGB): SolidPaint {
  return { type: 'SOLID', color }
}

/** 解析颜色并保留 alpha（#RRGGBBAA） */
function parseColorWithAlpha(hex: string): { color: RGB; alpha: number } {
  const raw = (hex ?? '').trim().replace(/^#/, '')
  if (raw.length === 8) {
    const color = hexToRgb(raw.slice(0, 6))
    return { color, alpha: parseInt(raw.slice(6, 8), 16) / 255 }
  }
  return { color: hexToRgb(raw), alpha: 1 }
}

/** 十六进制 → RGBA（供网格/效果等需要 alpha 的场景） */
export function hexToRgba(hex: string): RGBA {
  const { color, alpha } = parseColorWithAlpha(hex)
  return { ...color, a: alpha }
}

/** 渐变角度（度，Figma 约定：0 = 左→右，90 = 上→下）→ 围绕中心旋转的 2x3 变换矩阵 */
function gradientTransformFromAngle(angle: number): Transform {
  const rad = (angle * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  return [
    [cos, sin, 0.5 - 0.5 * cos - 0.5 * sin],
    [-sin, cos, 0.5 + 0.5 * sin - 0.5 * cos],
  ]
}

/** 解析渐变方向：合法 gradientTransform 优先，其次 angle，缺省为左→右 */
function resolveGradientTransform(input: {
  angle?: number
  gradientTransform?: number[][]
}): Transform {
  const matrix = input.gradientTransform
  if (Array.isArray(matrix) && matrix.length >= 2) {
    const [row0, row1] = matrix
    if (
      Array.isArray(row0) &&
      Array.isArray(row1) &&
      row0.length >= 3 &&
      row1.length >= 3 &&
      [...row0, ...row1].every((value) => typeof value === 'number' && Number.isFinite(value))
    ) {
      return [
        [row0[0], row0[1], row0[2]],
        [row1[0], row1[1], row1[2]],
      ]
    }
  }
  if (typeof input.angle === 'number' && Number.isFinite(input.angle)) {
    return gradientTransformFromAngle(input.angle)
  }
  return [
    [1, 0, 0],
    [0, 1, 0],
  ]
}

/** FillInput → Figma Paint（字符串/纯色/渐变） */
export function makePaint(input: FillInput): Paint {
  if (typeof input === 'string') {
    const { color, alpha } = parseColorWithAlpha(input)
    return alpha < 1 ? { type: 'SOLID', color, opacity: alpha } : { type: 'SOLID', color }
  }

  if ('gradientStops' in input) {
    const stops = (input.gradientStops ?? []).map((stop) => {
      const { color, alpha } = parseColorWithAlpha(stop.color)
      return { position: Math.max(0, Math.min(1, stop.position)), color: { ...color, a: alpha } }
    })
    if (stops.length < 2) throw new Error('渐变填充至少需要 2 个色标')
    const paint: GradientPaint = {
      type: (input.type as GradientPaint['type'] | undefined) ?? 'GRADIENT_LINEAR',
      gradientStops: stops,
      gradientTransform: resolveGradientTransform(input),
    }
    if (input.opacity != null && input.opacity < 1) {
      ;(paint as { opacity?: number }).opacity = input.opacity
    }
    return paint
  }

  const { color, alpha } = parseColorWithAlpha(input.color)
  const opacity = input.opacity ?? alpha
  return opacity < 1 ? { type: 'SOLID', color, opacity } : { type: 'SOLID', color }
}

/** EffectInput → Figma Effect */
export function makeEffect(input: EffectInput): Effect {
  const radius = Math.max(0, input.radius ?? 0)
  const visible = input.visible !== false

  if (input.type === 'LAYER_BLUR' || input.type === 'BACKGROUND_BLUR') {
    return { type: input.type, radius, visible }
  }

  const { color, alpha } = parseColorWithAlpha(input.color ?? '#000000')
  const effect = {
    type: input.type,
    color: { ...color, a: alpha },
    offset: { x: input.offset?.x ?? 0, y: input.offset?.y ?? 0 },
    radius,
    visible,
    blendMode: 'NORMAL' as const,
  } as DropShadowEffect | InnerShadowEffect
  if (input.spread != null) effect.spread = input.spread
  return effect
}

/** 四角圆角写入（Frame / Rect / Ellipse 支持） */
export function applyCornerRadii(
  node: SceneNode,
  radii: { topLeft?: number; topRight?: number; bottomRight?: number; bottomLeft?: number },
): void {
  if (!('topLeftRadius' in node)) return
  const clamp = (v: number | undefined): number | undefined =>
    v == null ? undefined : Math.max(0, v)
  const tl = clamp(radii.topLeft)
  const tr = clamp(radii.topRight)
  const br = clamp(radii.bottomRight)
  const bl = clamp(radii.bottomLeft)
  if (tl != null) node.topLeftRadius = tl
  if (tr != null) node.topRightRadius = tr
  if (br != null) node.bottomRightRadius = br
  if (bl != null) node.bottomLeftRadius = bl
}
