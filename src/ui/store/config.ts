/**
 * 全局配置 Store（PRD 第 6 章）
 * state（config / loaded）+ load / save / update，与沙箱 config:load / config:save 保持同一契约。
 * 配置读取统一走 normalizeConfig：兼容旧版本单模型配置并深拷贝 models。
 */
import { defineStore } from 'pinia'
import { normalizeConfig, type PluginConfig } from '../../../types/config.types'
import { applyLanguage } from '../i18n'
import { bridge } from '../services/bridge.service'

interface ConfigState {
  /** 当前生效配置（读写表单直接绑定此对象） */
  config: PluginConfig
  /** 是否已完成首次加载 */
  loaded: boolean
}

export const useConfigStore = defineStore('config', {
  state: (): ConfigState => ({
    config: normalizeConfig(),
    loaded: false
  }),
  actions: {
    /** 从沙箱加载配置；失败时回退默认值，不阻塞页面（DEV.md 5.4） */
    async load(): Promise<PluginConfig> {
      try {
        const stored = await bridge.request<Partial<PluginConfig>>('config:load')
        this.config = normalizeConfig(stored && typeof stored === 'object' ? stored : null)
      } catch {
        this.config = normalizeConfig()
      } finally {
        this.loaded = true
        applyLanguage(this.config.language)
      }
      return this.config
    },
    /** 保存配置到沙箱（config:save，payload 即配置对象） */
    async save(): Promise<void> {
      this.config = normalizeConfig(this.config)
      applyLanguage(this.config.language)
      await bridge.request('config:save', this.config)
      this.loaded = true
    },
    /** 局部更新配置（仅内存，不写盘；语言在保存时统一生效） */
    update(partial: Partial<PluginConfig>): void {
      this.config = normalizeConfig({ ...this.config, ...partial })
    },
    /** 立即按当前配置应用语言（清空数据等绕过保存流程时使用） */
    applyCurrentLanguage(): void {
      applyLanguage(this.config.language)
    }
  }
})
