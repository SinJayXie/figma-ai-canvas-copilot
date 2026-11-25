/**
 * LLM 接口类型（OpenAI 兼容 Chat Completions 协议扩展）
 * 覆盖非流式响应、SSE 流式增量块与 tools 定义
 */

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool'

/** 多模态内容片段（OpenAI 兼容） */
export interface LlmTextPart {
  type: 'text'
  text: string
}

export interface LlmImagePart {
  type: 'image_url'
  image_url: { url: string }
}

export type LlmContentPart = LlmTextPart | LlmImagePart
export type LlmMessageContent = string | LlmContentPart[]

/** 对话消息（Agent 上下文组装的基本单元） */
export interface ChatMessage {
  role: ChatRole
  content: LlmMessageContent
  /** assistant 消息携带的工具调用（用于工具往返） */
  tool_calls?: LlmToolCall[]
  /** role=tool 时对应的工具调用 ID */
  tool_call_id?: string
  /**
   * assistant 的思考内容。DeepSeek 等推理模型要求：
   * 带 tool_calls 的 assistant 消息必须把它原样回传，否则下一次请求 400。
   */
  reasoning_content?: string
}

/** 用户消息附件（图片 / 文本文件） */
export interface MessageAttachment {
  id: string
  kind: 'image' | 'text'
  name: string
  mime: string
  size: number
  /** image：data URL（持久化时丢弃） */
  dataUrl?: string
  /** text：抽取后的文本（持久化时丢弃） */
  text?: string
}

/** 工具函数定义（JSON Schema 形式的参数描述） */
export interface LlmFunctionDefinition {
  name: string
  description?: string
  parameters: Record<string, unknown>
}

/** tools 请求参数项 */
export interface LlmTool {
  type: 'function'
  function: LlmFunctionDefinition
}

/** 模型返回的工具调用 */
export interface LlmToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    /** JSON 字符串形式的参数，需自行解析并校验 */
    arguments: string
  }
}

/** Token 用量统计 */
export interface LlmUsage {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
}

/** Chat Completions 请求体 */
export interface LlmChatRequest {
  model: string
  messages: ChatMessage[]
  stream?: boolean
  temperature?: number
  max_tokens?: number
  tools?: LlmTool[]
  tool_choice?: 'none' | 'auto' | 'required' | { type: 'function'; function: { name: string } }
  /** 允许厂商扩展字段（如思考模式 / 推理强度参数） */
  [key: string]: unknown
}

/** 响应中的消息体（content 可能为 null，此时以 tool_calls 为准） */
export interface LlmChoiceMessage {
  role: ChatRole
  content: string | null
  tool_calls?: LlmToolCall[]
}

export interface LlmChoice {
  index: number
  message: LlmChoiceMessage
  finish_reason: string | null
}

/** 非流式 Chat Completions 响应 */
export interface LlmChatResponse {
  id: string
  object: string
  created: number
  model: string
  choices: LlmChoice[]
  usage?: LlmUsage
}

/** SSE 流式增量块（data: {...} 解析结果） */
export interface LlmStreamChunk {
  id: string
  object: string
  created: number
  model: string
  choices: Array<{
    index: number
    delta: {
      role?: ChatRole
      content?: string | null
      /** 思考内容（DeepSeek / vLLM 等 reasoning 模型） */
      reasoning_content?: string | null
      /** 部分厂商使用 reasoning 字段承载思考内容 */
      reasoning?: string | null
      tool_calls?: Array<
        Partial<LlmToolCall> & {
          index: number
        }
      >
    }
    finish_reason: string | null
  }>
  usage?: LlmUsage | null
}
