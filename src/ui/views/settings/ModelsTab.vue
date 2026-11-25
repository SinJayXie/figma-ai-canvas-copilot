<script setup lang="ts">
/**
 * 设置页 Tab：模型与服务商
 * 模型列表 + 添加/编辑子页面（push/pop 导航，非弹窗）：
 * 基础信息 / 上下文窗口 / 对话参数 / 思考模式 / 采样参数 / 连通性测试
 */
import { computed, ref, watch } from 'vue'
import {
  DEFAULT_GENERATION,
  PROVIDER_PRESETS,
  getProviderPreset,
  normalizeBaseUrl,
  normalizeGeneration,
  parseExtraBody,
  type GenerationParams,
  type ModelEntry,
  type ReasoningEffort
} from '../../../../types/config.types'
import { confirmAction } from '../../composables/useConfirm'
import { useT } from '../../i18n'
import { localizedProviderName } from '../../i18n/providerNames'
import { useConfigStore } from '../../store/config'
import { generateId } from '../../utils/uuid'
import SettingGroup from '../../components/SettingGroup.vue'
import SettingItem from '../../components/SettingItem.vue'
import SettingToggle from '../../components/SettingToggle.vue'
import NumberInput from '../../components/NumberInput.vue'
import { inputClass, invalidInputClass, selectClass, secondaryBtnClass } from './formStyles'
import {
  draftApiKeyError as resolveDraftApiKeyError,
  draftBaseUrlError as resolveDraftBaseUrlError,
  draftModelIdError as resolveDraftModelIdError,
  draftNameError as resolveDraftNameError,
  modelError
} from './modelValidation'

const emit = defineEmits<{
  (e: 'notify', text: string, type?: 'success' | 'error'): void
}>()

const store = useConfigStore()
const t = useT()

const visibleApiKeys = ref<Record<string, boolean>>({})
const testingModelId = ref('')
const testResults = ref<Record<string, { ok: boolean; message: string }>>({})

/** 添加 / 编辑子页面：draft 为 null 表示在列表页 */
const modelDraft = ref<ModelEntry | null>(null)
const modelModalMode = ref<'add' | 'edit'>('add')
const draftProvider = computed(() =>
  modelDraft.value ? getProviderPreset(modelDraft.value.provider) : null
)

/* ---------- 生成参数读写 ---------- */
const draftGeneration = computed(() => modelDraft.value?.generation ?? DEFAULT_GENERATION)

/** 与默认值相同则返回 null，NumberInput 显示为空（「留空使用最佳默认值」） */
type NumericGenKey =
  | 'temperature'
  | 'topP'
  | 'topK'
  | 'maxTokens'
  | 'thinkingBudget'
  | 'contextInput'
  | 'toolRounds'

function genNum(key: NumericGenKey): number | null {
  const value = draftGeneration.value[key]
  if (value === null) return null
  return value === DEFAULT_GENERATION[key] ? null : (value as number)
}

function patchGeneration<K extends keyof GenerationParams>(key: K, value: GenerationParams[K]): void {
  if (modelDraft.value) modelDraft.value.generation[key] = value
}

function onDraftTemperature(value: number | null): void {
  patchGeneration('temperature', value === null ? DEFAULT_GENERATION.temperature : Math.min(2, Math.max(0, Math.round(value * 10) / 10)))
}
function onDraftTopP(value: number | null): void {
  patchGeneration('topP', value === null ? DEFAULT_GENERATION.topP : Math.min(1, Math.max(0, Math.round(value * 100) / 100)))
}
function onDraftTopK(value: number | null): void {
  patchGeneration('topK', value === null ? DEFAULT_GENERATION.topK : Math.min(100, Math.max(0, Math.round(value))))
}
function onDraftMaxTokens(value: number | null): void {
  patchGeneration('maxTokens', value === null ? DEFAULT_GENERATION.maxTokens : Math.min(131072, Math.max(1, Math.round(value))))
}
function onDraftThinkingBudget(value: number | null): void {
  patchGeneration('thinkingBudget', value === null ? DEFAULT_GENERATION.thinkingBudget : Math.min(131072, Math.max(0, Math.round(value))))
}
function onDraftContextInput(value: number | null): void {
  patchGeneration('contextInput', value === null ? null : Math.min(1048576, Math.max(1024, Math.round(value))))
}
function onDraftToolRounds(value: number | null): void {
  patchGeneration('toolRounds', value === null ? DEFAULT_GENERATION.toolRounds : Math.min(500, Math.max(1, Math.round(value))))
}
function onDraftReasoningEffort(event: Event): void {
  const value = (event.target as HTMLSelectElement).value as ReasoningEffort
  patchGeneration('reasoningEffort', value)
}

/* ---------- 上下文窗口 / 输出快捷标签 ---------- */
const CONTEXT_INPUT_CHIPS: { label: string; value: number }[] = [
  { label: '128k', value: 131072 },
  { label: '256k', value: 262144 },
  { label: '512k', value: 524288 },
  { label: '1M', value: 1048576 }
]
const OUTPUT_CHIPS: { label: string; value: number }[] = [
  { label: '4k', value: 4096 },
  { label: '16k', value: 16384 },
  { label: '32k', value: 32768 },
  { label: '128k', value: 131072 }
]

const chipBtnClass =
  'rounded-md bg-ios-fill px-1.5 py-0.5 text-[11px] font-medium text-ios-label-secondary transition-colors hover:bg-ios-blue/10 hover:text-ios-blue dark:bg-ios-fill-dark dark:text-ios-label-secondary-dark dark:hover:bg-ios-blue-dark/15 dark:hover:text-ios-blue-dark'
const chipActiveClass =
  'rounded-md bg-ios-blue/10 px-1.5 py-0.5 text-[11px] font-semibold text-ios-blue dark:bg-ios-blue-dark/15 dark:text-ios-blue-dark'

const numberInputClass = 'w-28'

function onDraftProviderChange(): void {
  if (modelDraft.value) onProviderChange(modelDraft.value)
}

/** 服务商描述文案 key（与 locale 中的大写下划线 key 一一对应） */
const PROVIDER_DESCRIPTION_KEYS: Record<string, string> = {
  deepseek: 'OFFICIAL_API_WITH_REASONING_MODELS',
  openai: 'OFFICIAL_GPT_O_SERIES_ENDPOINT',
  moonshot: 'MOONSHOT_KIMI',
  zhipu: 'GLM_4_SERIES',
  qwen: 'ALIBABA_CLOUD_BAILIAN_COMPATIBLE_MODE',
  siliconflow: 'MULTI_MODEL_AGGREGATION_PLATFORM',
  openrouter: 'AGGREGATES_MULTIPLE_OVERSEAS_MODELS',
  groq: 'LOW_LATENCY_INFERENCE',
  mistral: 'OFFICIAL_MISTRAL_API',
  xai: 'GROK_SERIES',
  gemini: 'GEMINI_OPENAI_COMPATIBLE_ENDPOINT',
  ollama: 'LOCAL_MODELS_USUALLY_NO_KEY_NEEDED',
  custom: 'ANY_OPENAI_COMPATIBLE_ENDPOINT',
}

const activeEntry = computed(
  () => store.config.models.find((entry) => entry.id === store.config.activeModelId) ?? null
)

function isActiveModel(id: string): boolean {
  return store.config.activeModelId === id
}

function providerName(entry: ModelEntry): string {
  return localizedProviderName(entry.provider)
}

function modelSuggestions(entry: ModelEntry): string[] {
  return getProviderPreset(entry.provider).models
}

function providerDocs(entry: ModelEntry): string | undefined {
  return getProviderPreset(entry.provider).docsUrl
}

/** 服务商要求 Key 但当前未填写 */
function modelNeedsKey(entry: ModelEntry): boolean {
  return getProviderPreset(entry.provider).requiresApiKey && !entry.apiKey.trim()
}

/** 选择当前使用模型，并同步兼容字段 model */
function selectModel(id: string): void {
  const entry = store.config.models.find((item) => item.id === id)
  if (!entry) return
  store.config.activeModelId = entry.id
  store.config.model = entry.model
}

/** 切换服务商：地址为空或仍是某个预设默认值时，自动套用新预设 */
function onProviderChange(entry: ModelEntry): void {
  const preset = getProviderPreset(entry.provider)
  const isKnownPresetUrl = PROVIDER_PRESETS.some(
    (item) => item.baseUrl && item.baseUrl === normalizeBaseUrl(entry.baseUrl)
  )
  if (!entry.baseUrl.trim() || isKnownPresetUrl) entry.baseUrl = preset.baseUrl
  if (!entry.model.trim() && preset.models[0]) entry.model = preset.models[0]
  // 切换服务商后旧 Key 不再适用，清空避免把 A 厂商密钥发到 B 厂商
  entry.apiKey = ''
  if (isActiveModel(entry.id)) store.config.model = entry.model
  delete testResults.value[entry.id]
}

/** 添加页面的默认草稿（重置按钮也复用） */
function buildDefaultDraft(): ModelEntry {
  const preset = getProviderPreset('deepseek')
  return {
    id: generateId('model'),
    name: preset.name,
    provider: preset.id,
    model: preset.models[0] ?? '',
    baseUrl: preset.baseUrl,
    apiKey: '',
    generation: { ...DEFAULT_GENERATION, stop: [] }
  }
}

/** push 进入“添加模型”子页面 */
function openAddModel(): void {
  modelDraft.value = buildDefaultDraft()
  modelModalMode.value = 'add'
  resetModelTouched()
}

/** push 进入“编辑模型”子页面（深拷贝，返回不影响列表） */
function openEditModel(entry: ModelEntry): void {
  modelDraft.value = {
    ...entry,
    generation: { ...entry.generation, stop: [...entry.generation.stop] }
  }
  modelModalMode.value = 'edit'
  resetModelTouched()
}

/** pop 返回列表（丢弃未保存的草稿） */
function closeModelModal(): void {
  modelDraft.value = null
  resetModelTouched()
}

/** 「重置」：添加模式恢复默认草稿，编辑模式还原为列表里的原值 */
function resetModelDraft(): void {
  if (modelModalMode.value === 'add') {
    modelDraft.value = buildDefaultDraft()
  } else if (modelDraft.value) {
    const source = store.config.models.find((item) => item.id === modelDraft.value?.id)
    if (source) {
      modelDraft.value = {
        ...source,
        generation: { ...source.generation, stop: [...source.generation.stop] }
      }
    }
  }
  resetModelTouched()
}

/** 保存当前草稿：只写入内存配置，底部「保存」再统一落盘 */
function saveModelDraft(): void {
  const draft = modelDraft.value
  if (!draft) return
  touchAllModelFields()
  const error = firstModelFormError.value
  if (error) {
    emit('notify', error, 'error')
    focusFirstModelFormError()
    return
  }
  const extraBody = parseExtraBody(draft.generation.extraBody)
  if (!extraBody.ok) {
    emit('notify', t('INVALID_EXTRA_REQUEST_BODY_JSON', { error: extraBody.error }), 'error')
    return
  }
  const next: ModelEntry = {
    ...draft,
    name: draft.name.trim() || draft.model.trim() || localizedProviderName(draft.provider),
    model: draft.model.trim(),
    baseUrl: normalizeBaseUrl(draft.baseUrl),
    apiKey: draft.apiKey.trim(),
    generation: normalizeGeneration(draft.generation)
  }
  const index = store.config.models.findIndex((item) => item.id === next.id)
  if (index >= 0) store.config.models[index] = next
  else store.config.models.push(next)
  if (isActiveModel(next.id)) store.config.model = next.model
  delete testResults.value[next.id]
  const added = modelModalMode.value === 'add'
  modelDraft.value = null
  resetModelTouched()
  emit('notify', added ? t('MODEL_ADDED_REMEMBER_TO_SAVE_SETTINGS') : t('MODEL_UPDATED_REMEMBER_TO_SAVE_SETTINGS'), 'success')
}

async function removeModel(id: string): Promise<void> {
  if (store.config.models.length <= 1) return
  const entry = store.config.models.find((item) => item.id === id)
  if (!entry) return
  // 删除前确认，避免误删已填写的 API 配置
  const confirmed = await confirmAction({
    title: t('DELETE_MODEL_CONFIRM'),
    message: t('THIS_DELETES_AND_ITS_API_KEY', {
      name: entry.name || entry.model || t('UNTITLED_MODEL'),
    }),
    confirmText: t('DELETE'),
    danger: true
  })
  if (!confirmed) return
  const index = store.config.models.findIndex((item) => item.id === id)
  if (index < 0) return
  store.config.models.splice(index, 1)
  delete testResults.value[id]
  delete visibleApiKeys.value[id]
  if (store.config.activeModelId === id) selectModel(store.config.models[0].id)
}

function toggleKeyVisibility(id: string): void {
  visibleApiKeys.value[id] = !visibleApiKeys.value[id]
}

async function copyText(text: string): Promise<void> {
  if (!text) {
    emit('notify', t('NOTHING_TO_COPY_PLAIN'), 'error')
    return
  }
  try {
    await navigator.clipboard.writeText(text)
    emit('notify', t('COPIED_TO_CLIPBOARD'))
  } catch {
    try {
      const textarea = document.createElement('textarea')
      textarea.value = text
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
      emit('notify', t('COPIED_TO_CLIPBOARD'))
    } catch {
      emit('notify', t('COPY_FAILED_PLEASE_COPY_MANUALLY'), 'error')
    }
  }
}

/* ---------- 表单校验 ---------- */

/** 字段是否已触碰（blur / 保存后展示错误） */
const modelFormTouched = ref<Record<string, boolean>>({})

function touchModelField(field: string): void {
  modelFormTouched.value = { ...modelFormTouched.value, [field]: true }
}

function touchAllModelFields(): void {
  modelFormTouched.value = { name: true, model: true, baseUrl: true, apiKey: true }
}

function resetModelTouched(): void {
  modelFormTouched.value = {}
}

const draftNameError = computed(() => resolveDraftNameError(modelDraft.value))

const draftModelIdError = computed(() =>
  resolveDraftModelIdError(modelDraft.value, store.config.models)
)

const draftBaseUrlError = computed(() => resolveDraftBaseUrlError(modelDraft.value))

const draftApiKeyError = computed(() => resolveDraftApiKeyError(modelDraft.value))

/** 第一个错误，按字段顺序 */
const firstModelFormError = computed(
  () =>
    draftNameError.value ||
    draftModelIdError.value ||
    draftBaseUrlError.value ||
    draftApiKeyError.value
)

/** 各字段当前是否展示错误（失焦 / 保存 / 测试后） */
const showNameError = computed(() => !!modelFormTouched.value.name && !!draftNameError.value)
const showModelIdError = computed(
  () => !!modelFormTouched.value.model && !!draftModelIdError.value
)
const showBaseUrlError = computed(
  () =>
    (!!modelFormTouched.value.baseUrl || !!modelDraft.value?.baseUrl.trim()) &&
    !!draftBaseUrlError.value
)
const showApiKeyError = computed(
  () => !!modelFormTouched.value.apiKey && !!draftApiKeyError.value
)

const nameInputRef = ref<HTMLInputElement | null>(null)
const modelInputRef = ref<HTMLInputElement | null>(null)
const baseUrlInputRef = ref<HTMLInputElement | null>(null)
const apiKeyInputRef = ref<HTMLInputElement | null>(null)

/** 保存 / 测试失败时聚焦第一个出错字段 */
function focusFirstModelFormError(): void {
  if (draftNameError.value) nameInputRef.value?.focus()
  else if (draftModelIdError.value) modelInputRef.value?.focus()
  else if (draftBaseUrlError.value) baseUrlInputRef.value?.focus()
  else if (draftApiKeyError.value) apiKeyInputRef.value?.focus()
}

/** 表单字段变化后清空旧的连接测试结果，避免展示过期状态 */
watch(
  () => {
    const draft = modelDraft.value
    return draft ? `${draft.provider}|${draft.model}|${draft.baseUrl}|${draft.apiKey}` : ''
  },
  () => {
    if (modelDraft.value) delete testResults.value[modelDraft.value.id]
  }
)

/** 测试连接前先走表单校验，避免无效配置直接发请求 */
function testModelDraft(): void {
  touchAllModelFields()
  if (firstModelFormError.value) {
    emit('notify', firstModelFormError.value, 'error')
    focusFirstModelFormError()
    return
  }
  if (modelDraft.value) void testModel(modelDraft.value)
}

/** 单模型连接测试（按该模型自己的地址与密钥） */
async function testModel(entry: ModelEntry): Promise<void> {
  const error = modelError(entry)
  if (error) {
    testResults.value[entry.id] = { ok: false, message: error }
    return
  }
  testingModelId.value = entry.id
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15000)
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (entry.apiKey.trim()) headers.Authorization = `Bearer ${entry.apiKey.trim()}`
  try {
    const res = await fetch(`${normalizeBaseUrl(entry.baseUrl)}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: entry.model.trim(),
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1
      }),
      signal: controller.signal
    })
    if (res.ok) {
      testResults.value[entry.id] = { ok: true, message: t('CONNECTED') }
    } else {
      const body = await res.text().catch(() => '')
      testResults.value[entry.id] = {
        ok: false,
        message: `HTTP ${res.status}${body ? `：${body.slice(0, 120)}` : ''}`
      }
    }
  } catch (err) {
    const aborted = (err as Error)?.name === 'AbortError'
    testResults.value[entry.id] = {
      ok: false,
      message: aborted
        ? t('CONNECTION_TIMED_OUT_15S')
        : t('CONNECTION_FAILED', { message: err instanceof Error ? err.message : String(err) })
    }
  } finally {
    clearTimeout(timer)
    if (testingModelId.value === entry.id) testingModelId.value = ''
  }
}

/** 供 SettingsView 保存校验失败时定位到对应模型并打开编辑页 */
function openEditor(id: string): void {
  const entry = store.config.models.find((item) => item.id === id)
  if (entry) openEditModel(entry)
}

/** 供 SettingsView「重置」前关闭子页面并清空临时状态 */
function closeModals(): void {
  modelDraft.value = null
  resetModelTouched()
  testResults.value = {}
  visibleApiKeys.value = {}
}

defineExpose({ openEditor, closeModals })
</script>

<template>
  <div class="flex flex-col gap-5">
    <!-- 列表视图 -->
    <template v-if="!modelDraft">
      <!-- 当前使用 -->
      <SettingGroup :title="t('CURRENT_MODEL')">
        <div class="flex items-center gap-3 px-4 py-3">
          <span
            class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ios-blue/10 text-[13px] font-semibold text-ios-blue dark:bg-ios-blue-dark/15 dark:text-ios-blue-dark"
          >
            {{ activeEntry ? providerName(activeEntry).slice(0, 2) : '—' }}
          </span>
          <div class="min-w-0 flex-1">
            <p class="truncate text-[14px] font-medium text-figma-text dark:text-figma-text-dark">
              {{ activeEntry?.name || t('NO_MODEL_CONFIGURED_YET') }}
            </p>
            <p
              class="truncate text-[12px] text-ios-label-secondary dark:text-ios-label-secondary-dark"
            >
              {{
                activeEntry
                  ? `${providerName(activeEntry)} · ${activeEntry.model || t('NO_MODEL_ID')}`
                  : t('ADD_A_MODEL_BELOW')
              }}
            </p>
          </div>
        </div>
      </SettingGroup>

      <!-- 模型列表 -->
      <SettingGroup :title="t('MODEL_LIST')">
        <p
          class="px-4 pb-1 pt-3 text-[12px] leading-[18px] text-ios-label-secondary dark:text-ios-label-secondary-dark"
        >
          {{ t('CLICK_EDIT_TO_CONFIGURE_THE_PROVIDER') }}
        </p>

        <div
          v-for="entry in store.config.models"
          :key="entry.id"
          class="flex items-center gap-2 px-4 py-3"
        >
          <div class="min-w-0 flex-1">
            <div class="flex min-w-0 items-center gap-1.5">
              <span
                class="truncate text-[14px] font-medium text-figma-text dark:text-figma-text-dark"
              >
                {{ entry.name || entry.model || t('UNTITLED_MODEL') }}
              </span>
              <span
                v-if="isActiveModel(entry.id)"
                class="shrink-0 rounded-full bg-ios-blue/10 px-1.5 py-0.5 text-[10px] font-semibold text-ios-blue dark:bg-ios-blue-dark/15 dark:text-ios-blue-dark"
              >
                {{ t('DEFAULT') }}
              </span>
              <span
                v-if="modelNeedsKey(entry)"
                class="shrink-0 rounded bg-ios-red/10 px-1 text-[10px] font-medium text-ios-red dark:bg-ios-red-dark/15 dark:text-ios-red-dark"
              >
                {{ t('MISSING_KEY') }}
              </span>
            </div>
            <div
              class="mt-0.5 truncate text-[12px] text-ios-label-secondary dark:text-ios-label-secondary-dark"
            >
              {{ providerName(entry) }} · {{ entry.model || t('NO_MODEL_ID') }}
            </div>
          </div>

          <div class="flex shrink-0 items-center gap-0.5">
            <button
              v-if="!isActiveModel(entry.id)"
              type="button"
              class="rounded-md px-2 py-1 text-[12px] font-medium text-ios-blue transition-colors hover:bg-ios-blue/10 dark:text-ios-blue-dark dark:hover:bg-ios-blue-dark/15"
              @click="selectModel(entry.id)"
            >
              {{ t('SET_AS_DEFAULT') }}
            </button>
            <button
              type="button"
              class="rounded-md px-2 py-1 text-[12px] font-medium text-ios-blue transition-colors hover:bg-ios-blue/10 dark:text-ios-blue-dark dark:hover:bg-ios-blue-dark/15"
              @click="openEditModel(entry)"
            >
              {{ t('EDIT') }}
            </button>
            <button
              type="button"
              :disabled="store.config.models.length <= 1"
              class="rounded-md px-2 py-1 text-[12px] font-medium text-ios-red transition-colors hover:bg-ios-red/10 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent dark:text-ios-red-dark dark:hover:bg-ios-red-dark/10"
              @click="removeModel(entry.id)"
            >
              {{ t('DELETE') }}
            </button>
          </div>
        </div>

        <button
          type="button"
          class="flex w-full items-center justify-center gap-1.5 px-4 py-3 text-[14px] font-medium text-ios-blue transition-colors hover:bg-ios-fill dark:text-ios-blue-dark dark:hover:bg-ios-fill-dark"
          @click="openAddModel"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
          </svg>
          {{ t('ADD_MODEL') }}
        </button>
      </SettingGroup>
    </template>

    <!-- 添加 / 编辑模型：整屏覆盖的 push 子页面（相对设置页根节点定位，左右滑入滑出） -->
    <Transition name="model-push">
      <div
        v-if="modelDraft"
        class="absolute inset-0 z-20 flex flex-col bg-figma-bg dark:bg-figma-bg-dark"
      >
        <!-- 子页面标题栏：返回 + 标题 -->
        <div
          class="flex h-12 shrink-0 items-center gap-1 border-b border-figma-border px-2 dark:border-figma-border-dark"
        >
        <button
          type="button"
          :aria-label="t('BACK_TO_LIST')"
          class="flex h-8 w-8 items-center justify-center rounded-full text-ios-blue transition-colors hover:bg-ios-fill dark:text-ios-blue-dark dark:hover:bg-ios-fill-dark"
          @click="closeModelModal"
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
        <h2 class="text-[15px] font-semibold tracking-[-0.01em]">
          {{ modelModalMode === 'add' ? t('ADD_MODEL') : t('EDIT_MODEL') }}
        </h2>
        <button
          v-if="modelModalMode === 'edit'"
          type="button"
          class="ml-auto rounded-md px-2 py-1 text-[12px] font-medium text-ios-label-secondary transition-colors hover:bg-ios-fill dark:text-ios-label-secondary-dark dark:hover:bg-ios-fill-dark"
          @click="closeModelModal"
        >
          {{ t('CANCEL') }}
        </button>
        </div>

        <!-- 表单主体：整屏滚动（360 窄宽度下全部纵向排布，避免控件被挤压） -->
        <div class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
        <!-- 基础信息 -->
        <SettingGroup :title="t('BASICS')">
        <div class="flex flex-col gap-3 px-4 py-3">
          <div class="flex flex-col gap-1.5">
            <span class="text-[12px] text-ios-label-secondary dark:text-ios-label-secondary-dark">{{ t('DISPLAY_NAME') }}</span>
            <input
              ref="nameInputRef"
              v-model="modelDraft.name"
              type="text"
              :aria-label="t('MODEL_DISPLAY_NAME')"
              :placeholder="t('E_G_DEEPSEEK_CHAT')"
              maxlength="40"
              spellcheck="false"
              :aria-invalid="showNameError"
              :class="showNameError ? invalidInputClass : inputClass"
              @blur="touchModelField('name')"
            />
            <span
              v-if="showNameError"
              class="text-[12px] leading-[18px] text-ios-red dark:text-ios-red-dark"
            >
              {{ draftNameError }}
            </span>
          </div>

          <div class="flex flex-col gap-1.5">
            <span class="text-[12px] text-ios-label-secondary dark:text-ios-label-secondary-dark">{{ t('PROVIDER') }}</span>
            <select v-model="modelDraft.provider" :class="selectClass" @change="onDraftProviderChange">
              <option v-for="preset in PROVIDER_PRESETS" :key="preset.id" :value="preset.id">
                {{ localizedProviderName(preset.id) }}
              </option>
            </select>
            <span v-if="draftProvider" class="text-[11px] leading-4 text-ios-label-secondary dark:text-ios-label-secondary-dark">
              {{ t(PROVIDER_DESCRIPTION_KEYS[draftProvider.id] ?? draftProvider.description) }}
            </span>
          </div>

          <div class="flex flex-col gap-1.5">
            <span class="text-[12px] text-ios-label-secondary dark:text-ios-label-secondary-dark">
              {{ t('MODEL_ID') }} <span class="text-ios-red dark:text-ios-red-dark">*</span>
            </span>
            <input
              ref="modelInputRef"
              v-model="modelDraft.model"
              type="text"
              :aria-label="t('API_MODEL_ID')"
              list="model-page-options"
              :placeholder="t('E_G_DEEPSEEK_CHAT_GPT_4O')"
              maxlength="200"
              spellcheck="false"
              :aria-invalid="showModelIdError"
              :class="showModelIdError ? invalidInputClass : inputClass"
              @blur="touchModelField('model')"
            />
            <datalist id="model-page-options">
              <option v-for="item in modelSuggestions(modelDraft)" :key="item" :value="item" />
            </datalist>
            <span
              v-if="showModelIdError"
              class="text-[12px] leading-[18px] text-ios-red dark:text-ios-red-dark"
            >
              {{ draftModelIdError }}
            </span>
          </div>

          <div class="flex flex-col gap-1.5">
            <span class="text-[12px] text-ios-label-secondary dark:text-ios-label-secondary-dark">
              Base URL <span class="text-ios-red dark:text-ios-red-dark">*</span>
            </span>
            <input
              ref="baseUrlInputRef"
              v-model="modelDraft.baseUrl"
              type="text"
              aria-label="Base URL"
              placeholder="https://api.example.com/v1"
              spellcheck="false"
              :aria-invalid="showBaseUrlError"
              :class="showBaseUrlError ? invalidInputClass : inputClass"
              @blur="touchModelField('baseUrl')"
            />
            <span
              v-if="showBaseUrlError"
              class="text-[12px] leading-[18px] text-ios-red dark:text-ios-red-dark"
            >
              {{ draftBaseUrlError }}
            </span>
          </div>

          <div class="flex flex-col gap-1.5">
            <div class="flex items-center justify-between">
              <span class="text-[12px] text-ios-label-secondary dark:text-ios-label-secondary-dark">
                API Key
                <span v-if="draftProvider?.requiresApiKey" class="text-ios-red dark:text-ios-red-dark">*</span>
              </span>
              <a
                v-if="providerDocs(modelDraft)"
                :href="providerDocs(modelDraft)"
                target="_blank"
                rel="noreferrer"
                class="text-[12px] font-medium text-ios-blue dark:text-ios-blue-dark"
              >
                {{ t('GET_KEY') }}
              </a>
            </div>
            <div class="relative">
              <input
                ref="apiKeyInputRef"
                v-model="modelDraft.apiKey"
                :type="visibleApiKeys[modelDraft.id] ? 'text' : 'password'"
                aria-label="API Key"
                placeholder="sk-..."
                autocomplete="off"
                spellcheck="false"
                :aria-invalid="showApiKeyError"
                :class="[showApiKeyError ? invalidInputClass : inputClass, 'pr-20']"
                @blur="touchModelField('apiKey')"
              />
              <div class="absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
                <button
                  type="button"
                  :aria-label="visibleApiKeys[modelDraft.id] ? t('HIDE_KEY') : t('SHOW_KEY')"
                  class="flex h-7 w-7 items-center justify-center rounded-full text-ios-label-secondary hover:bg-ios-fill hover:text-figma-text dark:text-ios-label-secondary-dark dark:hover:bg-ios-fill-dark dark:hover:text-figma-text-dark"
                  @click="toggleKeyVisibility(modelDraft.id)"
                >
                  <svg v-if="visibleApiKeys[modelDraft.id]" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                  <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                    <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
                    <line x1="1" y1="1" x2="23" y2="23" />
                  </svg>
                </button>
                <button
                  type="button"
                  :aria-label="t('COPY_API_KEY')"
                  class="flex h-7 w-7 items-center justify-center rounded-full text-ios-label-secondary hover:bg-ios-fill hover:text-figma-text dark:text-ios-label-secondary-dark dark:hover:bg-ios-fill-dark dark:hover:text-figma-text-dark"
                  @click="copyText(modelDraft.apiKey)"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="9" y="9" width="13" height="13" rx="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                  </svg>
                </button>
              </div>
            </div>
            <span class="text-[11px] text-ios-label-secondary dark:text-ios-label-secondary-dark">
              {{ t('KEYS_ARE_STORED_ONLY_IN_THE') }}
            </span>
            <span
              v-if="showApiKeyError"
              class="text-[12px] leading-[18px] text-ios-red dark:text-ios-red-dark"
            >
              {{ draftApiKeyError }}
            </span>
          </div>
        </div>
      </SettingGroup>

      <!-- 上下文窗口（Token） -->
      <SettingGroup :title="t('CONTEXT_WINDOW')">
        <SettingItem :label="t('CONTEXT_INPUT')" :hint="t('BUDGET_FOR_TRIMMING_HISTORY_LEAVE_EMPTY')">
          <div class="flex items-center gap-2">
            <div class="flex shrink-0 items-center gap-1">
              <button
                v-for="chip in CONTEXT_INPUT_CHIPS"
                :key="chip.label"
                type="button"
                :class="genNum('contextInput') === chip.value ? chipActiveClass : chipBtnClass"
                @click="patchGeneration('contextInput', chip.value)"
              >
                {{ chip.label }}
              </button>
            </div>
            <div :class="[numberInputClass, 'shrink-0']">
              <NumberInput
                :model-value="genNum('contextInput')"
                :min="1024"
                :max="1048576"
                :step="1024"
                :aria-label="t('CONTEXT_WINDOW_INPUT')"
                :placeholder="t('DEFAULT')"
                @update:model-value="onDraftContextInput"
              />
            </div>
          </div>
        </SettingItem>

        <SettingItem :label="t('CONTEXT_OUTPUT')" :hint="t('MAXIMUM_TOKENS_PER_REPLY_LEAVE_EMPTY')">
          <div class="flex items-center gap-2">
            <div class="flex shrink-0 items-center gap-1">
              <button
                v-for="chip in OUTPUT_CHIPS"
                :key="chip.label"
                type="button"
                :class="genNum('maxTokens') === chip.value ? chipActiveClass : chipBtnClass"
                @click="patchGeneration('maxTokens', chip.value)"
              >
                {{ chip.label }}
              </button>
            </div>
            <div :class="[numberInputClass, 'shrink-0']">
              <NumberInput
                :model-value="genNum('maxTokens')"
                :min="1"
                :max="131072"
                :step="256"
                :aria-label="t('CONTEXT_WINDOW_OUTPUT')"
                :placeholder="t('DEFAULT')"
                @update:model-value="onDraftMaxTokens"
              />
            </div>
          </div>
        </SettingItem>
      </SettingGroup>

      <!-- 对话参数 -->
      <SettingGroup :title="t('CHAT_PARAMETERS')">
        <SettingItem :label="t('TOOL_ROUNDS')" :hint="t('MAXIMUM_TOOL_ROUND_TRIPS_PER_TURN')">
          <div :class="numberInputClass">
            <NumberInput
              :model-value="genNum('toolRounds')"
              :min="1"
              :max="500"
              :step="1"
              :aria-label="t('TOOL_ROUNDS')"
              @update:model-value="onDraftToolRounds"
            />
          </div>
        </SettingItem>

        <SettingItem :label="t('IMAGE_INPUT')" :hint="t('WHEN_OFF_ATTACHED_IMAGES_ARE_NOT')">
          <div class="flex items-center gap-5">
            <label class="flex cursor-pointer items-center gap-1.5 text-[13px] text-figma-text dark:text-figma-text-dark">
              <input
                v-model="modelDraft.generation.supportsImage"
                type="radio"
                name="supports-image"
                :value="true"
                class="accent-ios-blue dark:accent-ios-blue-dark"
              />
              {{ t('SUPPORTED') }}
            </label>
            <label class="flex cursor-pointer items-center gap-1.5 text-[13px] text-figma-text dark:text-figma-text-dark">
              <input
                v-model="modelDraft.generation.supportsImage"
                type="radio"
                name="supports-image"
                :value="false"
                class="accent-ios-blue dark:accent-ios-blue-dark"
              />
              {{ t('NOT_SUPPORTED') }}
            </label>
          </div>
        </SettingItem>
      </SettingGroup>

      <!-- 思考模式 -->
      <SettingGroup :title="t('THINKING_MODE')">
        <SettingItem horizontal :label="t('THINKING_MODE')" :hint="t('SEND_REASONING_PARAMETERS_USING_THE_LEVEL')">
          <SettingToggle v-model="modelDraft.generation.thinkingMode" />
        </SettingItem>

        <SettingItem horizontal :label="t('PARALLEL_TOOL_CALLS')" :hint="t('ALLOW_THE_MODEL_TO_ISSUE_MULTIPLE')">
          <SettingToggle v-model="modelDraft.generation.parallelToolCalls" />
        </SettingItem>

        <SettingItem :label="t('REASONING_EFFORT')" :hint="t('OFF_DISABLES_THINKING_HIGHER_LEVELS_REASON')">
          <select
            :value="draftGeneration.reasoningEffort"
            :disabled="!modelDraft.generation.thinkingMode"
            :class="[selectClass, 'disabled:cursor-not-allowed disabled:opacity-40']"
            @change="onDraftReasoningEffort"
          >
            <option value="off">{{ t('OFF_OFF') }}</option>
            <option value="low">{{ t('LOW_LOW') }}</option>
            <option value="medium">{{ t('MEDIUM_MEDIUM') }}</option>
            <option value="high">{{ t('HIGH_HIGH') }}</option>
            <option value="max">{{ t('MAX_MAX') }}</option>
          </select>
        </SettingItem>

        <SettingItem :label="t('THINKING_BUDGET')" :hint="t('MAXIMUM_TOKENS_PER_THINKING_BLOCK_LEAVE')">
          <div :class="numberInputClass">
            <NumberInput
              :model-value="genNum('thinkingBudget')"
              :min="0"
              :max="131072"
              :step="256"
              :aria-label="t('THINKING_BUDGET')"
              :placeholder="t('DEFAULT')"
              @update:model-value="onDraftThinkingBudget"
            />
          </div>
        </SettingItem>
      </SettingGroup>

      <!-- 采样参数 -->
      <SettingGroup :title="t('SAMPLING')">
        <SettingItem label="Temperature" :hint="t('0_2_HIGHER_IS_MORE_RANDOM')">
          <div :class="numberInputClass">
            <NumberInput
              :model-value="genNum('temperature')"
              :min="0"
              :max="2"
              :step="0.1"
              aria-label="Temperature"
              :placeholder="t('DEFAULT')"
              @update:model-value="onDraftTemperature"
            />
          </div>
        </SettingItem>

        <SettingItem label="Top P" :hint="t('0_1_NUCLEUS_SAMPLING_THRESHOLD')">
          <div :class="numberInputClass">
            <NumberInput
              :model-value="genNum('topP')"
              :min="0"
              :max="1"
              :step="0.05"
              aria-label="Top P"
              :placeholder="t('DEFAULT')"
              @update:model-value="onDraftTopP"
            />
          </div>
        </SettingItem>

        <SettingItem label="Top K" :hint="t('TOP_K_HINT')">
          <div :class="numberInputClass">
            <NumberInput
              :model-value="genNum('topK')"
              :min="0"
              :max="100"
              :step="1"
              aria-label="Top K"
              :placeholder="t('DEFAULT')"
              @update:model-value="onDraftTopK"
            />
          </div>
        </SettingItem>
      </SettingGroup>

      <!-- 连通性测试 -->
      <SettingGroup :title="t('CONNECTIVITY_TEST')">
        <div class="flex flex-col gap-2 px-4 py-3">
          <div class="flex items-center gap-2">
            <button
              type="button"
              :disabled="testingModelId === modelDraft.id"
              class="shrink-0 rounded-lg bg-ios-blue/10 px-3 py-2 text-[13px] font-medium text-ios-blue transition-colors hover:bg-ios-blue/15 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-ios-blue-dark/15 dark:text-ios-blue-dark dark:hover:bg-ios-blue-dark/20"
              @click="testModelDraft"
            >
              {{ testingModelId === modelDraft.id ? t('TESTING') : t('TEST_CONNECTION') }}
            </button>
            <span
              v-if="testResults[modelDraft.id]"
              class="min-w-0 flex-1 truncate text-[12px]"
              :title="testResults[modelDraft.id].message"
              :class="testResults[modelDraft.id].ok ? 'text-ios-green dark:text-ios-green-dark' : 'text-ios-red dark:text-ios-red-dark'"
            >
              {{ testResults[modelDraft.id].message }}
            </span>
          </div>
        </div>
      </SettingGroup>
        </div><!-- /表单主体 -->

        <!-- 底部固定操作栏：提示 + 重置 / 添加模型（保存） -->
        <div
          class="flex shrink-0 flex-col gap-2 border-t border-figma-border bg-figma-bg px-4 py-3 dark:border-figma-border-dark dark:bg-figma-bg-dark"
        >
          <span class="text-[11px] leading-4 text-ios-label-secondary dark:text-ios-label-secondary-dark">
            {{ t('THE_CONNECTIVITY_TEST_SENDS_A_REAL') }}
          </span>
          <div class="flex items-center gap-2">
            <button type="button" :class="[secondaryBtnClass, 'flex-1']" @click="resetModelDraft">
              {{ t('RESET') }}
            </button>
            <button
              type="button"
              class="flex-1 rounded-lg bg-ios-blue px-4 py-2.5 text-[13px] font-semibold text-white transition-colors hover:bg-ios-blue/90 dark:bg-ios-blue-dark dark:hover:bg-ios-blue-dark/90"
              @click="saveModelDraft"
            >
              {{ modelModalMode === 'add' ? t('ADD_MODEL') : t('SAVE') }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
/* push / pop：与设置页进入动画一致，从右侧滑入、向右滑出 */
.model-push-enter-active,
.model-push-leave-active {
  transition: transform 0.3s cubic-bezier(0.32, 0.72, 0, 1);
}
.model-push-enter-from,
.model-push-leave-to {
  transform: translateX(100%);
}
</style>
