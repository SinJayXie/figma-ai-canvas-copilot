<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import type { QuickCommandConfig, SendKey } from '../../../types/config.types'
import { getProviderPreset, resolveActiveModelEntry, type ModelEntry } from '../../../types/config.types'
import type { MessageAttachment } from '../../../types/llm.types'
import { DEFAULT_QUICK_COMMANDS } from '../config/quickCommands'
import { showToast } from '../composables/useToast'
import { useChatStore, type ChatMsg } from '../store/chat'
import { useConfigStore } from '../store/config'
import { BUILTIN_SYSTEM_PROMPT, CONTEXT_BUDGET_TOKENS, IMAGE_TOKEN_ESTIMATE, MAX_HISTORY_ROUNDS, estimateTokens } from '../utils/promptBuilder'
import { generateId } from '../utils/uuid'

const props = withDefaults(
  defineProps<{
    /** AI 生成中：发送按钮切换为红色停止按钮 */
    generating?: boolean
    /** 发送快捷键（来自 config.sendKey，Task 7 完善设置联动） */
    sendKey?: SendKey
  }>(),
  { generating: false, sendKey: 'enter' },
)

const emit = defineEmits<{
  (e: 'send', text: string, attachments: MessageAttachment[]): void
  (e: 'stop'): void
  (e: 'manage-models'): void
}>()

const configStore = useConfigStore()
const chatStore = useChatStore()
const draft = ref('')
/** contenteditable 编辑器：指令 Tag 与文字在同一行内 */
const editorRef = ref<HTMLElement | null>(null)
const composing = ref(false)
/** 程序化重建编辑器内容时忽略 input 事件 */
let syncingEditor = false
const showModelMenu = ref(false)

/** 当前模型摘要（输入区快速切换展示） */
const activeModel = computed(() => resolveActiveModelEntry(configStore.config))
const activeModelName = computed(
  () => activeModel.value.name || activeModel.value.model || '未配置模型',
)

/** 上下文窗口（输入侧）与输出上限：与请求侧取值口径保持一致（留空 = 默认预算） */
const contextBudget = computed(
  () => activeModel.value.generation.contextInput ?? CONTEXT_BUDGET_TOKENS,
)
const outputLimit = computed(() => activeModel.value.generation.maxTokens)
/** 模型不支持图片输入时，图片不会进入请求，因此不计入 token 估算 */
const imagesAllowed = computed(() => activeModel.value.generation.supportsImage)

function providerName(entry: ModelEntry): string {
  return getProviderPreset(entry.provider).name
}

/** 服务商要求 Key 但当前未填写时，在菜单里提示 */
function needsKey(entry: ModelEntry): boolean {
  return getProviderPreset(entry.provider).requiresApiKey && !entry.apiKey.trim()
}

/** 快速切换模型：立即写回配置并持久化 */
function selectModel(id: string): void {
  const entry = configStore.config.models.find((item) => item.id === id)
  if (!entry) return
  configStore.update({ activeModelId: entry.id, model: entry.model })
  showModelMenu.value = false
  showToast(`已切换模型：${entry.name || entry.model}`, 'info', 1600)
  void configStore.save().catch(() => showToast('模型切换未能保存', 'error'))
}

function onManageModels(): void {
  showModelMenu.value = false
  emit('manage-models')
}

/** 自动增高参数：text-sm/leading-5 行高 20px，py-2 上下共 16px */
const LINE_HEIGHT = 20
/** 初始两行：保证长 placeholder 完整显示 */
const MIN_LINES = 2
const MAX_LINES = 6
const MIN_HEIGHT = LINE_HEIGHT * MIN_LINES + 16
const MAX_HEIGHT = LINE_HEIGHT * MAX_LINES + 16

/** 编辑器自动增高：初始/最少 2 行，最高 6 行，超出内部滚动 */
function autoResize(): void {
  const el = editorRef.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${Math.max(MIN_HEIGHT, Math.min(el.scrollHeight, MAX_HEIGHT))}px`
  el.style.overflowY = el.scrollHeight > MAX_HEIGHT ? 'auto' : 'hidden'
}

/** 读取编辑器纯文本（忽略指令 Tag） */
function readEditorText(): string {
  const el = editorRef.value
  if (!el) return ''
  const clone = el.cloneNode(true) as HTMLElement
  clone.querySelectorAll('[data-command-tag]').forEach((node) => node.remove())
  return (clone.innerText || '').replace(/\u00a0/g, ' ')
}

function focusEditorAtEnd(): void {
  const el = editorRef.value
  if (!el) return
  el.focus()
  const range = document.createRange()
  range.selectNodeContents(el)
  range.collapse(false)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
}

/** 重建编辑器：指令 Tag + 纯文本（仅在指令变化 / 发送后调用，避免打字时光标跳动） */
function renderEditor(): void {
  const el = editorRef.value
  if (!el) return
  syncingEditor = true
  el.innerHTML = ''

  if (selectedCommand.value) {
    const chip = document.createElement('span')
    chip.dataset.commandTag = 'true'
    chip.contentEditable = 'false'
    chip.className =
      'mr-1 inline-flex select-none items-center gap-1 rounded bg-ios-blue/15 px-1.5 py-0.5 text-[12px] font-medium text-ios-blue dark:bg-ios-blue-dark/20 dark:text-ios-blue-dark'
    chip.append(document.createTextNode(selectedCommand.value.label))

    const remove = document.createElement('button')
    remove.type = 'button'
    remove.contentEditable = 'false'
    remove.setAttribute('aria-label', '移除指令')
    remove.className = 'text-[11px] leading-none opacity-60 hover:opacity-100'
    remove.textContent = '×'
    remove.addEventListener('mousedown', (event) => event.preventDefault())
    remove.addEventListener('click', () => clearSelectedCommand())
    chip.appendChild(remove)

    el.appendChild(chip)
  }

  if (draft.value) el.appendChild(document.createTextNode(draft.value))

  syncingEditor = false
  autoResize()
  focusEditorAtEnd()
}

function onEditorInput(): void {
  if (syncingEditor || composing.value) return
  const text = readEditorText()
  if (text.length > MAX_DRAFT_CHARS) {
    draft.value = text.slice(0, MAX_DRAFT_CHARS)
    renderEditor()
    return
  }
  draft.value = text
  autoResize()
}

function onCompositionEnd(): void {
  composing.value = false
  onEditorInput()
}

/** 在光标处插入纯文本（粘贴用，避免带样式 HTML 进入编辑器） */
function insertPlainText(text: string): void {
  const el = editorRef.value
  if (!el) return
  el.focus()
  let inserted = false
  try {
    inserted = document.execCommand('insertText', false, text)
  } catch {
    inserted = false
  }
  if (!inserted) {
    const selection = window.getSelection()
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0)
      range.deleteContents()
      const node = document.createTextNode(text)
      range.insertNode(node)
      range.setStartAfter(node)
      range.collapse(true)
      selection.removeAllRanges()
      selection.addRange(range)
    } else {
      el.appendChild(document.createTextNode(text))
    }
  }
  onEditorInput()
}

watch(draft, () => {
  void nextTick(autoResize)
})

/* ---------- 附件（图片 / 文本文件） ---------- */
const MAX_ATTACHMENTS = 8
const MAX_IMAGES = 4
/** 单张图片原始文件上限 */
const MAX_IMAGE_FILE_BYTES = 8 * 1024 * 1024
/** 图片最长边上限：超出时本地等比缩放，降低传输体积与视觉 token */
const MAX_IMAGE_DIMENSION = 1600
const MAX_TEXT_BYTES = 1024 * 1024
/** 单个文本文件的最大字符数 */
const MAX_TEXT_CHARS = 20000
/** 输入框最大字数；粘贴文本超过该值时自动转为 txt 附件 */
const MAX_DRAFT_CHARS = 5000
const TEXT_FILE_PATTERN = /\.(txt|md|markdown|json|csv|tsv|log|ya?ml|html?|css|js|ts|tsx|jsx|xml|svg)$/i

const attachments = ref<MessageAttachment[]>([])
const fileInputRef = ref<HTMLInputElement | null>(null)

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

function readAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsText(file)
  })
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('图片解析失败'))
    image.src = src
  })
}

/** 读取图片并限制最长边：超出时用 canvas 等比缩放（GIF 保留原图以免丢动画） */
async function prepareImage(file: File): Promise<{ dataUrl: string; size: number }> {
  const raw = await readAsDataUrl(file)
  if (file.type === 'image/gif') return { dataUrl: raw, size: file.size }

  const image = await loadImage(raw)
  const longest = Math.max(image.width, image.height)
  if (longest <= MAX_IMAGE_DIMENSION) return { dataUrl: raw, size: file.size }

  const scale = MAX_IMAGE_DIMENSION / longest
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(image.width * scale))
  canvas.height = Math.max(1, Math.round(image.height * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) return { dataUrl: raw, size: file.size }
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
  const mime =
    file.type === 'image/png' ? 'image/png' : file.type === 'image/webp' ? 'image/webp' : 'image/jpeg'
  const dataUrl = canvas.toDataURL(mime, 0.9)
  return { dataUrl, size: Math.round((dataUrl.length * 3) / 4) }
}

async function addFile(file: File): Promise<void> {
  if (file.type.startsWith('image/')) {
    if (attachments.value.filter((item) => item.kind === 'image').length >= MAX_IMAGES) {
      showToast(`最多添加 ${MAX_IMAGES} 张图片`, 'error')
      return
    }
    if (file.size > MAX_IMAGE_FILE_BYTES) {
      showToast(`图片「${file.name}」超过 8MB`, 'error')
      return
    }
    try {
      const { dataUrl, size } = await prepareImage(file)
      attachments.value.push({
        id: generateId('att'),
        kind: 'image',
        name: file.name || '图片',
        mime: file.type || 'image/png',
        size,
        dataUrl,
      })
    } catch {
      showToast(`图片「${file.name}」处理失败`, 'error')
    }
    return
  }

  const textLike = file.type.startsWith('text/') || TEXT_FILE_PATTERN.test(file.name)
  if (!textLike) {
    showToast(`暂不支持该文件类型：${file.name}`, 'error')
    return
  }
  if (file.size > MAX_TEXT_BYTES) {
    showToast(`文本文件「${file.name}」超过 1MB`, 'error')
    return
  }
  const raw = await readAsText(file)
  const text = raw.slice(0, MAX_TEXT_CHARS)
  if (raw.length > MAX_TEXT_CHARS) {
    showToast(`「${file.name}」内容过长，已截断到 ${MAX_TEXT_CHARS} 字`, 'error')
  }
  attachments.value.push({
    id: generateId('att'),
    kind: 'text',
    name: file.name,
    mime: file.type || 'text/plain',
    size: file.size,
    text,
  })
}

async function addFiles(files: Iterable<File>): Promise<void> {
  for (const file of Array.from(files)) {
    if (attachments.value.length >= MAX_ATTACHMENTS) {
      showToast(`最多添加 ${MAX_ATTACHMENTS} 个附件`, 'error')
      break
    }
    await addFile(file)
  }
}

function openFilePicker(): void {
  fileInputRef.value?.click()
}

function onFileChange(event: Event): void {
  const input = event.target as HTMLInputElement
  if (input.files) void addFiles(input.files)
  // 允许重复选择同一文件
  input.value = ''
}

function onDrop(event: DragEvent): void {
  const files = event.dataTransfer?.files
  if (files && files.length > 0) void addFiles(files)
}

/** 超长文本转 txt 附件（避免撑爆输入框与上下文） */
function addPastedText(text: string): void {
  if (attachments.value.length >= MAX_ATTACHMENTS) {
    showToast(`最多添加 ${MAX_ATTACHMENTS} 个附件`, 'error')
    return
  }
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
  attachments.value.push({
    id: generateId('att'),
    kind: 'text',
    name: `粘贴文本-${stamp}.txt`,
    mime: 'text/plain',
    size: text.length,
    text: text.slice(0, MAX_TEXT_CHARS),
  })
  if (text.length > MAX_TEXT_CHARS) {
    showToast(`粘贴内容超过 ${MAX_TEXT_CHARS} 字，已截断后转为 txt 附件`, 'error')
  } else {
    showToast(`粘贴内容超过 ${MAX_DRAFT_CHARS} 字，已转为 txt 附件`, 'info')
  }
}

/** Ctrl+V 粘贴图片/文件；超长纯文本自动转 txt 附件 */
function onPaste(event: ClipboardEvent): void {
  const clipboard = event.clipboardData
  if (!clipboard) return

  const files: File[] = []
  for (const item of Array.from(clipboard.items ?? [])) {
    if (item.kind !== 'file') continue
    const file = item.getAsFile()
    if (file) files.push(file)
  }
  if (files.length === 0 && clipboard.files?.length) {
    files.push(...Array.from(clipboard.files))
  }
  if (files.length > 0) {
    event.preventDefault()
    void addFiles(files)
    return
  }

  // 纯文本：超过输入框上限时转为 txt 附件，其余按纯文本插入（避免带样式 HTML）
  const text = clipboard.getData('text/plain')
  if (!text) return
  event.preventDefault()
  if (text.length > MAX_DRAFT_CHARS) {
    addPastedText(text)
    return
  }
  insertPlainText(text)
}

function removeAttachment(id: string): void {
  attachments.value = attachments.value.filter((item) => item.id !== id)
}

function doSend(): void {
  const typed = draft.value.trim()
  const commandPrompt = selectedCommand.value?.prompt.trim() ?? ''
  if ((!typed && !commandPrompt && attachments.value.length === 0) || props.generating) return

  // 指令模板作为前缀，用户补充的文字接在后面
  const text = commandPrompt
    ? `${commandPrompt}${typed ? `\n${typed}` : ''}`
    : typed
  emit('send', text, attachments.value.map((item) => ({ ...item })))
  draft.value = ''
  attachments.value = []
  selectedCommand.value = null
  renderEditor()
}

/** 内置 + 自定义指令合并；同名自定义覆盖内置 */
const QUICK_COMMANDS = computed<QuickCommandConfig[]>(() => {
  const merged = new Map<string, QuickCommandConfig>()
  for (const cmd of DEFAULT_QUICK_COMMANDS) merged.set(cmd.label, cmd)
  for (const cmd of configStore.config.customCommands ?? []) merged.set(cmd.label, cmd)
  return [...merged.values()]
})

/** 当前指令片段：仅当草稿是单个 /xxx（不含空格）时触发候选 */
const commandQuery = computed(() =>
  /^\/[^\s]*$/.test(draft.value) ? draft.value.slice(1) : null,
)

const filteredCommands = computed(() => {
  const query = commandQuery.value
  if (query === null) return []
  const keyword = query.toLowerCase()
  return QUICK_COMMANDS.value.filter((cmd) => cmd.label.slice(1).toLowerCase().includes(keyword))
})

/** 按 Esc 或点击空白关闭后，草稿再次变化才重新弹出 */
const commandDismissed = ref(false)
const activeCommandIndex = ref(0)
/** 已选中的指令：以 Tag 形式展示，发送时把模板拼到消息前面 */
const selectedCommand = ref<QuickCommandConfig | null>(null)

const commandMenuOpen = computed(
  () => !commandDismissed.value && commandQuery.value !== null && filteredCommands.value.length > 0,
)

watch(draft, () => {
  commandDismissed.value = false
  activeCommandIndex.value = 0
})

/** 选中候选：以行内 Tag 形式放进编辑器，不把模板塞进输入框 */
function applyCommand(cmd: QuickCommandConfig): void {
  selectedCommand.value = cmd
  draft.value = ''
  renderEditor()
}

function clearSelectedCommand(): void {
  selectedCommand.value = null
  renderEditor()
}

function dismissCommandMenu(): void {
  commandDismissed.value = true
}

/** Enter 发送 / Shift+Enter 换行；sendKey=ctrl-enter 时 Ctrl/Cmd+Enter 发送 */
function onKeydown(e: KeyboardEvent): void {
  // 指令候选打开时优先处理上下选择 / 确认 / 关闭
  if (commandMenuOpen.value && !e.isComposing) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const total = filteredCommands.value.length
      const delta = e.key === 'ArrowDown' ? 1 : -1
      activeCommandIndex.value = (activeCommandIndex.value + delta + total) % total
      return
    }
    if (e.key === 'Tab' || e.key === 'Enter') {
      e.preventDefault()
      const cmd = filteredCommands.value[activeCommandIndex.value]
      if (cmd) applyCommand(cmd)
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      dismissCommandMenu()
      return
    }
  }

  // 输入框为空时按 Backspace 移除指令 Tag
  if (
    e.key === 'Backspace' &&
    !e.isComposing &&
    !draft.value &&
    selectedCommand.value
  ) {
    e.preventDefault()
    clearSelectedCommand()
    return
  }

  if (e.key !== 'Enter') return
  if ((props.sendKey ?? 'enter') === 'ctrl-enter') {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault()
      doSend()
    }
    return
  }
  // IME 组合输入中的 Enter 不发送
  if (e.shiftKey || e.isComposing) return
  e.preventDefault()
  doSend()
}

/* ---------- 上下文 token 估算 ---------- */

/** 与会话构建保持一致：最近 MAX_HISTORY_ROUNDS 轮，且以 user 消息开头 */
function recentRounds(messages: ChatMsg[]): ChatMsg[] {
  const valid = messages.filter((msg) => msg.role === 'user' || msg.role === 'assistant')
  let cut = 0
  let rounds = 0
  for (let i = valid.length - 1; i >= 0; i--) {
    if (valid[i].role === 'user') {
      rounds++
      if (rounds > MAX_HISTORY_ROUNDS) {
        cut = i + 1
        break
      }
    }
  }
  const windowed = valid.slice(cut)
  while (windowed.length > 0 && windowed[0].role !== 'user') windowed.shift()
  return windowed
}

function attachmentTokens(list: MessageAttachment[] | undefined): number {
  if (!list) return 0
  let total = 0
  for (const att of list) {
    if (att.kind === 'image') {
      if (imagesAllowed.value) total += IMAGE_TOKEN_ESTIMATE
    } else {
      total += estimateTokens(att.text ?? '')
    }
  }
  return total
}

/**
 * 上下文 token 估算：系统提示词 + 自定义规则 + 最近 20 轮历史 + 当前输入与附件。
 * 画布上下文在请求时才生成，此处不计入，因此是偏保守的下界。
 */
const estimatedTokens = computed(() => {
  let total = estimateTokens(BUILTIN_SYSTEM_PROMPT)
  total += estimateTokens(configStore.config.customPrompt ?? '')
  for (const msg of recentRounds(chatStore.messages)) {
    total += estimateTokens(msg.content)
    total += attachmentTokens(msg.attachments)
  }
  const commandPrompt = selectedCommand.value?.prompt.trim() ?? ''
  const composed = commandPrompt
    ? `${commandPrompt}${draft.value ? `\n${draft.value}` : ''}`
    : draft.value
  total += estimateTokens(composed)
  total += attachmentTokens(attachments.value)
  return Math.round(total)
})

/** 最近一次请求的真实用量（厂商返回 usage 时才有） */
const lastUsage = computed(() => {
  for (let i = chatStore.messages.length - 1; i >= 0; i--) {
    const msg = chatStore.messages[i]
    if (msg.role === 'assistant' && msg.usage) return msg.usage
  }
  return null
})

/** 有新的输入 / 附件表示上下文已变化，实测值不再代表当前占用 */
const hasPendingInput = computed(
  () => draft.value.trim().length > 0 || attachments.value.length > 0,
)

/** 实测占用 = 上次请求的输入 + 输出（输出会作为历史进入下一轮上下文） */
const measuredTokens = computed(() => {
  const usage = lastUsage.value
  if (!usage || hasPendingInput.value) return null
  return Math.round(usage.prompt_tokens + usage.completion_tokens)
})

/** 优先展示厂商返回的实测值，否则回退到本地估算 */
const contextMeasured = computed(() => measuredTokens.value !== null)
const contextTokens = computed(() => measuredTokens.value ?? estimatedTokens.value)

const contextPercent = computed(() =>
  Math.round((contextTokens.value / contextBudget.value) * 100),
)

const contextLevel = computed<'ok' | 'warn' | 'over'>(() =>
  contextPercent.value >= 100 ? 'over' : contextPercent.value >= 80 ? 'warn' : 'ok',
)

const contextLevelClass = computed(() =>
  contextLevel.value === 'over'
    ? 'text-ios-red dark:text-ios-red-dark'
    : contextLevel.value === 'warn'
      ? 'text-ios-orange dark:text-ios-orange-dark'
      : 'text-ios-green dark:text-ios-green-dark',
)

/** 环形进度：半径 8，周长 2πr */
const RING_RADIUS = 8
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS
/** 圆环未填充长度：百分比越大，缺口越小（上限 100%） */
const ringOffset = computed(
  () => RING_CIRCUMFERENCE * (1 - Math.min(100, Math.max(0, contextPercent.value)) / 100),
)

/** 上下文环的悬浮提示（iframe 内原生 title 不稳定，改用自定义 tooltip） */
const showTokenTip = ref(false)

/** 紧凑单位：1,234 → 1.2K；1,234,567 → 1.2M；1,234,567,890 → 1.2B */
function formatTokenCount(value: number): string {
  if (value < 1000) return String(value)
  if (value < 1_000_000) return `${(value / 1000).toFixed(1).replace(/\.0$/, '')}K`
  if (value < 1_000_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  return `${(value / 1_000_000_000).toFixed(1).replace(/\.0$/, '')}B`
}
</script>

<template>
  <div
    class="shrink-0 border-t border-figma-border bg-figma-surface dark:border-figma-border-dark dark:bg-figma-surface-dark"
    @dragover.prevent
    @drop.prevent="onDrop"
  >
    <!-- 模型选择 -->
    <div class="flex items-center gap-2 px-3 pt-2">
      <div class="relative shrink-0">
        <button
          type="button"
          title="切换模型"
          aria-haspopup="listbox"
          :aria-expanded="showModelMenu"
          class="flex max-w-[150px] items-center gap-1 rounded-full bg-ios-blue/10 px-2.5 py-1 text-[12px] font-medium text-ios-blue transition-colors hover:bg-ios-blue/15 dark:bg-ios-blue-dark/15 dark:text-ios-blue-dark dark:hover:bg-ios-blue-dark/20"
          @click="showModelMenu = !showModelMenu"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M12 3l9 4.5-9 4.5-9-4.5L12 3z" />
            <path d="M3 12l9 4.5 9-4.5" />
          </svg>
          <span class="truncate">{{ activeModelName }}</span>
          <svg width="10" height="10" viewBox="0 0 16 16" fill="none" class="shrink-0 transition-transform" :class="showModelMenu ? 'rotate-180' : ''" aria-hidden="true">
            <path d="m4 6 4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </button>

        <!-- 点击空白关闭 -->
        <div v-if="showModelMenu" class="fixed inset-0 z-30" @click="showModelMenu = false" />

        <!-- 模型下拉（向上展开） -->
        <div
          v-if="showModelMenu"
          role="listbox"
          class="absolute bottom-full left-0 z-40 mb-2 w-64 overflow-hidden rounded-xl border border-figma-border bg-figma-surface dark:border-figma-border-dark dark:bg-figma-surface-dark"
        >
          <div class="max-h-64 overflow-y-auto">
            <button
              v-for="entry in configStore.config.models"
              :key="entry.id"
              type="button"
              role="option"
              :aria-selected="entry.id === configStore.config.activeModelId"
              class="flex w-full items-start gap-2 px-3 py-2.5 text-left transition-colors hover:bg-ios-fill dark:hover:bg-ios-fill-dark"
              @click="selectModel(entry.id)"
            >
              <svg
                v-if="entry.id === configStore.config.activeModelId"
                class="mt-0.5 h-3.5 w-3.5 shrink-0 text-ios-blue dark:text-ios-blue-dark"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2.2"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <path d="M20 6 9 17l-5-5" />
              </svg>
              <span v-else class="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span class="min-w-0 flex-1">
                <span class="flex items-center gap-1.5">
                  <span class="truncate text-[13px] font-medium text-figma-text dark:text-figma-text-dark">
                    {{ entry.name || entry.model || '未命名模型' }}
                  </span>
                  <span
                    v-if="needsKey(entry)"
                    class="shrink-0 rounded bg-ios-red/10 px-1 text-[10px] font-medium text-ios-red dark:bg-ios-red-dark/15 dark:text-ios-red-dark"
                  >
                    缺 Key
                  </span>
                </span>
                <span class="block truncate text-[11px] text-ios-label-secondary dark:text-ios-label-secondary-dark">
                  {{ providerName(entry) }} · {{ entry.model || '未填写模型 ID' }}
                </span>
              </span>
            </button>
          </div>
          <button
            type="button"
            class="w-full border-t border-figma-border px-3 py-2.5 text-left text-[12px] font-medium text-ios-blue transition-colors hover:bg-ios-fill dark:border-figma-border-dark dark:text-ios-blue-dark dark:hover:bg-ios-fill-dark"
            @click="onManageModels"
          >
            管理模型…
          </button>
        </div>
      </div>
      <!-- 上下文占用环：按当前模型的输入窗口计算，悬停显示 用量 / 窗口 · 占比，并附输出上限 -->
      <div
        class="relative ml-auto flex h-6 w-6 shrink-0 items-center justify-center"
        role="img"
        tabindex="0"
        :aria-label="`上下文 ${formatTokenCount(contextTokens)} / ${formatTokenCount(contextBudget)} · ${contextPercent}%，${contextMeasured ? '实测' : '估算'}，输出上限 ${formatTokenCount(outputLimit)}`"
        @mouseenter="showTokenTip = true"
        @mouseleave="showTokenTip = false"
        @focusin="showTokenTip = true"
        @focusout="showTokenTip = false"
      >
        <svg viewBox="0 0 20 20" class="h-4 w-4 -rotate-90" aria-hidden="true">
          <circle
            cx="10"
            cy="10"
            :r="RING_RADIUS"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            class="text-ios-fill-secondary dark:text-ios-fill-secondary-dark"
          />
          <circle
            cx="10"
            cy="10"
            :r="RING_RADIUS"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            :stroke-dasharray="RING_CIRCUMFERENCE"
            :stroke-dashoffset="ringOffset"
            class="transition-[stroke-dashoffset] duration-300"
            :class="contextLevelClass"
          />
        </svg>
        <Transition name="fade">
          <div
            v-if="showTokenTip"
            class="pointer-events-none absolute bottom-full right-0 z-30 mb-1.5 whitespace-nowrap rounded-md bg-[#1C1C1E] px-2 py-1 text-[10px] font-medium leading-4 text-white shadow-md dark:bg-white dark:text-black"
          >
            <div>{{ formatTokenCount(contextTokens) }} / {{ formatTokenCount(contextBudget) }} · {{ contextPercent }}%</div>
            <div class="text-white/70 dark:text-black/60">
              {{ contextMeasured ? '实测' : '估算' }} · 输出上限 {{ formatTokenCount(outputLimit) }}
            </div>
          </div>
        </Transition>
      </div>
    </div>

    <!-- 附件预览：图片缩略图 / 文件名 -->
    <div v-if="attachments.length > 0" class="flex flex-wrap gap-2 px-3 pt-2">
      <div v-for="att in attachments" :key="att.id" class="relative">
        <img
          v-if="att.kind === 'image' && att.dataUrl"
          :src="att.dataUrl"
          :alt="att.name"
          class="h-14 w-14 rounded-lg border border-figma-border object-cover dark:border-figma-border-dark"
        />
        <div
          v-else
          class="flex h-14 max-w-[180px] items-center gap-1.5 rounded-lg bg-ios-fill px-2.5 dark:bg-ios-fill-dark"
        >
          <svg
            class="h-3.5 w-3.5 shrink-0 text-ios-label-secondary dark:text-ios-label-secondary-dark"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <path d="M14 2v6h6" />
          </svg>
          <span class="truncate text-[11px] text-figma-text dark:text-figma-text-dark">
            {{ att.name }}
          </span>
        </div>
        <button
          type="button"
          title="移除附件"
          aria-label="移除附件"
          class="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-ios-label-secondary text-white"
          @click="removeAttachment(att.id)"
        >
          <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
    </div>

    <!-- 输入框 + 发送/停止 -->
    <div class="flex items-end gap-2 p-3">
      <!-- 添加图片 / 文件 -->
      <button
        type="button"
        title="添加图片或文件"
        aria-label="添加图片或文件"
        class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ios-blue transition-colors hover:bg-ios-fill disabled:cursor-not-allowed disabled:opacity-40 dark:text-ios-blue-dark dark:hover:bg-ios-fill-dark"
        :disabled="generating"
        @click="openFilePicker"
      >
        <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M21.44 11.05 12.25 20.24a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 1 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
        </svg>
      </button>
      <input
        ref="fileInputRef"
        type="file"
        class="hidden"
        multiple
        accept="image/*,.txt,.md,.markdown,.json,.csv,.tsv,.log,.yml,.yaml,.html,.htm,.css,.js,.ts,.tsx,.jsx,.xml,.svg"
        @change="onFileChange"
      />
      <div class="relative min-w-0 flex-1">
        <!-- 指令候选：输入 / 时在输入框上方展开 -->
        <div v-if="commandMenuOpen" class="fixed inset-0 z-30" @click="dismissCommandMenu" />
        <div
          v-if="commandMenuOpen"
          role="listbox"
          class="absolute bottom-full left-0 right-0 z-40 mb-2 max-h-64 overflow-y-auto rounded-xl border border-figma-border bg-figma-surface dark:border-figma-border-dark dark:bg-figma-surface-dark"
        >
          <button
            v-for="(cmd, index) in filteredCommands"
            :key="cmd.label"
            type="button"
            role="option"
            :aria-selected="index === activeCommandIndex"
            class="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors"
            :class="index === activeCommandIndex ? 'bg-ios-fill dark:bg-ios-fill-dark' : ''"
            @mousedown.prevent="applyCommand(cmd)"
            @mouseenter="activeCommandIndex = index"
          >
            <span class="shrink-0 text-[12px] font-medium text-ios-blue dark:text-ios-blue-dark">
              {{ cmd.label }}
            </span>
            <span class="truncate text-[11px] text-ios-label-secondary dark:text-ios-label-secondary-dark">
              {{ cmd.description }}
            </span>
          </button>
        </div>
        <div
          ref="editorRef"
          contenteditable="true"
          role="textbox"
          aria-multiline="true"
          class="input-editor w-full overflow-y-auto whitespace-pre-wrap break-words rounded-xl border border-transparent bg-ios-fill px-3 py-2 text-[13px] leading-5 text-figma-text outline-none transition-colors focus:border-ios-blue/30 focus:ring-2 focus:ring-ios-blue/20 dark:bg-ios-fill-dark dark:text-figma-text-dark dark:focus:border-ios-blue-dark/40 dark:focus:ring-ios-blue-dark/20"
          :class="{ 'is-empty': !draft && !selectedCommand }"
          data-placeholder="描述你要设计的页面…（可粘贴图片，输入 / 使用快捷指令）"
          @input="onEditorInput"
          @keydown="onKeydown"
          @paste="onPaste"
          @compositionstart="composing = true"
          @compositionend="onCompositionEnd"
        ></div>
      </div>
      <button
        v-if="!generating"
        type="button"
        title="发送"
        class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ios-blue text-white transition-colors hover:bg-ios-blue/90 disabled:cursor-not-allowed disabled:bg-ios-fill-secondary disabled:text-ios-label-tertiary dark:bg-ios-blue-dark dark:hover:bg-ios-blue-dark/90 dark:disabled:bg-ios-fill-secondary-dark dark:disabled:text-ios-label-tertiary-dark"
        :disabled="!draft.trim() && attachments.length === 0 && !selectedCommand"
        @click="doSend"
      >
        <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="22" y1="2" x2="11" y2="13" />
          <polygon points="22 2 15 22 11 13 2 9 22 2" />
        </svg>
      </button>
      <button
        v-else
        type="button"
        title="停止生成"
        class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ios-red text-white transition-colors hover:bg-ios-red/90 dark:bg-ios-red-dark"
        @click="emit('stop')"
      >
        <svg class="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
          <rect x="6" y="6" width="12" height="12" rx="2" />
        </svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
/* tooltip 淡入淡出 */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.12s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

/* contenteditable 编辑器：与 textarea 保持同样的 2~6 行高度 */
.input-editor {
  min-height: 56px;
  max-height: 136px;
  cursor: text;
}
.input-editor.is-empty::before {
  content: attr(data-placeholder);
  color: rgba(142, 142, 147, 0.9);
  pointer-events: none;
}
.dark .input-editor.is-empty::before {
  color: rgba(235, 235, 245, 0.4);
}
</style>
