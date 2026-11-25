/**
 * 插件内确认弹窗（模块级单例，Promise 版本）
 * Figma 插件 iframe 中 window.confirm 行为不稳定（可能被静默拦截并直接返回 false），
 * 破坏性画布操作统一走这里，由 App.vue 渲染 ConfirmDialog。
 */
import { reactive } from 'vue'

export interface ConfirmOptions {
  title: string
  message: string
  confirmText?: string
  cancelText?: string
  /** 危险操作：确认按钮使用红色 */
  danger?: boolean
  /** 超时自动取消（ms），避免 Agent 等待太久卡住生成状态 */
  timeoutMs?: number
}

interface ConfirmState {
  visible: boolean
  title: string
  message: string
  confirmText: string
  cancelText: string
  danger: boolean
}

const state = reactive<ConfirmState>({
  visible: false,
  title: '',
  message: '',
  confirmText: '确认',
  cancelText: '取消',
  danger: false,
})

let resolver: ((ok: boolean) => void) | null = null
let timer: ReturnType<typeof setTimeout> | null = null

/** 结算当前弹窗：回复 Promise 并复位状态 */
function settle(ok: boolean): void {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  const resolve = resolver
  resolver = null
  state.visible = false
  resolve?.(ok)
}

/**
 * 弹出确认框，返回用户选择。
 * 已有弹窗时先按取消结算，保证旧 Promise 不会悬挂。
 */
export function confirmAction(options: ConfirmOptions): Promise<boolean> {
  settle(false)
  return new Promise<boolean>((resolve) => {
    resolver = resolve
    state.title = options.title
    state.message = options.message
    state.confirmText = options.confirmText ?? '确认'
    state.cancelText = options.cancelText ?? '取消'
    state.danger = options.danger ?? false
    state.visible = true
    timer = setTimeout(() => settle(false), options.timeoutMs ?? 120_000)
  })
}

export function acceptConfirm(): void {
  settle(true)
}

export function cancelConfirm(): void {
  settle(false)
}

export function useConfirm(): ConfirmState {
  return state
}
