/**
 * 沙箱层消息分发主入口（Task 2）
 * - 带 id 消息：请求-响应，逐 handler try/catch，回传 {id, type, success, data|error}
 * - 无 id 消息：按协议不应出现，直接忽略
 * - 事件推送：selection:changed / theme:changed（无 id）
 * 渲染 / 序列化逻辑由 Task 3 提供实现（./renderer / ./serializer）
 */
import type { PluginConfig } from '../../types/config.types'
import type { PluginMessageType } from '../../types/message.types'
import type { OpsPayload } from '../../types/node.types'
import { handleReadRequest } from './capabilities/read-handlers'
import { clearStyleCache } from './capabilities/serializers'
import { handleWriteRequest } from './capabilities/write-handlers'
import { executeCreateOps, executeUpdateOps } from './renderer'
import { getCurrentSelection, getCurrentSelectionSummary, getCurrentPageSummary } from './serializer'
import { loadConfig, loadHistory, saveConfig, saveHistory } from './storage'

figma.showUI(__html__, { width: 360, height: 560, themeColors: true })

/** 请求处理器：payload -> 响应 data */
type Handler = (payload: unknown) => unknown

/**
 * 串行请求队列：Figma 主线程共享全局状态（skipInvisibleInstanceChildren 等），
 * 并发执行会互相干扰，且写操作需要稳定顺序（例如 ops:create 后再 get_selection）。
 */
let requestChain: Promise<unknown> = Promise.resolve()

function enqueueRequest<T>(task: () => Promise<T>): Promise<T> {
  const run = requestChain.then(task, task)
  requestChain = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

/** ops 批次幂等缓存：同一 batchId 重复提交（超时重试）直接返回首次结果 */
const OP_BATCH_LIMIT = 50
const opBatchCache = new Map<string, unknown>()

function opBatchKey(type: string, payload: unknown): string | undefined {
  const batchId = (payload as { batchId?: unknown } | null)?.batchId
  return typeof batchId === 'string' && batchId ? `${type}:${batchId}` : undefined
}

async function runOpBatch<T>(type: string, payload: unknown, execute: () => Promise<T>): Promise<T> {
  const key = opBatchKey(type, payload)
  if (key && opBatchCache.has(key)) return opBatchCache.get(key) as T
  const data = await execute()
  if (key) {
    opBatchCache.set(key, data)
    if (opBatchCache.size > OP_BATCH_LIMIT) {
      const oldest = opBatchCache.keys().next().value
      if (oldest) opBatchCache.delete(oldest)
    }
  }
  return data
}

/** 能力请求（转发至 ./capabilities 统一读写能力层） */
interface CapabilityRequest {
  type: string
  nodeIds?: string[]
  params?: Record<string, unknown>
  requestId?: string
}

/**
 * 大树遍历类能力：开启时跳过实例内不可见节点可显著提速（findAllWithCriteria 最多快数百倍）。
 * 该标记仅作用于单次请求，结束后还原（Dev Mode 下默认值为 true，不能硬编码 false）。
 */
const FAST_TRAVERSAL = new Set([
  'get_document',
  'get_design_context',
  'get_fonts',
  'get_annotations',
  'get_local_components',
  'search_nodes',
  'scan_text_nodes',
  'scan_nodes_by_types',
])

/** 会新增/改名样式的写能力：执行前清空样式名缓存，避免同轮后续读取拿到旧名字 */
const STYLE_MUTATIONS = new Set([
  'create_paint_style',
  'create_text_style',
  'create_effect_style',
  'create_grid_style',
  'update_paint_style',
  'update_text_style',
  'update_effect_style',
  'update_grid_style',
  'delete_style',
])

/** 统一能力分发：先 read 后 write；data 解包后回传 UI，null/error 转为抛错 */
async function invokeCapability(payload: CapabilityRequest): Promise<unknown> {
  if (STYLE_MUTATIONS.has(payload.type)) clearStyleCache()
  const prevSkip = figma.skipInvisibleInstanceChildren
  const fast = FAST_TRAVERSAL.has(payload.type)
  if (fast) figma.skipInvisibleInstanceChildren = true
  try {
    const request = { ...payload, requestId: payload.requestId ?? `cap_${Date.now()}` }
    // 移植的能力层返回 { type, requestId, data }，异常路径为 { type, requestId, error }
    const raw = (await handleReadRequest(request)) ?? (await handleWriteRequest(request))
    const result = raw as { data?: unknown; error?: string } | null
    if (result === null) throw new Error(`未知能力类型：${payload.type}`)
    if (result.error) throw new Error(result.error)
    return result.data
  } finally {
    if (fast) figma.skipInvisibleInstanceChildren = prevSkip
  }
}

/** 历史按 fileKey 隔离（DEV.md 5.4） */
function getFileKey(): string {
  return figma.fileKey ?? ''
}

/** 请求处理器映射（DEV.md 3.3） */
const handlers: Partial<Record<PluginMessageType, Handler>> = {
  'config:load': () => loadConfig(),
  'config:save': (payload) => saveConfig(payload as PluginConfig),
  'selection:get': () => getCurrentSelection(),
  'page:get': () => getCurrentPageSummary(),
  'cap:invoke': (payload) => invokeCapability(payload as CapabilityRequest),
  'ops:create': (payload) =>
    runOpBatch('ops:create', payload, () => executeCreateOps(payload as OpsPayload)),
  'ops:update': (payload) =>
    runOpBatch('ops:update', payload, () => executeUpdateOps(payload as OpsPayload)),
  'history:load': () => loadHistory(getFileKey()),
  'history:save': (payload) => saveHistory(getFileKey(), payload),
}

/** 回传成功响应 */
function respond(id: string, type: string, data: unknown): void {
  figma.ui.postMessage({ id, type, success: true, data })
}

/** 回传失败响应 */
function respondError(id: string, type: string, error: unknown): void {
  figma.ui.postMessage({
    id,
    type,
    success: false,
    error: error instanceof Error ? error.message : String(error),
  })
}

/** 消息分发入口 */
figma.ui.onmessage = (pluginMessage: unknown) => {
  const msg = (pluginMessage ?? {}) as { id?: unknown; type?: unknown; payload?: unknown }
  // 无 id 的消息（按协议不应出现）直接忽略
  if (typeof msg.id !== 'string') return
  const id = msg.id
  const type = typeof msg.type === 'string' ? msg.type : ''
  const handler = type ? handlers[type as PluginMessageType] : undefined
  if (!handler) {
    respondError(id, type, new Error(`Unknown message type: ${type || '(empty)'}`))
    return
  }
  try {
    void enqueueRequest(() => Promise.resolve(handler(msg.payload))).then(
      (data) => respond(id, type, data),
      (error) => respondError(id, type, error),
    )
  } catch (error) {
    respondError(id, type, error)
  }
}

/** 画布选中变更推送（无 id 事件）：轻量摘要 + 120ms 防抖，避免拖动时频繁深序列化 */
let selectionTimer: ReturnType<typeof setTimeout> | null = null

figma.on('selectionchange', () => {
  if (selectionTimer) clearTimeout(selectionTimer)
  selectionTimer = setTimeout(() => {
    selectionTimer = null
    figma.ui.postMessage({ type: 'selection:changed', payload: getCurrentSelectionSummary() })
  }, 120)
})

/**
 * 画布文档变更推送（无 id 事件）
 * 注：dynamic-page 模式下注册 figma.on('documentchange') 必须先 loadAllPagesAsync（会加载整份文件），
 * 因此改用官方推荐的更细粒度替代：当前页 PageNode 的 nodechange + 全局 stylechange。
 * 防抖避免拖动/批量操作时频繁推送；插件自身写入也会触发，UI 侧做缓存失效即可（无需区分来源）。
 */
let documentTimer: ReturnType<typeof setTimeout> | null = null

function notifyDocumentChanged(): void {
  if (documentTimer) clearTimeout(documentTimer)
  documentTimer = setTimeout(() => {
    documentTimer = null
    figma.ui.postMessage({ type: 'document:changed' })
  }, 400)
}

/** 当前已监听 nodechange 的页面与回调（页面切换时需要解绑旧页，避免重复推送） */
let observedPage: PageNode | null = null
let pageNodeChangeHandler: ((event: any) => void) | null = null

/** 绑定当前页的 nodechange；切换页面后调用可重新绑定 */
function bindCurrentPageChange(): void {
  const page = figma.currentPage
  if (observedPage === page && pageNodeChangeHandler) return
  if (observedPage && pageNodeChangeHandler) {
    try {
      observedPage.off('nodechange', pageNodeChangeHandler)
    } catch {
      // 旧页已卸载时忽略
    }
  }
  observedPage = page
  pageNodeChangeHandler = () => notifyDocumentChanged()
  page.on('nodechange', pageNodeChangeHandler)
}

bindCurrentPageChange()
figma.on('stylechange', () => notifyDocumentChanged())

/** 当前页切换推送（无 id 事件）：直接携带页 id / 名称，UI 侧据此刷新页面摘要 */
figma.on('currentpagechange', () => {
  bindCurrentPageChange()
  const page = figma.currentPage
  figma.ui.postMessage({ type: 'page:changed', payload: { pageId: page.id, pageName: page.name } })
})

/** 插件关闭时清理未执行的防抖定时器与页面监听 */
figma.on('close', () => {
  if (documentTimer) {
    clearTimeout(documentTimer)
    documentTimer = null
  }
  if (observedPage && pageNodeChangeHandler) {
    try {
      observedPage.off('nodechange', pageNodeChangeHandler)
    } catch {
      // 关闭时忽略
    }
  }
  observedPage = null
  pageNodeChangeHandler = null
})

/**
 * 主题变更检测（DEV.md 4.5）
 * 注：当前 Figma 沙箱运行时不支持 figma.on("themechange")（合法事件列表无此项），
 * 因此沙箱不再监听主题；主题由 UI 层 useTheme 通过 themeColors 注入的
 * Figma CSS 变量 + MutationObserver 探测
 */
