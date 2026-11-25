/**
 * 画布 + 设计系统上下文获取（借鉴 Figma 官方 Agent 的「设计系统即事实来源」做法）
 * - designContext：get_design_context（优先选中图层，无选中回退当前页）
 * - designSystem：本地组件 / 样式 / 变量的紧凑摘要，供模型优先复用而非从零画
 * 失败均静默降级；组件与样式慢查询做 60s 缓存，避免每条消息全量扫描
 */
import { invokeCapability } from './capabilities.service'
import { estimateTokens } from '../utils/promptBuilder'

/** 上下文 token 预算（估算值），超出时按优先级结构化裁剪，绝不截断 JSON 字符串 */
const MAX_CONTEXT_TOKENS = 7000
/** 设计系统摘要缓存时长 */
const DESIGN_SYSTEM_TTL = 60_000

interface CacheEntry<T> {
  ts: number
  value: T
}

let designSystemCache: CacheEntry<string | null> | null = null

const safe = async <T>(task: () => Promise<T>): Promise<T | null> => {
  try {
    return await task()
  } catch {
    return null
  }
}

const clamp = (list: unknown, max: number): any[] => (Array.isArray(list) ? list.slice(0, max) : [])

/** 样式摘要：只保留名称与关键排版信息，避免大量 paint 细节 */
function summarizeStyles(data: any) {
  if (!data) return undefined
  return {
    paintStyles: clamp(data.paints, 30).map((s: any) => ({ id: s.id, name: s.name })),
    textStyles: clamp(data.text, 20).map((s: any) => ({
      id: s.id,
      name: s.name,
      fontSize: s.fontSize,
      fontFamily: s.fontFamily,
      fontStyle: s.fontStyle,
    })),
    effectStyles: clamp(data.effects, 10).map((s: any) => ({ id: s.id, name: s.name })),
    gridStyles: clamp(data.grids, 10).map((s: any) => ({ id: s.id, name: s.name })),
  }
}

/** 变量摘要：集合 + 模式 + 变量名与类型 */
function summarizeVariables(data: any) {
  if (!data || !Array.isArray(data.collections)) return undefined
  return {
    collections: clamp(data.collections, 5).map((c: any) => ({
      id: c.id,
      name: c.name,
      modes: clamp(c.modes, 5).map((m: any) => m.name),
      variables: clamp(c.variables, 40).map((v: any) => ({
        id: v.id,
        name: v.name,
        type: v.resolvedType,
      })),
    })),
  }
}

/** 组件摘要：本地组件（id）+ 已使用的资源库组件（key，可 importComponentByKeyAsync 复用） */
function summarizeComponents(data: any) {
  if (!data) return undefined
  return {
    count: data.count ?? 0,
    componentSets: clamp(data.componentSets, 10).map((s: any) => ({ id: s.id, name: s.name })),
    components: clamp(data.components, 40).map((c: any) => ({
      id: c.id,
      name: c.name,
      variantProperties: c.variantProperties ?? undefined,
    })),
    // 资源库组件无法整体枚举，只列出当前文件已使用过的（按 key 复用）
    libraryComponents: clamp(data.libraryComponents, 40).map((c: any) => ({
      key: c.key,
      name: c.name,
      componentSetName: c.componentSetName ?? undefined,
    })),
  }
}

/** 获取设计系统摘要（带缓存） */
async function fetchDesignSystem(): Promise<string | null> {
  const now = Date.now()
  if (designSystemCache && now - designSystemCache.ts < DESIGN_SYSTEM_TTL) {
    return designSystemCache.value
  }
  const [styles, variables, components] = await Promise.all([
    safe(() => invokeCapability('get_styles')),
    safe(() => invokeCapability('get_variable_defs')),
    safe(() => invokeCapability('get_local_components')),
  ])
  const summary = {
    styles: summarizeStyles(styles),
    variables: summarizeVariables(variables),
    components: summarizeComponents(components),
  }
  const hasContent = Boolean(summary.styles || summary.variables || summary.components)
  const value = hasContent ? JSON.stringify(summary) : null
  designSystemCache = { ts: now, value }
  return value
}

/** 手动失效缓存（新建组件/样式后需要时调用） */
export function invalidateDesignSystemCache(): void {
  designSystemCache = null
}

/** 估算 JSON 体积（token）；序列化失败时视为超限 */
function contextTokens(value: unknown): number {
  try {
    return estimateTokens(JSON.stringify(value))
  } catch {
    return Number.MAX_SAFE_INTEGER
  }
}

/**
 * 结构化裁剪：按「设计系统 → 上下文节点数量 → 只保留页面摘要」的顺序降级，
 * 任何情况下都返回合法 JSON（旧实现直接 slice 字符串会把 JSON 切断）。
 */
function fitContext(payload: {
  designContext?: Record<string, any>
  designSystem?: unknown
}): string {
  if (contextTokens(payload) <= MAX_CONTEXT_TOKENS) return JSON.stringify(payload)

  // 1. 先丢设计系统摘要：体积最大，且下一轮可重新获取
  delete payload.designSystem
  const context = payload.designContext
  if (context) context.contextTruncated = true
  if (contextTokens(payload) <= MAX_CONTEXT_TOKENS) return JSON.stringify(payload)

  // 2. 裁剪上下文树：先保留前 20 个顶层节点，再逐个收缩到至少 1 个
  if (context && Array.isArray(context.context)) {
    const originalNodeCount = context.context.length
    if (context.context.length > 20) context.context = context.context.slice(0, 20)
    while (context.context.length > 1 && contextTokens(payload) > MAX_CONTEXT_TOKENS) {
      context.context.pop()
    }
    context.truncated = true
    context.originalNodeCount = originalNodeCount
  }
  if (contextTokens(payload) <= MAX_CONTEXT_TOKENS) return JSON.stringify(payload)

  // 3. 最后兜底：只保留页面/选区元信息
  return JSON.stringify({
    designContext: context
      ? {
          fileName: context.fileName,
          currentPage: context.currentPage,
          selectionCount: context.selectionCount,
          truncated: true,
          contextTruncated: true,
        }
      : undefined,
    contextTruncated: true,
  })
}

/**
 * 获取当前画布上下文（选中图层 / 当前页的设计上下文 + 设计系统摘要）
 * 失败（沙箱未就绪、能力异常等）时返回空串，绝不抛出，避免打断对话
 */
export async function fetchCanvasContext(): Promise<string> {
  const [designContext, designSystem] = await Promise.all([
    safe(() => invokeCapability('get_design_context', { params: { depth: 2, detail: 'compact' } })),
    fetchDesignSystem(),
  ])
  if (!designContext && !designSystem) return ''

  const payload: {
    designContext?: Record<string, any>
    designSystem?: unknown
  } = {}
  if (designContext) payload.designContext = designContext as Record<string, any>
  if (designSystem) {
    try {
      payload.designSystem = JSON.parse(designSystem)
    } catch {
      // 摘要损坏时直接忽略，不影响主上下文
    }
  }
  if (!payload.designContext && !payload.designSystem) return ''
  return fitContext(payload)
}
