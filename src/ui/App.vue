<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
// 插件图标：?inline 强制内联为 base64，保证单文件 ui.html 自包含
import appIcon from '../../icon.png?inline'
import ChatView from './views/ChatView.vue'
import SettingsView from './views/SettingsView.vue'
import ConfirmDialog from './components/ConfirmDialog.vue'
import { getProviderPreset, resolveActiveModelEntry } from '../../types/config.types'
import { confirmAction } from './composables/useConfirm'
import { useToast } from './composables/useToast'
import { currentLocale, useT } from './i18n'
import { useCanvasStore } from './store/canvas'
import { useChatStore, type Conversation } from './store/chat'
import { useConfigStore } from './store/config'

/** 插件版本号（构建期由 vite define 注入，来源 package.json） */
const appVersion = __APP_VERSION__

/** 顶层页面：无 vue-router，组件切换（DEV.md 4.1） */
type Page = 'chat' | 'settings'

const page = ref<Page>('chat')
const configStore = useConfigStore()
const chatStore = useChatStore()
const canvasStore = useCanvasStore()
const toast = useToast()
const t = useT()

/** 清空对话二次确认状态（3s 未确认自动复位） */
const confirmingClear = ref(false)
let confirmTimer: ReturnType<typeof setTimeout> | null = null

/** 设置 ⇄ 对话切换（设置页后续也可经其自带返回按钮回对话页） */
function toggleSettings(): void {
  historyOpen.value = false
  page.value = page.value === 'chat' ? 'settings' : 'chat'
}

/** 从输入区“管理模型”进入设置，同时关闭历史面板 */
function openSettings(): void {
  historyOpen.value = false
  page.value = 'settings'
}

/** 历史会话面板 */
const historyOpen = ref(false)
/** 拖拽后的面板高度（px）；null 表示按内容自适应，最大 70vh */
const sheetHeight = ref<number | null>(null)
const sheetStyle = computed(() =>
  sheetHeight.value
    ? { height: `${sheetHeight.value}px`, maxHeight: 'calc(100vh - 16px)' }
    : { maxHeight: '70vh' },
)

/** 拖拽顶部把手调整历史面板高度 */
function startSheetResize(event: PointerEvent): void {
  const panel = (event.currentTarget as HTMLElement).closest('.sheet-panel') as HTMLElement | null
  if (!panel) return
  const startY = event.clientY
  const startHeight = panel.getBoundingClientRect().height
  const minHeight = 180
  const maxHeight = Math.max(minHeight, window.innerHeight - 16)
  const previousUserSelect = document.body.style.userSelect
  document.body.style.userSelect = 'none'

  const onMove = (move: PointerEvent): void => {
    // 向上拖增大高度，向下拖减小高度
    const next = Math.min(maxHeight, Math.max(minHeight, startHeight + (startY - move.clientY)))
    sheetHeight.value = Math.round(next)
  }
  const stop = (): void => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', stop)
    window.removeEventListener('pointercancel', stop)
    document.body.style.userSelect = previousUserSelect
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', stop)
  window.addEventListener('pointercancel', stop)
}

/**
 * 顶栏清空当前会话：二次确认后清空消息并持久化
 */
function onClearClick(): void {
  if (!confirmingClear.value) {
    confirmingClear.value = true
    if (confirmTimer) clearTimeout(confirmTimer)
    confirmTimer = setTimeout(() => {
      confirmingClear.value = false
      confirmTimer = null
    }, 3000)
    return
  }
  confirmingClear.value = false
  if (confirmTimer) {
    clearTimeout(confirmTimer)
    confirmTimer = null
  }
  chatStore.clearMessages()
  void chatStore.persist()
}

function onCancelClear(): void {
  confirmingClear.value = false
  if (confirmTimer) {
    clearTimeout(confirmTimer)
    confirmTimer = null
  }
}

/* ---------- 历史会话 ---------- */
function toggleHistory(): void {
  if (chatStore.generating) return
  historyOpen.value = !historyOpen.value
}

function onNewConversation(): void {
  if (chatStore.generating) return
  chatStore.newConversation()
  historyOpen.value = false
}

function onSwitchConversation(id: string): void {
  if (chatStore.generating) return
  if (chatStore.switchConversation(id)) historyOpen.value = false
}

async function onDeleteConversation(conversation: Conversation): Promise<void> {
  if (chatStore.generating) return
  const confirmed = await confirmAction({
    title: t('DELETE_CONVERSATION_CONFIRM'),
    message: t('DELETE_CONVERSATION_MESSAGE', { title: conversation.title || t('NEW_CHAT') }),
    confirmText: t('DELETE'),
    danger: true
  })
  if (!confirmed) return
  chatStore.deleteConversation(conversation.id)
}

/** 相对时间：刚刚 / N 分钟前 / N 小时前 / MM-DD */
function formatRelative(timestamp: number): string {
  const diff = Date.now() - timestamp
  if (diff < 60_000) return t('JUST_NOW')
  if (diff < 3_600_000) return t('MIN_AGO', { count: Math.floor(diff / 60_000) })
  if (diff < 86_400_000) return t('H_AGO', { count: Math.floor(diff / 3_600_000) })
  return new Date(timestamp).toLocaleDateString(currentLocale(), { month: '2-digit', day: '2-digit' })
}

onMounted(async () => {
  canvasStore.init()
  await configStore.load()
  // 首次未配置可用模型（缺模型 ID 或必填 Key）：引导进入设置页
  const active = resolveActiveModelEntry(configStore.config)
  const preset = getProviderPreset(active.provider)
  if (!active.model || (preset.requiresApiKey && !active.apiKey)) page.value = 'settings'
})
</script>

<template>
  <div class="relative flex h-screen w-full flex-col overflow-hidden bg-figma-bg text-figma-text dark:bg-figma-bg-dark dark:text-figma-text-dark">
    <!-- 顶部导航栏（iOS 44px 导航条 / 扁平细分割线）；设置页使用自己的返回导航 -->
    <header
      class="flex h-11 shrink-0 items-center justify-between border-b border-figma-border bg-figma-surface px-3 dark:border-figma-border-dark dark:bg-figma-surface-dark"
    >
      <div class="flex items-center gap-2">
        <img :src="appIcon" alt="" class="h-6 w-6 shrink-0 rounded-[6px] object-cover" />
        <h1 class="text-[15px] font-semibold tracking-[-0.01em]">AI Canvas Copilot</h1>
        <span
          class="rounded-full bg-ios-fill px-1.5 py-px text-[10px] font-medium leading-4 text-ios-label-secondary dark:bg-ios-fill-dark dark:text-ios-label-secondary-dark"
          :title="t('VERSION', { version: appVersion })"
        >
          v{{ appVersion }}
        </span>
      </div>
      <div class="flex items-center gap-1">
        <!-- 历史会话 -->
        <div class="relative">
          <button
            type="button"
            :title="t('HISTORY')"
            :disabled="chatStore.generating"
            class="flex h-8 w-8 items-center justify-center rounded-full text-ios-blue transition-colors hover:bg-ios-fill disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent dark:text-ios-blue-dark dark:hover:bg-ios-fill-dark"
            @click="toggleHistory"
          >
            <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M4 6h16M4 12h16M4 18h10" />
            </svg>
          </button>

          <!-- 底部弹出式历史会话面板（避免顶部气泡在窄面板中横向溢出） -->
          <Transition name="sheet">
            <div v-if="historyOpen" class="fixed inset-0 z-40">
              <div class="absolute inset-0 bg-black/20 dark:bg-black/50" @click="historyOpen = false" />
              <div
                class="sheet-panel absolute inset-x-2 bottom-2 flex flex-col overflow-hidden rounded-2xl border border-figma-border bg-figma-surface dark:border-figma-border-dark dark:bg-figma-surface-dark"
                :style="sheetStyle"
              >
                <!-- 拖拽把手：上下拖动调整面板高度，双击恢复自适应 -->
                <div
                  class="group flex shrink-0 cursor-ns-resize touch-none items-center justify-center py-2.5"
                  role="separator"
                  :aria-label="t('DRAG_TO_RESIZE')"
                  :title="t('DRAG_TO_RESIZE_HINT')"
                  @pointerdown.prevent="startSheetResize"
                  @dblclick="sheetHeight = null"
                >
                  <div class="h-1 w-10 rounded-full bg-ios-fill-secondary transition-colors group-hover:bg-ios-label-tertiary dark:bg-ios-fill-secondary-dark dark:group-hover:bg-ios-label-tertiary-dark" />
                </div>

                <div class="flex shrink-0 items-center justify-between px-3 pb-2.5">
                  <span class="text-[13px] font-semibold text-figma-text dark:text-figma-text-dark">{{ t('HISTORY') }}</span>
                  <div class="flex items-center gap-1">
                    <button
                      type="button"
                      :disabled="chatStore.generating"
                      class="rounded-md px-2 py-1 text-[12px] font-medium text-ios-blue transition-colors hover:bg-ios-blue/10 disabled:cursor-not-allowed disabled:opacity-40 dark:text-ios-blue-dark dark:hover:bg-ios-blue-dark/15"
                      @click="onNewConversation"
                    >
                      {{ t('NEW_CHAT') }}
                    </button>
                    <button
                      type="button"
                      :aria-label="t('CLOSE')"
                      class="flex h-7 w-7 items-center justify-center rounded-full text-ios-label-secondary transition-colors hover:bg-ios-fill dark:text-ios-label-secondary-dark dark:hover:bg-ios-fill-dark"
                      @click="historyOpen = false"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
                        <path d="M6 6l12 12M18 6L6 18" />
                      </svg>
                    </button>
                  </div>
                </div>

                <div class="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
                  <div
                    v-for="conversation in chatStore.sortedConversations"
                    :key="conversation.id"
                    class="flex items-start gap-1"
                  >
                    <button
                      type="button"
                      class="min-w-0 flex-1 rounded-lg px-2 py-2 text-left transition-colors hover:bg-ios-fill dark:hover:bg-ios-fill-dark"
                      @click="onSwitchConversation(conversation.id)"
                    >
                      <span class="flex items-center gap-1.5">
                        <span
                          class="truncate text-[13px]"
                          :class="
                            conversation.id === chatStore.activeConversationId
                              ? 'font-semibold text-ios-blue dark:text-ios-blue-dark'
                              : 'font-medium text-figma-text dark:text-figma-text-dark'
                          "
                        >
                          {{ conversation.title || t('NEW_CHAT') }}
                        </span>
                        <span
                          v-if="conversation.id === chatStore.activeConversationId"
                          class="shrink-0 rounded-full bg-ios-blue/10 px-1.5 py-0.5 text-[10px] font-semibold text-ios-blue dark:bg-ios-blue-dark/15 dark:text-ios-blue-dark"
                        >
                          {{ t('CURRENT') }}
                        </span>
                      </span>
                      <span class="mt-0.5 block text-[11px] text-ios-label-secondary dark:text-ios-label-secondary-dark">
                        {{ formatRelative(conversation.updatedAt) }} · {{ t('MESSAGES', { count: conversation.messages.length }) }}
                      </span>
                    </button>
                    <button
                      type="button"
                      :aria-label="t('DELETE_CONVERSATION')"
                      class="mt-1.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-ios-red opacity-70 transition-colors hover:bg-ios-red/10 hover:opacity-100 dark:text-ios-red-dark dark:hover:bg-ios-red-dark/10"
                      @click.stop="onDeleteConversation(conversation)"
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <path d="M3 6h18" />
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                        <path d="M10 11v6M14 11v6" />
                        <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                      </svg>
                    </button>
                  </div>
                  <p
                    v-if="chatStore.sortedConversations.length === 0"
                    class="px-3 py-6 text-center text-[12px] text-ios-label-secondary dark:text-ios-label-secondary-dark"
                  >
                    {{ t('NO_CONVERSATIONS_YET') }}
                  </p>
                </div>
              </div>
            </div>
          </Transition>
        </div>

        <button
          type="button"
          :title="page === 'chat' ? t('SETTINGS') : t('BACK_TO_CHAT')"
          class="flex h-8 w-8 items-center justify-center rounded-full text-ios-blue transition-colors hover:bg-ios-fill dark:text-ios-blue-dark dark:hover:bg-ios-fill-dark"
          @click="toggleSettings"
        >
          <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path
              d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0 .33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"
            />
          </svg>
        </button>
        <!-- 清空对话：生成中禁用，二次确认后清空并同步沙箱 -->
        <div class="relative">
          <button
            type="button"
            :title="t('CLEAR_CHAT')"
            :disabled="chatStore.generating"
            class="flex h-8 w-8 items-center justify-center rounded-full text-ios-blue transition-colors hover:bg-ios-fill hover:text-ios-red disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent dark:text-ios-blue-dark dark:hover:bg-ios-fill-dark dark:hover:text-ios-red-dark"
            @click="onClearClick"
          >
            <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 6h18" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              <line x1="10" y1="11" x2="10" y2="17" />
              <line x1="14" y1="11" x2="14" y2="17" />
            </svg>
          </button>
          <!-- 二次确认气泡 -->
          <Transition name="fade">
            <div
              v-if="confirmingClear"
              class="absolute right-0 top-9 z-50 flex items-center gap-2 whitespace-nowrap rounded-xl border border-figma-border bg-figma-surface px-2.5 py-1.5 text-[12px] dark:border-figma-border-dark dark:bg-figma-surface-dark"
            >
              <span class="text-figma-text dark:text-figma-text-dark">{{ t('CLEAR_CHAT_CONFIRM') }}</span>
              <button type="button" class="font-medium text-ios-red transition-opacity hover:opacity-80 dark:text-ios-red-dark" @click="onClearClick">{{ t('CLEAR') }}</button>
              <button type="button" class="text-ios-blue transition-opacity hover:opacity-80 dark:text-ios-blue-dark" @click="onCancelClear">{{ t('CANCEL') }}</button>
            </div>
          </Transition>
        </div>
      </div>
    </header>
    <!-- 页面切换：设置页以 push/pop 覆盖层从右侧推入，铺满整个插件 frame；
         对话页始终保持挂载（不用 v-if），返回时保留消息与滚动位置。
         定位必须放在外层容器：SettingsView 根节点自带 relative，直接合并 fixed/absolute 会被覆盖 -->
    <ChatView @manage-models="openSettings" />
    <Transition name="push">
      <div v-if="page === 'settings'" class="fixed inset-0 z-50">
        <SettingsView class="h-full" @back="page = 'chat'" />
      </div>
    </Transition>
    <!-- 破坏性操作确认（插件内弹窗，替代 iframe 中不稳定的 window.confirm） -->
    <ConfirmDialog />
    <!-- 统一 Toast（发送失败等提示） -->
    <Transition name="fade">
      <div v-if="toast.visible" class="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex justify-center px-4">
        <div
          class="max-w-full truncate rounded-xl px-3.5 py-2 text-[12px] font-medium"
          :class="toast.kind === 'error' ? 'bg-ios-red text-white dark:bg-ios-red-dark' : 'bg-[#1C1C1E] text-white dark:bg-white dark:text-black'"
        >
          {{ toast.message }}
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
/* toast / 确认气泡淡入淡出 */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

/* 历史会话底部弹出面板：遮罩淡入 + 面板上滑 */
.sheet-enter-active,
.sheet-leave-active {
  transition: opacity 0.2s ease;
}
.sheet-enter-from,
.sheet-leave-to {
  opacity: 0;
}
.sheet-enter-active .sheet-panel {
  animation: sheet-up 0.24s cubic-bezier(0.22, 0.8, 0.36, 1);
}
.sheet-leave-active .sheet-panel {
  animation: sheet-down 0.18s ease-in forwards;
}
@keyframes sheet-up {
  from {
    transform: translateY(18px);
    opacity: 0.5;
  }
  to {
    transform: translateY(0);
    opacity: 1;
  }
}
@keyframes sheet-down {
  from {
    transform: translateY(0);
    opacity: 1;
  }
  to {
    transform: translateY(18px);
    opacity: 0;
  }
}

/* 设置页 push / pop：从右侧推入，返回时向右推出 */
.push-enter-active,
.push-leave-active {
  transition: transform 0.3s cubic-bezier(0.32, 0.72, 0, 1);
  will-change: transform;
}
.push-enter-from,
.push-leave-to {
  transform: translateX(100%);
}
</style>
