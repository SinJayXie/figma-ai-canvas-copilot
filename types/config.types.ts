/**
 * 插件配置类型（存储于 figma.clientStorage，全局共享）
 * 默认值依据 PRD 第 6 章设置模块设计
 */

/** off = 关闭思考模式（不发送 reasoning 参数），直接输出答案 */
export type ReasoningEffort = 'off' | 'low' | 'medium' | 'high' | 'max'

export type SendKey = 'enter' | 'ctrl-enter'

/** 内置服务商 id（custom 表示完全自定义的 OpenAI 兼容地址） */
export type ProviderId =
  | 'deepseek'
  | 'openai'
  | 'moonshot'
  | 'zhipu'
  | 'qwen'
  | 'siliconflow'
  | 'openrouter'
  | 'groq'
  | 'mistral'
  | 'xai'
  | 'gemini'
  | 'ollama'
  | 'custom'

/** 服务商预设：默认地址、常用模型、是否需要 API Key */
export interface ProviderPreset {
  id: ProviderId
  name: string
  /** Base URL（不含 /chat/completions） */
  baseUrl: string
  /** 常用模型 id，供输入框联想 */
  models: string[]
  /** 本地/自建服务可以不需要 Key */
  requiresApiKey: boolean
  /** 控制台/API Key 申请地址 */
  docsUrl?: string
  description: string
}

/** 单模型独立的生成参数 */
export interface GenerationParams {
  temperature: number
  topP: number
  topK: number
  maxTokens: number
  presencePenalty: number
  frequencyPenalty: number
  repetitionPenalty: number
  seed: number | null
  stop: string[]
  parallelToolCalls: boolean
  thinkingBudget: number
  extraBody: string
  thinkingMode: boolean
  reasoningEffort: ReasoningEffort
  /** 上下文窗口（输入侧 Token），null 表示留空使用最佳默认值（用于历史截断预算） */
  contextInput: number | null
  /** 单模型独立的工具调用轮数上限（1~500） */
  toolRounds: number
  /** 是否支持图片输入（不支持时附件图片不进入请求） */
  supportsImage: boolean
}

/** 默认生成参数（新增模型 / 迁移兜底） */
export const DEFAULT_GENERATION: GenerationParams = {
  temperature: 0.7,
  topP: 1,
  topK: 0,
  maxTokens: 4096,
  presencePenalty: 0,
  frequencyPenalty: 0,
  repetitionPenalty: 0,
  seed: null,
  stop: [],
  parallelToolCalls: true,
  thinkingBudget: 0,
  extraBody: '',
  thinkingMode: false,
  reasoningEffort: 'high',
  contextInput: null,
  toolRounds: 500,
  supportsImage: true
}

/** 单个模型配置：服务商、API 地址、密钥、生成参数彼此独立 */
export interface ModelEntry {
  /** 稳定 id，用于选中与持久化 */
  id: string
  /** 设置页展示名称 */
  name: string
  /** 服务商预设 id */
  provider: ProviderId
  /** 请求体里的 model 值，如 deepseek-chat */
  model: string
  /** 该模型独立使用的 Base URL（不含 /chat/completions） */
  baseUrl: string
  /** 该模型独立使用的 API Key */
  apiKey: string
  /** 该模型独立的生成参数（切换模型互不影响） */
  generation: GenerationParams
}

/** 用户自定义快捷指令 */
export interface QuickCommandConfig {
  /** 指令名，以 / 开头，如 /骨架 */
  label: string
  /** 候选列表中的说明 */
  description: string
  /** 选中后填入输入框的提示词模板 */
  prompt: string
}

export interface PluginConfig {
  /** 当前使用模型的 API id（由 activeModelId 派生，保留用于兼容旧代码） */
  model: string
  /** 模型列表（至少 1 个，每个模型独立 API 地址 / 密钥） */
  models: ModelEntry[]
  /** 当前使用模型的条目 id */
  activeModelId: string
  /** JSON 解析失败自动重试次数 0~3 */
  autoRetry: number
  /** 用户自定义追加提示词（拼接在默认系统提示词之后） */
  customPrompt: string
  /** 生成后自动应用到画布 */
  autoApply: boolean
  /** 任务模式：分步生成，首次应用后自动继续（仅在任务范围内改动画布） */
  taskMode: boolean
  /** 跟随 Figma 系统主题 */
  followTheme: boolean
  /** 发送快捷键 */
  sendKey: SendKey
  /** 用户自定义快捷指令（与内置指令合并，同名覆盖内置） */
  customCommands: QuickCommandConfig[]
}

/** 默认模型条目 id（迁移旧配置时也用它） */
export const DEFAULT_MODEL_ID = 'model-default'

/** 内置服务商（顺序即设置页展示顺序） */
export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    requiresApiKey: true,
    docsUrl: 'https://platform.deepseek.com/api_keys',
    description: '官方 API，支持思考模型'
  },
  {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    models: ['gpt-4o', 'gpt-4o-mini', 'o3-mini'],
    requiresApiKey: true,
    docsUrl: 'https://platform.openai.com/api-keys',
    description: 'GPT / o 系列官方接口'
  },
  {
    id: 'moonshot',
    name: 'Kimi / Moonshot',
    baseUrl: 'https://api.moonshot.cn/v1',
    models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'kimi-latest'],
    requiresApiKey: true,
    docsUrl: 'https://platform.moonshot.cn/console/api-keys',
    description: '月之暗面 Kimi'
  },
  {
    id: 'zhipu',
    name: '智谱 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    models: ['glm-4-plus', 'glm-4-air', 'glm-4-flash'],
    requiresApiKey: true,
    docsUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
    description: 'GLM-4 系列'
  },
  {
    id: 'qwen',
    name: '通义千问',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: ['qwen-plus', 'qwen-max', 'qwen-turbo'],
    requiresApiKey: true,
    docsUrl: 'https://bailian.console.aliyun.com/',
    description: '阿里云百炼兼容模式'
  },
  {
    id: 'siliconflow',
    name: '硅基流动',
    baseUrl: 'https://api.siliconflow.cn/v1',
    models: ['deepseek-ai/DeepSeek-V3', 'Qwen/Qwen2.5-72B-Instruct'],
    requiresApiKey: true,
    docsUrl: 'https://cloud.siliconflow.cn/account/ak',
    description: '多模型聚合平台'
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    models: ['openai/gpt-4o', 'anthropic/claude-3.5-sonnet', 'google/gemini-2.0-flash'],
    requiresApiKey: true,
    docsUrl: 'https://openrouter.ai/keys',
    description: '聚合多家海外模型'
  },
  {
    id: 'groq',
    name: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    models: ['llama-3.3-70b-versatile', 'mixtral-8x7b-32768'],
    requiresApiKey: true,
    docsUrl: 'https://console.groq.com/keys',
    description: '低延迟推理'
  },
  {
    id: 'mistral',
    name: 'Mistral',
    baseUrl: 'https://api.mistral.ai/v1',
    models: ['mistral-large-latest', 'mistral-small-latest'],
    requiresApiKey: true,
    docsUrl: 'https://console.mistral.ai/api-keys/',
    description: 'Mistral 官方 API'
  },
  {
    id: 'xai',
    name: 'xAI Grok',
    baseUrl: 'https://api.x.ai/v1',
    models: ['grok-2-latest', 'grok-beta'],
    requiresApiKey: true,
    docsUrl: 'https://console.x.ai/',
    description: 'Grok 系列'
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    models: ['gemini-2.0-flash', 'gemini-1.5-pro'],
    requiresApiKey: true,
    docsUrl: 'https://aistudio.google.com/app/apikey',
    description: 'Gemini OpenAI 兼容接口'
  },
  {
    id: 'ollama',
    name: 'Ollama（本地）',
    baseUrl: 'http://localhost:11434/v1',
    models: ['llama3.1', 'qwen2.5', 'deepseek-r1'],
    requiresApiKey: false,
    description: '本地模型，通常无需 Key'
  },
  {
    id: 'custom',
    name: '自定义',
    baseUrl: '',
    models: [],
    requiresApiKey: false,
    description: '任意 OpenAI 兼容地址'
  }
]

const PROVIDER_IDS = new Set<string>(PROVIDER_PRESETS.map((preset) => preset.id))

export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === 'string' && PROVIDER_IDS.has(value)
}

/** 按 Base URL 反推服务商（旧配置迁移 / 用户手填地址） */
export function inferProvider(baseUrl: string): ProviderId {
  const url = (baseUrl ?? '').trim().toLowerCase()
  if (!url) return 'custom'
  for (const preset of PROVIDER_PRESETS) {
    if (preset.baseUrl && url.startsWith(preset.baseUrl.toLowerCase())) return preset.id
  }
  if (url.includes('deepseek')) return 'deepseek'
  if (url.includes('openai.azure') || url.includes('openai.com')) return 'openai'
  if (url.includes('moonshot') || url.includes('kimi')) return 'moonshot'
  if (url.includes('bigmodel')) return 'zhipu'
  if (url.includes('dashscope') || url.includes('aliyun')) return 'qwen'
  if (url.includes('siliconflow')) return 'siliconflow'
  if (url.includes('openrouter')) return 'openrouter'
  if (url.includes('groq')) return 'groq'
  if (url.includes('mistral')) return 'mistral'
  if (url.includes('x.ai')) return 'xai'
  if (url.includes('generativelanguage')) return 'gemini'
  if (url.includes('localhost') || url.includes('127.0.0.1')) return 'ollama'
  return 'custom'
}

export function getProviderPreset(id: ProviderId | string): ProviderPreset {
  return (
    PROVIDER_PRESETS.find((preset) => preset.id === id) ??
    PROVIDER_PRESETS[PROVIDER_PRESETS.length - 1]
  )
}

/** 去掉末尾斜杠，统一 Base URL 形态 */
export function normalizeBaseUrl(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/\/+$/, '') : ''
}

export const DEFAULT_CONFIG: PluginConfig = {
  model: '',
  models: [
    {
      id: DEFAULT_MODEL_ID,
      // 首次使用不预置任何模型，由用户在设置页自行填写
      name: '',
      provider: 'custom',
      model: '',
      baseUrl: '',
      apiKey: '',
      generation: { ...DEFAULT_GENERATION, stop: [] }
    }
  ],
  activeModelId: DEFAULT_MODEL_ID,
  autoRetry: 1,
  customPrompt: '',
  autoApply: false,
  taskMode: false,
  followTheme: true,
  sendKey: 'enter',
  customCommands: []
}

/** 深拷贝配置，避免默认值里的数组 / 嵌套对象被 UI 直接修改 */
export function cloneConfig(config: PluginConfig): PluginConfig {
  return {
    ...config,
    models: config.models.map((entry) => ({
      ...entry,
      generation: {
        ...(entry.generation ?? DEFAULT_GENERATION),
        stop: [...(entry.generation?.stop ?? [])]
      }
    })),
    customCommands: (config.customCommands ?? []).map((command) => ({ ...command }))
  }
}

/** 自定义指令数量与字段长度上限 */
const COMMAND_LIMIT = 20
const COMMAND_LABEL_LIMIT = 20
const COMMAND_DESCRIPTION_LIMIT = 40
const COMMAND_PROMPT_LIMIT = 2000

/** 归一化自定义指令：补 / 前缀、去空白、去空项、去重、限长 */
function normalizeCustomCommands(raw: unknown): QuickCommandConfig[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const list: QuickCommandConfig[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const command = item as Partial<QuickCommandConfig>
    if (typeof command.label !== 'string') continue
    let label = command.label.trim().replace(/\s+/g, '')
    if (!label) continue
    if (!label.startsWith('/')) label = `/${label}`
    label = label.slice(0, COMMAND_LABEL_LIMIT)
    if (label === '/' || seen.has(label)) continue

    const prompt = typeof command.prompt === 'string' ? command.prompt.trim().slice(0, COMMAND_PROMPT_LIMIT) : ''
    if (!prompt) continue

    seen.add(label)
    list.push({
      label,
      description:
        typeof command.description === 'string'
          ? command.description.trim().slice(0, COMMAND_DESCRIPTION_LIMIT)
          : '',
      prompt
    })
    if (list.length >= COMMAND_LIMIT) break
  }
  return list
}

function isValidModelEntry(
  value: unknown
): value is {
  id: string
  name?: unknown
  provider?: unknown
  model?: unknown
  baseUrl?: unknown
  apiKey?: unknown
  generation?: unknown
} {
  if (!value || typeof value !== 'object') return false
  return typeof (value as { id?: unknown }).id === 'string'
}

/** 数值参数限幅（非法值回退默认） */
function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const num = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(num) ? Math.min(max, Math.max(min, num)) : fallback
}

/** 整数参数限幅 */
function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  return Math.round(clampNumber(value, min, max, fallback))
}

/** 推理强度只允许固定枚举 */
function normalizeReasoningEffort(value: unknown): ReasoningEffort {
  return value === 'off' || value === 'low' || value === 'medium' || value === 'high' || value === 'max'
    ? value
    : DEFAULT_GENERATION.reasoningEffort
}

/** 生成参数归一化：限幅 + 兜底默认值 */
export function normalizeGeneration(raw?: unknown): GenerationParams {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Partial<GenerationParams>
  return {
    temperature: clampNumber(source.temperature, 0, 2, DEFAULT_GENERATION.temperature),
    topP: clampNumber(source.topP, 0, 1, DEFAULT_GENERATION.topP),
    topK: clampInt(source.topK, 0, 100, DEFAULT_GENERATION.topK),
    maxTokens: clampInt(source.maxTokens, 1, 131072, DEFAULT_GENERATION.maxTokens),
    presencePenalty: clampNumber(
      source.presencePenalty,
      -2,
      2,
      DEFAULT_GENERATION.presencePenalty
    ),
    frequencyPenalty: clampNumber(
      source.frequencyPenalty,
      -2,
      2,
      DEFAULT_GENERATION.frequencyPenalty
    ),
    repetitionPenalty: clampNumber(
      source.repetitionPenalty,
      0,
      2,
      DEFAULT_GENERATION.repetitionPenalty
    ),
    seed:
      source.seed === null || source.seed === undefined
        ? null
        : clampInt(source.seed, 0, 2147483647, 0),
    stop: Array.isArray(source.stop)
      ? source.stop
          .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
          .map((item) => item.trim())
          .slice(0, 4)
      : [],
    parallelToolCalls: source.parallelToolCalls !== false,
    thinkingBudget: clampInt(source.thinkingBudget, 0, 131072, DEFAULT_GENERATION.thinkingBudget),
    extraBody: typeof source.extraBody === 'string' ? source.extraBody : '',
    thinkingMode: source.thinkingMode === true,
    reasoningEffort: normalizeReasoningEffort(source.reasoningEffort),
    contextInput:
      source.contextInput === null || source.contextInput === undefined
        ? null
        : clampInt(source.contextInput, 1024, 1048576, 131072),
    toolRounds: clampInt(source.toolRounds, 1, 500, DEFAULT_GENERATION.toolRounds),
    supportsImage: source.supportsImage !== false
  }
}

/** 解析"额外请求体"JSON：空字符串视为未配置，仅允许对象 */
export function parseExtraBody(raw: string):
  | { ok: true; value?: Record<string, unknown> }
  | { ok: false; error: string } {
  const text = (raw ?? '').trim()
  if (!text) return { ok: true }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'JSON 解析失败' }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: '必须是 JSON 对象（{ ... }）' }
  }
  return { ok: true, value: parsed as Record<string, unknown> }
}

/**
 * 配置归一化（读取旧版本 / 损坏数据时调用）：
 * - 旧版本全局 baseUrl / apiKey / model → 迁移到单条模型记录
 * - 旧版本全局生成参数 → 迁移到每个模型（新格式 per-model 值优先）
 * - 模型条目缺少 baseUrl / apiKey → 用旧版全局值或服务商预设补齐
 * - 补齐 activeModelId，并同步兼容字段 model
 * - 过滤空条目 / 重复 id，保证至少一条
 */
export function normalizeConfig(raw?: Partial<PluginConfig> | null): PluginConfig {
  if (!raw) return cloneConfig(DEFAULT_CONFIG)

  // 旧版本全局字段（已从类型中移除，仅用于迁移）
  const legacy = raw as Partial<{
    baseUrl: string
    apiKey: string
  }>
  const legacyBaseUrl = normalizeBaseUrl(legacy.baseUrl)
  const legacyApiKey = typeof legacy.apiKey === 'string' ? legacy.apiKey : ''
  // 旧版全局生成参数：作为每个模型的迁移兜底
  const legacyParams = raw as Partial<GenerationParams>

  const merged: PluginConfig = { ...cloneConfig(DEFAULT_CONFIG), ...raw }
  const seenIds = new Set<string>()
  const models: ModelEntry[] = []
  const rawModels = Array.isArray(raw.models) ? raw.models : []

  for (const item of rawModels) {
    if (!isValidModelEntry(item)) continue
    const id = item.id.trim()
    if (!id || seenIds.has(id)) continue

    const model = typeof item.model === 'string' ? item.model.trim() : ''
    const rawBaseUrl = normalizeBaseUrl(item.baseUrl)
    const baseUrl = rawBaseUrl || legacyBaseUrl
    const provider = isProviderId(item.provider)
      ? item.provider
      : inferProvider(baseUrl)
    const preset = getProviderPreset(provider)
    const name = typeof item.name === 'string' ? item.name.trim() : ''
    // 允许 model 为空：设置页新增模型时尚未填写，不应在归一化时被丢弃
    if (!name && !model) continue

    const rawGeneration =
      item.generation && typeof item.generation === 'object'
        ? (item.generation as Partial<GenerationParams>)
        : {}

    seenIds.add(id)
    models.push({
      id,
      name: name || model || preset.name,
      provider,
      model,
      baseUrl: baseUrl || preset.baseUrl,
      apiKey: typeof item.apiKey === 'string' ? item.apiKey : legacyApiKey,
      // 新字段优先，旧全局参数作为兜底
      generation: normalizeGeneration({ ...legacyParams, ...rawGeneration })
    })
  }

  // 旧配置迁移：没有可用模型时用 model / 全局 API 配置兜底（都没有则留空条目，等用户填写）
  if (models.length === 0) {
    const model = typeof merged.model === 'string' && merged.model.trim()
      ? merged.model.trim()
      : DEFAULT_CONFIG.model
    const baseUrl = legacyBaseUrl
    models.push({
      id: DEFAULT_MODEL_ID,
      name: model,
      provider: inferProvider(baseUrl),
      model,
      baseUrl,
      apiKey: legacyApiKey,
      generation: normalizeGeneration(legacyParams)
    })
  }

  const active =
    models.find((entry) => entry.id === merged.activeModelId) ??
    models.find((entry) => entry.model === merged.model) ??
    models[0]

  // 丢弃旧版全局字段（含已迁移到模型的生成参数），避免迁移后继续落盘
  const result = merged as PluginConfig & {
    baseUrl?: string
    apiKey?: string
    maxToolRounds?: number
    temperature?: number
    topP?: number
    topK?: number
    maxTokens?: number
    presencePenalty?: number
    frequencyPenalty?: number
    repetitionPenalty?: number
    seed?: number | null
    stop?: string[]
    parallelToolCalls?: boolean
    thinkingBudget?: number
    extraBody?: string
    thinkingMode?: boolean
    reasoningEffort?: ReasoningEffort
  }
  delete result.baseUrl
  delete result.apiKey
  delete result.maxToolRounds
  delete result.temperature
  delete result.topP
  delete result.topK
  delete result.maxTokens
  delete result.presencePenalty
  delete result.frequencyPenalty
  delete result.repetitionPenalty
  delete result.seed
  delete result.stop
  delete result.parallelToolCalls
  delete result.thinkingBudget
  delete result.extraBody
  delete result.thinkingMode
  delete result.reasoningEffort

  return {
    ...result,
    models,
    activeModelId: active.id,
    model: active.model,
    taskMode: result.taskMode === true,
    customCommands: normalizeCustomCommands(result.customCommands)
  }
}

/** 当前使用的模型条目（配置已归一化，列表至少一条） */
export function resolveActiveModelEntry(
  config: Pick<PluginConfig, 'model' | 'models' | 'activeModelId'>
): ModelEntry {
  return (
    config.models?.find((entry) => entry.id === config.activeModelId) ??
    config.models?.[0] ?? {
      id: '',
      name: '',
      provider: 'custom',
      model: '',
      baseUrl: '',
      apiKey: '',
      generation: { ...DEFAULT_GENERATION, stop: [] }
    }
  )
}

/** 当前模型的生成参数 */
export function resolveGeneration(
  config: Pick<PluginConfig, 'model' | 'models' | 'activeModelId'>
): GenerationParams {
  return resolveActiveModelEntry(config).generation
}

/** 复制配置并覆盖当前模型的生成参数（任务续跑等临时覆盖，不影响其它模型） */
export function withActiveGeneration(
  config: PluginConfig,
  patch: Partial<GenerationParams>
): PluginConfig {
  const activeId = resolveActiveModelEntry(config).id
  return {
    ...config,
    models: config.models.map((entry) =>
      entry.id === activeId
        ? { ...entry, generation: { ...entry.generation, ...patch } }
        : entry
    )
  }
}

/** 当前真正用于请求的 model 值（空列表 / 空值时有兜底） */
export function resolveActiveModel(
  config: Pick<PluginConfig, 'model' | 'models' | 'activeModelId'>
): string {
  return resolveActiveModelEntry(config).model.trim()
}
