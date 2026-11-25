/**
 * 跨上下文通信协议（UI iframe ⇄ Figma 沙箱）
 * 统一信封格式，见 DEV.md 第 3.1 / 3.3 节
 */

/** 消息类型全集 */
export type PluginMessageType =
  | 'config:load'
  | 'config:save'
  | 'selection:get'
  | 'page:get'
  | 'cap:invoke'
  | 'ops:create'
  | 'ops:update'
  | 'selection:changed'
  | 'document:changed'
  | 'page:changed'
  | 'theme:changed'
  | 'history:load'
  | 'history:save'

/** 主题事件载荷（theme:changed） */
export type ThemeMode = 'light' | 'dark'

/** 请求信封（UI→沙箱请求；沙箱→UI 事件推送时复用同一结构） */
export interface PluginRequest<T = unknown> {
  /** 唯一请求 ID，用于匹配响应 */
  id: string
  type: PluginMessageType
  payload: T
}

/** 响应信封（沙箱→UI） */
export interface PluginResponse<T = unknown> {
  id: string
  type: PluginMessageType
  success: boolean
  data?: T
  error?: string
}
