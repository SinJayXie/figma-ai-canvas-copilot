/**
 * 轻量 Toast 通知（M3 7.3 交互打磨：发送失败等提示统一）
 * 模块级单例响应式状态，App.vue 负责渲染，任意模块 showToast 触发
 */
import { reactive } from 'vue'

export type ToastKind = 'error' | 'info'

interface ToastState {
  visible: boolean
  message: string
  kind: ToastKind
}

const state = reactive<ToastState>({ visible: false, message: '', kind: 'error' })

let hideTimer: ReturnType<typeof setTimeout> | null = null

/** 显示 toast，默认 2.5s 自动消失 */
export function showToast(message: string, kind: ToastKind = 'error', duration = 2500): void {
  state.message = message
  state.kind = kind
  state.visible = true
  if (hideTimer) clearTimeout(hideTimer)
  hideTimer = setTimeout(() => {
    state.visible = false
    hideTimer = null
  }, duration)
}

export function useToast(): ToastState {
  return state
}
