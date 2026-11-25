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

const activeEntry = computed(
  () => store.config.models.find((entry) => entry.id === store.config.activeModelId) ?? null
)

function isActiveModel(id: string): boolean {
  return store.config.activeModelId === id
}

function providerName(entry: ModelEntry): string {
  return getProviderPreset(entry.provider).name
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
    emit('notify', `额外请求体 JSON 无效：${extraBody.error}`, 'error')
    return
  }
  const next: ModelEntry = {
    ...draft,
    name: draft.name.trim() || draft.model.trim() || getProviderPreset(draft.provider).name,
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
  emit('notify', added ? '模型已添加，记得保存设置' : '模型已更新，记得保存设置', 'success')
}

async function removeModel(id: string): Promise<void> {
  if (store.config.models.length <= 1) return
  const entry = store.config.models.find((item) => item.id === id)
  if (!entry) return
  // 删除前确认，避免误删已填写的 API 配置
  const confirmed = await confirmAction({
    title: '删除模型？',
    message: `将删除「${entry.name || entry.model || '未命名模型'}」及其 API Key 配置，此操作不可撤销。`,
    confirmText: '删除',
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
    emit('notify', '内容为空，无需复制', 'error')
    return
  }
  try {
    await navigator.clipboard.writeText(text)
    emit('notify', '已复制到剪贴板')
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
      emit('notify', '已复制到剪贴板')
    } catch {
      emit('notify', '复制失败，请手动复制', 'error')
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
      testResults.value[entry.id] = { ok: true, message: '连接成功' }
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
        ? '连接超时（15s）'
        : `连接失败：${err instanceof Error ? err.message : String(err)}`
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
      <SettingGroup title="当前使用">
        <div class="flex items-center gap-3 px-4 py-3">
          <span
            class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ios-blue/10 text-[13px] font-semibold text-ios-blue dark:bg-ios-blue-dark/15 dark:text-ios-blue-dark"
          >
            {{ activeEntry ? providerName(activeEntry).slice(0, 2) : '—' }}
          </span>
          <div class="min-w-0 flex-1">
            <p class="truncate text-[14px] font-medium text-figma-text dark:text-figma-text-dark">
              {{ activeEntry?.name || '尚未配置模型' }}
            </p>
            <p
              class="truncate text-[12px] text-ios-label-secondary dark:text-ios-label-secondary-dark"
            >
              {{
                activeEntry
                  ? `${providerName(activeEntry)} · ${activeEntry.model || '未填写模型 ID'}`
                  : '在下方添加模型'
              }}
            </p>
          </div>
        </div>
      </SettingGroup>

      <!-- 模型列表 -->
      <SettingGroup title="模型列表">
        <p
          class="px-4 pb-1 pt-3 text-[12px] leading-[18px] text-ios-label-secondary dark:text-ios-label-secondary-dark"
        >
          点击「编辑」进入模型配置页，可修改服务商、密钥与高级参数。
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
                {{ entry.name || entry.model || '未命名模型' }}
              </span>
              <span
                v-if="isActiveModel(entry.id)"
                class="shrink-0 rounded-full bg-ios-blue/10 px-1.5 py-0.5 text-[10px] font-semibold text-ios-blue dark:bg-ios-blue-dark/15 dark:text-ios-blue-dark"
              >
                默认
              </span>
              <span
                v-if="modelNeedsKey(entry)"
                class="shrink-0 rounded bg-ios-red/10 px-1 text-[10px] font-medium text-ios-red dark:bg-ios-red-dark/15 dark:text-ios-red-dark"
              >
                缺 Key
              </span>
            </div>
            <div
              class="mt-0.5 truncate text-[12px] text-ios-label-secondary dark:text-ios-label-secondary-dark"
            >
              {{ providerName(entry) }} · {{ entry.model || '未填写模型 ID' }}
            </div>
          </div>

          <div class="flex shrink-0 items-center gap-0.5">
            <button
              v-if="!isActiveModel(entry.id)"
              type="button"
              class="rounded-md px-2 py-1 text-[12px] font-medium text-ios-blue transition-colors hover:bg-ios-blue/10 dark:text-ios-blue-dark dark:hover:bg-ios-blue-dark/15"
              @click="selectModel(entry.id)"
            >
              设为默认
            </button>
            <button
              type="button"
              class="rounded-md px-2 py-1 text-[12px] font-medium text-ios-blue transition-colors hover:bg-ios-blue/10 dark:text-ios-blue-dark dark:hover:bg-ios-blue-dark/15"
              @click="openEditModel(entry)"
            >
              编辑
            </button>
            <button
              type="button"
              :disabled="store.config.models.length <= 1"
              class="rounded-md px-2 py-1 text-[12px] font-medium text-ios-red transition-colors hover:bg-ios-red/10 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent dark:text-ios-red-dark dark:hover:bg-ios-red-dark/10"
              @click="removeModel(entry.id)"
            >
              删除
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
          添加模型
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
          aria-label="返回列表"
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
          {{ modelModalMode === 'add' ? '添加模型' : '编辑模型' }}
        </h2>
        <button
          v-if="modelModalMode === 'edit'"
          type="button"
          class="ml-auto rounded-md px-2 py-1 text-[12px] font-medium text-ios-label-secondary transition-colors hover:bg-ios-fill dark:text-ios-label-secondary-dark dark:hover:bg-ios-fill-dark"
          @click="closeModelModal"
        >
          取消
        </button>
        </div>

        <!-- 表单主体：整屏滚动（360 窄宽度下全部纵向排布，避免控件被挤压） -->
        <div class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
        <!-- 基础信息 -->
        <SettingGroup title="基础信息">
        <div class="flex flex-col gap-3 px-4 py-3">
          <div class="flex flex-col gap-1.5">
            <span class="text-[12px] text-ios-label-secondary dark:text-ios-label-secondary-dark">显示名称</span>
            <input
              ref="nameInputRef"
              v-model="modelDraft.name"
              type="text"
              aria-label="模型显示名称"
              placeholder="如 DeepSeek Chat"
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
            <span class="text-[12px] text-ios-label-secondary dark:text-ios-label-secondary-dark">服务商</span>
            <select v-model="modelDraft.provider" :class="selectClass" @change="onDraftProviderChange">
              <option v-for="preset in PROVIDER_PRESETS" :key="preset.id" :value="preset.id">
                {{ preset.name }}
              </option>
            </select>
            <span v-if="draftProvider" class="text-[11px] leading-4 text-ios-label-secondary dark:text-ios-label-secondary-dark">
              {{ draftProvider.description }}
            </span>
          </div>

          <div class="flex flex-col gap-1.5">
            <span class="text-[12px] text-ios-label-secondary dark:text-ios-label-secondary-dark">
              模型 ID <span class="text-ios-red dark:text-ios-red-dark">*</span>
            </span>
            <input
              ref="modelInputRef"
              v-model="modelDraft.model"
              type="text"
              aria-label="API 模型 ID"
              list="model-page-options"
              placeholder="如 deepseek-chat / gpt-4o"
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
                获取 Key
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
                  :aria-label="visibleApiKeys[modelDraft.id] ? '隐藏密钥' : '显示密钥'"
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
                  aria-label="复制 API Key"
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
              密钥仅保存在本地 Figma clientStorage
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
      <SettingGroup title="上下文窗口（Token）">
        <SettingItem label="输入" hint="用于对话历史的截断预算，留空使用最佳默认值">
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
                aria-label="上下文窗口输入"
                placeholder="默认"
                @update:model-value="onDraftContextInput"
              />
            </div>
          </div>
        </SettingItem>

        <SettingItem label="输出" hint="单次回复的最大 Token 数，留空使用最佳默认值">
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
                aria-label="上下文窗口输出"
                placeholder="默认"
                @update:model-value="onDraftMaxTokens"
              />
            </div>
          </div>
        </SettingItem>
      </SettingGroup>

      <!-- 对话参数 -->
      <SettingGroup title="对话参数">
        <SettingItem label="工具调用轮数" hint="单轮对话内工具往返上限（1 ~ 500）">
          <div :class="numberInputClass">
            <NumberInput
              :model-value="genNum('toolRounds')"
              :min="1"
              :max="500"
              :step="1"
              aria-label="工具调用轮数"
              @update:model-value="onDraftToolRounds"
            />
          </div>
        </SettingItem>

        <SettingItem label="支持图片输入" hint="关闭后，消息附带的图片不会传给该模型">
          <div class="flex items-center gap-5">
            <label class="flex cursor-pointer items-center gap-1.5 text-[13px] text-figma-text dark:text-figma-text-dark">
              <input
                v-model="modelDraft.generation.supportsImage"
                type="radio"
                name="supports-image"
                :value="true"
                class="accent-ios-blue dark:accent-ios-blue-dark"
              />
              支持
            </label>
            <label class="flex cursor-pointer items-center gap-1.5 text-[13px] text-figma-text dark:text-figma-text-dark">
              <input
                v-model="modelDraft.generation.supportsImage"
                type="radio"
                name="supports-image"
                :value="false"
                class="accent-ios-blue dark:accent-ios-blue-dark"
              />
              不支持
            </label>
          </div>
        </SettingItem>
      </SettingGroup>

      <!-- 思考模式 -->
      <SettingGroup title="思考模式">
        <SettingItem horizontal label="思考模式" hint="开启后按下方档位发送推理参数">
          <SettingToggle v-model="modelDraft.generation.thinkingMode" />
        </SettingItem>

        <SettingItem horizontal label="并行工具调用" hint="允许模型在一轮里并行发起多个工具调用">
          <SettingToggle v-model="modelDraft.generation.parallelToolCalls" />
        </SettingItem>

        <SettingItem label="推理强度" hint="off 关闭思考；档位越高推理越深、耗时越长">
          <select
            :value="draftGeneration.reasoningEffort"
            :disabled="!modelDraft.generation.thinkingMode"
            :class="[selectClass, 'disabled:cursor-not-allowed disabled:opacity-40']"
            @change="onDraftReasoningEffort"
          >
            <option value="off">关闭（off）</option>
            <option value="low">低（low）</option>
            <option value="medium">中（medium）</option>
            <option value="high">高（high）</option>
            <option value="max">最高（max）</option>
          </select>
        </SettingItem>

        <SettingItem label="思考预算" hint="单次思考的最大 Token 数，留空使用最佳默认值">
          <div :class="numberInputClass">
            <NumberInput
              :model-value="genNum('thinkingBudget')"
              :min="0"
              :max="131072"
              :step="256"
              aria-label="思考预算"
              placeholder="默认"
              @update:model-value="onDraftThinkingBudget"
            />
          </div>
        </SettingItem>
      </SettingGroup>

      <!-- 采样参数 -->
      <SettingGroup title="采样参数">
        <SettingItem label="Temperature" hint="0 ~ 2，越高越随机">
          <div :class="numberInputClass">
            <NumberInput
              :model-value="genNum('temperature')"
              :min="0"
              :max="2"
              :step="0.1"
              aria-label="Temperature"
              placeholder="默认"
              @update:model-value="onDraftTemperature"
            />
          </div>
        </SettingItem>

        <SettingItem label="Top P" hint="0 ~ 1，核采样阈值">
          <div :class="numberInputClass">
            <NumberInput
              :model-value="genNum('topP')"
              :min="0"
              :max="1"
              :step="0.05"
              aria-label="Top P"
              placeholder="默认"
              @update:model-value="onDraftTopP"
            />
          </div>
        </SettingItem>

        <SettingItem label="Top K" hint="1 ~ 100，留空或 0 表示由模型决定">
          <div :class="numberInputClass">
            <NumberInput
              :model-value="genNum('topK')"
              :min="0"
              :max="100"
              :step="1"
              aria-label="Top K"
              placeholder="默认"
              @update:model-value="onDraftTopK"
            />
          </div>
        </SettingItem>
      </SettingGroup>

      <!-- 连通性测试 -->
      <SettingGroup title="连通性测试">
        <div class="flex flex-col gap-2 px-4 py-3">
          <div class="flex items-center gap-2">
            <button
              type="button"
              :disabled="testingModelId === modelDraft.id"
              class="shrink-0 rounded-lg bg-ios-blue/10 px-3 py-2 text-[13px] font-medium text-ios-blue transition-colors hover:bg-ios-blue/15 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-ios-blue-dark/15 dark:text-ios-blue-dark dark:hover:bg-ios-blue-dark/20"
              @click="testModelDraft"
            >
              {{ testingModelId === modelDraft.id ? '测试中…' : '测试连接' }}
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
            连通性测试会发起一次真实请求，会消耗少量模型 Token
          </span>
          <div class="flex items-center gap-2">
            <button type="button" :class="[secondaryBtnClass, 'flex-1']" @click="resetModelDraft">
              重置
            </button>
            <button
              type="button"
              class="flex-1 rounded-lg bg-ios-blue px-4 py-2.5 text-[13px] font-semibold text-white transition-colors hover:bg-ios-blue/90 dark:bg-ios-blue-dark dark:hover:bg-ios-blue-dark/90"
              @click="saveModelDraft"
            >
              {{ modelModalMode === 'add' ? '添加模型' : '保存' }}
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
