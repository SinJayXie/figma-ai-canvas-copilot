/**
 * Tool Call 参数解析与校验容错（DEV.md 6.3、6.4，原生 Tool Call 方案）
 * - 解析 llm.service 返回的 tool_calls（create_ops / update_ops），JSON.parse arguments
 * - Zod 宽松 Schema 校验：非法字段 .catch 补默认值、未知字段 strip、children 递归
 * - normalizeOps 兜底：无 layout → mode 'none'、frame 无宽高 → 375x812、rect/ellipse 无填充 → 白色等
 * - 校验失败返回结构化错误信息（供 Agent 拼入重试消息）
 */
import { z } from 'zod'
import type { LlmToolCall } from '../../../types/llm.types'
import type { NodeLayout, NodeOp, NodeType, TextAutoResize } from '../../../types/node.types'

/** 单次生成节点总数上限（PRD 5.2.1 约束） */
export const MAX_NODE_COUNT = 300

/** layout 缺省值（无 layout → mode 'none'） */
export const DEFAULT_LAYOUT: NodeLayout = {
  mode: 'none',
  gap: 0,
  padding: [0, 0, 0, 0],
  alignItems: 'stretch',
  justifyContent: 'flex-start',
}

const NODE_TYPE_NAMES: Record<NodeType, string> = {
  frame: 'Frame',
  text: '文本',
  rect: '矩形',
  ellipse: '圆形',
  line: '线条',
}

/** 模型输出的节点类型别名归一化（如 rectangle→rect、circle→ellipse） */
const TYPE_ALIASES: Record<string, NodeType> = {
  rectangle: 'rect',
  rounded_rectangle: 'rect',
  box: 'rect',
  shape: 'rect',
  circle: 'ellipse',
  oval: 'ellipse',
  textbox: 'text',
  label: 'text',
  paragraph: 'text',
  container: 'frame',
  div: 'frame',
  group: 'frame',
  canvas: 'frame',
}

function normalizeNodeType(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const key = value.trim().toLowerCase() as NodeType
  return TYPE_ALIASES[key] ?? key
}

/** NodeOp 短 key 别名（紧凑写法，减少模型输出整页 JSON 的体积） */
const NODE_KEY_ALIASES: Record<string, string> = {
  t: 'type',
  n: 'name',
  w: 'width',
  h: 'height',
  f: 'fill',
  bg: 'fill',
  s: 'stroke',
  sw: 'strokeWeight',
  r: 'cornerRadius',
  radius: 'cornerRadius',
  c: 'children',
  l: 'layout',
  fs: 'fontSize',
  fw: 'fontWeight',
  tc: 'textColor',
  ff: 'fontFamily',
  txt: 'textContent',
  text: 'textContent',
  ls: 'layoutSizing',
}

/** layout 子字段别名 */
const LAYOUT_KEY_ALIASES: Record<string, string> = {
  m: 'mode',
  g: 'gap',
  p: 'padding',
  pad: 'padding',
  a: 'alignItems',
  j: 'justifyContent',
  sz: 'sizing',
  cas: 'counterAxisSpacing',
}

/** 允许写在节点顶层、随后并入 layout 的字段（避免多一层嵌套） */
const TOP_LEVEL_LAYOUT_KEYS = new Set([
  'mode',
  'gap',
  'padding',
  'alignItems',
  'justifyContent',
  'sizing',
  'wrap',
  'counterAxisSpacing',
  'm',
  'g',
  'p',
  'pad',
  'a',
  'j',
  'sz',
  'cas',
])

function normalizeLayoutInput(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  const result: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    result[LAYOUT_KEY_ALIASES[key] ?? key] = item
  }
  return result
}

/**
 * 紧凑 NodeOp 归一化（zod 校验前执行）：
 * - 短 key → 完整字段（t/n/w/h/f/r/c/l/fs/fw/tc/txt ...）
 * - 顶层布局字段（mode/gap/padding/...）自动并入 layout
 * - create 缺省 type 时按内容推断：有 txt/textContent → text，有 children → frame
 */
export function normalizeCompactNodeOp(input: unknown): unknown {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input
  const source = input as Record<string, unknown>
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(source)) {
    const canonical = NODE_KEY_ALIASES[key] ?? key
    result[canonical] = canonical === 'layout' ? normalizeLayoutInput(value) : value
  }

  const topLevelLayout: Record<string, unknown> = {}
  for (const key of TOP_LEVEL_LAYOUT_KEYS) {
    if (!(key in source)) continue
    topLevelLayout[LAYOUT_KEY_ALIASES[key] ?? key] = source[key]
  }
  if (Object.keys(topLevelLayout).length > 0) {
    const nested =
      result.layout && typeof result.layout === 'object' && !Array.isArray(result.layout)
        ? (result.layout as Record<string, unknown>)
        : {}
    result.layout = { ...topLevelLayout, ...nested }
  }

  if (result.type == null && (result.action ?? 'create') !== 'update') {
    if (result.textContent != null) result.type = 'text'
    else if (Array.isArray(result.children)) result.type = 'frame'
  }
  return result
}

/** padding：4 元组 / 单数字（四边统一）/ 2 元组（上下、左右），非法回退 [0,0,0,0] */
const paddingSchema = z
  .union([
    z.tuple([z.coerce.number(), z.coerce.number(), z.coerce.number(), z.coerce.number()]),
    z.coerce.number().transform((n): [number, number, number, number] => [n, n, n, n]),
    z
      .tuple([z.coerce.number(), z.coerce.number()])
      .transform(([a, b]): [number, number, number, number] => [a, b, a, b]),
  ])
  .catch([0, 0, 0, 0] as [number, number, number, number])

const layoutSchema = z
  .object({
    // 各字段保持「可选」：update 时未提供的属性不改动现有值
    mode: z.enum(['vertical', 'horizontal', 'none']).optional().catch(undefined),
    gap: z.coerce.number().optional().catch(undefined),
    padding: paddingSchema.optional().catch(undefined),
    alignItems: z.string().optional().catch(undefined),
    justifyContent: z.string().optional().catch(undefined),
    sizing: z
      .object({
        horizontal: z.enum(['fixed', 'hug']).optional().catch(undefined),
        vertical: z.enum(['fixed', 'hug']).optional().catch(undefined),
      })
      .optional()
      .catch(undefined),
    wrap: z.boolean().optional().catch(undefined),
    counterAxisSpacing: z.coerce.number().optional().catch(undefined),
  })
  .optional()
  .catch(undefined)

/**
 * 宽松版 NodeOp Schema：
 * - 非法/缺失字段由 .catch 补默认值（永远不会 parse 失败）
 * - z.object 默认 strip 未知字段
 * - children 通过 z.lazy 自引用递归；单个子节点非法时置 null 并在 transform 中剔除
 */
export const nodeOpSchema: z.ZodType<NodeOp, z.ZodTypeDef, unknown> = z.lazy(() =>
  z.preprocess(
    normalizeCompactNodeOp,
    z.object({
    action: z.enum(['create', 'update']).catch('create'),
    id: z.string().catch(''),
    type: z
      .preprocess(normalizeNodeType, z.enum(['frame', 'text', 'rect', 'ellipse', 'line']).catch('frame')),
    name: z.string().catch(''),
    parent: z
      .union([z.string(), z.null()])
      .optional()
      .transform((v) => (typeof v === 'string' && v.trim() ? v.trim() : undefined))
      .catch(undefined),
    position: z.enum(['auto', 'absolute']).catch('auto'),
    insertAfter: z
      .union([z.string(), z.null()])
      .optional()
      .transform((v) => (typeof v === 'string' && v.trim() ? v.trim() : undefined))
      .catch(undefined),
    insertBefore: z
      .union([z.string(), z.null()])
      .optional()
      .transform((v) => (typeof v === 'string' && v.trim() ? v.trim() : undefined))
      .catch(undefined),
    x: z.coerce.number().catch(0),
    y: z.coerce.number().catch(0),
    width: z.coerce.number().catch(0),
    height: z.coerce.number().catch(0),
    fill: z.string().optional().catch(undefined),
    cornerRadius: z.coerce.number().catch(0),
    stroke: z.string().nullable().catch(null),
    strokeWeight: z.coerce.number().catch(0),
    fills: z.array(z.any()).optional().catch(undefined),
    opacity: z.coerce.number().min(0).max(1).optional().catch(undefined),
    blendMode: z.string().optional().catch(undefined),
    cornerRadii: z
      .object({
        topLeft: z.coerce.number().optional(),
        topRight: z.coerce.number().optional(),
        bottomRight: z.coerce.number().optional(),
        bottomLeft: z.coerce.number().optional(),
      })
      .optional()
      .catch(undefined),
    effects: z.array(z.any()).optional().catch(undefined),
    strokeAlign: z.enum(['INSIDE', 'OUTSIDE', 'CENTER']).optional().catch(undefined),
    strokeWeights: z
      .object({
        top: z.coerce.number().optional(),
        right: z.coerce.number().optional(),
        bottom: z.coerce.number().optional(),
        left: z.coerce.number().optional(),
      })
      .optional()
      .catch(undefined),
    dashPattern: z.array(z.coerce.number()).optional().catch(undefined),
    fillStyleId: z.string().optional().catch(undefined),
    strokeStyleId: z.string().optional().catch(undefined),
    textStyleId: z.string().optional().catch(undefined),
    effectStyleId: z.string().optional().catch(undefined),
    layout: layoutSchema,
    textContent: z.string().nullable().catch(null),
    fontSize: z.coerce.number().catch(16),
    fontWeight: z.coerce.number().catch(400),
    textColor: z.string().catch('#111111'),
    fontFamily: z
      .union([z.string(), z.null()])
      .optional()
      .transform((v) => (typeof v === 'string' && v.trim() ? v.trim() : undefined))
      .catch(undefined),
    textAutoResize: z
      .union([z.string(), z.null()])
      .optional()
      .transform((v): TextAutoResize | undefined => {
        const s = typeof v === 'string' ? v.trim().toUpperCase() : ''
        return s === 'NONE' || s === 'WIDTH_AND_HEIGHT' || s === 'HEIGHT' || s === 'TRUNCATE'
          ? (s as TextAutoResize)
          : undefined
      })
      .catch(undefined),
    lineHeight: z.coerce.number().optional().catch(undefined),
    letterSpacing: z.coerce.number().optional().catch(undefined),
    paragraphSpacing: z.coerce.number().optional().catch(undefined),
    textAlignHorizontal: z.enum(['LEFT', 'CENTER', 'RIGHT', 'JUSTIFIED']).optional().catch(undefined),
    textAlignVertical: z.enum(['TOP', 'CENTER', 'BOTTOM']).optional().catch(undefined),
    textCase: z.enum(['ORIGINAL', 'UPPER', 'LOWER', 'TITLE']).optional().catch(undefined),
    textDecoration: z.enum(['NONE', 'UNDERLINE', 'STRIKETHROUGH']).optional().catch(undefined),
    textTruncation: z.enum(['DISABLED', 'ENDING']).optional().catch(undefined),
    maxLines: z.coerce.number().int().positive().optional().catch(undefined),
    layoutSizing: z
      .object({
        horizontal: z.enum(['fixed', 'hug', 'fill']).optional().catch(undefined),
        vertical: z.enum(['fixed', 'hug', 'fill']).optional().catch(undefined),
      })
      .optional()
      .catch(undefined),
    layoutPositioning: z.enum(['AUTO', 'ABSOLUTE']).optional().catch(undefined),
    minWidth: z.coerce.number().optional().catch(undefined),
    maxWidth: z.coerce.number().optional().catch(undefined),
    minHeight: z.coerce.number().optional().catch(undefined),
    maxHeight: z.coerce.number().optional().catch(undefined),
    constraints: z
      .object({
        horizontal: z.enum(['MIN', 'MAX', 'CENTER', 'STRETCH', 'SCALE']),
        vertical: z.enum(['MIN', 'MAX', 'CENTER', 'STRETCH', 'SCALE']),
      })
      .optional()
      .catch(undefined),
    layoutGrids: z.array(z.any()).optional().catch(undefined),
    clipsContent: z.boolean().optional().catch(undefined),
    isMask: z.boolean().optional().catch(undefined),
    maskType: z.enum(['ALPHA', 'VECTOR', 'LUMINANCE']).optional().catch(undefined),
    children: z
      .array(z.lazy(() => nodeOpSchema).nullable().catch(null))
      .nullish()
      .transform((value) => (value ?? []).filter((child): child is NodeOp => child !== null))
      .catch([]),
    }),
  ),
)

/** ops 数组 Schema：单个元素非法时剔除（置 null 后过滤），整体非数组由 safeParse 捕获 */
export const opsArraySchema = z
  .array(nodeOpSchema.nullable().catch(null))
  .transform((value) => value.filter((op): op is NodeOp => op !== null))

/** 解析入参：兼容 llm.service 的 {name,args} 与 llm.types 的 LlmToolCall 两种形态 */
export type ToolCallInput = { name: string; args: string }

export type ParseSuccess = { kind: 'create' | 'update'; ops: NodeOp[] }
export type ParseFailure = { error: string }
export type ParseResult = ParseSuccess | ParseFailure

let idSeq = 0
function generateId(): string {
  idSeq += 1
  return `n_${Date.now().toString(36)}_${idSeq}`
}

function trimMessage(text: string): string {
  return String(text).replace(/\s+/g, ' ').trim().slice(0, 200)
}

/** 重试提示包装：标注第几次尝试，便于 Agent 拼入重试消息 */
function withHint(error: string, retryLevel: number): ParseFailure {
  return { error: retryLevel > 0 ? `${error}（第 ${retryLevel + 1} 次尝试）` : error }
}

function toInput(call: LlmToolCall | ToolCallInput): ToolCallInput {
  if ('function' in call && call.function && typeof call.function === 'object') {
    return { name: call.function?.name ?? '', args: call.function?.arguments ?? '' }
  }
  return { name: (call as ToolCallInput).name ?? '', args: (call as ToolCallInput).args ?? '' }
}

/** 递归统计节点总数（含 children） */
function countNodes(ops: NodeOp[]): number {
  let count = 0
  const walk = (op: NodeOp): void => {
    count++
    for (const child of op.children) walk(child)
  }
  for (const op of ops) walk(op)
  return count
}

/**
 * 兜底规范化：
 * - create：补齐缺失/非法字段的默认值（frame 无宽高 → 375x812、text 缺内容 → '' 等）
 * - update：见 CREATE_ONLY_DEFAULTS，未显式提供的字段会被移除
 */
/** update 操作里由 create 默认值兜底的字段：模型未显式给出时不得覆盖画布现值 */
const CREATE_ONLY_DEFAULTS = [
  'parent',
  'position',
  'x',
  'y',
  'width',
  'height',
  'fill',
  'cornerRadius',
  'stroke',
  'strokeWeight',
  'layout',
  'textContent',
  'fontSize',
  'fontWeight',
  'textColor',
] as const

/**
 * 兜底规范化：
 * - create：补齐缺失/非法字段默认值（frame 无宽高 → 375x812，text 缺内容 → '' 等）
 * - update：删除模型未显式提供的字段，避免 100x100 / #FFFFFF / 16px 等默认值覆盖现有图层
 */
export function normalizeOps(raw: unknown): NodeOp[] {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray((raw as { ops?: unknown }).ops)
      ? (raw as { ops: unknown[] }).ops
      : []
  const output: NodeOp[] = []
  for (const item of list) {
    // 先归一化短 key / 顶层布局 / 类型推断，再用归一化后的原始对象判断 update 显式字段
    const normalizedItem = normalizeCompactNodeOp(item)
    const parsed = nodeOpSchema.safeParse(normalizedItem)
    if (parsed.success) output.push(normalizeOp(parsed.data, normalizedItem))
  }
  return output
}

function normalizeOp(op: NodeOp, rawItem?: unknown): NodeOp {
  const normalized: NodeOp = { ...op, children: [] }
  const raw = (rawItem && typeof rawItem === 'object' ? rawItem : {}) as Record<string, unknown>

  if (normalized.action === 'update') {
    // update：未显式给出的字段一律删除（渲染侧只改显式属性）
    const target = normalized as unknown as Record<string, unknown>
    for (const key of CREATE_ONLY_DEFAULTS) {
      if (!(key in raw)) delete target[key]
    }
    // position 仅用于 create；update 保留 parent（移动到新容器）与 insertAfter/insertBefore（调整顺序）
    delete target.position
  } else {
    // 仅 create 缺 id 时自动生成；update 缺 id 保留空串，由 parseToolCalls 报错重试
    if (!normalized.id) normalized.id = generateId()
    if (!normalized.name) normalized.name = NODE_TYPE_NAMES[normalized.type] ?? '图层'
    // 填充兜底：rect / ellipse 用白色；frame 不填则保持透明（新建 frame 默认白底会遮挡背景）
    if (!normalized.fill && (normalized.type === 'rect' || normalized.type === 'ellipse')) {
      normalized.fill = '#FFFFFF'
    }
    normalized.layout = { ...DEFAULT_LAYOUT, ...normalized.layout }
    const width = normalized.width ?? 0
    const height = normalized.height ?? 0
    if (width <= 0 || height <= 0) {
      if (normalized.type === 'frame') {
        if (width <= 0) normalized.width = 375
        if (height <= 0) normalized.height = 812
      } else {
        if (width <= 0) normalized.width = 100
        if (height <= 0) normalized.height = 100
      }
    }
    if (normalized.type === 'text') {
      if (!normalized.textContent) normalized.textContent = ''
      if (!((normalized.fontSize ?? 0) > 0)) normalized.fontSize = 16
      if (!((normalized.fontWeight ?? 0) > 0)) normalized.fontWeight = 400
      // 模型没给宽高时按内容自适应，避免默认 100×100 把文字撑成方块、破坏 auto layout
      const rawWidth = typeof raw.width === 'number' ? raw.width : 0
      const rawHeight = typeof raw.height === 'number' ? raw.height : 0
      if (rawWidth <= 0 && rawHeight <= 0 && !normalized.textAutoResize) {
        normalized.textAutoResize = 'WIDTH_AND_HEIGHT'
      }
    }
    if (!normalized.textColor) normalized.textColor = '#111111'
  }

  const rawChildren = Array.isArray(raw.children) ? (raw.children as unknown[]) : []
  // children 一律挂到所属 frame 内，parent 只对顶层节点生效
  normalized.children = (op.children ?? []).map((child, index) => {
    const normalizedChild = normalizeOp(child, rawChildren[index])
    delete normalizedChild.parent
    return normalizedChild
  })
  return normalized
}

/**
 * 解析模型返回的 tool_calls：
 * - 成功 → { kind: 'create' | 'update', ops }（kind 由工具名决定）
 * - 失败 → { error }（结构化错误信息，用于自动重试提示）
 */
export function parseToolCalls(
  toolCalls: Array<LlmToolCall | ToolCallInput>,
  retryLevel = 0,
): ParseResult {
  const call = (toolCalls ?? []).map(toInput).find((item) => item.name)
  if (!call) {
    return withHint('模型未返回任何 tool_calls，必须通过 create_ops / update_ops 工具交付画布操作', retryLevel)
  }

  const kind = call.name === 'create_ops' ? 'create' : call.name === 'update_ops' ? 'update' : null
  if (!kind) {
    return withHint(`未知的工具调用「${call.name}」，只支持 create_ops / update_ops`, retryLevel)
  }

  let parsedArgs: unknown
  try {
    parsedArgs = JSON.parse(call.args)
  } catch (error) {
    return withHint(
      `tool_calls 参数不是合法 JSON：${trimMessage((error as Error)?.message ?? error)}`,
      retryLevel,
    )
  }

  // 兼容模型把 ops 数组直接作为顶层参数的情况
  const rawOps = Array.isArray(parsedArgs) ? parsedArgs : (parsedArgs as { ops?: unknown } | null)?.ops
  if (!Array.isArray(rawOps) || rawOps.length === 0) {
    return withHint('tool_calls 参数缺少非空的 ops 数组，请输出 { "ops": [ ... ] }', retryLevel)
  }

  const result = opsArraySchema.safeParse(rawOps)
  if (!result.success) {
    return withHint(
      `ops 结构校验失败：${trimMessage(result.error.issues[0]?.message ?? '未知错误')}`,
      retryLevel,
    )
  }
  // 用 rawOps 规范化：update 需要判断哪些字段是模型显式给出的（result.data 已丢失该信息）
  const ops = normalizeOps(rawOps)
  if (ops.length === 0) {
    return withHint('ops 数组中没有可用的操作元素', retryLevel)
  }

  const total = countNodes(ops)
  if (total > MAX_NODE_COUNT) {
    return withHint(`节点总数 ${total} 超过单次 ${MAX_NODE_COUNT} 上限，请拆分需求后分次生成`, retryLevel)
  }

  // update 操作必须携带原生图层 ID（修改时使用画布上下文传入的 ID）
  const badIndex = ops.findIndex((op) => op.action === 'update' && !op.id)
  if (badIndex >= 0) {
    return withHint(
      `第 ${badIndex + 1} 个 update 操作缺少原生图层 ID，请使用画布上下文中提供的 ID`,
      retryLevel,
    )
  }

  return { kind, ops }
}
