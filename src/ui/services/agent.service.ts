/**
 * Agent 智能体编排（DEV.md 第 6 章，原生 Tool Call 方案）
 * 流程：画布上下文 → 分层 Prompt → llmService.streamChat（tool_calls）→
 *       figma_call 能力往返循环 / create_ops·update_ops 经 toolCallParser 校验
 *       → 成功 setOps（autoApply 时自动发送 bridge）/ 失败自动重试（错误拼入 user 消息，次数取 config.autoRetry）
 */
import type { ChatMessage, MessageAttachment } from '../../../types/llm.types'
import type { NodeOp } from '../../../types/node.types'
import { resolveGeneration, withActiveGeneration } from '../../../types/config.types'
import { lintOps } from '../utils/designLint'
import { isDateTool, runDateTool } from '../utils/dateTools'
import { buildMessages, buildSystemPrompt, CONTEXT_BUDGET_TOKENS } from '../utils/promptBuilder'
import { parseToolCalls } from '../utils/toolCallParser'
import { generateId } from '../utils/uuid'
import { useChatStore, normalizeTasks, type ChatMsg } from '../store/chat'
import { useConfigStore } from '../store/config'
import { bridge } from './bridge.service'
import { confirmAction } from '../composables/useConfirm'
import { invokeCapability, isDestructiveCapability, WRITE_CAPABILITIES } from './capabilities.service'
import { fetchCanvasContext, invalidateDesignSystemCache } from './canvasContext.service'
import { llmService, type StreamChatResult, type StreamToolCall } from './llm.service'

/** 重试次数上限（设置页可配 0~3） */
const MAX_RETRY = 3

/** 工具调用轮数允许范围（每模型独立配置，设置页可配 1~500） */
const MIN_TOOL_ROUNDS = 1
const MAX_TOOL_ROUNDS_LIMIT = 500

/**
 * ops 批量写入超时：300 节点 + 字体加载 + auto layout 在真实文件中可能远超 bridge 默认 10s，
 * 默认超时会导致“UI 报失败但沙箱已写入”的假失败。
 */
const OPS_TIMEOUT = 120_000

/** 会改变设计系统摘要的写能力：成功后立即失效缓存，避免下一轮上下文陈旧 */
const DESIGN_SYSTEM_WRITES = new Set([
  'create_component',
  'combine_as_variants',
  'create_paint_style',
  'create_text_style',
  'create_effect_style',
  'create_grid_style',
  'update_paint_style',
  'update_text_style',
  'update_effect_style',
  'update_grid_style',
  'delete_style',
  'create_variable_collection',
  'add_variable_mode',
  'create_variable',
  'set_variable_value',
  'rename_variable',
  'delete_variable',
  'delete_variable_collection',
  'add_component_property',
  'edit_component_property',
  'delete_component_property',
  'rename_variable_collection',
  'rename_variable_mode',
  'delete_variable_mode',
  'update_variable',
  'import_variable_by_key',
  'import_style_by_key',
  'reorder_styles',
])

/** 工具结果回填模型时的字符上限 */
const MAX_TOOL_RESULT_CHARS = 8000

/** 单轮工具往返结果 */
type RoundOutcome =
  | { kind: 'ops'; ops: NodeOp[] }
  | { kind: 'answered' }
  | { kind: 'aborted' }
  /** 轮次达到上限，但已经通过写能力直接修改了画布 */
  | { kind: 'direct'; count: number }
  | { kind: 'retry'; error: string }
  /** 参数类错误：重试也不会成功（如输出被 max_tokens 截断），直接结束 */
  | { kind: 'fatal'; error: string }

/** 执行单个 figma_call 的结果（content 回填模型，detail 作为步骤行摘要） */
interface FigmaCallResult {
  ok: boolean
  type: string
  content: string
  detail: string
}

/** 顶层节点落位（沙箱返回，用于校验与展示） */
export interface CreatedPlacement {
  opId: string
  nodeId: string
  parentId: string
  parentName?: string
  x: number
  y: number
  autoLayout: boolean
}

/** 应用结果（用于步骤/Toast 展示生成去向） */
export interface ApplyOpsResult {
  created: number
  updated: number
  /** 生成到的容器名称（所有顶层节点落在同一容器时） */
  containerName?: string
  /** 新建的顶层节点 id（用于校验步骤） */
  ids?: string[]
  /** op.id → 原生 node.id（含嵌套节点） */
  idMap?: Record<string, string>
  /** 顶层节点落位明细 */
  placements?: CreatedPlacement[]
  /** 部分节点创建/更新失败的原因（成功部分仍已写入） */
  errors?: string[]
  /** 被跳过的节点数 */
  skipped?: number
}

/**
 * 按 action 分组发送画布操作（DEV.md 3.3：create / update 分别走 ops:create / ops:update）
 * 供 ChatView 手动应用与 autoApply 自动应用共用。
 *
 * batchId 用于沙箱幂等：同一条消息因超时重试时不会重复生成。
 * 默认按本次调用生成；调用方建议传消息 id 以保证跨重试稳定。
 */
export async function sendOpsByAction(
  ops: NodeOp[],
  options: { batchId?: string; messageId?: string } = {},
): Promise<ApplyOpsResult> {
  const result: ApplyOpsResult = { created: 0, updated: 0 }
  const batchId = options.batchId ?? generateId('batch')
  const createOps = ops.filter((op) => op.action === 'create')
  const updateOps = ops.filter((op) => op.action === 'update')
  if (createOps.length > 0) {
    const data = await bridge.request<{
      created?: number
      containerName?: string
      ids?: string[]
      idMap?: Record<string, string>
      placements?: CreatedPlacement[]
      errors?: string[]
      skipped?: number
    }>('ops:create', { ops: createOps, batchId }, OPS_TIMEOUT)
    result.created = data?.created ?? 0
    result.containerName = data?.containerName
    result.ids = Array.isArray(data?.ids) ? data.ids : undefined
    result.idMap = data?.idMap
    result.placements = Array.isArray(data?.placements) ? data.placements : undefined
    result.errors = Array.isArray(data?.errors) ? data.errors : undefined
    result.skipped = data?.skipped
  }
  if (updateOps.length > 0) {
    const data = await bridge.request<{ updated?: number; errors?: string[]; skipped?: number }>(
      'ops:update',
      { ops: updateOps, batchId },
      OPS_TIMEOUT,
    )
    result.updated = data?.updated ?? 0
    if (Array.isArray(data?.errors) && data.errors.length > 0) {
      result.errors = [...(result.errors ?? []), ...data.errors]
    }
    result.skipped = (result.skipped ?? 0) + (data?.skipped ?? 0)
  }
  // 记忆：无论自动应用还是手动点击应用，都把本次写入摘要记到对应消息上
  if (options.messageId && (result.created > 0 || result.updated > 0)) {
    useChatStore().setActions(options.messageId, describeOpsMemory(ops, result))
  }
  return result
}

/** 工具结果序列化：JSON.stringify 后按上限截断 */
function serializeToolResult(data: unknown): string {
  let json: string
  try {
    json = JSON.stringify(data) ?? ''
  } catch {
    json = String(data)
  }
  return json.length > MAX_TOOL_RESULT_CHARS ? `${json.slice(0, MAX_TOOL_RESULT_CHARS)}…（已截断）` : json
}

/**
 * 空结果诊断：reasoning 模型常常把输出额度全用在思考上，
 * 导致正文与 tool_calls 都为空，需要给出可操作的提示而非「什么都没返回」
 */
function describeEmptyResult(result: StreamChatResult, maxTokens: number): string {
  if (result.finishReason === 'length') {
    return `输出被 max_tokens（${maxTokens}）截断：思考内容占满了输出额度，未产出最终结果。请到「设置 → 模型参数」把最大输出 Token 调到 8192 以上，或关闭思考模式后重试`
  }
  if (result.reasoning?.trim()) {
    return `模型只返回了思考内容（${result.reasoning.length} 字符），未产出正文或 tool_calls。可直接重试；若反复出现，请调大最大输出 Token 或关闭思考模式`
  }
  return '模型未返回 tool_calls，且没有任何文本内容'
}

/** 注入系统提示词的记忆条数 / 字符上限（控制 token 占用） */
const MEMORY_LIMIT = 12
const MEMORY_CHAR_LIMIT = 1600

/** 会话记忆：把历史消息里记录的写入摘要按时间顺序拼成一段文本，并返回条数供 UI 展示 */
function collectActionMemory(messages: ChatMsg[]): { text: string; count: number } {
  const entries: string[] = []
  for (const message of messages) {
    if (message.role !== 'assistant') continue
    if (message.actions?.length) {
      entries.push(...message.actions)
      continue
    }
    // 兼容旧消息 / 极少数未写入 actions 的情况：从仍存在的 ops 或节点数推导基础记忆
    if (message.ops?.length && message.opsStatus === 'applied') {
      const legacy = describeLegacyOpsMemory(message.ops)
      if (legacy) entries.push(`${legacy} (native ids: see Canvas context)`)
    } else if (message.opsCount && message.opsStatus === 'applied') {
      entries.push(
        `earlier ops → ${message.opsCount} nodes applied (native ids are in the Canvas context)`,
      )
    }
  }
  const recent = entries.slice(-MEMORY_LIMIT)
  const lines: string[] = []
  let size = 0
  for (let i = recent.length - 1; i >= 0; i--) {
    const line = `- ${recent[i]}`
    if (size + line.length > MEMORY_CHAR_LIMIT) break
    lines.unshift(line)
    size += line.length + 1
  }
  return { text: lines.join('\n'), count: lines.length }
}

/** 旧消息兜底：仅用 ops 里的名称/类型生成基础记忆（创建节点的原生 id 需从画布上下文查） */
function describeLegacyOpsMemory(ops: NodeOp[]): string {
  const created = ops.filter((op) => op.action === 'create')
  const updated = ops.filter((op) => op.action === 'update')
  const chunks: string[] = []
  if (created.length > 0) {
    const nodes = created
      .slice(0, 6)
      .map((op) => `${op.name || op.type} ${op.type}`)
      .join('; ')
    const more = created.length > 6 ? ` +${created.length - 6} more` : ''
    chunks.push(`create_ops → ${created.length} nodes: ${nodes}${more}`)
  }
  if (updated.length > 0) {
    const ids = updated
      .slice(0, 6)
      .map((op) => op.id)
      .filter(Boolean)
    chunks.push(`update_ops → ${updated.length} nodes: ${ids.join(', ')}`)
  }
  return chunks.join(' | ')
}

/** 上下文步骤的 detail：同时展示画布字符数与会话记忆条数，便于确认记忆是否生效 */
function contextStepDetail(canvasContext: string, memoryCount: number): string {
  if (!canvasContext) return `未获取到 · 记忆 ${memoryCount} 条`
  return `${canvasContext.length} 字符 · 记忆 ${memoryCount} 条`
}

/** 单条节点的记忆描述：名称 / 类型 / 原生 id / 尺寸 / 文本内容 */
function describeNodeMemory(op: NodeOp, id?: string): string {
  const parts = [op.name || op.type, op.type]
  if (id) parts.push(`(${id})`)
  if ((op.width ?? 0) > 0 && (op.height ?? 0) > 0) parts.push(`${op.width}x${op.height}`)
  if (op.type === 'text' && op.textContent) parts.push(`"${op.textContent.slice(0, 20)}"`)
  return parts.join(' ')
}

/** update 操作里实际改动的字段（用于回忆“改了什么”） */
const MEMORY_IGNORED_OP_KEYS = new Set(['action', 'id', 'type', 'name', 'children'])

/** create / update ops 应用成功 → 本轮记忆（保留原生 id 与关键内容，供后续轮次直接引用） */
function describeOpsMemory(ops: NodeOp[], applied: ApplyOpsResult): string[] {
  const lines: string[] = []
  const created = ops.filter((op) => op.action === 'create')
  const updated = ops.filter((op) => op.action === 'update')
  if (created.length > 0) {
    const nodes = created
      .slice(0, 6)
      .map((op) => describeNodeMemory(op, applied.idMap?.[op.id]))
    const more = created.length > 6 ? ` +${created.length - 6} more` : ''
    const where = applied.containerName ? ` in "${applied.containerName}"` : ''
    lines.push(`create_ops → ${applied.created} nodes${where}: ${nodes.join('; ')}${more}`)
  }
  if (updated.length > 0) {
    const nodes = updated
      .slice(0, 6)
      .map((op) => {
        const fields = Object.keys(op).filter((key) => !MEMORY_IGNORED_OP_KEYS.has(key))
        const fieldHint = fields.length > 0 ? ` {${fields.slice(0, 6).join(',')}}` : ''
        return `${op.name || op.type} (${op.id})${fieldHint}`
      })
    const more = updated.length > 6 ? ` +${updated.length - 6} more` : ''
    lines.push(`update_ops → ${applied.updated} nodes: ${nodes.join('; ')}${more}`)
  }
  return lines
}

/** 记忆里保留参数的写能力（其余只记录能力名与目标 id，避免噪声与体积） */
const MEMORY_PARAM_TYPES = new Set([
  'create_frame',
  'create_rectangle',
  'create_ellipse',
  'create_text',
  'set_text',
  'set_fills',
  'set_strokes',
  'set_opacity',
  'move_nodes',
  'resize_nodes',
  'rename_node',
  'set_corner_radius',
  'set_auto_layout',
  'align_nodes',
  'group_nodes',
  'set_mask',
])

/** 单次 figma_call 写操作 → 一条记忆（能力名 + 目标原生 id + 关键参数） */
function describeFigmaWriteMemory(type: string, call: StreamToolCall, content: string): string {
  let ids: string[] = []
  let params = ''
  try {
    const args = JSON.parse(call.args || '{}') as { nodeIds?: unknown; params?: unknown }
    if (Array.isArray(args.nodeIds)) ids = args.nodeIds.map(String).filter(Boolean)
    if (MEMORY_PARAM_TYPES.has(type) && args.params && typeof args.params === 'object') {
      const text = JSON.stringify(args.params)
      if (text && text !== '{}') params = ` ${text.slice(0, 120)}`
    }
  } catch {
    // 参数无法解析时只记录能力名
  }
  // 创建类能力的结果里带新节点 id，补进记忆便于后续定位
  try {
    const data = JSON.parse(content) as { id?: unknown }
    if (typeof data?.id === 'string' && !ids.includes(data.id)) ids = [data.id, ...ids]
  } catch {
    // 结果被截断时只保留请求里的 id
  }
  const targets = ids.length > 0 ? ` → ${ids.slice(0, 6).join(', ')}${ids.length > 6 ? ' …' : ''}` : ''
  return `figma_call ${type}${targets}${params}`
}

/** 任务模式：单个任务最大步数（防止无限续跑） */
const TASK_MAX_STEPS = 20

/** 任务模式运行态：记录授权状态与本任务创建的节点范围 */
interface TaskRunState {
  /** 用户原始需求（每次续跑都带上，避免模型忘记目标） */
  request: string
  /** 是否已通过首次「应用」授权 */
  approved: boolean
  /** 已完成步数 */
  step: number
  /** 本任务创建的节点 id（允许 update / delete 的范围） */
  nodes: Set<string>
  /** 本任务创建的容器 id（允许作为 create 的 parent） */
  containers: Set<string>
  /** 首次计划的任务数：后续只允许更新状态，禁止越加越多 */
  planSize: number
  /** 首次计划的任务 id / 标题：任务名称锁定，中途不允许改名 */
  planIds: string[]
  planTitles: string[]
  /** 首步的 assistant 消息 id：任务续跑复用同一气泡 */
  messageId?: string
  /** 本任务应用过的 ops（用于完成后的整体规范复核） */
  allOps: NodeOp[]
  /** 本次任务累计新建 / 修改 / 直接写能力次数（用于最终总结） */
  createdCount: number
  updatedCount: number
  directWriteCount: number
}

let taskRun: TaskRunState | null = null
let taskTimer: ReturnType<typeof setTimeout> | null = null

function clearTaskTimer(): void {
  if (taskTimer) {
    clearTimeout(taskTimer)
    taskTimer = null
  }
}

/** 结束任务：清空运行态并可在当前消息上追加一条结果步骤 */
function finishTask(assistantId?: string, detail?: string): void {
  clearTaskTimer()
  taskRun = null
  if (!assistantId || !detail) return
  useChatStore().addStep(assistantId, {
    id: `task-end-${Date.now()}`,
    icon: 'verify',
    label: detail,
    status: 'done',
  })
}

/** 任务范围内过滤 ops：只允许更新任务节点、只在任务容器或页面内创建 */
function scopeTaskOps(ops: NodeOp[]): { ops: NodeOp[]; dropped: string[] } {
  const state = taskRun
  if (!state) return { ops, dropped: [] }
  const kept: NodeOp[] = []
  const dropped: string[] = []
  for (const op of ops) {
    if (op.action === 'update') {
      if (!state.nodes.has(op.id)) {
        dropped.push(`禁止修改任务外的节点：${op.id || op.name}`)
        continue
      }
      kept.push(op)
      continue
    }
    if (op.parent && op.parent !== 'page' && !state.containers.has(op.parent)) {
      dropped.push(`禁止在任务外的容器创建：${op.name || op.type}`)
      continue
    }
    kept.push(op)
  }
  return { ops: kept, dropped }
}

/** 记录本任务创建的节点 / 容器（后续步只允许在这些范围内改动） */
function registerTaskNodes(
  ops: NodeOp[],
  applied: { ids?: string[]; idMap?: Record<string, string>; created?: number; updated?: number },
): void {
  const state = taskRun
  if (!state) return
  for (const id of applied.ids ?? []) state.nodes.add(id)
  for (const id of Object.values(applied.idMap ?? {})) state.nodes.add(id)
  for (const op of ops) {
    if (op.action !== 'create' || op.type !== 'frame') continue
    const id = applied.idMap?.[op.id]
    if (id) state.containers.add(id)
  }
  // 保留本任务应用过的 ops，任务完成时统一做规范复核（上限避免无限增长）
  if (state.allOps.length < 400) state.allOps.push(...ops.slice(0, 400 - state.allOps.length))
  state.createdCount += applied.created ?? 0
  state.updatedCount += applied.updated ?? 0
}

/** figma_call 直接创建节点后登记到任务范围 */
function registerDirectWriteNode(type: string, data: unknown): void {
  const state = taskRun
  if (!state || !data || typeof data !== 'object') return
  const id = (data as { id?: unknown }).id
  if (typeof id !== 'string') return
  state.nodes.add(id)
  state.directWriteCount += 1
  if (type === 'create_frame' || type === 'create_component' || type === 'create_section') {
    state.containers.add(id)
  }
}

/** 解析并应用 update_tasks 工具调用（整体替换任务列表）
 * - 首次列表决定计划长度，后续只更新状态，避免模型每步追加新任务导致列表越滚越大
 * - 超出首次计划长度的新任务会被截断，并按标题去重
 */
function applyTaskToolCalls(calls: StreamToolCall[]): number {
  const chatStore = useChatStore()
  let applied = 0
  for (const call of calls) {
    try {
      const args = JSON.parse(call.args || '{}') as { tasks?: unknown }
      const raw = Array.isArray(args?.tasks) ? args.tasks : []
      if (raw.length === 0) continue
      const normalized = normalizeTasks(raw)
      const state = taskRun
      let list = normalized
      if (state) {
        if (state.planTitles.length === 0) {
          // 首次计划：锁定任务数量、id 与标题
          state.planSize = normalized.length
          state.planIds = normalized.map((task) => task.id)
          state.planTitles = normalized.map((task) => task.title)
          list = normalized
        } else {
          // 后续只允许改状态：忽略改名 / 新增 / 重排，按首次计划还原
          const byId = new Map(normalized.map((task) => [task.id, task]))
          const byTitle = new Map(normalized.map((task) => [task.title.toLowerCase(), task]))
          list = state.planTitles.map((title, index) => {
            const incoming = byId.get(state.planIds[index]) ?? byTitle.get(title.toLowerCase())
            return {
              id: state.planIds[index] ?? `task-${index + 1}`,
              title,
              status: incoming?.status ?? 'pending',
            }
          })
        }
      }
      chatStore.setTasks(list)
      applied++
    } catch {
      // 参数不合法时忽略，本轮继续
    }
  }
  return applied
}

/** 需要记入会话记忆的读取能力（便于后续“删除/修改这些节点”直接复用 id） */
const READ_MEMORY_TYPES = new Set([
  'search_nodes',
  'scan_text_nodes',
  'scan_nodes_by_types',
  'get_nodes_info',
  'get_selection',
])

/** 读取结果 → 一行记忆（query + 前几个节点 id/name） */
function describeReadCall(type: string, call: StreamToolCall, content: string): string | null {
  if (!READ_MEMORY_TYPES.has(type)) return null
  let query = ''
  try {
    const args = JSON.parse(call.args || '{}') as { params?: Record<string, unknown> }
    const params = args.params ?? {}
    query = String(params.query ?? params.nodeId ?? '').slice(0, 40)
  } catch {
    // 参数无法解析时只记录能力名与结果
  }
  try {
    const data = JSON.parse(content) as Record<string, unknown> | unknown[]
    const list = Array.isArray(data)
      ? data
      : Array.isArray((data as Record<string, unknown>)?.nodes)
        ? ((data as Record<string, unknown>).nodes as unknown[])
        : Array.isArray((data as Record<string, unknown>)?.matchingNodes)
          ? ((data as Record<string, unknown>).matchingNodes as unknown[])
          : Array.isArray((data as Record<string, unknown>)?.textNodes)
            ? ((data as Record<string, unknown>).textNodes as unknown[])
            : null
    if (!list) return null
    const items = list
      .slice(0, 8)
      .map((item) => {
        const node = item as { id?: unknown; name?: unknown }
        return [node?.id, node?.name].filter(Boolean).join(' ')
      })
      .filter(Boolean)
    const count =
      typeof (data as Record<string, unknown>)?.count === 'number'
        ? ((data as Record<string, unknown>).count as number)
        : list.length
    return `${type}${query ? ` "${query}"` : ''} → ${count} 项${items.length ? `: ${items.join('; ')}` : ''}`
  } catch {
    return null
  }
}

/** 追加本步写入记忆（任务复用同一气泡时保留前面步骤的记忆） */
function appendActions(assistantId: string, lines: string[]): void {
  if (lines.length === 0) return
  const chatStore = useChatStore()
  const existing = chatStore.messages.find((message) => message.id === assistantId)?.actions ?? []
  chatStore.setActions(assistantId, [...existing, ...lines])
}

/** 计划是否已全部完成（全部任务 completed） */
function isTaskPlanComplete(): boolean {
  const tasks = useChatStore().tasks
  return tasks.length > 0 && tasks.every((task) => task.status === 'completed')
}

/**
 * 任务完成后的验证：
 * - 回读画布确认本任务创建的节点仍在、尺寸正常
 * - 汇总整个任务的规范问题（8pt / 字号阶梯 / 触控 / 对比度）
 * - 检查任务列表是否仍有未完成项
 */
async function verifyTaskResult(state: TaskRunState): Promise<string[]> {
  const issues: string[] = []
  const ids = [...state.nodes]
  if (ids.length > 0) {
    try {
      const nodes = await invokeCapability<
        Array<{ id?: string; name?: string; width?: number; height?: number }>
      >('get_nodes_info', { nodeIds: ids.slice(0, 200) })
      const found = new Set((nodes ?? []).map((node) => node?.id).filter(Boolean) as string[])
      const missing = ids.filter((id) => !found.has(id))
      if (missing.length > 0) issues.push(`${missing.length} 个任务图层未找到（可能被删除或未落位）`)
      for (const node of nodes ?? []) {
        if (!node) continue
        if ((node.width ?? 1) < 0.5 || (node.height ?? 1) < 0.5) {
          issues.push(`「${node.name || node.id}」尺寸异常`)
        }
      }
    } catch {
      issues.push('无法回读生成结果（get_nodes_info 失败）')
    }
  }

  const tasks = useChatStore().tasks
  if (tasks.length > 0) {
    const unfinished = tasks.filter((task) => task.status !== 'completed').length
    if (unfinished > 0) issues.push(`任务计划仍有 ${unfinished} 项未完成`)
  }

  // 整任务规范复核（与每步 lint 一致，但覆盖全部已应用 ops）
  const lintMessages = lintOps(state.allOps, 8).map((item) => item.message)
  issues.push(...lintMessages)

  return [...new Set(issues)].slice(0, 8)
}

/** 任务模式单步紧凑摘要（只保留新建/修改数量） */
function appliedDetailShort(applied: ApplyOpsResult): string {
  const parts: string[] = []
  if (applied.created > 0) parts.push(`新建 ${applied.created}`)
  if (applied.updated > 0) parts.push(`修改 ${applied.updated}`)
  return parts.length > 0 ? parts.join(' · ') : '无变化'
}

/** 展示验证结果并结束任务 */
async function verifyTaskAndFinish(assistantId: string | undefined, state: TaskRunState): Promise<void> {
  if (taskRun !== state) return
  clearTaskTimer()
  taskRun = null
  if (!assistantId) return

  const chatStore = useChatStore()
  const stepId = `task-verify-${Date.now()}`
  chatStore.addStep(assistantId, { id: stepId, icon: 'verify', label: '验证生成结果' })
  const issues = await verifyTaskResult(state)
  chatStore.updateStep(assistantId, stepId, {
    status: issues.length > 0 ? 'failed' : 'done',
    detail:
      issues.length > 0
        ? `${issues.length} 项待确认 · 新建 ${state.createdCount} / 修改 ${state.updatedCount}`
        : `通过 · 新建 ${state.createdCount} / 修改 ${state.updatedCount}`,
  })

  // 本次任务成果总结（保持一行，避免啰嗦）
  const totalSteps = state.planSize || chatStore.tasks.length
  const parts = [`新建 ${state.createdCount} 个图层`]
  if (state.updatedCount > 0) parts.push(`修改 ${state.updatedCount} 个图层`)
  const stats = `本次任务共 ${totalSteps} 步：${parts.join('，')}。`

  const verifyText =
    issues.length > 0
      ? `验证提示：${issues.slice(0, 5).join('；')}`
      : '验证通过：任务图层均已落位，设计规范无遗留问题。'
  const current = chatStore.messages.find((message) => message.id === assistantId)?.content ?? ''
  chatStore.setContent(assistantId, `${current}\n\n${stats}\n${verifyText}`.trim())
}

/** 生成任务续跑提示：强调任务列表、单步范围与收尾 */
function buildTaskContinuation(state: TaskRunState): string {
  const nextStep = Math.min(state.step + 1, TASK_MAX_STEPS)
  return `[Task mode · step ${nextStep}/${TASK_MAX_STEPS}] Continue the original request: "${state.request}".
Call update_tasks first with the SAME list as before: only change statuses (finished items completed, the next item in_progress). Never append extra items unless the user changed the request.
Then emit ONLY that step's create_ops / update_ops as a small batch. Do not write prose in step turns.
Create only on the page or inside layers created by this task; never touch other layers.
When everything is complete, call update_tasks with all items completed and reply DONE with no ops.`
}

/** 安排下一步：等当前 runAgent 完全收尾后再发下一次请求 */
function scheduleTaskStep(): void {
  clearTaskTimer()
  taskTimer = setTimeout(() => {
    taskTimer = null
    const state = taskRun
    if (!state?.approved) return
    if (state.step >= TASK_MAX_STEPS) {
      finishTask(undefined, `任务已达 ${TASK_MAX_STEPS} 步上限`)
      return
    }
    state.step += 1
    void runAgent(buildTaskContinuation(state), { reuseUserInput: true, taskStep: true })
  }, 60)
}

/**
 * 首次「应用」授权后调用：登记本步创建的节点并自动续跑后续任务步骤。
 * 仅任务模式且存在运行中的任务时生效。
 */
export function approveTaskAndContinue(
  applied: { ids?: string[]; idMap?: Record<string, string>; created?: number; updated?: number },
  ops: NodeOp[],
): void {
  const state = taskRun
  // 只处理首次授权；已授权后的卡片重复应用不再触发续跑
  if (!state || state.approved) return
  state.approved = true
  state.step = Math.max(state.step, 1)
  registerTaskNodes(ops, applied)
  if (isTaskPlanComplete()) {
    const lastAssistant = [...useChatStore().messages]
      .reverse()
      .find((message) => message.role === 'assistant')?.id
    void verifyTaskAndFinish(lastAssistant, state)
    return
  }
  scheduleTaskStep()
}

/**
 * 用户手动结束任务：取消续跑、停止当前生成，并把剩余任务标记为完成。
 * 任务面板的「完成」按钮调用。
 */
export function completeTaskManually(): void {
  const chatStore = useChatStore()
  const tasks = chatStore.tasks
  if (tasks.length > 0) {
    chatStore.setTasks(tasks.map((task) => ({ ...task, status: 'completed' as const })))
  }
  clearTaskTimer()
  if (chatStore.generating) llmService.stop()
  taskRun = null
}

/** 用户清空任务列表：取消续跑、停止当前生成并移除面板数据 */
export function clearTaskList(): void {
  const chatStore = useChatStore()
  clearTaskTimer()
  if (chatStore.generating) llmService.stop()
  taskRun = null
  chatStore.clearTasks()
}

/** 结果摘要（步骤行 detail）：数组/带 count 的对象给出数量，其余取前几个字段名 */
function summarizeResult(data: unknown): string {
  if (Array.isArray(data)) return `${data.length} 项`
  if (data && typeof data === 'object') {
    const count = (data as { count?: unknown }).count
    if (typeof count === 'number') return `${count} 项`
    const keys = Object.keys(data)
    return keys.length ? keys.slice(0, 3).join('、') : '完成'
  }
  if (typeof data === 'string') return data.slice(0, 40)
  return '完成'
}

/** 从参数中读取能力名（用于步骤文案，解析失败回退 figma_call） */
function figmaCallType(call: StreamToolCall): string {
  try {
    const args = JSON.parse(call.args || '{}') as { type?: unknown }
    return typeof args.type === 'string' && args.type ? args.type : 'figma_call'
  } catch {
    return 'figma_call'
  }
}

/** 破坏性能力的中文动作名（用于确认弹窗与步骤文案） */
const DESTRUCTIVE_LABELS: Record<string, string> = {
  delete_nodes: '删除图层',
  delete_page: '删除页面',
  delete_style: '删除样式',
  delete_variable: '删除变量',
  delete_variable_collection: '删除变量集合',
  detach_instance: '分离组件实例',
  reset_instance_overrides: '重置实例覆盖',
  delete_variable_mode: '删除变量模式',
  delete_annotation_category: '删除批注分类',
}

/** 破坏性调用的确认文案：尽量带上受影响节点，帮助用户判断影响范围 */
function describeDestructiveCall(type: string, call: StreamToolCall): string {
  let target = ''
  try {
    const args = JSON.parse(call.args || '{}') as { nodeIds?: unknown }
    const ids = Array.isArray(args.nodeIds) ? args.nodeIds.map(String) : []
    if (ids.length > 0) {
      target = `\n目标：${ids.slice(0, 3).join('、')}${
        ids.length > 3 ? ` 等 ${ids.length} 个节点` : ''
      }`
    }
  } catch {
    // 参数无法解析时只提示动作名
  }
  return `AI 准备执行「${DESTRUCTIVE_LABELS[type] ?? type}」，该操作会修改画布且无法撤销。${target}`
}

/** 执行单个 figma_call：解析参数 → 调用沙箱能力 → 写操作成功后刷新画布上下文 */
async function executeFigmaCall(call: StreamToolCall): Promise<FigmaCallResult> {
  let args: unknown
  try {
    args = JSON.parse(call.args || '{}')
  } catch (error) {
    const message = `参数解析失败：${error instanceof Error ? error.message : String(error)}`
    return { ok: false, type: 'figma_call', content: message, detail: message.slice(0, 60) }
  }

  const payload = (args && typeof args === 'object' ? args : {}) as Record<string, unknown>
  const type = typeof payload.type === 'string' ? payload.type : ''
  if (!type) {
    return { ok: false, type: 'figma_call', content: '缺少能力名 type 参数', detail: '缺少 type' }
  }

  // 兼容模型把能力参数直接放在顶层（如 { type: 'set_fills', color: '#FF0000' }）：
  // 除 type / nodeIds / params 之外的顶层字段统一并入 params（显式 params 优先）
  const { type: _type, nodeIds: rawNodeIds, params: rawParams, ...rest } = payload
  const mergedParams: Record<string, unknown> = {
    ...rest,
    ...(rawParams && typeof rawParams === 'object' ? (rawParams as Record<string, unknown>) : {}),
  }

  try {
    const resolvedNodeIds = Array.isArray(rawNodeIds) ? rawNodeIds.map(String) : []
    // 任务模式：首次应用前禁止写画布；授权后只允许操作本任务创建的节点
    if (taskRun && WRITE_CAPABILITIES.includes(type)) {
      if (!taskRun.approved) {
        return {
          ok: false,
          type,
          content: '任务模式：请先在操作卡片点击「应用」完成本任务授权，再执行写操作。',
          detail: '等待任务授权',
        }
      }
      const outside = resolvedNodeIds.filter((id) => !taskRun!.nodes.has(id))
      if (outside.length > 0) {
        const message = `任务模式：只能修改本任务创建的节点。已阻止：${outside.slice(0, 5).join(', ')}`
        return { ok: false, type, content: message, detail: '超出任务范围' }
      }
    }
    const data = await invokeCapability(type, {
      nodeIds: resolvedNodeIds.length > 0 ? resolvedNodeIds : undefined,
      params: Object.keys(mergedParams).length > 0 ? mergedParams : undefined,
    })
    // 写操作后不再主动拉取 page:get：该数据当前没有消费方，整页序列化成本远高于收益
    if (DESIGN_SYSTEM_WRITES.has(type)) invalidateDesignSystemCache()
    if (taskRun && WRITE_CAPABILITIES.includes(type)) registerDirectWriteNode(type, data)
    return { ok: true, type, content: serializeToolResult(data), detail: summarizeResult(data) }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, type, content: `调用失败：${message}`, detail: message.slice(0, 60) }
  }
}

/**
 * 执行一轮 Agent 对话：
 * - 常规调用：将用户输入写入 chat store 并发起请求
 * - 重新生成（options.reuseUserInput 为 true）：不新增用户消息（由调用方先移除旧消息）
 */
export async function runAgent(
  userInput: string,
  options: {
    reuseUserInput?: boolean
    attachments?: MessageAttachment[]
    /** 任务模式续跑（不新增用户消息，自动应用并继续） */
    taskStep?: boolean
  } = {},
): Promise<void> {
  const chatStore = useChatStore()
  const configStore = useConfigStore()
  if (chatStore.generating) return

  const config = configStore.config
  const taskMode = config.taskMode === true
  const isTaskStep = options.taskStep === true
  if (isTaskStep && !taskMode) {
    // 任务被关闭：丢弃未完成的续跑
    clearTaskTimer()
    taskRun = null
    return
  }
  if (!isTaskStep) {
    // 新的用户输入：终止旧任务；任务模式下开启新任务（首步等待用户「应用」授权）
    clearTaskTimer()
    taskRun = taskMode
      ? {
          request: userInput,
          approved: false,
          step: 0,
          nodes: new Set(),
          containers: new Set(),
          planSize: 0,
          planIds: [],
          planTitles: [],
          allOps: [],
          createdCount: 0,
          updatedCount: 0,
          directWriteCount: 0,
        }
      : null
  }
  // 历史快照：当前输入之前的 user/assistant 消息（不含 error / ops 详情）
  const history = chatStore.messages
    .filter((m): m is ChatMsg & { role: 'user' | 'assistant' } => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({ role: m.role, content: m.content }))
  // 会话记忆：此前各轮实际写入画布的操作与原生 id，避免模型忘记自己改过什么
  const actionMemory = collectActionMemory(chatStore.messages)
  if (!options.reuseUserInput) {
    chatStore.addMessage({ role: 'user', content: userInput, attachments: options.attachments })
  }

  chatStore.generating = true
  /** 任务续跑复用首步的 assistant 气泡，避免每步拆出新的消息区域 */
  const reuseMessageId = isTaskStep ? taskRun?.messageId : undefined
  const assistantId =
    reuseMessageId ?? chatStore.addMessage({ role: 'assistant', content: '', streaming: true }).id
  if (taskMode && taskRun && !reuseMessageId) taskRun.messageId = assistantId
  if (reuseMessageId) chatStore.setStreaming(reuseMessageId, true)
  /** 每轮步骤 id 前缀：同一气泡里多轮任务步骤避免 id / Vue key 冲突 */
  const runKey = isTaskStep ? `s${taskRun?.step ?? 0}-${Date.now().toString(36)}` : ''
  const sid = (base: string): string => (runKey ? `${runKey}-${base}` : base)
  /** 任务续跑：步骤列表收敛为单行「第 N 步」，不展示每步的完整流水账 */
  const compactTask = isTaskStep
  /** 任务续跑追求速度：关闭思考、限制输出长度，避免每步都长时间推理 */
  const stepConfig = compactTask
    ? withActiveGeneration(config, {
        thinkingMode: false,
        thinkingBudget: 0,
        reasoningEffort: 'low',
        maxTokens: Math.min(resolveGeneration(config).maxTokens, 3072),
      })
    : config
  /** 工具调用轮数：每模型独立配置，不读全局值（依赖 stepConfig，必须在其后计算） */
  const maxToolRounds = Math.max(
    MIN_TOOL_ROUNDS,
    Math.min(MAX_TOOL_ROUNDS_LIMIT, Math.round(resolveGeneration(stepConfig).toolRounds)),
  )
  /** 重试回滚基准：复用气泡时只回滚本轮新增的步骤与正文 */
  const messageBase = chatStore.messages.find((m) => m.id === assistantId)
  const stepsBase = messageBase?.steps?.length ?? 0
  const contentBase = messageBase?.content ?? ''
  /** 任务模式：本轮是否被用户停止 / 是否有写入 / 是否有待授权 ops（finally 中需要读取） */
  let taskAborted = false
  let taskStepApplied = false
  let taskOpsPending = false

  try {
    if (compactTask && taskRun) {
      chatStore.addStep(assistantId, {
        id: sid('step'),
        icon: 'apply',
        label: `第 ${taskRun.step} 步`,
        status: 'running',
      })
    }
    // 画布上下文：优先当前选中图层，无选中时自动取当前页；任务续跑省略整页上下文以提速
    const canvasContext = compactTask ? '' : await fetchCanvasContext()
    if (!compactTask) {
      chatStore.addStep(assistantId, { id: sid('context'), icon: 'context', label: '读取画布上下文' })
      chatStore.updateStep(assistantId, sid('context'), {
        status: canvasContext ? 'done' : 'failed',
        detail: contextStepDetail(canvasContext, actionMemory.count),
      })
    }
    const effectiveInput = compactTask
      ? `${userInput}\n\nTask memory (task-created nodes):\n${
          actionMemory.text.slice(-900) || '(none yet)'
        }`
      : userInput
    const systemPrompt = buildSystemPrompt(
      config.customPrompt,
      canvasContext,
      compactTask ? null : actionMemory.text,
      taskMode,
    )
    const maxRetry = Math.max(0, Math.min(MAX_RETRY, Math.round(config.autoRetry)))
    // 图片输入支持为每模型独立开关：不支持时附件图片不进入请求（文本附件不受影响）
    const stepGeneration = resolveGeneration(stepConfig)
    const effectiveAttachments = stepGeneration.supportsImage
      ? options.attachments
      : options.attachments?.filter((item) => item.kind !== 'image')
    // 上下文窗口（输入侧）为每模型独立配置，留空使用默认预算
    const contextBudget = stepGeneration.contextInput ?? CONTEXT_BUDGET_TOKENS
    const baseMessages = buildMessages(
      systemPrompt,
      compactTask ? [] : history,
      effectiveInput,
      stepGeneration.maxTokens,
      effectiveAttachments,
      contextBudget,
    )
    /** 工具往返消息：仅本次请求上下文使用，不写入 chat store 持久化历史 */
    const toolMessages: ChatMessage[] = []
    let lastError = ''
    let ops: NodeOp[] | null = null
    /** 规范修正前已解析成功的方案：修正轮失败时回退应用，避免整轮生成失败 */
    let fallbackOps: NodeOp[] | null = null
    /** 达到轮次上限时，已成功执行的写能力次数（直接改画布也算完成） */
    let directWrites = 0
    /** 本轮通过 figma_call 直接写入的记忆条目 */
    const directActions: string[] = []
    /** 用户是否取消了破坏性操作（取消后立即结束本轮，不再重试） */
    let declined = false

    for (let attempt = 0; attempt <= maxRetry; attempt++) {
      if (attempt > 0) {
        // 重试轮次：只回滚本轮新增的步骤与正文，保留任务此前步骤
        chatStore.trimSteps(assistantId, stepsBase)
        if (!compactTask) {
          chatStore.addStep(assistantId, {
            id: sid('context'),
            icon: 'context',
            label: '读取画布上下文',
            status: canvasContext ? 'done' : 'failed',
            detail: contextStepDetail(canvasContext, actionMemory.count),
          })
        }
        chatStore.setContent(assistantId, contentBase)
      }
      // 每次尝试从干净的工具往返上下文开始
      toolMessages.length = 0

      const requestMessages: ChatMessage[] = [...baseMessages]
      if (attempt > 0) {
        requestMessages.push({
          role: 'user',
          content: `Previous tool call was rejected: ${lastError}\nReturn ONE complete create_ops or update_ops call with a non-empty "ops" array. Do not reply with prose, an empty object, or partial JSON.`,
        })
      }

      let outcome: RoundOutcome = {
        kind: 'retry',
        error: `工具调用轮次已达上限（${maxToolRounds} 轮），仍未得到最终结果`,
      }
      /** 本次尝试中成功执行的写能力次数 */
      let attemptWrites = 0
      /** 是否已就设计规范问题回填给模型修正过（每次尝试最多一次） */
      let lintCorrected = false
      /** 本次尝试是否被用户取消了破坏性操作 */
      declined = false
      /** 最近一次 figma_call 失败信息，用于轮次耗尽时给出诊断 */
      let lastToolError = ''

      for (let round = 0; round < maxToolRounds; round++) {
        const thinkStepId = sid(`think-${attempt}-${round}`)
        if (!compactTask) chatStore.addStep(assistantId, { id: thinkStepId, icon: 'think', label: '思考中' })
        let thinkFinished = false
        const finishThink = (): void => {
          if (thinkFinished) return
          thinkFinished = true
          // 思考完成即清空思考预览，只保留「思考完成」状态条
          chatStore.updateStep(assistantId, thinkStepId, {
            status: 'done',
            label: '思考完成',
            detail: undefined,
            raw: undefined,
          })
        }

        const result = await llmService.streamChat({
          messages: [...requestMessages, ...toolMessages],
          config: stepConfig,
          onDelta: (text) => {
            finishThink()
            // 任务续跑不把每步的模型正文拼进气泡，避免消息过于啰嗦
            if (!compactTask) chatStore.appendDelta(assistantId, text)
          },
          // 思考内容按句子边界更新为单行预览，不展示完整思考链
          onReasoning: compactTask
            ? undefined
            : (text) => chatStore.appendStepThinking(assistantId, thinkStepId, text),
        })
        finishThink()

        // 厂商返回 usage 时记录真实消耗，输入栏据此显示实测上下文占用
        if (result.usage) chatStore.setUsage(assistantId, result.usage)

        // 用户主动停止：保留已回显的部分文本，本轮直接结束
        if (result.aborted) {
          taskAborted = true
          outcome = { kind: 'aborted' }
          break
        }

        // tool_calls 被 max_tokens 截断时 JSON 必然不完整，重试也无法修复
        if (result.finishReason === 'length' && result.toolCalls.length > 0) {
          outcome = {
            kind: 'fatal',
            error: `输出被 max_tokens（${resolveGeneration(config).maxTokens}）截断，tool_calls 不完整。请到「设置 → 模型参数」把最大输出 Token 调到 8192 以上（当前 ${resolveGeneration(config).maxTokens}），或把设计拆小后重试`,
          }
          break
        }

        // 任务模式：update_tasks 只更新任务列表，不参与画布解析
        const taskToolCalls = result.toolCalls.filter((call) => call.name === 'update_tasks')
        if (taskToolCalls.length > 0) {
          const count = applyTaskToolCalls(taskToolCalls)
          if (!compactTask) {
            chatStore.addStep(assistantId, {
              id: sid(`tasks-${attempt}-${round}`),
              icon: 'ops',
              label: '更新任务列表',
              status: count > 0 ? 'done' : 'failed',
              detail: count > 0 ? `${chatStore.tasks.length} 项` : '参数无效',
            })
          }
        }
        const remainingCalls = result.toolCalls.filter((call) => call.name !== 'update_tasks')
        // 本地日期工具（读时钟 / 日期计算）与画布调用分开处理
        const dateCalls = remainingCalls.filter((call) => isDateTool(call.name))
        const canvasCalls = remainingCalls.filter((call) => !isDateTool(call.name))
        if (dateCalls.length > 0) {
          const toolCalls = dateCalls.map((call, index) => ({
            id: call.id || `date_${attempt}_${round}_${index}`,
            type: 'function' as const,
            function: { name: call.name, arguments: call.args },
          }))
          toolMessages.push({
            role: 'assistant',
            content: result.content ?? '',
            // 推理模型（DeepSeek 等）要求带 tool_calls 的 assistant 消息回传 reasoning_content
            ...(result.reasoning ? { reasoning_content: result.reasoning } : {}),
            tool_calls: toolCalls,
          })
          for (let i = 0; i < dateCalls.length; i++) {
            const callResult = runDateTool(dateCalls[i].name, dateCalls[i].args)
            chatStore.addStep(assistantId, {
              id: sid(`date-${attempt}-${round}-${i}`),
              icon: 'tool',
              label: dateCalls[i].name === 'get_current_time' ? '读取当前时间' : '计算日期',
              status: 'done',
              detail: callResult.detail,
            })
            toolMessages.push({
              role: 'tool',
              tool_call_id: toolCalls[i].id,
              content: callResult.content,
            })
          }
        }
        // 本轮只问了日期：让模型拿着结果继续，而不是按 ops 解析
        if (dateCalls.length > 0 && canvasCalls.length === 0 && taskToolCalls.length === 0) {
          if (round === maxToolRounds - 1) {
            outcome = { kind: 'retry', error: '日期信息已取到，但未得到最终回复' }
            break
          }
          continue
        }
        // 本轮只更新了任务列表：继续下一轮，等待模型补上当前步的 ops
        if (taskMode && canvasCalls.length === 0 && taskToolCalls.length > 0) {
          if (round === maxToolRounds - 1) {
            outcome = { kind: 'retry', error: '任务模式：只返回了任务列表，缺少本步 ops' }
            break
          }
          continue
        }

        const figmaCalls = canvasCalls.filter((call) => call.name === 'figma_call')
        if (figmaCalls.length > 0) {
          const toolCalls = figmaCalls.map((call, index) => ({
            id: call.id || `call_${round}_${index}`,
            type: 'function' as const,
            function: { name: call.name, arguments: call.args },
          }))
          toolMessages.push({
            role: 'assistant',
            content: result.content ?? '',
            // 推理模型（DeepSeek 等）要求带 tool_calls 的 assistant 消息回传 reasoning_content
            ...(result.reasoning ? { reasoning_content: result.reasoning } : {}),
            tool_calls: toolCalls,
          })

          for (let i = 0; i < figmaCalls.length; i++) {
            const stepId = sid(`tool-${attempt}-${round}-${i}`)
            const callType = figmaCallType(figmaCalls[i])
            chatStore.addStep(assistantId, {
              id: stepId,
              icon: 'tool',
              label: `调用 ${callType}`,
            })
            // 破坏性能力（删除/分离实例等）执行前必须由用户确认，取消则立即结束本轮
            if (isDestructiveCapability(callType)) {
              const confirmStepId = `${stepId}-confirm`
              chatStore.updateStep(assistantId, stepId, { detail: '等待确认' })
              chatStore.addStep(assistantId, {
                id: confirmStepId,
                icon: 'tool',
                label: `确认${DESTRUCTIVE_LABELS[callType] ?? callType}`,
              })
              const confirmed = await confirmAction({
                title: '确认破坏性操作？',
                message: describeDestructiveCall(callType, figmaCalls[i]),
                confirmText: '执行',
                danger: true,
              })
              chatStore.updateStep(assistantId, confirmStepId, {
                status: confirmed ? 'done' : 'failed',
                detail: confirmed ? '已确认' : '已取消',
              })
              if (!confirmed) {
                declined = true
                chatStore.updateStep(assistantId, stepId, {
                  status: 'failed',
                  detail: '用户已取消',
                })
                break
              }
            }
            const callResult = await executeFigmaCall(figmaCalls[i])
            chatStore.updateStep(assistantId, stepId, {
              status: callResult.ok ? 'done' : 'failed',
              detail: callResult.detail,
            })
            if (!callResult.ok) {
              lastToolError = callResult.detail || callResult.content
            } else if (WRITE_CAPABILITIES.includes(callResult.type)) {
              // 通过 figma_call 直接完成了写操作（create_frame / set_fills 等）
              attemptWrites += 1
              directActions.push(
                describeFigmaWriteMemory(callResult.type, figmaCalls[i], callResult.content),
              )
            } else {
              // 读取结果也记忆下来：后续「删除/修改这些节点」可直接复用 id
              const readLine = describeReadCall(callResult.type, figmaCalls[i], callResult.content)
              if (readLine) directActions.push(readLine)
            }
            toolMessages.push({
              role: 'tool',
              tool_call_id: toolCalls[i].id,
              content: callResult.content,
            })
          }

          // 用户取消了破坏性操作：结束本轮，不再自动重试（重试会再次询问）
          if (declined) {
            outcome =
              attemptWrites > 0 ? { kind: 'direct', count: attemptWrites } : { kind: 'answered' }
            break
          }

          // 达到轮次上限：已有写操作视为完成，否则交给重试机制并带上最近错误
          if (round === maxToolRounds - 1) {
            outcome =
              attemptWrites > 0
                ? { kind: 'direct', count: attemptWrites }
                : {
                    kind: 'retry',
                    error: `工具调用轮次已达上限（${maxToolRounds} 轮）${
                      lastToolError ? `：${lastToolError.slice(0, 120)}` : '，仍未得到最终结果'
                    }`,
                  }
            break
          }
          continue
        }

        if (canvasCalls.length > 0) {
          const parsed = parseToolCalls(canvasCalls, attempt)
          if (!('ops' in parsed)) {
            outcome = { kind: 'retry', error: parsed.error }
            break
          }

          // 设计规范校验：首次发现违规时把问题回填给模型修正一次
          const issues = lintOps(parsed.ops)
          if (issues.length > 0 && !lintCorrected && round < maxToolRounds - 1) {
            lintCorrected = true
            // 先记住这份可用方案：模型后续修正失败时直接回退应用，不整轮报错
            fallbackOps = parsed.ops
            const opsCalls = canvasCalls.map((call, index) => ({
              id: call.id || `ops_${attempt}_${round}_${index}`,
              type: 'function' as const,
              function: { name: call.name, arguments: call.args },
            }))
            toolMessages.push({
              role: 'assistant',
              content: result.content ?? '',
              ...(result.reasoning ? { reasoning_content: result.reasoning } : {}),
              tool_calls: opsCalls,
            })
            toolMessages.push({
              role: 'tool',
              tool_call_id: opsCalls[0].id,
              content: `The ops were received but violate design rules: ${issues
                .map((item) => item.message)
                .join('; ')}. Return the COMPLETE corrected ops array (${parsed.ops.length} top-level operations) via create_ops or update_ops: keep every node and only fix the listed issues. Do not send an empty ops array, do not drop unchanged nodes, and do not reply with prose.`,
            })
            chatStore.addStep(assistantId, {
              id: sid(`lint-${attempt}-${round}`),
              icon: 'verify',
              label: '按设计规范修正',
              status: 'done',
              detail: `${issues.length} 项`,
            })
            continue
          }

          outcome = { kind: 'ops', ops: parsed.ops }
          break
        }
        // 无 tool_calls 但有文本：视为纯文本回答（如用户提问咨询），正常结束
        if (result.content.trim()) {
          outcome = { kind: 'answered' }
          break
        }
        const diagnostic = describeEmptyResult(result, resolveGeneration(stepConfig).maxTokens)
        // max_tokens 截断为重试无法解决的参数问题，直接结束并提示调整
        outcome =
          result.finishReason === 'length'
            ? { kind: 'fatal', error: diagnostic }
            : { kind: 'retry', error: diagnostic }
        break
      }

      if (outcome.kind === 'ops') {
        ops = outcome.ops
        break
      }
      if (outcome.kind === 'answered' || outcome.kind === 'aborted') break
      if (outcome.kind === 'direct') {
        directWrites = outcome.count
        break
      }
      if (outcome.kind === 'fatal') {
        lastError = outcome.error
        break
      }
      // 本次尝试已成功写入画布：自动重试会重复执行写操作（重复建节点/重复改属性），
      // 因此不再重试，直接按「已通过能力调用完成」收尾
      if (attemptWrites > 0) {
        directWrites = attemptWrites
        break
      }
      lastError = outcome.error
    }

    // 规范修正的后续调用失败（空 ops / 截断 / 纯文本）：回退到已通过校验的原方案继续应用
    if (!ops && fallbackOps) {
      ops = fallbackOps
      if (!compactTask) {
        chatStore.addStep(assistantId, {
          id: sid('lint-fallback'),
          icon: 'verify',
          label: '使用修正前的可用方案',
          status: 'done',
          detail: '规范修正未返回有效 ops',
        })
      }
    }

    // 任务模式：首次「应用」前不自动执行；授权后只应用任务范围内的 ops
    const taskApproved = taskMode && taskRun?.approved === true
    const autoApplyOps = taskMode ? taskApproved : config.autoApply
    let opsToApply = ops
    if (ops && taskApproved) {
      const scoped = scopeTaskOps(ops)
      opsToApply = scoped.ops
      if (scoped.dropped.length > 0) {
        if (!compactTask) {
          chatStore.addStep(assistantId, {
            id: sid('task-scope'),
            icon: 'verify',
            label: '任务范围过滤',
            status: 'done',
            detail: `${scoped.dropped.length} 项已阻止`,
          })
        }
        if (!compactTask) {
          const current = chatStore.messages.find((m) => m.id === assistantId)?.content ?? ''
          chatStore.setContent(
            assistantId,
            `${current}\n\n任务范围提示：${scoped.dropped.slice(0, 3).join('；')}`.trim(),
          )
        }
      }
      if (opsToApply.length === 0) {
        chatStore.addMessage({
          role: 'error',
          content: '任务模式：本步操作全部超出任务范围，已停止。',
        })
        finishTask(assistantId, '任务已停止')
        return
      }
    }

    chatStore.setStreaming(assistantId, false)
    // 跨工具轮次的文本是直接拼接的，收尾时清掉多余空行与首尾空白
    chatStore.normalizeContent(assistantId)

    // 用户取消了破坏性操作且本次没有其它写操作：保留可见反馈后结束
    if (declined && directWrites === 0) {
      const message = chatStore.messages.find((m) => m.id === assistantId)
      if (!message?.content.trim()) chatStore.setContent(assistantId, '已取消该破坏性操作。')
      return
    }

    // 轮次达到上限但已经通过写能力直接改完画布：按成功处理，不再报错重试
    if (directWrites > 0 && !ops) {
      if (taskMode && taskApproved) taskStepApplied = true
      appendActions(assistantId, directActions)
      if (compactTask) {
        chatStore.updateStep(assistantId, sid('step'), {
          status: 'done',
          detail: `${directWrites} 次写操作`,
        })
        return
      }
      chatStore.addStep(assistantId, {
        id: sid('direct-write'),
        icon: 'apply',
        label: '通过能力调用完成画布修改',
        status: 'done',
        detail: `${directWrites} 次写操作`,
      })
      const message = chatStore.messages.find((m) => m.id === assistantId)
      if (!message?.content.trim()) {
        chatStore.setContent(assistantId, '已通过能力调用直接完成画布修改。')
      }
      return
    }

    if (ops && opsToApply) {
      // 任务续跑复用首步气泡：自动应用的中间步骤不再挂操作卡片，避免反复刷新同一张卡
      const showOpsCard = !(isTaskStep && autoApplyOps)
      if (!compactTask) {
        chatStore.addStep(assistantId, {
          id: sid('ops'),
          icon: 'ops',
          label: '生成画布操作',
          status: 'done',
          detail: `${opsToApply.length} 个顶层操作`,
        })
      }
      if (showOpsCard) chatStore.setOps(assistantId, opsToApply, 'pending')

      // 设计规范校验：8pt 网格 / 类型阶梯 / 触控目标 / 对比度，结果只提示不阻塞
      const lintIssues = lintOps(opsToApply)
      if (!compactTask) {
        chatStore.addStep(assistantId, {
          id: sid('lint'),
          icon: 'verify',
          label: '设计规范校验',
          status: 'done',
          detail: lintIssues.length > 0 ? `${lintIssues.length} 项待优化` : '通过',
        })
      }
      if (lintIssues.length > 0 && !compactTask) {
        const current = chatStore.messages.find((m) => m.id === assistantId)?.content ?? ''
        chatStore.setContent(
          assistantId,
          `${current}\n\n规范提示：${lintIssues.map((item) => item.message).join('；')}`.trim(),
        )
      }

      if (autoApplyOps) {
        // 自动应用：任务模式授权后 / 普通模式开启 autoApply；卡片仍显示，但状态直接置为 applied
        if (!compactTask) {
          chatStore.addStep(assistantId, { id: sid('apply'), icon: 'apply', label: '应用到画布' })
        }
        if (showOpsCard) chatStore.setOpsStatus(assistantId, 'applying')
        try {
          // batchId：普通模式复用消息 id 以支持超时幂等；任务模式每步必须唯一，
          // 否则沙箱幂等缓存会把第 1 步结果当成后续步骤的结果，导致新操作不生效
          const batchId =
            taskMode && taskRun
              ? `${assistantId}-step-${taskRun.step}-${Date.now().toString(36)}`
              : assistantId
          const applied = await sendOpsByAction(opsToApply, { batchId })
          const parentIds = new Set((applied.placements ?? []).map((item) => item.parentId))
          let applyDetail = `已生成 ${applied.created} 个节点`
          if (applied.containerName) {
            applyDetail = `已放入 ${applied.containerName}`
          } else if (parentIds.size > 1) {
            applyDetail += '（多个容器）'
          } else if (parentIds.size === 1 && parentIds.has('page')) {
            applyDetail += '（页面）'
          }
          const partialErrors = applied.errors ?? []
          if (partialErrors.length > 0) {
            applyDetail += ` · ${partialErrors.length} 个失败`
          }
          if (compactTask) {
            chatStore.updateStep(assistantId, sid('step'), {
              status: partialErrors.length > 0 ? 'failed' : 'done',
              detail: appliedDetailShort(applied),
            })
          } else {
            chatStore.updateStep(assistantId, sid('apply'), {
              status: partialErrors.length > 0 ? 'failed' : 'done',
              detail: applyDetail,
            })
          }
          const nothingApplied =
            applied.created === 0 && applied.updated === 0 && partialErrors.length > 0
          if (showOpsCard) {
            chatStore.setOpsStatus(assistantId, nothingApplied ? 'failed' : 'applied')
          }
          // 模型只调了工具、没写正文时补一句结果摘要，保证后续轮次的历史里有可读上下文
          const appliedMessage = chatStore.messages.find((m) => m.id === assistantId)
          if (!compactTask && !appliedMessage?.content.trim()) {
            chatStore.setContent(
              assistantId,
              nothingApplied ? '应用失败。' : `已生成 ${applied.created} 个节点并应用到画布。`,
            )
          }
          // 记忆：本轮直接写能力 + 批量 ops 的写入摘要（含原生 id），供后续轮次引用
          if (applied.created > 0 || applied.updated > 0 || directActions.length > 0) {
            appendActions(assistantId, [
              ...directActions,
              ...describeOpsMemory(opsToApply, applied),
            ])
          }
          // 任务模式：登记本步创建的节点 / 容器，并标记本步已写入
          if (taskMode && (applied.created > 0 || applied.updated > 0)) {
            registerTaskNodes(opsToApply, applied)
            taskStepApplied = true
          }
          // 借鉴官方 Agent 的读写闭环：应用后读回画布校验生成结果（任务续跑省略每步校验）
          if (!compactTask) {
            chatStore.addStep(assistantId, { id: sid('verify'), icon: 'verify', label: '校验生成结果' })
            try {
              const selection = await invokeCapability<{
                count?: number
                nodes?: Array<{ id: string }>
                truncated?: boolean
              }>('get_selection')
              const count = selection?.count ?? 0
              const expected = applied.ids ?? []
              // 创建后插件会把顶层新节点设为选中，这里按 id 逐个核对；
              // 选中数量超过 20 时沙箱只返回统计摘要（truncated），退化为数量校验。
              if (selection?.truncated || expected.length === 0) {
                chatStore.updateStep(assistantId, sid('verify'), {
                  status: count > 0 ? 'done' : 'failed',
                  detail: count > 0 ? `已选中 ${count} 个新节点` : '未检测到新节点',
                })
              } else {
                const selected = new Set((selection?.nodes ?? []).map((node) => node.id))
                const matched = expected.filter((id) => selected.has(id)).length
                chatStore.updateStep(assistantId, sid('verify'), {
                  status: matched === expected.length ? 'done' : 'failed',
                  detail: `顶层节点 ${matched}/${expected.length} 已落位${
                    applied.containerName ? ` · ${applied.containerName}` : ''
                  }`,
                })
              }
            } catch {
              chatStore.updateStep(assistantId, sid('verify'), { status: 'failed', detail: '校验失败' })
            }
          }
        } catch (error) {
          if (showOpsCard) chatStore.setOpsStatus(assistantId, 'failed')
          if (compactTask) {
            chatStore.updateStep(assistantId, sid('step'), {
              status: 'failed',
              detail: error instanceof Error ? error.message.slice(0, 40) : '应用失败',
            })
          } else {
            chatStore.updateStep(assistantId, sid('apply'), {
              status: 'failed',
              detail: error instanceof Error ? error.message.slice(0, 60) : '应用失败',
            })
          }
          chatStore.addMessage({
            role: 'error',
            content: `自动应用到画布失败：${error instanceof Error ? error.message : String(error)}`,
          })
        }
      } else if (taskMode) {
        // 任务首步：等待用户在操作卡片上点击「应用」完成授权
        taskOpsPending = true
      }
      return
    }

    // 纯读取/问答轮次：把本次查询到的节点 id 追加进会话记忆，避免下一轮“失忆”
    if (!lastError && directWrites === 0 && directActions.length > 0) {
      appendActions(assistantId, directActions)
    }

    if (lastError) {
      if (compactTask) {
        chatStore.updateStep(assistantId, sid('step'), {
          status: 'failed',
          detail: lastError.slice(0, 40),
        })
      } else {
        chatStore.addStep(assistantId, {
          id: sid('error'),
          icon: 'error',
          label: '生成失败',
          status: 'failed',
          detail: lastError.slice(0, 60),
        })
      }
      // 重试全部失败（或首轮即失败且无可用内容）：展示错误与「重新生成」语义
      chatStore.addMessage({
        role: 'error',
        content: `生成失败：${lastError}\n可点击操作卡片或重新发送以「重新生成」。`,
      })
    }
    // 其余情况（纯文本回复 / 用户停止）：保留 assistant 文本即可
  } catch (error) {
    chatStore.setStreaming(assistantId, false)
    chatStore.addMessage({
      role: 'error',
      content: `请求异常：${error instanceof Error ? error.message : String(error)}`,
    })
  } finally {
    // 任务模式收尾：授权后自动续跑下一步；计划全部完成 / 模型回复 DONE / 手动停止时结束任务
    // 验证期间保持 generating，避免用户消息与复核结果交叉
    let scheduleNext = false
    if (taskMode && taskRun) {
      if (taskAborted) {
        finishTask(assistantId, '任务已停止')
      } else if (taskRun.approved && taskStepApplied) {
        if (isTaskPlanComplete()) await verifyTaskAndFinish(assistantId, taskRun)
        else scheduleNext = true
      } else if (isTaskStep && !taskStepApplied) {
        await verifyTaskAndFinish(assistantId, taskRun)
      } else if (!taskRun.approved && !taskOpsPending && !taskStepApplied) {
        finishTask(assistantId, '任务未产生画布操作')
      }
    }
    chatStore.generating = false
    // 任务续跑每步持久化会拖慢节奏：每 3 步或任务结束时再落盘
    if (!compactTask || !taskRun || taskRun.step % 3 === 0) void chatStore.persist()
    if (scheduleNext) scheduleTaskStep()
  }
}
