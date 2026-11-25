/**
 * 对话状态 Store（DEV.md 4.1 useChatStore）
 * 多会话：conversations 保存每个会话的消息，messages 始终指向当前会话的消息数组；
 * 历史经 history:load / history:save 持久化（沙箱按 fileKey 隔离，兼容旧版单会话数组）。
 */
import { defineStore } from 'pinia'
import type { LlmUsage, MessageAttachment } from '../../../types/llm.types'
import type { NodeOp } from '../../../types/node.types'
import { bridge } from '../services/bridge.service'
import { generateId } from '../utils/uuid'

/** 消息角色：用户 / AI / 系统错误 */
export type ChatRole = 'user' | 'assistant' | 'error'

/** 画布操作执行状态 */
export type OpsStatus = 'pending' | 'applying' | 'applied' | 'failed'

/** 任务模式任务项状态 */
export type TaskStatus = 'pending' | 'in_progress' | 'completed'

/** 任务模式的一项任务（由模型通过 update_tasks 工具维护） */
export interface TaskItem {
  id: string
  title: string
  status: TaskStatus
}

/** Agent 步骤状态 */
export type StepStatus = 'running' | 'done' | 'failed'

/** 步骤图标语义（渲染层映射为 MDI 图标） */
export type StepIcon = 'think' | 'context' | 'tool' | 'ops' | 'apply' | 'verify' | 'error'

/** 单条 Agent 执行步骤（IDE Agent 风格的过程记录） */
export interface AgentStep {
  id: string
  icon: StepIcon
  label: string
  /** 单行补充说明（如能力名、节点数、错误摘要） */
  detail?: string
  status: StepStatus
  /** think 步骤的原始思考累积（用于按句子边界取最新一句，不渲染） */
  raw?: string
  timestamp: number
}

/** 单条对话消息 */
export interface ChatMsg {
  id: string
  role: ChatRole
  content: string
  /** AI 消息附带的画布操作指令（应用前预览） */
  ops?: NodeOp[]
  opsStatus?: OpsStatus
  /** 操作包含的节点总数：历史持久化时只保留这个数字，丢弃完整 ops 以控制存储体积 */
  opsCount?: number
  /** 用户消息附件（图片 / 文本文件）；持久化时只保留元信息 */
  attachments?: MessageAttachment[]
  /**
   * 本轮实际写入画布的操作摘要（含原生图层 id），
   * 作为跨轮/跨会话恢复后的「记忆」注入系统提示词，避免模型忘记自己改过什么
   */
  actions?: string[]
  /** Agent 执行步骤（思考 / 上下文 / 能力调用 / 应用），不持久化 */
  steps?: AgentStep[]
  /** 流式输出中（显示打字光标） */
  streaming?: boolean
  /** 该轮最后一次请求的真实 token 用量（厂商未返回 usage 时为空，仅内存保留） */
  usage?: LlmUsage
  timestamp: number
}

/** 新建消息入参（id/timestamp 可省略，自动生成） */
export type NewChatMsg = Omit<ChatMsg, 'id' | 'timestamp'> & Partial<Pick<ChatMsg, 'id' | 'timestamp'>>

/** 单个会话（消息数组与 store.messages 共享引用） */
export interface Conversation {
  id: string
  title: string
  messages: ChatMsg[]
  /** 任务模式任务列表（会话级，随历史持久化） */
  tasks: TaskItem[]
  updatedAt: number
}

/** 每个会话持久化的消息上限 */
const PERSIST_LIMIT = 50
/** 最多保留的会话数 */
const CONVERSATION_LIMIT = 20
/** 会话标题最大长度 */
const TITLE_LIMIT = 24

function createId(): string {
  return generateId('msg')
}

/** 递归统计 ops 节点总数（含子节点） */
function countOps(ops: NodeOp[]): number {
  let total = 0
  const walk = (op: NodeOp): void => {
    total++
    for (const child of op.children ?? []) walk(child)
  }
  for (const op of ops) walk(op)
  return total
}

/** 恢复历史里的附件元信息（图片 dataUrl / 文本内容不持久化，恢复后仅展示文件名） */
function normalizeAttachments(raw: unknown): MessageAttachment[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const list: MessageAttachment[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const attachment = item as Partial<MessageAttachment>
    if (typeof attachment.id !== 'string' || typeof attachment.name !== 'string') continue
    const kind = attachment.kind === 'text' ? 'text' : 'image'
    list.push({
      id: attachment.id,
      kind,
      name: attachment.name,
      mime:
        typeof attachment.mime === 'string'
          ? attachment.mime
          : kind === 'image'
            ? 'image/*'
            : 'text/plain',
      size: typeof attachment.size === 'number' ? attachment.size : 0,
    })
  }
  return list.length > 0 ? list : undefined
}

/** 记忆条目上限（保留最近若干条操作摘要） */
const ACTION_LIMIT = 20

/** 恢复历史里的操作记忆：只保留非空短字符串 */
function normalizeActions(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const list = raw
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.slice(0, 300))
  return list.length > 0 ? list.slice(-ACTION_LIMIT) : undefined
}

/** 恢复历史里的执行步骤：过滤非法项，running 收尾为 done，丢弃思考原文 */
function restoreSteps(raw: unknown): AgentStep[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const icons: StepIcon[] = ['think', 'context', 'tool', 'ops', 'apply', 'verify', 'error']
  const steps: AgentStep[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const s = item as Partial<AgentStep>
    if (typeof s.id !== 'string' || typeof s.label !== 'string') continue
    steps.push({
      id: s.id,
      icon: icons.includes(s.icon as StepIcon) ? (s.icon as StepIcon) : 'tool',
      label: s.label,
      detail: typeof s.detail === 'string' ? s.detail : undefined,
      status: s.status === 'failed' ? 'failed' : 'done',
      timestamp: typeof s.timestamp === 'number' ? s.timestamp : Date.now(),
    })
  }
  return steps.length > 0 ? steps : undefined
}

/** 由首条用户消息生成会话标题 */
function deriveTitle(messages: ChatMsg[]): string {
  const first = messages.find((m) => m.role === 'user' && m.content.trim())
  const text = (first?.content ?? '').replace(/\s+/g, ' ').trim()
  if (!text) return '新对话'
  return text.length > TITLE_LIMIT ? `${text.slice(0, TITLE_LIMIT)}…` : text
}

function createConversation(): Conversation {
  return { id: generateId('conv'), title: '新对话', messages: [], tasks: [], updatedAt: Date.now() }
}

/** 任务列表上限 / 标题长度上限 */
const TASK_LIMIT = 12
const TASK_TITLE_LIMIT = 80

/** 归一化任务列表：过滤非法项、按标题去重、收敛状态、限制长度 */
export function normalizeTasks(raw: unknown): TaskItem[] {
  if (!Array.isArray(raw)) return []
  const list: TaskItem[] = []
  const seenTitles = new Set<string>()
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const task = item as Partial<TaskItem>
    const title = typeof task.title === 'string' ? task.title.trim().slice(0, TASK_TITLE_LIMIT) : ''
    if (!title) continue
    // 模型每步会重发完整列表，按标题去重避免同一任务被重复追加
    const key = title.toLowerCase()
    if (seenTitles.has(key)) continue
    seenTitles.add(key)
    const status: TaskStatus =
      task.status === 'completed' ? 'completed' : task.status === 'in_progress' ? 'in_progress' : 'pending'
    list.push({
      id: typeof task.id === 'string' && task.id ? task.id : `task-${list.length + 1}`,
      title,
      status,
    })
    if (list.length >= TASK_LIMIT) break
  }
  return list
}

/** 归一化单条历史消息（跳过坏数据） */
function normalizeStoredMessage(item: unknown): ChatMsg | null {
  if (!item || typeof item !== 'object') return null
  const m = item as Partial<ChatMsg>
  const role = m.role
  if ((role !== 'user' && role !== 'assistant' && role !== 'error') || typeof m.content !== 'string') {
    return null
  }
  const hasOps = Array.isArray(m.ops)
  // 旧版本历史可能仍带 ops；新版本只存 opsCount，恢复后无法再次应用
  const opsCount =
    typeof m.opsCount === 'number' && m.opsCount > 0
      ? m.opsCount
      : hasOps
        ? countOps(m.ops as NodeOp[])
        : undefined
  const opsStatus: OpsStatus | undefined = hasOps
    ? 'applied'
    : m.opsStatus === 'applied' || m.opsStatus === 'failed'
      ? m.opsStatus
      : opsCount
        ? 'pending'
        : undefined
  return {
    id: typeof m.id === 'string' && m.id ? m.id : createId(),
    role,
    content: m.content,
    ops: hasOps ? m.ops : undefined,
    opsStatus,
    opsCount,
    attachments: normalizeAttachments(m.attachments),
    actions: normalizeActions(m.actions),
    steps: restoreSteps(m.steps),
    streaming: false,
    timestamp: typeof m.timestamp === 'number' ? m.timestamp : Date.now(),
  }
}

/** 归一化持久化消息：丢弃 ops 全文，只保留 opsCount；收尾 running 步骤 */
function sanitizeMessage(m: ChatMsg): ChatMsg {
  return {
    ...m,
    ops: undefined,
    opsCount: m.opsCount ?? (m.ops ? countOps(m.ops) : undefined),
    // 附件只保留元信息：图片 base64 与文件文本体积过大，不进 clientStorage
    attachments: m.attachments?.map(({ id, kind, name, mime, size }) => ({
      id,
      kind,
      name,
      mime,
      size,
    })),
    actions: m.actions && m.actions.length > 0 ? m.actions.slice(-ACTION_LIMIT) : undefined,
    streaming: false,
    steps: m.steps?.map((s) => ({
      ...s,
      raw: undefined,
      status: s.status === 'running' ? 'done' : s.status,
    })),
  }
}

/** 归一化持久化的会话对象 */
function normalizeConversation(item: unknown): Conversation | null {
  if (!item || typeof item !== 'object') return null
  const raw = item as { id?: unknown; title?: unknown; messages?: unknown; updatedAt?: unknown }
  const messages = Array.isArray(raw.messages)
    ? raw.messages.map(normalizeStoredMessage).filter((m): m is ChatMsg => m !== null)
    : []
  const title = typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim() : deriveTitle(messages)
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : generateId('conv'),
    title,
    messages,
    tasks: normalizeTasks((raw as { tasks?: unknown }).tasks),
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : Date.now(),
  }
}

export const useChatStore = defineStore('chat', {
  state: () => {
    const conversation = createConversation()
    return {
      /** 当前会话消息（与 active conversation.messages 共享引用） */
      messages: conversation.messages,
      /** 全部会话 */
      conversations: [conversation] as Conversation[],
      /** 当前会话 id */
      activeConversationId: conversation.id,
      /** AI 生成中（发送按钮切换为停止） */
      generating: false,
    }
  },
  getters: {
    /** 按最近更新时间排序的会话（UI 列表用） */
    sortedConversations(state): Conversation[] {
      return [...state.conversations].sort((a, b) => b.updatedAt - a.updatedAt)
    },
    /** 当前会话的任务列表（任务模式面板用） */
    tasks(state): TaskItem[] {
      return state.conversations.find((item) => item.id === state.activeConversationId)?.tasks ?? []
    },
  },
  actions: {
    /** 保证存在活动会话，并让 messages 指向它的消息数组 */
    ensureActiveConversation(): Conversation {
      let active = this.conversations.find((item) => item.id === this.activeConversationId)
      if (!active) {
        active = createConversation()
        this.conversations.unshift(active)
        this.activeConversationId = active.id
      }
      if (this.messages !== active.messages) this.messages = active.messages
      return active
    },
    /** 追加消息，返回完整消息对象（含生成的 id/timestamp） */
    addMessage(msg: NewChatMsg): ChatMsg {
      const active = this.ensureActiveConversation()
      const full: ChatMsg = {
        ...msg,
        id: msg.id ?? createId(),
        timestamp: msg.timestamp ?? Date.now(),
      }
      active.messages.push(full)
      active.updatedAt = Date.now()
      // 首个用户消息作为标题
      if (full.role === 'user' && (!active.title || active.title === '新对话')) {
        active.title = deriveTitle([full])
      }
      return full
    },
    /** 流式追加文本（按消息 id 定位） */
    appendDelta(id: string, text: string): void {
      const msg = this.messages.find((m) => m.id === id)
      if (msg) msg.content += text
    },
    /** 流式收尾：去掉首尾空白，连续空行压缩为一个（跨轮拼接常留下多余空行） */
    normalizeContent(id: string): void {
      const msg = this.messages.find((m) => m.id === id)
      if (!msg) return
      msg.content = msg.content
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
    },
    /** 设置消息的画布操作指令与状态 */
    setOps(id: string, ops: NodeOp[], status: OpsStatus = 'pending'): void {
      const msg = this.messages.find((m) => m.id === id)
      if (!msg) return
      msg.ops = ops
      msg.opsCount = countOps(ops)
      msg.opsStatus = status
    },
    /** 仅更新操作状态（应用到画布成功 / 失败后） */
    setOpsStatus(id: string, status: OpsStatus): void {
      const msg = this.messages.find((m) => m.id === id)
      if (!msg) return
      msg.opsStatus = status
    },
    /** 隐藏操作卡片（任务模式应用后只保留步骤与任务进度） */
    hideOps(id: string): void {
      const msg = this.messages.find((m) => m.id === id)
      if (!msg) return
      msg.opsCount = msg.opsCount ?? (msg.ops ? countOps(msg.ops) : undefined)
      msg.ops = undefined
    },
    /** 记录本轮实际写入画布的操作摘要（跨轮记忆，随历史持久化） */
    setActions(id: string, actions: string[]): void {
      const msg = this.messages.find((m) => m.id === id)
      if (!msg) return
      const list = actions.map((item) => item.trim().slice(0, 300)).filter(Boolean)
      msg.actions = list.length > 0 ? list.slice(-ACTION_LIMIT) : undefined
    },
    /** 整体替换任务列表（模型通过 update_tasks 工具维护） */
    setTasks(items: TaskItem[]): void {
      const active = this.ensureActiveConversation()
      active.tasks = normalizeTasks(items)
      active.updatedAt = Date.now()
    },
    /** 清空任务列表 */
    clearTasks(): void {
      const active = this.ensureActiveConversation()
      active.tasks = []
      active.updatedAt = Date.now()
    },
    /** 重写消息内容（Agent 重试轮次开始时清空上一轮流式文本） */
    setContent(id: string, content: string): void {
      const msg = this.messages.find((m) => m.id === id)
      if (msg) msg.content = content
    },
    /** 追加执行步骤 */
    addStep(id: string, step: Omit<AgentStep, 'timestamp' | 'status'> & { status?: StepStatus }): void {
      const msg = this.messages.find((m) => m.id === id)
      if (!msg) return
      msg.steps = msg.steps ?? []
      msg.steps.push({ ...step, status: step.status ?? 'running', timestamp: Date.now() })
    },
    /** 更新步骤状态 / 文案 */
    updateStep(id: string, stepId: string, patch: Partial<Omit<AgentStep, 'id'>>): void {
      const step = this.messages.find((m) => m.id === id)?.steps?.find((s) => s.id === stepId)
      if (step) Object.assign(step, patch)
    },
    /** 思考内容：按句子边界取最新一句作为单行 detail，避免逐字堆叠看不清 */
    appendStepThinking(id: string, stepId: string, text: string): void {
      const step = this.messages.find((m) => m.id === id)?.steps?.find((s) => s.id === stepId)
      // 仅在思考进行中更新预览；已完成的步骤不再回填内容
      if (!step || step.status !== 'running') return
      const raw = `${step.raw ?? ''}${text}`.slice(-1200)
      step.raw = raw
      const sentences = raw.split(/[\n。！？；!?;]/).map((s) => s.trim()).filter(Boolean)
      step.detail = (sentences[sentences.length - 1] ?? '').slice(0, 60)
    },
    /** 清空步骤（重试轮次开始时重置过程记录） */
    clearSteps(id: string): void {
      const msg = this.messages.find((m) => m.id === id)
      if (msg) msg.steps = []
    },
    /** 截断步骤到指定长度（任务复用气泡时重试只回滚本轮步骤） */
    trimSteps(id: string, length: number): void {
      const msg = this.messages.find((m) => m.id === id)
      if (!msg?.steps) return
      if (length <= 0) msg.steps = []
      else if (msg.steps.length > length) msg.steps.length = length
    },
    /** 开启/结束流式输出状态；结束时把残留的 running 步骤收尾 */
    setStreaming(id: string, streaming: boolean): void {
      const msg = this.messages.find((m) => m.id === id)
      if (!msg) return
      msg.streaming = streaming
      if (!streaming && msg.steps) {
        for (const step of msg.steps) if (step.status === 'running') step.status = 'done'
      }
    },
    /** 记录该轮请求的真实 token 用量（供输入栏显示实测上下文占用） */
    setUsage(id: string, usage: LlmUsage): void {
      const msg = this.messages.find((m) => m.id === id)
      if (msg) msg.usage = usage
    },
    /** 删除指定消息（重新生成时移除旧的 AI 消息与其用户输入） */
    removeMessage(id: string): void {
      const index = this.messages.findIndex((m) => m.id === id)
      if (index >= 0) this.messages.splice(index, 1)
    },
    /**
     * 联动删除「一轮对话」：
     * - 删除 assistant / error 消息时，连同其所属的用户消息及后续回复一起移除
     * - 删除用户消息时，连同其后的 assistant / error 回复一起移除
     * 返回实际删除的消息条数；删除后重算会话标题。
     */
    removeTurn(id: string): number {
      const list = this.messages
      const index = list.findIndex((m) => m.id === id)
      if (index < 0) return 0
      // 向前找到本轮用户消息作为起点；消息出现在首条用户消息之前时只删自身组
      let start = index
      for (let i = index; i >= 0; i--) {
        if (list[i].role === 'user') {
          start = i
          break
        }
      }
      // 向后扩展到下一条用户消息之前
      let end = index + 1
      while (end < list.length && list[end].role !== 'user') end++
      const removed = end - start
      list.splice(start, removed)
      const active = this.ensureActiveConversation()
      active.title = deriveTitle(active.messages)
      active.updatedAt = Date.now()
      return removed
    },
    /** 清空当前会话消息（保留会话条目并重置标题） */
    clearMessages(): void {
      const active = this.ensureActiveConversation()
      this.messages.splice(0, this.messages.length)
      active.tasks = []
      active.title = '新对话'
      active.updatedAt = Date.now()
    },
    /** 新建会话；当前会话为空时直接复用，避免产生大量空会话 */
    newConversation(): void {
      if (this.generating) return
      const current = this.conversations.find((item) => item.id === this.activeConversationId)
      if (current && current.messages.length === 0) {
        this.messages = current.messages
        return
      }
      const conversation = createConversation()
      this.conversations.unshift(conversation)
      this.activeConversationId = conversation.id
      this.messages = conversation.messages
      this.pruneConversations()
      void this.persist()
    },
    /** 切换会话 */
    switchConversation(id: string): boolean {
      if (this.generating) return false
      const target = this.conversations.find((item) => item.id === id)
      if (!target || target.id === this.activeConversationId) return false
      this.activeConversationId = target.id
      this.messages = target.messages
      void this.persist()
      return true
    },
    /** 删除会话；删除当前会话后自动切到最近一个（无会话时新建空会话） */
    deleteConversation(id: string): boolean {
      if (this.generating) return false
      const index = this.conversations.findIndex((item) => item.id === id)
      if (index < 0) return false
      const wasActive = this.activeConversationId === id
      this.conversations.splice(index, 1)
      if (this.conversations.length === 0) {
        const conversation = createConversation()
        this.conversations.push(conversation)
        this.activeConversationId = conversation.id
        this.messages = conversation.messages
      } else if (wasActive) {
        const next = [...this.conversations].sort((a, b) => b.updatedAt - a.updatedAt)[0]
        this.activeConversationId = next.id
        this.messages = next.messages
      }
      void this.persist()
      return true
    },
    /** 会话数量上限：保留最近会话，始终保留当前会话 */
    pruneConversations(): void {
      if (this.conversations.length <= CONVERSATION_LIMIT) return
      const kept = [...this.conversations]
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, CONVERSATION_LIMIT)
        .map((item) => item.id)
      if (!kept.includes(this.activeConversationId)) {
        kept.pop()
        kept.push(this.activeConversationId)
      }
      const keepSet = new Set(kept)
      this.conversations = this.conversations.filter((item) => keepSet.has(item.id))
    },
    /**
     * 持久化全部会话（history:save）
     * - 每个会话最多 50 条消息；最多 20 个会话
     * - 丢弃 ops 全文与思考原文，避免 clientStorage 膨胀
     */
    async persist(): Promise<void> {
      const active = this.ensureActiveConversation()
      active.updatedAt = Date.now()
      this.pruneConversations()
      const conversations = this.sortedConversations.slice(0, CONVERSATION_LIMIT).map((item) => ({
        id: item.id,
        title: item.title || deriveTitle(item.messages),
        updatedAt: item.updatedAt,
        tasks: normalizeTasks(item.tasks),
        messages: item.messages.slice(-PERSIST_LIMIT).map(sanitizeMessage),
      }))
      try {
        await bridge.request('history:save', {
          conversations,
          activeId: this.activeConversationId,
        })
      } catch {
        // 持久化失败不影响当前会话
      }
    },
    /**
     * 恢复历史（兼容旧版 messages 数组 / { messages } / 新版 { conversations, activeId }）
     * 恢复的消息不再处于流式状态；带 ops 的旧消息直接展示为已应用
     */
    async restore(raw?: unknown): Promise<void> {
      let source: unknown = raw
      if (raw === undefined) {
        try {
          source = await bridge.request<unknown>('history:load')
        } catch {
          return
        }
      }

      const conversations: Conversation[] = []
      let activeId = ''

      if (Array.isArray(source)) {
        // 旧版：单会话消息数组
        const messages = source
          .map(normalizeStoredMessage)
          .filter((m): m is ChatMsg => m !== null)
        const conversation = createConversation()
        conversation.messages = messages
        conversation.title = deriveTitle(messages)
        const last = messages[messages.length - 1]
        conversation.updatedAt = last?.timestamp ?? Date.now()
        conversations.push(conversation)
        activeId = conversation.id
      } else if (source && typeof source === 'object') {
        const payload = source as { conversations?: unknown; activeId?: unknown; messages?: unknown }
        if (Array.isArray(payload.conversations)) {
          for (const item of payload.conversations) {
            const conversation = normalizeConversation(item)
            if (conversation) conversations.push(conversation)
          }
        } else if (Array.isArray(payload.messages)) {
          const messages = payload.messages
            .map(normalizeStoredMessage)
            .filter((m): m is ChatMsg => m !== null)
          const conversation = createConversation()
          conversation.messages = messages
          conversation.title = deriveTitle(messages)
          conversations.push(conversation)
        }
        activeId = typeof payload.activeId === 'string' ? payload.activeId : ''
      }

      if (conversations.length === 0) conversations.push(createConversation())
      const active = conversations.find((item) => item.id === activeId) ?? conversations[0]
      this.conversations = conversations
      this.activeConversationId = active.id
      this.messages = active.messages
    },
  },
})
