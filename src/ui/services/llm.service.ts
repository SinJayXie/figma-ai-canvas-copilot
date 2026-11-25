/**
 * LLM 服务封装（DEV.md 6.2，原生 Tool Call 方案）
 * OpenAI 兼容 /chat/completions SSE 流式调用：
 * - 请求携带 tools（create_ops / update_ops），模型以 tool_calls 返回结构化指令
 * - 增量文本经 onDelta 实时回显；tool_calls 按 index 分片累积
 * - AbortController 支持停止生成
 */
import { parseExtraBody, resolveActiveModelEntry, type PluginConfig } from '../../../types/config.types'
import type { ChatMessage, LlmStreamChunk, LlmTool, LlmUsage } from '../../../types/llm.types'
import { t } from '../i18n'
import { READ_CAPABILITIES, WRITE_CAPABILITIES } from './capabilities.service'

/** 图层操作节点的内联 JSON Schema（简化版 NodeOp；children 用 object 描述递归，避免 JSON 循环引用） */
const NODE_OP_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    action: { type: 'string', enum: ['create', 'update'], description: 'create a new layer or update an existing one' },
    id: {
      type: 'string',
      description: 'For create: a unique id you generate (e.g. n_001). For update: the native node id from the canvas context.',
    },
    type: { type: 'string', enum: ['frame', 'text', 'rect', 'ellipse', 'line'] },
    name: { type: 'string', description: "Layer name in the user's language, concise and descriptive" },
    parent: {
      type: 'string',
      description:
        'Native id of the target container, or "page". For create: where to create the node (omit to infer from selection). For update: move the existing node into this container',
    },
    position: {
      type: 'string',
      enum: ['auto', 'absolute'],
      description: 'Create only: "auto" lets the plugin place the node; "absolute" uses x/y exactly',
    },
    insertAfter: {
      type: 'string',
      description:
        'Native id of the preceding sibling. For create: inserts the new node right after it. For update: moves the node after it (use this to reorder children of an auto layout container, where x/y are ignored)',
    },
    insertBefore: {
      type: 'string',
      description:
        'Native id of the following sibling: the node is placed right before it. Use it to make a node the first child of a container',
    },
    x: { type: 'number', description: 'X position; container-relative when a container is selected; ignored under auto layout' },
    y: { type: 'number', description: 'Y position; container-relative when a container is selected; ignored under auto layout' },
    width: { type: 'number', description: 'Width; frames default to 375 (mobile) or 1440 (desktop)' },
    height: { type: 'number' },
    fill: {
      type: 'string',
      description:
        'Fill color as hex, e.g. #FFFFFF. Use "transparent" or "none" for no fill; frames without fill / fills / fillStyleId are created with no fill',
    },
    cornerRadius: { type: 'number', description: 'Corner radius, multiple of 8' },
    stroke: { type: 'string', description: 'Stroke color as hex; pass null for no stroke' },
    strokeWeight: { type: 'number' },
    fills: {
      type: 'array',
      description:
        'Multiple fills; overrides fill. Each item is a hex string or { type: "GRADIENT_LINEAR" | "GRADIENT_RADIAL", gradientStops: [{ position, color }], angle?: 45 } (angle in degrees: 0 = left→right, 45 = diagonal, 90 = top→bottom)',
      items: {},
    },
    opacity: { type: 'number', description: 'Layer opacity 0~1' },
    blendMode: { type: 'string', description: 'Blend mode, e.g. MULTIPLY / SCREEN' },
    cornerRadii: {
      type: 'object',
      description: 'Per-corner radius; overrides cornerRadius',
      properties: {
        topLeft: { type: 'number' },
        topRight: { type: 'number' },
        bottomRight: { type: 'number' },
        bottomLeft: { type: 'number' },
      },
    },
    effects: {
      type: 'array',
      description:
        'Effects: { type: "DROP_SHADOW" | "INNER_SHADOW" | "LAYER_BLUR" | "BACKGROUND_BLUR", color?, offset?: {x,y}, radius?, spread? }',
      items: {},
    },
    strokeAlign: { type: 'string', enum: ['INSIDE', 'OUTSIDE', 'CENTER'] },
    strokeWeights: {
      type: 'object',
      description: 'Per-side stroke width',
      properties: {
        top: { type: 'number' },
        right: { type: 'number' },
        bottom: { type: 'number' },
        left: { type: 'number' },
      },
    },
    dashPattern: { type: 'array', items: { type: 'number' } },
    fillStyleId: { type: 'string', description: 'Paint style id from the design system summary' },
    strokeStyleId: { type: 'string', description: 'Paint style id for strokes' },
    textStyleId: { type: 'string', description: 'Text style id for text layers' },
    effectStyleId: { type: 'string', description: 'Effect style id from the design system summary' },
    layout: {
      type: 'object',
      description: 'Auto layout config; omit it or pass { "mode": "none" } to disable',
      properties: {
        mode: { type: 'string', enum: ['vertical', 'horizontal', 'none'] },
        gap: { type: 'number' },
        padding: { type: 'array', items: { type: 'number' }, description: 'Top, right, bottom, left' },
        alignItems: { type: 'string' },
        justifyContent: { type: 'string' },
        wrap: { type: 'boolean', description: 'Wrap children onto new lines (horizontal layouts)' },
        counterAxisSpacing: { type: 'number', description: 'Row gap when wrap is enabled' },
        sizing: {
          type: 'object',
          description:
            'This frame\'s own axes: "fixed" keeps width/height, "hug" fits its content (Figma AUTO). To make a frame stretch to its parent, use layoutSizing.fill instead.',
          properties: {
            horizontal: { type: 'string', enum: ['fixed', 'hug'] },
            vertical: { type: 'string', enum: ['fixed', 'hug'] },
          },
        },
      },
    },
    textContent: { type: 'string', description: 'Required when type = text, otherwise null' },
    fontSize: { type: 'number', description: 'Allowed sizes: 12/14/16/20/24/32/48' },
    fontWeight: { type: 'number', description: '400/500/600/700' },
    textColor: { type: 'string', description: 'Text color as hex' },
    fontFamily: {
      type: 'string',
      description: 'Font family, e.g. "PingFang SC" / "Inter" / "Microsoft YaHei"; omit to keep the default or existing font',
    },
    textAutoResize: {
      type: 'string',
      enum: ['NONE', 'WIDTH_AND_HEIGHT', 'HEIGHT', 'TRUNCATE'],
      description: 'Text auto-resize mode; use WIDTH_AND_HEIGHT when the text must not wrap',
    },
    lineHeight: { type: 'number', description: 'Line height in px (optional)' },
    letterSpacing: { type: 'number', description: 'Letter spacing in px (can be negative)' },
    paragraphSpacing: { type: 'number', description: 'Paragraph spacing in px' },
    textAlignHorizontal: { type: 'string', enum: ['LEFT', 'CENTER', 'RIGHT', 'JUSTIFIED'] },
    textAlignVertical: { type: 'string', enum: ['TOP', 'CENTER', 'BOTTOM'] },
    textCase: { type: 'string', enum: ['ORIGINAL', 'UPPER', 'LOWER', 'TITLE'] },
    textDecoration: { type: 'string', enum: ['NONE', 'UNDERLINE', 'STRIKETHROUGH'] },
    textTruncation: {
      type: 'string',
      enum: ['DISABLED', 'ENDING'],
      description: 'ENDING truncates the text; combine with maxLines',
    },
    maxLines: { type: 'number' },
    layoutSizing: {
      type: 'object',
      description:
        'Child sizing inside an auto layout parent: "fill" = Fill container (stretch to fill the parent axis, Figma FILL), "hug" = Hug contents (only for auto layout frames / text), "fixed" = keep the given size. Use fill instead of guessing a fixed width/height when the child must span the parent.',
      properties: {
        horizontal: { type: 'string', enum: ['fixed', 'hug', 'fill'] },
        vertical: { type: 'string', enum: ['fixed', 'hug', 'fill'] },
      },
    },
    layoutPositioning: {
      type: 'string',
      enum: ['AUTO', 'ABSOLUTE'],
      description: 'ABSOLUTE places the child absolutely inside an auto layout parent',
    },
    minWidth: { type: 'number' },
    maxWidth: { type: 'number' },
    minHeight: { type: 'number' },
    maxHeight: { type: 'number' },
    constraints: {
      type: 'object',
      description: 'Constraints relative to the parent',
      properties: {
        horizontal: { type: 'string', enum: ['MIN', 'MAX', 'CENTER', 'STRETCH', 'SCALE'] },
        vertical: { type: 'string', enum: ['MIN', 'MAX', 'CENTER', 'STRETCH', 'SCALE'] },
      },
    },
    layoutGrids: {
      type: 'array',
      description:
        'Layout grids: { pattern: "COLUMNS" | "ROWS" | "GRID", count?, gutterSize?, sectionSize?, offset?, alignment?, color? }',
      items: {},
    },
    clipsContent: { type: 'boolean', description: 'Whether the frame clips overflowing children' },
    isMask: {
      type: 'boolean',
      description: 'Turns the layer into a mask that clips sibling layers below it in the same parent',
    },
    maskType: {
      type: 'string',
      enum: ['ALPHA', 'VECTOR', 'LUMINANCE'],
      description: 'Mask type; only applied when isMask is true',
    },
    children: {
      type: 'array',
      description:
        'Nested child nodes; each element has the same structure as its parent (action/id/type/name/x/y/width/height/fill/layout/textContent/children, ...)',
      items: { type: 'object' },
    },
  },
  required: ['action', 'id', 'type', 'name'],
}

const OPS_PARAMETERS: Record<string, unknown> = {
  type: 'object',
  properties: {
    ops: {
      type: 'array',
      description:
        'Layer operations; max 300 nodes. Compact aliases accepted: t/n/w/h/f/s/r/c/l/fs/fw/tc/txt; layout fields may sit on the node (mode/gap/padding/alignItems/justifyContent)',
      items: NODE_OP_SCHEMA,
    },
  },
  required: ['ops'],
}

/** figma_call 工具参数：单个能力调用 */
const FIGMA_CALL_PARAMETERS: Record<string, unknown> = {
  type: 'object',
  properties: {
    type: {
      type: 'string',
      description: `Capability name. Read: ${READ_CAPABILITIES.join(', ')}. Write: ${WRITE_CAPABILITIES.join(', ')}.`,
    },
    nodeIds: {
      type: 'array',
      items: { type: 'string' },
      description:
        'Target native node ids. Node-scoped style capabilities apply the same params to EVERY id in one call: set_fills / set_strokes / set_effects / set_corner_radius / rename_node / apply_style_to_node / set_text / set_font / set_corner_radii / set_stroke_properties / set_layout_grids / set_overflow / set_annotations / set_auto_layout / set_instance_properties / bind_variable_to_node / set_reactions. Pass all affected layers together instead of calling once per layer.',
    },
    params: {
      type: 'object',
      description:
        'Capability-specific parameters (examples, not exhaustive). Fills: set_fills / set_strokes { "color": "#FF0000" | "transparent" | "none" } or { "fills": [paint] }; gradient { "type": "GRADIENT_LINEAR", "gradientStops": [{ "position": 0, "color": "#FF0000" }, { "position": 1, "color": "#0000FF" }], "angle": 45 } (0 = left→right, 90 = top→bottom). Text: set_text { "text" }; set_text_range { "start", "end", "color", "fontName": { "family", "style" }, "hyperlink": { "type": "URL", "value": "https://..." } }. Nodes: create_frame { "name", "x", "y", "width", "height", "fillColor" }; set_corner_radius { "radius" }; search_nodes { "query", "types", "limit" }; import_svg { "svg", "parentId", "width", "height", "x", "y", "name" }; create_instance { "componentId" } or { "componentKey", "parentId" }; create_vector { "paths": [{ "windingRule": "NONZERO", "data": "M 0 0 L 24 0 L 24 24 Z" }], "fillColor", "parentId" }. Media and export: create_image_from_url { "url", "parentId", "width", "height", "scaleMode" }; set_export_settings { "settings": [{ "format": "PNG", "constraint": { "type": "SCALE", "value": 2 } }] }. Components: set_component_property_references { "references": { "visible": "Visible#1:0" } }. Tokens and files: reorder_styles { "type": "PAINT", "styleId", "beforeStyleId": "<style id> | null" }; get_page { "pageId" }; save_file_version { "title" }; set_annotations { "annotations": [{ "label", "categoryId" }] }.',
    },
  },
  required: ['type'],
}

/** update_tasks 工具参数：整体替换任务列表（任务模式） */
const UPDATE_TASKS_PARAMETERS: Record<string, unknown> = {
  type: 'object',
  properties: {
    tasks: {
      type: 'array',
      description:
        'Full task list, in order. Mark finished items completed, exactly one item in_progress (the current step), rest pending',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Stable id, e.g. t1' },
          title: { type: 'string', description: 'Short step title in the user language' },
          status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] },
        },
        required: ['title', 'status'],
      },
    },
  },
  required: ['tasks'],
}

/** get_current_time 工具参数：读取真实当前时间（模型本身没有时钟） */
const CURRENT_TIME_PARAMETERS: Record<string, unknown> = {
  type: 'object',
  properties: {
    timezone: {
      type: 'string',
      description:
        'IANA time zone, e.g. Asia/Shanghai or America/New_York. Omit to use the user local zone.',
    },
  },
}

/** date_math 工具参数：日期加减 / 两个日期求差 */
const DATE_MATH_PARAMETERS: Record<string, unknown> = {
  type: 'object',
  properties: {
    base: {
      type: 'string',
      description:
        'Start date or datetime, e.g. 2026-11-25 or 2026-11-25T10:00:00+08:00. Omit to use now.',
    },
    offset: {
      type: 'string',
      description: 'Duration to add, unit required: 3d, -2h, 30m, 1w.',
    },
    to: {
      type: 'string',
      description:
        'When set, return the difference from base to this date instead of applying offset.',
    },
    timezone: {
      type: 'string',
      description: 'IANA time zone used for the formatted result. Omit to use the user local zone.',
    },
  },
}

/**
 * Figma 插件页面运行在 HTTPS 下，浏览器会拦截明文 HTTP 请求（Mixed Content）。
 * 仅 localhost / 127.0.0.1 / [::1] 被视为安全来源；其余 http:// 地址需改为 HTTPS
 * 或通过端口转发映射到 localhost。
 */
function assertSecureEndpoint(url: string): void {
  if (typeof window === 'undefined' || window.location.protocol !== 'https:') return
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return
  }
  if (parsed.protocol !== 'http:') return
  const host = parsed.hostname.replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return
  throw new Error(t('LLM_HTTP_BLOCKED', { origin: parsed.origin }))
}

/** 注册给模型的画布操作工具（spec：原生 Tool Call 协议） */
export const TOOLS: LlmTool[] = [
  {
    type: 'function',
    function: {
      name: 'create_ops',
      description:
        'Create new layers on the canvas (frame / text / rect / ellipse / line, nested auto layout supported). Use it when generating a page, a section or any new element.',
      parameters: OPS_PARAMETERS,
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_ops',
      description:
        'Modify properties (style / text / layout) of existing layers by native node id without creating new nodes. Use it when the user asks to change selected or existing content.',
      parameters: OPS_PARAMETERS,
    },
  },
  {
    type: 'function',
    function: {
      name: 'figma_call',
      description:
        'Granular Figma capability call: inspect the canvas, search nodes, read/write styles, variables, components, variants, prototypes, pages, boolean operations, export, alignment, delete/move/rename, etc. Prefer create_ops / update_ops for full-page or multi-layer generation.',
      parameters: FIGMA_CALL_PARAMETERS,
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_tasks',
      description:
        'Task mode only: replace the visible task list shown in the plugin. Call it at the start of every step (full list, one item in_progress) before the step ops, and mark everything completed when the request is done.',
      parameters: UPDATE_TASKS_PARAMETERS,
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_current_time',
      description:
        "Get the real current date, time and weekday in the user's time zone. You have no internal clock: call this before answering anything that depends on today / this week / a specific date, and never guess the current date.",
      parameters: CURRENT_TIME_PARAMETERS,
    },
  },
  {
    type: 'function',
    function: {
      name: 'date_math',
      description:
        'Add or subtract a duration from a date, or compute the difference between two dates (e.g. deadline countdowns, delivery dates, "how many days until").',
      parameters: DATE_MATH_PARAMETERS,
    },
  },
]

/** 模型返回的单个工具调用（arguments 为分片拼接后的 JSON 字符串） */
export interface StreamToolCall {
  name: string
  args: string
  /** 工具调用 ID（首个分片携带，用于工具往返消息） */
  id?: string
}

export interface StreamChatResult {
  /** 全量增量文本 */
  content: string
  /** 累积完成的 tool_calls */
  toolCalls: StreamToolCall[]
  /** 思考内容（reasoning 模型流式输出，正文可能为空） */
  reasoning?: string
  /** 流结束原因（length 表示被 max_tokens 截断） */
  finishReason?: string | null
  /** 厂商返回的真实 token 用量（不支持 include_usage 的厂商为空） */
  usage?: LlmUsage
  /** 用户主动停止生成（保留已接收的部分内容） */
  aborted?: boolean
}

export interface StreamChatParams {
  messages: ChatMessage[]
  config: PluginConfig
  /** 本次请求可用的工具集（默认全量 TOOLS；任务续跑可传更小的集合以加速） */
  tools?: LlmTool[]
  /** 每收到一段增量文本回调 */
  onDelta?: (text: string) => void
  /** 每收到一段思考内容回调（reasoning 模型） */
  onReasoning?: (text: string) => void
}

/** 首次响应（拿到 headers）超时 */
const RESPONSE_TIMEOUT = 60_000
/** 流式读取空闲超时（连续无任何新数据） */
const IDLE_TIMEOUT = 120_000
/** 传输层可重试的 HTTP 状态 */
const RETRYABLE_STATUS = new Set([429, 502, 503, 504])
/** 传输层重试次数（仅在尚未产出任何内容前） */
const MAX_TRANSPORT_RETRIES = 2

/** 请求阶段错误：retryable 表示可安全重发（尚未产出内容） */
class LlmTransportError extends Error {
  readonly retryable: boolean

  constructor(message: string, retryable: boolean) {
    super(message)
    this.name = 'LlmTransportError'
    this.retryable = retryable
  }
}

/** 流内错误（provider 通过 SSE 返回）：不重试，避免内容重复 */
class LlmStreamError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LlmStreamError'
  }
}

function isNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return (
    error.name === 'TypeError' ||
    /failed to fetch|load failed|network|connection/i.test(error.message)
  )
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** 从 SSE error 事件 / chunk.error 中提取可读信息 */
function extractProviderError(input: unknown): string {
  if (typeof input === 'string') {
    try {
      return extractProviderError(JSON.parse(input) as unknown)
    } catch {
      return input.slice(0, 300) || t('LLM_STREAM_ERROR')
    }
  }
  if (input && typeof input === 'object') {
    const value = input as { error?: unknown; message?: unknown }
    if (typeof value.message === 'string' && value.message) return value.message
    if (typeof value.error === 'string' && value.error) return value.error
    if (value.error && typeof value.error === 'object') {
      const nested = value.error as { message?: unknown }
      if (typeof nested.message === 'string' && nested.message) return nested.message
    }
  }
  return t('LLM_STREAM_ERROR')
}

class LLMService {
  private abortController: AbortController | null = null
  /** 用户主动停止（区分“用户取消”与“超时取消”） */
  private stopped = false

  /** 中断当前流式请求 */
  stop(): void {
    this.stopped = true
    this.abortController?.abort()
  }

  /**
   * 流式对话补全：返回全量文本与 tool_calls；非 2xx 抛出含状态码错误。
   * 传输层错误（网络 / 超时 / 429 / 5xx）在尚未产出内容时自动重试 2 次。
   */
  async streamChat(params: StreamChatParams): Promise<StreamChatResult> {
    this.stopped = false
    let lastError: unknown
    for (let attempt = 0; attempt <= MAX_TRANSPORT_RETRIES; attempt++) {
      if (this.stopped) return { content: '', toolCalls: [], aborted: true }
      try {
        return await this.streamOnce(params)
      } catch (error) {
        lastError = error
        const retryable = error instanceof LlmTransportError && error.retryable
        if (!retryable || attempt >= MAX_TRANSPORT_RETRIES || this.stopped) break
        await sleep(800 * (attempt + 1))
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError))
  }

  private async streamOnce({
    messages,
    config,
    tools,
    onDelta,
    onReasoning,
  }: StreamChatParams): Promise<StreamChatResult> {
    const controller = new AbortController()
    this.abortController = controller
    const signal = controller.signal
    const activeModel = resolveActiveModelEntry(config)
    const generation = activeModel.generation
    const modelId = activeModel.model.trim()
    const baseUrl = activeModel.baseUrl.trim().replace(/\/+$/, '')
    if (!modelId) {
      throw new Error(t('LLM_MODEL_NOT_CONFIGURED'))
    }
    if (!baseUrl) {
      throw new Error(t('LLM_BASE_URL_MISSING'))
    }
    const url = `${baseUrl}/chat/completions`
    assertSecureEndpoint(url)
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (activeModel.apiKey.trim()) {
      headers.Authorization = `Bearer ${activeModel.apiKey.trim()}`
    }

    const extra = parseExtraBody(generation.extraBody)
    if (!extra.ok) throw new Error(t('LLM_INVALID_EXTRA_BODY', { error: extra.error }))

    let responseTimer: ReturnType<typeof setTimeout> | null = setTimeout(
      () => controller.abort(),
      RESPONSE_TIMEOUT,
    )

    // 只发送显式启用的采样 / 惩罚参数，减少不兼容厂商的 400 错误
    const requestBody: Record<string, unknown> = {
      model: modelId,
      messages,
      stream: true,
      tools: tools && tools.length > 0 ? tools : TOOLS,
      // 显式声明由模型自行决定是否调用工具（符合 OpenAI tool-call 规范）
      tool_choice: 'auto',
      temperature: generation.temperature,
      max_tokens: generation.maxTokens,
    }
    if (generation.topP < 1) requestBody.top_p = generation.topP
    if (generation.topK > 0) requestBody.top_k = generation.topK
    if (generation.presencePenalty !== 0) requestBody.presence_penalty = generation.presencePenalty
    if (generation.frequencyPenalty !== 0) {
      requestBody.frequency_penalty = generation.frequencyPenalty
    }
    if (generation.repetitionPenalty > 0) {
      requestBody.repetition_penalty = generation.repetitionPenalty
    }
    if (generation.seed !== null) requestBody.seed = generation.seed
    if (generation.stop.length > 0) requestBody.stop = generation.stop
    if (!generation.parallelToolCalls) requestBody.parallel_tool_calls = false
    if (generation.thinkingMode) {
      // off = 关闭思考模式：不发送 reasoning 参数，模型直接输出答案
      if (generation.reasoningEffort !== 'off') {
        // OpenAI o 系列只接受 low / medium / high
        requestBody.reasoning_effort =
          generation.reasoningEffort === 'max' ? 'high' : generation.reasoningEffort
        if (generation.thinkingBudget > 0) requestBody.thinking_budget = generation.thinkingBudget
      }
    }
    if (extra.value) Object.assign(requestBody, extra.value)
    // 请求末尾返回真实 usage（部分厂商不支持，下面 400 兜底时会自动去掉）
    requestBody.stream_options = { include_usage: true }

    const send = (body: Record<string, unknown>): Promise<Response> =>
      fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal })

    let response: Response
    /** 400 时预读的响应体：用于判断是否是不支持 stream_options，最终报错时复用 */
    let prefetchedErrorBody = ''
    try {
      response = await send(requestBody)
      if (!response.ok && response.status === 400) {
        prefetchedErrorBody = await response.text().catch(() => '')
        // 仅当厂商明确拒绝 stream_options 时才去掉该字段重试，避免其它 400 重复请求
        if (/stream_options|include_usage/i.test(prefetchedErrorBody)) {
          delete requestBody.stream_options
          prefetchedErrorBody = ''
          response = await send(requestBody)
        }
      }
    } catch (error) {
      if ((error as Error)?.name === 'AbortError') {
        if (this.stopped) return { content: '', toolCalls: [], aborted: true }
        throw new LlmTransportError(
          t('LLM_REQUEST_TIMEOUT', { seconds: Math.round(RESPONSE_TIMEOUT / 1000) }),
          true,
        )
      }
      throw new LlmTransportError(
        t('LLM_REQUEST_FAILED', {
          message: error instanceof Error ? error.message : String(error),
        }),
        isNetworkError(error),
      )
    } finally {
      if (responseTimer) {
        clearTimeout(responseTimer)
        responseTimer = null
      }
    }

    if (!response.ok) {
      const bodyText = prefetchedErrorBody || (await response.text().catch(() => ''))
      const detail = bodyText ? `: ${bodyText.slice(0, 300)}` : ''
      throw new LlmTransportError(
        t('LLM_HTTP_ERROR', {
          status: response.status,
          statusText: response.statusText,
          detail,
        }),
        RETRYABLE_STATUS.has(response.status),
      )
    }
    if (!response.body) throw new Error(t('LLM_BODY_EMPTY'))

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let content = ''
    /** reasoning 模型的思考内容（不进入正文，仅用于诊断/回填） */
    let reasoning = ''
    /** 流结束原因：length 表示输出被 max_tokens 截断 */
    let finishReason: string | null = null
    /** 厂商返回的真实用量（启用 stream_options.include_usage 时出现在末尾分片） */
    let usage: LlmUsage | undefined
    /** index → 分片累积中的 tool call */
    const pending = new Map<number, { name: string; args: string; id: string }>()

    const handleData = (data: string): void => {
      if (!data || data === '[DONE]') return
      let chunk: LlmStreamChunk
      try {
        chunk = JSON.parse(data) as LlmStreamChunk
      } catch {
        return // 忽略无法解析的行
      }
      // 部分厂商在流内返回 { error: { message } }
      const streamError = (chunk as unknown as { error?: unknown }).error
      if (streamError) throw new LlmStreamError(extractProviderError(streamError))

      // usage 分片通常 choices 为空，需在读取 choice 之前处理
      if (chunk.usage) usage = chunk.usage
      const choice = chunk.choices?.[0]
      if (choice?.finish_reason) finishReason = choice.finish_reason
      const delta = choice?.delta
      if (!delta) return
      // reasoning_content（vLLM/DeepSeek）与 reasoning（部分厂商）都归入思考内容
      const reasoningDelta = delta.reasoning_content ?? delta.reasoning
      if (reasoningDelta) {
        reasoning += reasoningDelta
        onReasoning?.(reasoningDelta)
      }
      if (delta.content) {
        content += delta.content
        onDelta?.(delta.content)
      }
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const index = typeof tc.index === 'number' ? tc.index : 0
          const current = pending.get(index) ?? { name: '', args: '', id: '' }
          if (tc.id) current.id = tc.id
          if (tc.function?.name) current.name += tc.function.name
          if (tc.function?.arguments) current.args += tc.function.arguments
          pending.set(index, current)
        }
      }
    }

    /** SSE 帧解析：支持 event: error，data 行统一交给 handleData */
    let eventName = ''
    const consumeLines = (lines: string[]): void => {
      for (const rawLine of lines) {
        const line = rawLine.trim()
        if (!line) {
          eventName = ''
          continue
        }
        if (line.startsWith(':')) continue
        if (line.startsWith('event:')) {
          eventName = line.slice(6).trim()
          continue
        }
        if (!line.startsWith('data:')) continue
        const data = line.slice(5).trim()
        if (eventName === 'error') throw new LlmStreamError(extractProviderError(data))
        handleData(data)
        eventName = ''
      }
    }

    let idleTimer: ReturnType<typeof setTimeout> | null = null
    const resetIdle = (): void => {
      if (idleTimer) clearTimeout(idleTimer)
      idleTimer = setTimeout(() => controller.abort(), IDLE_TIMEOUT)
    }

    try {
      resetIdle()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        resetIdle()
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? '' // 末段可能不完整，留到下一轮
        consumeLines(lines)
      }
      // 处理流末尾未换行的剩余数据
      const rest = buffer.trim()
      if (rest.startsWith('data:')) consumeLines([rest])
    } catch (error) {
      if ((error as Error)?.name === 'AbortError') {
        if (this.stopped) {
          return { content, toolCalls: collectPending(pending), reasoning, finishReason, aborted: true }
        }
        throw new LlmStreamError(
          t('LLM_STREAM_TIMEOUT', { seconds: Math.round(IDLE_TIMEOUT / 1000) }),
        )
      }
      if (error instanceof LlmStreamError) throw error
      throw new Error(
        t('LLM_STREAM_READ_FAILED', {
          message: error instanceof Error ? error.message : String(error),
        }),
      )
    } finally {
      if (idleTimer) {
        clearTimeout(idleTimer)
        idleTimer = null
      }
      // 提前退出（流内错误 / abort）时释放底层连接
      void reader.cancel().catch(() => undefined)
    }

    return { content, toolCalls: collectPending(pending), reasoning, finishReason, usage }
  }
}

/** 按 index 顺序汇总累积的 tool_calls（丢弃无名称的残缺项） */
function collectPending(pending: Map<number, { name: string; args: string; id: string }>): StreamToolCall[] {
  return Array.from(pending.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([, value]) => ({ name: value.name, args: value.args, id: value.id || undefined }))
    .filter((call) => call.name.length > 0)
}

export const llmService = new LLMService()
