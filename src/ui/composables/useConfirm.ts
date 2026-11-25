/**
 * 插件内确认弹窗（模块级单例，Promise 版本）
 * Figma 插件 iframe 中 window.confirm 行为不稳定（可能被静默拦截并直接返回 false），
 * 破坏性画布操作统一走这里，由 App.vue 渲染 ConfirmDialog。
 */
import { reactive } from 'vue'
import { t } from '../i18n'

export interface ConfirmOptions {
  title: string
  message: string
  confirmText?: string
  cancelText?: string
  /** 第三选项（如「不保存返回」）；提供时弹窗展示三个按钮 */
  discardText?: string
  /** 危险操作：确认按钮使用红色 */
  danger?: boolean
  /** 超时自动取消（ms），避免 Agent 等待太久卡住生成状态 */
  timeoutMs?: number
}

/** 用户选择：确认 / 取消（含关闭弹窗）/ 放弃（仅三选项弹窗） */
export type ConfirmChoice = 'confirm' | 'cancel' | 'discard'

interface ConfirmState {
  visible: boolean
  title: string
  message: string
  confirmText: string
  cancelText: string
  discardText: string
  danger: boolean
}

const state = reactive<ConfirmState>({
  visible: false,
  title: '',
  message: '',
  confirmText: '',
  cancelText: '',
  discardText: '',
  danger: false,
})

let resolver: ((choice: ConfirmChoice) => void) | null = null
let timer: ReturnType<typeof setTimeout> | null = null

/** 结算当前弹窗：回复 Promise 并复位状态 */
function settle(choice: ConfirmChoice): void {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  const resolve = resolver
  resolver = null
  state.visible = false
  resolve?.(choice)
}

/** 打开弹窗，返回用户的完整选择 */
function open(options: ConfirmOptions): Promise<ConfirmChoice> {
  settle('cancel')
  return new Promise<ConfirmChoice>((resolve) => {
    resolver = resolve
    state.title = options.title
    state.message = options.message
    state.confirmText = options.confirmText ?? t('CONFIRM')
    state.cancelText = options.cancelText ?? t('CANCEL')
    state.discardText = options.discardText ?? ''
    state.danger = options.danger ?? false
    state.visible = true
    timer = setTimeout(() => settle('cancel'), options.timeoutMs ?? 120_000)
  })
}

/**
 * 弹出确认框，返回用户选择。
 * 已有弹窗时先按取消结算，保证旧 Promise 不会悬挂。
 */
export async function confirmAction(options: ConfirmOptions): Promise<boolean> {
  return (await open(options)) === 'confirm'
}

/** 三选一确认：确认 / 取消 / 放弃（discardText 为空时不会出现第三个按钮） */
export function confirmChoice(options: ConfirmOptions & { discardText: string }): Promise<ConfirmChoice> {
  return open(options)
}

export function acceptConfirm(): void {
  settle('confirm')
}

export function cancelConfirm(): void {
  settle('cancel')
}

export function discardConfirm(): void {
  settle('discard')
}

export function useConfirm(): ConfirmState {
  return state
}
