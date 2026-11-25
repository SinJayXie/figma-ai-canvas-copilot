<script setup lang="ts">
/**
 * 设置页 Tab：通用设置
 * 交互行为（语言 / 自动应用 / 主题 / 发送快捷键）与数据管理（清空对话 / 清空所有数据）
 */
import { ref } from 'vue'
import {
  DEFAULT_CONFIG,
  normalizeConfig,
  type LanguageSetting,
  type SendKey,
} from '../../../../types/config.types'
import { confirmAction } from '../../composables/useConfirm'
import { bridge } from '../../services/bridge.service'
import { useChatStore } from '../../store/chat'
import { useConfigStore } from '../../store/config'
import { LANGUAGE_OPTIONS, useT } from '../../i18n'
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
const t = useT()

function onSendKeyChange(event: Event): void {
  const value = (event.target as HTMLSelectElement).value as SendKey
  store.update({ sendKey: value })
}
const sendKeyOptions: { value: SendKey; label: string }[] = [
  { value: 'enter', label: 'ENTER_TO_SEND' },
  { value: 'ctrl-enter', label: 'CTRL_ENTER_TO_SEND' }
]

function onLanguageChange(event: Event): void {
  const value = (event.target as HTMLSelectElement).value as LanguageSetting
  store.update({ language: value })
}

function onRetryChange(event: Event): void {
  const raw = (event.target as HTMLInputElement).valueAsNumber
  const value = Number.isFinite(raw) ? Math.round(raw) : DEFAULT_CONFIG.autoRetry
  store.update({ autoRetry: Math.min(3, Math.max(0, value)) })
}

async function clearCurrentHistory(): Promise<void> {
  const confirmed = await confirmAction({
    title: t('CLEAR_THE_CURRENT_CHAT'),
    message: t('THIS_DELETES_ALL_CONVERSATIONS_FOR_THIS'),
    confirmText: t('CLEAR'),
    danger: true
  })
  if (!confirmed) return
  try {
    await bridge.request('history:save', { conversations: [], activeId: '' })
    // 对话页现在常驻挂载，清空后同步重置，返回时不会残留旧消息
    await chatStore.restore({ conversations: [], activeId: '' })
    emit('notify', t('CURRENT_CHAT_CLEARED'))
  } catch (err) {
    emit('notify', err instanceof Error ? t('CLEAR_FAILED', { message: err.message }) : t('CLEAR_FAILED_PLAIN'), 'error')
  }
}

const clearingAll = ref(false)
async function clearAllData(): Promise<void> {
  const confirmed = await confirmAction({
    title: t('CLEAR_ALL_DATA_CONFIRM'),
    message: t('THIS_REMOVES_ALL_MODEL_CONFIGURATION_API'),
    confirmText: t('CLEAR_ALL'),
    danger: true
  })
  if (!confirmed) return
  clearingAll.value = true
  try {
    // 完整清空逻辑（含历史与缓存）由 Task 7 完善，此处先重置配置
    const defaults = normalizeConfig()
    await bridge.request('config:save', defaults)
    store.update(defaults)
    store.applyCurrentLanguage()
    emit('cleared')
    emit('notify', t('ALL_DATA_CLEARED'))
  } catch (err) {
    emit('notify', err instanceof Error ? t('FAILED_TO_CLEAR', { message: err.message }) : t('FAILED_TO_CLEAR_PLAIN'), 'error')
  } finally {
    clearingAll.value = false
  }
}
</script>

<template>
  <div class="flex flex-col gap-5">
    <SettingGroup :title="t('BEHAVIOR')">
      <SettingItem :label="t('LANGUAGE')" :hint="t('FOLLOW_SYSTEM_LANGUAGE_HINT')">
        <select
          :value="store.config.language"
          :class="[selectClass, 'w-36']"
          @change="onLanguageChange"
        >
          <option v-for="option in LANGUAGE_OPTIONS" :key="option.value" :value="option.value">
            {{ t(option.label) }}
          </option>
        </select>
      </SettingItem>

      <SettingItem :label="t('AUTO_APPLY_AFTER_GENERATION')" :hint="t('RENDER_AI_RESULTS_TO_THE_CANVAS')" horizontal>
        <SettingToggle v-model="store.config.autoApply" />
      </SettingItem>

      <SettingItem
        :label="t('TASK_MODE_STEP_BY_STEP')"
        :hint="t('GENERATE_FROM_A_TASK_LIST_CONTINUE')"
        horizontal
      >
        <SettingToggle v-model="store.config.taskMode" />
      </SettingItem>

      <SettingItem :label="t('FOLLOW_SYSTEM_THEME')" :hint="t('MATCH_THE_FIGMA_LIGHT_OR_DARK')" horizontal>
        <SettingToggle v-model="store.config.followTheme" />
      </SettingItem>

      <SettingItem :label="t('SEND_SHORTCUT')" :hint="t('KEY_USED_TO_SEND_FROM_THE')" horizontal>
        <select
          :value="store.config.sendKey"
          :class="[selectClass, 'w-36']"
          @change="onSendKeyChange"
        >
          <option v-for="option in sendKeyOptions" :key="option.value" :value="option.value">
            {{ t(option.label) }}
          </option>
        </select>
      </SettingItem>

      <SettingItem :label="t('AUTO_RETRIES')" :hint="t('RETRY_ON_JSON_PARSE_FAILURES')">
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

    <SettingGroup :title="t('DATA')">
      <div class="flex flex-col gap-2 px-4 py-3">
        <span class="text-[14px] font-medium text-figma-text dark:text-figma-text-dark">{{ t('CLEAR_CURRENT_CHAT') }}</span>
        <span class="text-[12px] leading-[18px] text-ios-label-secondary dark:text-ios-label-secondary-dark">
          {{ t('CLEAR_THIS_FILES_CHAT_HISTORY_WITHOUT') }}
        </span>
        <button type="button" :class="secondaryBtnClass" @click="clearCurrentHistory">
          {{ t('CLEAR_CURRENT_CHAT') }}
        </button>
      </div>

      <div class="flex flex-col gap-2 px-4 py-3">
        <span class="text-[14px] font-medium text-ios-red dark:text-ios-red-dark">{{ t('CLEAR_ALL_DATA') }}</span>
        <span class="text-[12px] leading-[18px] text-ios-label-secondary dark:text-ios-label-secondary-dark">
          {{ t('REMOVE_ALL_CONFIGURATION_AND_CHAT_HISTORY') }}
        </span>
        <button
          type="button"
          :disabled="clearingAll"
          class="rounded-lg bg-ios-red/10 px-3.5 py-2.5 text-[14px] font-medium text-ios-red transition-colors hover:bg-ios-red/15 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-ios-red-dark/15 dark:text-ios-red-dark dark:hover:bg-ios-red-dark/20"
          @click="clearAllData"
        >
          {{ clearingAll ? t('CLEARING') : t('CLEAR_ALL_DATA') }}
        </button>
      </div>
    </SettingGroup>
  </div>
</template>
