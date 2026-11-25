/**
 * 设计规范校验（面向 ops 的轻量 lint）
 * 在应用到画布前检查 8pt 网格、类型阶梯、触控目标、文字对比度，
 * 结果作为 Agent 步骤与正文提示展示，不阻塞应用。
 */
import type { NodeOp } from '../../../types/node.types'
import { t } from '../i18n'

export interface LintIssue {
  message: string
}

/** 类型阶梯（与内置提示词一致） */
const TYPE_SCALE = new Set([12, 14, 16, 20, 24, 32, 48])
/** 触控目标最小高度 */
const MIN_TOUCH_HEIGHT = 40
/** 正文最小对比度（WCAG AA） */
const MIN_CONTRAST = 4.5

const isGrid = (value: number): boolean => Math.abs(value % 8) < 0.01

/** 解析 #RGB / #RRGGBB / #RRGGBBAA 为 0~1 RGB */
function parseHex(hex: string): { r: number; g: number; b: number } | null {
  const raw = (hex ?? '').trim().replace(/^#/, '')
  const value = raw.length === 3 ? raw.split('').map((c) => c + c).join('') : raw.slice(0, 6)
  if (!/^[0-9a-fA-F]{6}$/.test(value)) return null
  const num = parseInt(value, 16)
  return { r: ((num >> 16) & 255) / 255, g: ((num >> 8) & 255) / 255, b: (num & 255) / 255 }
}

/** WCAG 相对亮度 */
function luminance(hex: string): number | null {
  const rgb = parseHex(hex)
  if (!rgb) return null
  const channel = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b)
}

function contrastRatio(foreground: string, background: string): number | null {
  const fg = luminance(foreground)
  const bg = luminance(background)
  if (fg == null || bg == null) return null
  const [lighter, darker] = fg > bg ? [fg, bg] : [bg, fg]
  return (lighter + 0.05) / (darker + 0.05)
}

/** 取 op 的首个填充色（字符串或纯色对象） */
function firstFill(op: NodeOp): string | undefined {
  if (op.fill) return op.fill
  const first = op.fills?.[0]
  if (typeof first === 'string') return first
  if (first && typeof first === 'object' && 'color' in first) return first.color
  return undefined
}

/**
 * 校验 ops；只返回去重后的前 maxIssues 条，避免正文提示过长。
 */
export function lintOps(ops: NodeOp[], maxIssues = 6): LintIssue[] {
  const issues: string[] = []
  const seen = new Set<string>()

  const report = (message: string): void => {
    if (seen.has(message) || issues.length >= maxIssues) return
    seen.add(message)
    issues.push(message)
  }

  const walk = (op: NodeOp, parentFill?: string): void => {
    const label = op.name || op.type

    if (op.action === 'create') {
      const layout = op.layout
      if (layout && layout.mode && layout.mode !== 'none') {
        if (layout.gap != null && layout.gap > 0 && !isGrid(layout.gap)) {
          report(t('LINT_GAP', { label, value: layout.gap }))
        }
        for (const padding of layout.padding ?? []) {
          if (padding > 0 && !isGrid(padding)) {
            report(t('LINT_PADDING', { label, value: padding }))
            break
          }
        }
      }
      if ((op.cornerRadius ?? 0) > 0 && !isGrid(op.cornerRadius as number)) {
        report(t('LINT_RADIUS', { label, value: op.cornerRadius }))
      }
      if (
        op.type === 'frame' &&
        /按钮|button/i.test(op.name) &&
        (op.height ?? 0) > 0 &&
        (op.height as number) < MIN_TOUCH_HEIGHT
      ) {
        report(t('LINT_TOUCH_HEIGHT', { label, value: op.height, min: MIN_TOUCH_HEIGHT }))
      }
    }

    if (op.type === 'text' && op.fontSize && !TYPE_SCALE.has(op.fontSize)) {
      report(t('LINT_FONT_SIZE', { label, value: op.fontSize }))
    }

    if (op.type === 'text' && op.textColor && parentFill) {
      const ratio = contrastRatio(op.textColor, parentFill)
      if (ratio != null && ratio < MIN_CONTRAST) {
        report(t('LINT_CONTRAST', { label, value: ratio.toFixed(1), min: MIN_CONTRAST }))
      }
    }

    const ownFill = firstFill(op)
    const nextFill = op.type === 'text' ? parentFill : ownFill ?? parentFill
    for (const child of op.children ?? []) walk(child, nextFill)
  }

  for (const op of ops) walk(op)
  return issues.map((message) => ({ message }))
}
