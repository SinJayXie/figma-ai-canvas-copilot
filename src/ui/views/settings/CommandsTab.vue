<script setup lang="ts">
/**
 * 设置页 Tab：自定义快捷指令
 * 指令列表 + 添加/编辑弹窗 + 校验 + 删除确认
 */
import { computed, ref } from 'vue'
import { type QuickCommandConfig } from '../../../../types/config.types'
import { confirmAction } from '../../composables/useConfirm'
import { useConfigStore } from '../../store/config'
import { useT } from '../../i18n'
import SettingGroup from '../../components/SettingGroup.vue'
import { inputClass, invalidInputClass, secondaryBtnClass } from './formStyles'

const emit = defineEmits<{
  (e: 'notify', text: string, type?: 'success' | 'error'): void
}>()

const store = useConfigStore()
const t = useT()

const commandDraft = ref<QuickCommandConfig | null>(null)
const editingCommandLabel = ref<string | null>(null)

const normalizedCommandLabel = computed(() => {
  const raw = commandDraft.value?.label.trim() ?? ''
  if (!raw) return ''
  return raw.startsWith('/') ? raw : `/${raw}`
})

const commandLabelError = computed(() => {
  const draft = commandDraft.value
  if (!draft) return ''
  const label = normalizedCommandLabel.value
  if (!label || label === '/') return t('ENTER_A_COMMAND_NAME_E_G')
  if (/\s/.test(label)) return t('COMMAND_NAME_CANNOT_CONTAIN_SPACES')
  if (label.length > 20) return t('COMMAND_NAME_MUST_BE_20_CHARACTERS')
  const duplicate = store.config.customCommands.some(
    (item) => item.label === label && item.label !== editingCommandLabel.value
  )
  return duplicate ? t('A_CUSTOM_COMMAND_WITH_THIS_NAME') : ''
})

const commandDescriptionError = computed(() =>
  commandDraft.value && commandDraft.value.description.trim().length > 40
    ? t('DESCRIPTION_MUST_BE_40_CHARACTERS_OR')
    : ''
)

const commandPromptError = computed(() =>
  commandDraft.value && !commandDraft.value.prompt.trim() ? t('ENTER_A_PROMPT_TEMPLATE') : ''
)

function openAddCommand(): void {
  commandDraft.value = { label: '/', description: '', prompt: '' }
  editingCommandLabel.value = null
}

function openEditCommand(command: QuickCommandConfig): void {
  commandDraft.value = { ...command }
  editingCommandLabel.value = command.label
}

function closeCommandModal(): void {
  commandDraft.value = null
  editingCommandLabel.value = null
}

function saveCommandDraft(): void {
  if (!commandDraft.value) return
  const error =
    commandLabelError.value || commandDescriptionError.value || commandPromptError.value
  if (error) {
    emit('notify', error, 'error')
    return
  }
  const entry: QuickCommandConfig = {
    label: normalizedCommandLabel.value,
    description: commandDraft.value.description.trim(),
    prompt: commandDraft.value.prompt.trim()
  }
  const list = store.config.customCommands
  const index = editingCommandLabel.value
    ? list.findIndex((item) => item.label === editingCommandLabel.value)
    : -1
  if (index >= 0) list.splice(index, 1, entry)
  else list.push(entry)
  closeCommandModal()
  emit('notify', t('COMMAND_SAVED_REMEMBER_TO_SAVE_SETTINGS'))
}

async function removeCommand(label: string): Promise<void> {
  const confirmed = await confirmAction({
    title: t('DELETE_COMMAND_CONFIRM'),
    message: t('THIS_DELETES_THE_CUSTOM_COMMAND_THIS', { label }),
    confirmText: t('DELETE'),
    danger: true
  })
  if (!confirmed) return
  const index = store.config.customCommands.findIndex((item) => item.label === label)
  if (index >= 0) store.config.customCommands.splice(index, 1)
}

/** 供 SettingsView「重置」前关闭弹窗 */
function closeModal(): void {
  closeCommandModal()
}

defineExpose({ closeModal })
</script>

<template>
  <div class="flex flex-col gap-5">
    <SettingGroup :title="t('CUSTOM_COMMANDS')">
      <p class="px-4 pb-2 pt-3 text-[12px] leading-[18px] text-ios-label-secondary dark:text-ios-label-secondary-dark">
        {{ t('SHOWN_IN_THE_MENU_ALONGSIDE_BUILT') }}
      </p>
      <div class="px-4 pb-3">
        <button type="button" :class="[secondaryBtnClass, 'w-full']" @click="openAddCommand">
          {{ t('ADD_COMMAND') }}
        </button>
      </div>
      <div
        v-for="command in store.config.customCommands"
        :key="command.label"
        class="flex items-start gap-2 border-t border-figma-border px-4 py-3 dark:border-figma-border-dark"
      >
        <div class="min-w-0 flex-1">
          <p class="text-[14px] font-medium text-figma-text dark:text-figma-text-dark">
            {{ command.label }}
          </p>
          <p class="mt-0.5 truncate text-[12px] text-ios-label-secondary dark:text-ios-label-secondary-dark">
            {{ command.description || t('NO_DESCRIPTION') }}
          </p>
          <p class="mt-1 line-clamp-2 whitespace-pre-wrap break-words text-[11px] leading-4 text-ios-label-tertiary dark:text-ios-label-tertiary-dark">
            {{ command.prompt }}
          </p>
        </div>
        <div class="flex shrink-0 items-center gap-1">
          <button
            type="button"
            class="rounded-md px-2 py-1 text-[12px] font-medium text-ios-blue transition-colors hover:bg-ios-blue/10 dark:text-ios-blue-dark dark:hover:bg-ios-blue-dark/15"
            @click="openEditCommand(command)"
          >
            {{ t('EDIT') }}
          </button>
          <button
            type="button"
            class="rounded-md px-2 py-1 text-[12px] font-medium text-ios-red transition-colors hover:bg-ios-red/10 dark:text-ios-red-dark dark:hover:bg-ios-red-dark/10"
            @click="removeCommand(command.label)"
          >
            {{ t('DELETE') }}
          </button>
        </div>
      </div>
      <p
        v-if="store.config.customCommands.length === 0"
        class="border-t border-figma-border px-4 py-6 text-center text-[12px] text-ios-label-secondary dark:border-figma-border-dark dark:text-ios-label-secondary-dark"
      >
        {{ t('NO_CUSTOM_COMMANDS_YET') }}
      </p>
    </SettingGroup>

    <!-- 添加 / 编辑指令弹窗 -->
    <div v-if="commandDraft" class="fixed inset-0 z-[60] flex items-center justify-center p-3">
      <div class="absolute inset-0 bg-black/25 dark:bg-black/60" @click="closeCommandModal" />
      <div
        class="relative flex max-h-[85vh] w-full max-w-[360px] flex-col overflow-hidden rounded-2xl border border-figma-border bg-figma-surface dark:border-figma-border-dark dark:bg-figma-surface-dark"
      >
        <div class="flex shrink-0 items-center justify-between border-b border-figma-border px-4 py-3 dark:border-figma-border-dark">
          <h2 class="text-[15px] font-semibold text-figma-text dark:text-figma-text-dark">
            {{ editingCommandLabel ? t('EDIT_COMMAND') : t('ADD_COMMAND') }}
          </h2>
          <button
            type="button"
            :aria-label="t('CLOSE')"
            class="flex h-7 w-7 items-center justify-center rounded-full text-ios-label-secondary transition-colors hover:bg-ios-fill dark:text-ios-label-secondary-dark dark:hover:bg-ios-fill-dark"
            @click="closeCommandModal"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <div class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
          <label class="block">
            <span class="mb-1.5 block text-[12px] font-medium text-ios-label-secondary dark:text-ios-label-secondary-dark">
              {{ t('COMMAND_NAME') }}
            </span>
            <input
              v-model="commandDraft.label"
              type="text"
              :placeholder="t('SKELETON')"
              :class="[inputClass, commandLabelError ? invalidInputClass : '']"
            />
            <span v-if="commandLabelError" class="mt-1 block text-[11px] text-ios-red dark:text-ios-red-dark">
              {{ commandLabelError }}
            </span>
          </label>

          <label class="block">
            <span class="mb-1.5 block text-[12px] font-medium text-ios-label-secondary dark:text-ios-label-secondary-dark">
              {{ t('DESCRIPTION') }}
            </span>
            <input
              v-model="commandDraft.description"
              type="text"
              :placeholder="t('SHORT_DESCRIPTION_IN_THE_SUGGESTION_LIST')"
              :class="[inputClass, commandDescriptionError ? invalidInputClass : '']"
            />
            <span v-if="commandDescriptionError" class="mt-1 block text-[11px] text-ios-red dark:text-ios-red-dark">
              {{ commandDescriptionError }}
            </span>
          </label>

          <label class="block">
            <span class="mb-1.5 block text-[12px] font-medium text-ios-label-secondary dark:text-ios-label-secondary-dark">
              {{ t('PROMPT_TEMPLATE') }}
            </span>
            <textarea
              v-model="commandDraft.prompt"
              rows="6"
              :placeholder="t('FULL_PROMPT_INSERTED_INTO_THE_INPUT')"
              :class="[inputClass, 'resize-none leading-5', commandPromptError ? invalidInputClass : '']"
            ></textarea>
            <span v-if="commandPromptError" class="mt-1 block text-[11px] text-ios-red dark:text-ios-red-dark">
              {{ commandPromptError }}
            </span>
          </label>
        </div>

        <div class="flex shrink-0 gap-2 border-t border-figma-border px-4 py-3 dark:border-figma-border-dark">
          <button type="button" :class="[secondaryBtnClass, 'flex-1']" @click="closeCommandModal">
            {{ t('CANCEL') }}
          </button>
          <button
            type="button"
            class="flex-1 rounded-lg bg-ios-blue px-3.5 py-2.5 text-[14px] font-medium text-white transition-colors hover:bg-ios-blue/90 dark:bg-ios-blue-dark dark:hover:bg-ios-blue-dark/90"
            @click="saveCommandDraft"
          >
            {{ t('SAVE') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
