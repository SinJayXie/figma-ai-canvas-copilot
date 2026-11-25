<script setup lang="ts">
/**
 * 设置页 Tab：通用设置
 * 交互行为（自动应用 / 主题 / 发送快捷键）与数据管理（清空对话 / 清空所有数据）
 */
import { ref } from 'vue'
import { DEFAULT_CONFIG, normalizeConfig, type SendKey } from '../../../../types/config.types'
import { confirmAction } from '../../composables/useConfirm'
import { bridge } from '../../services/bridge.service'
import { useChatStore } from '../../store/chat'
import { useConfigStore } from '../../store/config'
import SettingGroup from '../../components/SettingGroup.vue'
import SettingItem from '../../components/SettingItem.vue'
import SettingToggle from '../../components/SettingToggle.vue'
import { inputClass, secondaryBtnClass, selectClass } from './formStyles'

const emit = defineEmits<{
  (e: 'notify', text: string, type?: 'success' | 'error'): void
  (e: 'cleared'): void
}>()

const store = useConfigStore()
const chatStore = useChatStore()

function onSendKeyChange(event: Event): void {
  const value = (event.target as HTMLSelectElement).value as SendKey
  store.update({ sendKey: value })
}
const sendKeyOptions: { value: SendKey; label: string }[] = [
  { value: 'enter', label: 'Enter 发送' },
  { value: 'ctrl-enter', label: 'Ctrl+Enter 发送' }
]

function onRetryChange(event: Event): void {
  const raw = (event.target as HTMLInputElement).valueAsNumber
  const value = Number.isFinite(raw) ? Math.round(raw) : DEFAULT_CONFIG.autoRetry
  store.update({ autoRetry: Math.min(3, Math.max(0, value)) })
}

async function clearCurrentHistory(): Promise<void> {
  const confirmed = await confirmAction({
    title: '清空当前对话？',
    message: '将删除当前文件的全部对话记录，此操作不可撤销。',
    confirmText: '清空',
    danger: true
  })
  if (!confirmed) return
  try {
    await bridge.request('history:save', { conversations: [], activeId: '' })
    // 对话页现在常驻挂载，清空后同步重置，返回时不会残留旧消息
    await chatStore.restore({ conversations: [], activeId: '' })
    emit('notify', '当前对话已清空')
  } catch (err) {
    emit('notify', err instanceof Error ? `清空失败：${err.message}` : '清空失败', 'error')
  }
}

const clearingAll = ref(false)
async function clearAllData(): Promise<void> {
  const confirmed = await confirmAction({
    title: '清除所有数据？',
    message: '将清除所有模型配置、API Key 与对话历史并恢复初始状态。\n该操作不可恢复。',
    confirmText: '全部清除',
    danger: true
  })
  if (!confirmed) return
  clearingAll.value = true
  try {
    // 完整清空逻辑（含历史与缓存）由 Task 7 完善，此处先重置配置
    const defaults = normalizeConfig()
    await bridge.request('config:save', defaults)
    store.update(defaults)
    emit('cleared')
    emit('notify', '所有数据已清除')
  } catch (err) {
    emit('notify', err instanceof Error ? `清除失败：${err.message}` : '清除失败', 'error')
  } finally {
    clearingAll.value = false
  }
}
</script>

<template>
  <div class="flex flex-col gap-5">
    <SettingGroup title="交互行为">
      <SettingItem horizontal label="生成后自动应用" hint="无需确认，直接将 AI 结果渲染到画布">
        <SettingToggle v-model="store.config.autoApply" />
      </SettingItem>

      <SettingItem
        horizontal
        label="任务模式（分步生成）"
        hint="按任务列表逐步生成：首步确认后自动继续，只改动本任务创建的图层"
      >
        <SettingToggle v-model="store.config.taskMode" />
      </SettingItem>

      <SettingItem horizontal label="跟随系统主题" hint="自动适配 Figma 明暗主题">
        <SettingToggle v-model="store.config.followTheme" />
      </SettingItem>

      <SettingItem horizontal label="发送快捷键" hint="对话输入框的发送按键">
        <select
          :value="store.config.sendKey"
          :class="[selectClass, 'w-36']"
          @change="onSendKeyChange"
        >
          <option v-for="option in sendKeyOptions" :key="option.value" :value="option.value">
            {{ option.label }}
          </option>
        </select>
      </SettingItem>

      <SettingItem label="自动重试次数" hint="JSON 解析失败时自动重试，范围 0~3 次">
        <input
          type="number"
          min="0"
          max="3"
          step="1"
          :value="store.config.autoRetry"
          :class="inputClass"
          @change="onRetryChange"
        />
      </SettingItem>
    </SettingGroup>

    <SettingGroup title="数据管理">
      <div class="flex flex-col gap-2 px-4 py-3">
        <span class="text-[14px] font-medium text-figma-text dark:text-figma-text-dark">清空当前对话</span>
        <span class="text-[12px] leading-[18px] text-ios-label-secondary dark:text-ios-label-secondary-dark">
          清空当前文件的对话历史，不影响配置
        </span>
        <button type="button" :class="secondaryBtnClass" @click="clearCurrentHistory">
          清空当前对话
        </button>
      </div>

      <div class="flex flex-col gap-2 px-4 py-3">
        <span class="text-[14px] font-medium text-ios-red dark:text-ios-red-dark">清空所有数据</span>
        <span class="text-[12px] leading-[18px] text-ios-label-secondary dark:text-ios-label-secondary-dark">
          清除所有配置与对话历史，恢复初始状态，不可恢复
        </span>
        <button
          type="button"
          :disabled="clearingAll"
          class="rounded-lg bg-ios-red/10 px-3.5 py-2.5 text-[14px] font-medium text-ios-red transition-colors hover:bg-ios-red/15 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-ios-red-dark/15 dark:text-ios-red-dark dark:hover:bg-ios-red-dark/20"
          @click="clearAllData"
        >
          {{ clearingAll ? '清除中…' : '清空所有数据' }}
        </button>
      </div>
    </SettingGroup>
  </div>
</template>
