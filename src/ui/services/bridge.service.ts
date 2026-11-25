/**
 * UI ⇄ 沙箱通信 Bridge（DEV.md 3.2）
 * - request：Promise 化请求-响应，自动生成 id 并匹配响应，超时 reject
 * - onEvent：注册沙箱主动推送事件（无 id 消息，如 selection:changed / theme:changed）
 */
import type { PluginMessageType, PluginResponse } from '../../../types/message.types'
import { generateId } from '../utils/uuid'

/** 沙箱推送事件处理器 */
type EventHandler = (payload: unknown) => void

/** 等待响应的挂起请求 */
interface PendingRequest {
  resolve: (data: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

const DEFAULT_TIMEOUT = 10000

/**
 * 转为可结构化克隆的纯数据：
 * Vue 响应式对象是 Proxy，postMessage 直接克隆会抛
 * "could not be cloned"，需先经 JSON 序列化剥离
 */
function toCloneable<T>(value: T): T {
  if (value === undefined) return value
  try {
    return JSON.parse(JSON.stringify(value)) as T
  } catch {
    return value
  }
}

class BridgeService {
  private pendingMap = new Map<string, PendingRequest>()
  private eventHandlers = new Map<string, Set<EventHandler>>()

  constructor() {
    window.addEventListener('message', this.onMessage)
  }

  /** 发送请求到沙箱，按 id 匹配响应；超时（默认 10s）reject */
  request<T = unknown>(type: PluginMessageType, payload?: unknown, timeout = DEFAULT_TIMEOUT): Promise<T> {
    const id = generateId('req')
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingMap.delete(id)
        reject(new Error(`Request "${type}" timed out after ${timeout}ms`))
      }, timeout)
      this.pendingMap.set(id, { resolve: resolve as (data: unknown) => void, reject, timer })
      parent.postMessage({ pluginMessage: { id, type, payload: toCloneable(payload) } }, '*')
    })
  }

  /** 注册沙箱主动推送事件（无 id 消息），返回取消订阅函数 */
  onEvent(type: PluginMessageType, handler: EventHandler): () => void {
    const handlers = this.eventHandlers.get(type) ?? new Set<EventHandler>()
    this.eventHandlers.set(type, handlers)
    handlers.add(handler)
    return () => handlers.delete(handler)
  }

  private onMessage = (event: MessageEvent): void => {
    const raw = (event.data as { pluginMessage?: unknown } | undefined)?.pluginMessage
    if (!raw || typeof raw !== 'object') return
    const msg = raw as PluginResponse & { payload?: unknown }

    // 带 id：请求-响应，按 id 匹配挂起请求
    if (typeof msg.id === 'string') {
      const pending = this.pendingMap.get(msg.id)
      if (!pending) return
      clearTimeout(pending.timer)
      this.pendingMap.delete(msg.id)
      if (msg.success) pending.resolve(msg.data)
      else pending.reject(new Error(msg.error ?? 'Unknown plugin error'))
      return
    }

    // 无 id：沙箱主动推送事件，按 type 分发
    if (typeof msg.type !== 'string') return
    const handlers = this.eventHandlers.get(msg.type)
    if (!handlers) return
    for (const handler of handlers) handler(msg.payload)
  }
}

export const bridge = new BridgeService()
