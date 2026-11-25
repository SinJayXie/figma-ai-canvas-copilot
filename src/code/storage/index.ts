/**
 * clientStorage 封装（DEV.md 5.4）
 * - 配置全局共享（key: plugin_config），读取失败 / 不存在回退 DEFAULT_CONFIG
 * - 对话历史按 fileKey 隔离（key: chat_history_${fileKey}），最多 20 个会话 / 每会话 50 条
 */
import { normalizeConfig, type PluginConfig } from '../../../types/config.types'

const CONFIG_KEY = 'plugin_config'
const HISTORY_PREFIX = 'chat_history_'
/** 每个会话最多保留的消息数 */
const HISTORY_LIMIT = 50
/** 最多保留的会话数 */
const CONVERSATION_LIMIT = 20

/** 历史存储 key：chat_history_${fileKey} */
function historyKey(fileKey: string): string {
  return `${HISTORY_PREFIX}${fileKey}`
}

/**
 * 历史载荷裁剪：
 * - 旧版单会话数组 → 保留最后 50 条
 * - 新版 { conversations, activeId } → 最多 20 个会话，每个会话最多 50 条消息
 */
function capHistoryPayload<T>(payload: T): T {
  if (Array.isArray(payload)) return payload.slice(-HISTORY_LIMIT) as T
  if (payload && typeof payload === 'object') {
    const record = payload as { conversations?: unknown }
    if (Array.isArray(record.conversations)) {
      const conversations = record.conversations.slice(0, CONVERSATION_LIMIT).map((item) => {
        if (!item || typeof item !== 'object') return item
        const conversation = item as { messages?: unknown }
        return Array.isArray(conversation.messages)
          ? { ...conversation, messages: conversation.messages.slice(-HISTORY_LIMIT) }
          : item
      })
      return { ...(payload as object), conversations } as T
    }
  }
  return payload
}

/** 读取全局配置；不存在 / 失败时回退默认配置（旧版本无 models 时自动迁移） */
export async function loadConfig(): Promise<PluginConfig> {
  try {
    const stored = await figma.clientStorage.getAsync(CONFIG_KEY)
    if (!stored || typeof stored !== 'object') return normalizeConfig()
    return normalizeConfig(stored as Partial<PluginConfig>)
  } catch {
    return normalizeConfig()
  }
}

/** 保存全局配置（写入前归一化，保证 models / activeModelId 一致），成功返回 true */
export async function saveConfig(config: PluginConfig): Promise<boolean> {
  try {
    await figma.clientStorage.setAsync(CONFIG_KEY, normalizeConfig(config))
    return true
  } catch {
    return false
  }
}

/** 读取指定文件的对话历史；失败返回空数组（裁剪逻辑同时兼容新旧载荷） */
export async function loadHistory<T = unknown>(fileKey: string): Promise<T[] | T> {
  try {
    const stored = await figma.clientStorage.getAsync(historyKey(fileKey))
    if (stored === undefined || stored === null) return []
    return capHistoryPayload(stored) as T[] | T
  } catch {
    return []
  }
}

/** 保存指定文件的对话历史（最多 20 个会话 / 每会话 50 条），成功返回 true */
export async function saveHistory<T = unknown>(fileKey: string, payload: T): Promise<boolean> {
  try {
    await figma.clientStorage.setAsync(historyKey(fileKey), capHistoryPayload(payload))
    return true
  } catch {
    return false
  }
}

/** 清空配置与全部对话历史 */
export async function clearAll(): Promise<boolean> {
  try {
    const keys = await figma.clientStorage.keysAsync()
    const targets = keys.filter((key) => key === CONFIG_KEY || key.startsWith(HISTORY_PREFIX))
    await Promise.all(targets.map((key) => figma.clientStorage.deleteAsync(key)))
    return true
  } catch {
    return false
  }
}
