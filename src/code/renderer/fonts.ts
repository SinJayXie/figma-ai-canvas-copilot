/**
 * 字体加载管理（Task 3.1）
 * - 支持任意字体族（含常见中文别名归一化，如 苹方 → PingFang SC）
 * - 字重映射为候选 style 列表逐个尝试（Inter 的 "Semi Bold" 与 PingFang 的 "Semibold" 命名不同）
 * - 文本节点设置 fontName/characters/fontSize 前必须 loadFontAsync
 */

import type { NodeOp } from '../../../types/node.types'

/** 默认字体族 */
export const FONT_FAMILY = 'Inter'

/** 常见字体族别名 → Figma 字体族名（小写匹配） */
const FAMILY_ALIASES: Record<string, string> = {
  苹方: 'PingFang SC',
  '苹方-简': 'PingFang SC',
  pingfang: 'PingFang SC',
  pingfangsc: 'PingFang SC',
  'pingfang sc': 'PingFang SC',
  微软雅黑: 'Microsoft YaHei',
  思源黑体: 'Source Han Sans CN',
  'source han sans': 'Source Han Sans CN',
  sourcehansans: 'Source Han Sans CN',
  inter: 'Inter',
}

/** 字体族归一化：别名/空值 → 实际 Figma 字体族名 */
export function resolveFamily(input?: string | null): string {
  const raw = (input ?? '').trim()
  if (!raw) return FONT_FAMILY
  return FAMILY_ALIASES[raw.toLowerCase()] ?? raw
}

/** 不同字重对应的候选 style（按优先级尝试，命中即可） */
function styleCandidates(weight?: number): string[] {
  const w = typeof weight === 'number' && weight > 0 ? weight : 400
  if (w < 400) return ['Light', 'Regular']
  if (w < 500) return ['Regular', 'Book', 'Normal']
  if (w < 600) return ['Medium', 'Regular']
  if (w < 700) return ['Semi Bold', 'Semibold', 'SemiBold', 'Medium', 'Bold']
  return ['Bold', 'Semibold', 'Semi Bold']
}

/** style 名 → 字重（仅改字体族时用于保留原字重） */
function styleToWeight(style?: string): number {
  const s = (style ?? '').toLowerCase()
  if (s.includes('light') || s.includes('thin')) return 300
  if (s.includes('medium')) return 500
  if (s.includes('semi') || s.includes('demi')) return 600
  if (s.includes('bold') || s.includes('heavy') || s.includes('black')) return 700
  return 400
}

export interface ResolvedFont {
  family: string
  style: string
}

/** 已加载字体缓存 `${family}::${style}` */
const loadedFontKeys = new Set<string>()
/** 族+字重 → 实际可用 fontName（null 表示不存在） */
const resolvedByWeight = new Map<string, ResolvedFont | null>()

const tryFamily = async (family: string, weight?: number): Promise<ResolvedFont | null> => {
  for (const style of styleCandidates(weight)) {
    const fontKey = `${family}::${style}`
    if (loadedFontKeys.has(fontKey)) return { family, style }
    try {
      await figma.loadFontAsync({ family, style })
      loadedFontKeys.add(fontKey)
      return { family, style }
    } catch {
      // 该 style 不存在，尝试下一个
    }
  }
  return null
}

/** 加载并解析 fontName：优先指定字体族，失败回退 Inter；全部失败返回 null */
export async function resolveFont(family: string, weight?: number): Promise<ResolvedFont | null> {
  const cacheKey = `${family}::${weight ?? 400}`
  if (resolvedByWeight.has(cacheKey)) return resolvedByWeight.get(cacheKey) ?? null
  let resolved = await tryFamily(family, weight)
  if (!resolved && family !== FONT_FAMILY) resolved = await tryFamily(FONT_FAMILY, weight)
  resolvedByWeight.set(cacheKey, resolved)
  return resolved
}

/** 同步读取已解析结果（创建流程先批量预加载，再同步建节点） */
export function getResolvedFont(family: string, weight?: number): ResolvedFont | null {
  return resolvedByWeight.get(`${family}::${weight ?? 400}`) ?? null
}

/** 按原 style 保留字重（仅切换字体族场景） */
export async function resolveFontLike(
  family: string,
  style?: string,
): Promise<ResolvedFont | null> {
  return resolveFont(family, styleToWeight(style))
}

/** 预收集 ops 中的字体（族+字重）并批量预加载；失败静默，创建时回退默认字体 */
export async function ensureFontsLoaded(ops: NodeOp[]): Promise<void> {
  const targets = new Map<string, { family: string; weight?: number }>()
  const collect = (list: NodeOp[]): void => {
    for (const op of list) {
      if (op.type === 'text') {
        const family = resolveFamily(op.fontFamily)
        targets.set(`${family}::${op.fontWeight ?? 400}`, { family, weight: op.fontWeight })
      }
      if (op.children?.length) collect(op.children)
    }
  }
  collect(ops)
  // 兜底字体：新建文本节点的初始字体是 Inter，加入加载列表以免切换字体前写 characters 失败
  if (targets.size > 0) {
    targets.set(`${FONT_FAMILY}::400`, { family: FONT_FAMILY, weight: 400 })
  }
  await Promise.all([...targets.values()].map((t) => resolveFont(t.family, t.weight).catch(() => null)))
}
