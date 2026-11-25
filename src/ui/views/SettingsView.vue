<script setup lang="ts">
/**
 * 设置页（PRD 第 6 章 / DEV.md 4.3）
 * 顶部返回 + 标题，四个 Tab 自定义分段控件切换；各 Tab 直接读写 Pinia config store，
 * 保存时通过 bridge 写盘，重置仅恢复内存默认值
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { normalizeBaseUrl, normalizeConfig, parseExtraBody } from '../../../types/config.types'
import { useConfigStore } from '../store/config'
import CommandsTab from './settings/CommandsTab.vue'
import GeneralTab from './settings/GeneralTab.vue'
import ModelsTab from './settings/ModelsTab.vue'
import PromptTab from './settings/PromptTab.vue'
import { findDuplicateModel, modelError } from './settings/modelValidation'
import { secondaryBtnClass } from './settings/formStyles'

type TabKey = 'models' | 'commands' | 'prompt' | 'general'

const emit = defineEmits<{ (e: 'back'): void }>()

const store = useConfigStore()

/* ---------- Tab 分段控件 ---------- */
const tabs: { key: TabKey; label: string }[] = [
  { key: 'models', label: '模型' },
  { key: 'commands', label: '指令' },
  { key: 'prompt', label: '提示词' },
  { key: 'general', label: '通用设置' }
]
const activeTab = ref<TabKey>('models')

const modelsTabRef = ref<InstanceType<typeof ModelsTab> | null>(null)
const commandsTabRef = ref<InstanceType<typeof CommandsTab> | null>(null)

/* ---------- Toast ---------- */
const toast = ref<{ type: 'success' | 'error'; text: string } | null>(null)
let toastTimer: ReturnType<typeof setTimeout> | null = null
function showToast(text: string, type: 'success' | 'error' = 'success'): void {
  toast.value = { type, text }
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    toast.value = null
  }, 2200)
}
onBeforeUnmount(() => {
  if (toastTimer) clearTimeout(toastTimer)
})

/* ---------- 加载与脏检查 ---------- */
const savedSnapshot = ref('')
onMounted(async () => {
  await store.load()
  savedSnapshot.value = JSON.stringify(store.config)
})
const isDirty = computed(
  () => savedSnapshot.value !== '' && JSON.stringify(store.config) !== savedSnapshot.value
)

/** 子组件清除所有数据后同步快照，避免被判定为未保存更改 */
function syncSavedSnapshot(): void {
  savedSnapshot.value = JSON.stringify(store.config)
}

/* ---------- 返回 ---------- */
function onBack(): void {
  if (isDirty.value) {
    showToast('更改尚未保存')
    setTimeout(() => emit('back'), 500)
  } else {
    emit('back')
  }
}

/* ---------- 底部操作 ---------- */
function resetForm(): void {
  modelsTabRef.value?.closeModals()
  commandsTabRef.value?.closeModal()
  store.update(normalizeConfig())
  showToast('已恢复默认配置（尚未保存）')
}

const saving = ref(false)
async function saveSettings(): Promise<void> {
  const invalid = store.config.models.find((entry) => modelError(entry))
  if (invalid) {
    activeTab.value = 'models'
    modelsTabRef.value?.openEditor(invalid.id)
    showToast(modelError(invalid), 'error')
    return
  }
  // 同一 Base URL 下不允许重复模型 ID（兜底校验，防止旧配置绕过弹窗）
  const duplicate = findDuplicateModel(store.config.models)
  if (duplicate) {
    activeTab.value = 'models'
    modelsTabRef.value?.openEditor(duplicate.id)
    showToast('当前 Base URL 下已存在相同模型 ID', 'error')
    return
  }
  // 额外请求体按模型逐个校验，出错时打开对应模型弹窗
  for (const entry of store.config.models) {
    const name = entry.name || entry.model || '未命名模型'
    const extraBody = parseExtraBody(entry.generation.extraBody)
    if (!extraBody.ok) {
      activeTab.value = 'models'
      modelsTabRef.value?.openEditor(entry.id)
      showToast(`模型「${name}」的额外请求体 JSON 无效：${extraBody.error}`, 'error')
      return
    }
  }
  saving.value = true
  try {
    // 保存前 trim；空名称回退为模型 ID，store.save() 会再做一次归一化
    store.update({
      models: store.config.models.map((entry) => ({
        ...entry,
        name: entry.name.trim() || entry.model.trim(),
        model: entry.model.trim(),
        baseUrl: normalizeBaseUrl(entry.baseUrl),
        apiKey: entry.apiKey.trim()
      }))
    })
    await store.save()
    savedSnapshot.value = JSON.stringify(store.config)
    showToast('设置已保存')
  } catch (err) {
    showToast(err instanceof Error ? `保存失败：${err.message}` : '保存失败', 'error')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div
    class="relative flex h-full min-h-0 w-full flex-col bg-figma-bg text-figma-text dark:bg-figma-bg-dark dark:text-figma-text-dark"
  >
    <!-- Toast -->
    <Transition name="toast">
      <div
        v-if="toast"
        class="absolute left-1/2 top-3 z-[70] -translate-x-1/2 whitespace-nowrap rounded-xl px-4 py-2.5 text-[13px] font-medium"
        :class="
          toast.type === 'success'
            ? 'bg-[#1C1C1E] text-white dark:bg-white dark:text-black'
            : 'bg-ios-red text-white dark:bg-ios-red-dark'
        "
      >
        {{ toast.text }}
      </div>
    </Transition>

    <!-- 顶部：返回 + 标题（iOS 导航条） -->
    <header
      class="flex h-12 shrink-0 items-center gap-1 border-b border-figma-border bg-figma-surface px-2 dark:border-figma-border-dark dark:bg-figma-surface-dark"
    >
      <button
        type="button"
        aria-label="返回对话"
        class="flex h-8 w-8 items-center justify-center rounded-full text-ios-blue transition-colors hover:bg-ios-fill dark:text-ios-blue-dark dark:hover:bg-ios-fill-dark"
        @click="onBack"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path
            d="M10 3 5 8l5 5"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </button>
      <h1 class="text-base font-semibold tracking-[-0.01em]">设置</h1>
    </header>

    <!-- Tab 分段控件（iOS Segmented Control） -->
    <nav class="shrink-0 px-4 pt-4">
      <div class="flex rounded-lg bg-ios-fill p-1 dark:bg-ios-fill-dark">
        <button
          v-for="tab in tabs"
          :key="tab.key"
          type="button"
          class="flex-1 rounded-md px-1 py-2 text-[13px] font-medium transition-colors"
          :class="
            activeTab === tab.key
              ? 'bg-figma-surface text-figma-text dark:bg-ios-fill-secondary-dark dark:text-figma-text-dark'
              : 'text-ios-label-secondary dark:text-ios-label-secondary-dark'
          "
          @click="activeTab = tab.key"
        >
          {{ tab.label }}
        </button>
      </div>
    </nav>

    <!-- 内容区 -->
    <main class="flex-1 overflow-y-auto px-4 py-4">
      <ModelsTab
        ref="modelsTabRef"
        v-show="activeTab === 'models'"
        @notify="(text, type) => showToast(text, type)"
      />

      <CommandsTab
        ref="commandsTabRef"
        v-show="activeTab === 'commands'"
        @notify="(text, type) => showToast(text, type)"
      />

      <PromptTab v-show="activeTab === 'prompt'" @notify="(text, type) => showToast(text, type)" />

      <GeneralTab
        v-show="activeTab === 'general'"
        @notify="(text, type) => showToast(text, type)"
        @cleared="syncSavedSnapshot"
      />
    </main>

    <!-- 底部操作 -->
    <footer
      class="flex shrink-0 items-center gap-3 border-t border-figma-border bg-figma-surface px-4 py-3 dark:border-figma-border-dark dark:bg-figma-surface-dark"
    >
      <button type="button" :disabled="saving" :class="[secondaryBtnClass, 'flex-1']" @click="resetForm">
        重置
      </button>
      <button
        type="button"
        :disabled="saving"
        class="flex-1 rounded-lg bg-ios-blue px-3.5 py-2.5 text-[14px] font-semibold text-white transition-colors hover:bg-ios-blue/90 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-ios-blue-dark dark:hover:bg-ios-blue-dark/90"
        @click="saveSettings"
      >
        {{ saving ? '保存中…' : '保存' }}
      </button>
    </footer>
  </div>
</template>

<style scoped>
.toast-enter-active,
.toast-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translate(-50%, -4px);
}
</style>
