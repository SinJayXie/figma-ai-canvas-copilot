<script setup lang="ts">
/**
 * 设置页 Tab：提示词
 * 内置默认提示词（可展开只读）+ 自定义追加提示词
 */
import { ref } from 'vue'
import { useConfigStore } from '../../store/config'
import { useT } from '../../i18n'
import { DEFAULT_SYSTEM_PROMPT } from '../../utils/promptBuilder'
import SettingGroup from '../../components/SettingGroup.vue'
import SettingItem from '../../components/SettingItem.vue'
import { inputClass, secondaryBtnClass } from './formStyles'

const emit = defineEmits<{
  (e: 'notify', text: string, type?: 'success' | 'error'): void
}>()

const store = useConfigStore()
const t = useT()

const promptExpanded = ref(false)
const MAX_PROMPT_LENGTH = 2000
</script>

<template>
  <div class="flex flex-col gap-5">
    <SettingGroup :title="t('BUILTIN_PROMPT')">
      <button
        type="button"
        class="flex w-full items-center justify-between px-4 py-3 text-[14px] font-medium text-figma-text transition-colors hover:bg-ios-fill dark:text-figma-text-dark dark:hover:bg-ios-fill-dark"
        @click="promptExpanded = !promptExpanded"
      >
        <span>{{ t('DEFAULT_SYSTEM_PROMPT') }}</span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 16 16"
          fill="none"
          class="text-ios-label-secondary transition-transform dark:text-ios-label-secondary-dark"
          :class="promptExpanded ? 'rotate-180' : ''"
        >
          <path
            d="m4 6 4 4 4-4"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </button>
      <pre
        v-show="promptExpanded"
        class="mx-4 mb-3 max-h-48 overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-ios-fill p-3 text-[12px] leading-5 text-ios-label-secondary dark:bg-ios-fill-dark dark:text-ios-label-secondary-dark"
        >{{ DEFAULT_SYSTEM_PROMPT }}</pre
      >
    </SettingGroup>

    <SettingGroup :title="t('CUSTOM_PROMPT')">
      <SettingItem
        :label="t('CUSTOM_PROMPT')"
        :hint="t('APPENDED_AFTER_THE_DEFAULT_PROMPT_FOR')"
      >
        <textarea
          v-model="store.config.customPrompt"
          rows="6"
          maxlength="2000"
          :placeholder="t('E_G_ALL_PRIMARY_BUTTONS_USE')"
          :class="[inputClass, 'resize-none leading-5']"
        />
        <div class="flex items-center justify-between">
          <span class="text-[12px] text-ios-label-secondary dark:text-ios-label-secondary-dark">
            {{ store.config.customPrompt.length }} / {{ MAX_PROMPT_LENGTH }}
          </span>
          <button
            type="button"
            :class="secondaryBtnClass"
            @click="store.update({ customPrompt: '' }); emit('notify', t('CUSTOM_PROMPT_RESET'))"
          >
            {{ t('RESET') }}
          </button>
        </div>
      </SettingItem>
    </SettingGroup>
  </div>
</template>
