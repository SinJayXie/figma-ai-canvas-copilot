/**
 * 画布状态 Store（DEV.md 4.1 useCanvasStore）
 * 当前选中图层数据：监听 selection:changed 推送 + selection:get 主动拉取
 */
import { defineStore } from 'pinia'
import type { SelectionData } from '../../../types/node.types'
import { bridge } from '../services/bridge.service'
import { invalidateDesignSystemCache } from '../services/canvasContext.service'

/** selection:changed 取消订阅（模块级，避免进入响应式 state） */
let unsubscribe: (() => void) | null = null
/** document:changed 取消订阅（文档变更 → 设计系统缓存失效） */
let unsubscribeDocument: (() => void) | null = null
/** page:changed 取消订阅（页面切换 → 缓存失效 + 重新拉取页面摘要） */
let unsubscribePage: (() => void) | null = null

export const useCanvasStore = defineStore('canvas', {
  state: () => ({
    /** 当前选中图层（沙箱序列化数据，>20 个时仅统计摘要） */
    selection: null as SelectionData | null,
    /** 当前页顶层结构摘要（无选中时的画布上下文回退，page:get） */
    page: null as (SelectionData & { pageName: string }) | null,
  }),
  actions: {
    /** 注册 selection:changed 监听（App 挂载时调用一次，重复调用幂等） */
    init(): void {
      if (unsubscribe) return
      unsubscribe = bridge.onEvent('selection:changed', (payload) => {
        this.selection = (payload ?? null) as SelectionData | null
      })
      // 文档变更（防抖推送）：仅让设计系统缓存失效，避免下一轮上下文拿到旧组件/样式
      unsubscribeDocument = bridge.onEvent('document:changed', (_payload) => {
        invalidateDesignSystemCache()
      })
      // 页面切换：缓存失效 + 重新拉取当前页摘要
      unsubscribePage = bridge.onEvent('page:changed', (_payload) => {
        invalidateDesignSystemCache()
        void this.requestPage()
      })
    },
    /** 取消监听（组件卸载场景预留） */
    dispose(): void {
      unsubscribe?.()
      unsubscribe = null
      unsubscribeDocument?.()
      unsubscribeDocument = null
      unsubscribePage?.()
      unsubscribePage = null
    },
    /** 主动拉取当前选中；失败时返回 null 并保持原状态 */
    async requestSelection(): Promise<SelectionData | null> {
      try {
        const data = await bridge.request<SelectionData | null>('selection:get')
        this.selection = data ?? null
      } catch {
        return null
      }
      return this.selection
    },
    /** 拉取当前页顶层结构摘要；失败时返回 null 并保持原状态 */
    async requestPage(): Promise<(SelectionData & { pageName: string }) | null> {
      try {
        const data = await bridge.request<SelectionData & { pageName: string }>('page:get')
        this.page = data ?? null
      } catch {
        return null
      }
      return this.page
    },
  },
})
