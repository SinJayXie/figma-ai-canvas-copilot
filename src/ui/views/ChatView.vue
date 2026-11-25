<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import type { MessageAttachment } from '../../../types/llm.types'
import ChatMessage from '../components/ChatMessage.vue'
import InputBar from '../components/InputBar.vue'
import TaskPanel from '../components/TaskPanel.vue'
import { showToast } from '../composables/useToast'
import { confirmAction } from '../composables/useConfirm'
import { currentLocale, useT } from '../i18n'
import { approveTaskAndContinue, runAgent, sendOpsByAction } from '../services/agent.service'
import { llmService } from '../services/llm.service'
import { useChatStore, type ChatMsg } from '../store/chat'
import { useConfigStore } from '../store/config'

const chatStore = useChatStore()
const configStore = useConfigStore()
const { messages, generating } = storeToRefs(chatStore)
const t = useT()

const emit = defineEmits<{ (e: 'manage-models'): void }>()

const scrollRef = ref<HTMLElement | null>(null)

/** 距底部多少像素内视为「贴底」 */
const BOTTOM_THRESHOLD = 24
/** 是否贴底：用户主动上滑后置 false，回到底部或点按钮后恢复 */
const pinnedToBottom = ref(true)
/** 不贴底时显示「回到底部」悬浮按钮 */
const showScrollToBottom = computed(() => !pinnedToBottom.value)

/** 滚动事件：实时判断是否贴底（未贴底则暂停自动滚动） */
function onScroll(): void {
  const el = scrollRef.value
  if (!el) return
  pinnedToBottom.value = el.scrollHeight - el.scrollTop - el.clientHeight <= BOTTOM_THRESHOLD
}

let autoScrollFrame = 0
/** 仅当仍贴底时滚到底部；force 用于用户主动发送 / 切换会话 */
function autoScrollToBottom(force = false): void {
  if (!force && !pinnedToBottom.value) return
  if (autoScrollFrame) cancelAnimationFrame(autoScrollFrame)
  autoScrollFrame = requestAnimationFrame(() => {
    autoScrollFrame = 0
    const el = scrollRef.value
    if (!el) return
    el.scrollTop = el.scrollHeight
    pinnedToBottom.value = true
  })
}

/** 点击悬浮按钮：平滑回到底部并恢复自动跟随 */
function scrollToBottomSmooth(): void {
  const el = scrollRef.value
  if (!el) return
  pinnedToBottom.value = true
  el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
}

const contentRef = ref<HTMLElement | null>(null)
let contentObserver: ResizeObserver | null = null

/**
 * 思考步骤 / 工具步骤 / 操作卡片 / 图片等会改变内容高度，但不会触发消息 watch，
 * 用 ResizeObserver 兜底：仍贴底时随内容增高同步滚到底部
 */
watch(contentRef, (el) => {
  contentObserver?.disconnect()
  if (!el) return
  contentObserver = new ResizeObserver(() => autoScrollToBottom())
  contentObserver.observe(el)
})

onBeforeUnmount(() => {
  contentObserver?.disconnect()
  contentObserver = null
})

/**
 * 性能：仅监听「消息条数 + 最后一条内容」。
 * 流式 appendDelta 只更新最后一条消息（每条消息独立组件、key 稳定，局部重渲染），
 * 避免对全列表 deep watch 造成的 O(n) 逐 delta 遍历开销。
 * 用户自己发消息时强制回到底部；其余更新只在贴底时跟随。
 */
watch(
  () => [messages.value.length, messages.value[messages.value.length - 1]?.content],
  () => {
    const last = messages.value[messages.value.length - 1]
    if (last?.role === 'user') pinnedToBottom.value = true
    autoScrollToBottom()
  },
  { flush: 'post' },
)

/** 切换历史会话后强制滚到底部（消息条数可能相同，需单独监听） */
watch(
  () => chatStore.activeConversationId,
  () => {
    pinnedToBottom.value = true
    autoScrollToBottom(true)
  },
)

/** 发送失败统一 toast 提示：新增 error 消息时取首行内容轻提示（气泡仍保留完整信息） */
watch(
  () => messages.value.length,
  () => {
    const last = messages.value[messages.value.length - 1]
    if (last && last.role === 'error') showToast(last.content.split('\n')[0])
  },
)

onMounted(async () => {
  // 恢复对话历史（history:load，沙箱按 fileKey 隔离；带 ops 的消息恢复为已应用态）
  await chatStore.restore()
  pinnedToBottom.value = true
  autoScrollToBottom(true)
})

/**
 * 发送流程：用户消息写入 store 后交给 Agent 编排
 * （runAgent：promptBuilder 组装上下文 → llmService 流式请求 → toolCallParser 解析 → ops 预览/自动应用）
 */
function onSend(text: string, attachments: MessageAttachment[] = []): void {
  if (generating.value) return
  void runAgent(text, { attachments })
}

/** 停止生成：中断 LLM 流式请求（runAgent 收到 aborted 后收尾本轮） */
function onStop(): void {
  llmService.stop()
}

/** 应用操作到画布：按 action 分组依次发送 ops:create / ops:update（DEV.md 3.3） */
async function onApply(msg: ChatMsg): Promise<void> {
  const ops = msg.ops
  if (!ops || ops.length === 0 || msg.opsStatus === 'applied' || msg.opsStatus === 'applying') return
  // 先进入 applying 态：既是视觉反馈，也防止重复点击导致重复创建
  chatStore.setOpsStatus(msg.id, 'applying')
  try {
    // batchId 复用消息 id：超时重试时沙箱幂等返回首次结果
    const result = await sendOpsByAction(ops, { batchId: msg.id, messageId: msg.id })
    // 全部节点都失败（如父级 id 来自已删除的页面）时不标记为已应用
    const nothingApplied = result.created === 0 && result.updated === 0
    chatStore.setOpsStatus(
      msg.id,
      nothingApplied && (result.errors?.length ?? 0) > 0 ? 'failed' : 'applied',
    )
    // 任务模式：首次应用成功即授权，登记本步节点并自动续跑后续任务
    if (configStore.config.taskMode && !nothingApplied) {
      approveTaskAndContinue(
        {
          ids: result.ids,
          idMap: result.idMap,
          created: result.created,
          updated: result.updated,
        },
        ops,
      )
      // 应用后隐藏画布操作卡片，任务进度改由步骤列表 / 任务面板展示
      chatStore.hideOps(msg.id)
    }
    // 手动应用：模型没写正文时补一句结果摘要，保证下一轮历史里有可读上下文
    const appliedMessage = chatStore.messages.find((m) => m.id === msg.id)
    if (appliedMessage && !appliedMessage.content.trim() && !nothingApplied) {
      chatStore.setContent(msg.id, t('APPLY_SUCCESS_SUMMARY', { count: result.created }))
    }
    const parentIds = new Set((result.placements ?? []).map((item) => item.parentId))
    let detail = t('CREATED_NODES_COUNT', { count: result.created })
    if (result.containerName) {
      detail = t('CREATED_IN', { name: result.containerName })
    } else if (parentIds.size > 1) {
      detail = t('MULTIPLE_CONTAINERS', { detail })
    } else if (parentIds.size === 1 && parentIds.has('page')) {
      detail = t('PAGE', { detail })
    }
    if (result.errors?.length) {
      showToast(t('SOME_NODES_FAILED', { message: result.errors[0] }), 'error')
    } else {
      showToast(detail, 'info')
    }
    void chatStore.persist() // 应用状态变化同步到持久化
  } catch (error) {
    chatStore.setOpsStatus(msg.id, 'failed')
    chatStore.addMessage({
      role: 'error',
      content: t('FAILED_TO_APPLY_TO_CANVAS', {
        message: error instanceof Error ? error.message : String(error),
      }),
    })
  }
}

/** 重新生成：移除该 AI 消息及其用户输入后重跑（Agent 重新添加用户消息并重试链路） */
function onRegenerate(msg: ChatMsg): void {
  if (generating.value) return
  const index = chatStore.messages.findIndex((m) => m.id === msg.id)
  for (let i = index - 1; i >= 0; i--) {
    const prev = chatStore.messages[i]
    if (prev.role === 'user') {
      chatStore.removeMessage(msg.id)
      chatStore.removeMessage(prev.id)
      void runAgent(prev.content, { attachments: prev.attachments })
      return
    }
  }
}

/**
 * 删除消息（联动删除一轮对话）：
 * 无论点的是用户消息还是 AI / 错误消息，都移除该消息所属的用户输入与其回复。
 */
async function onDeleteMessage(msg: ChatMsg): Promise<void> {
  if (generating.value) {
    showToast(t('CANNOT_DELETE_WHILE_GENERATING'), 'info')
    return
  }
  const ok = await confirmAction({
    title: t('DELETE_MESSAGE'),
    message: t('DELETE_MESSAGE_CONFIRM'),
    confirmText: t('DELETE'),
    danger: true,
  })
  if (!ok) return
  const removed = chatStore.removeTurn(msg.id)
  if (removed > 0) {
    void chatStore.persist()
    showToast(t('MESSAGE_DELETED'), 'info')
  }
}

/** 每 5 条消息显示一次的时间戳（HH:mm） */
function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString(currentLocale(), { hour: '2-digit', minute: '2-digit' })
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <!-- 消息流区域 -->
    <div class="relative min-h-0 flex-1">
      <div
        ref="scrollRef"
        class="msg-scroll h-full overflow-y-auto px-4 py-4"
        @scroll.passive="onScroll"
      >
      <!-- 空状态：图标化 -->
      <div v-if="messages.length === 0" class="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
        <div class="flex h-12 w-12 items-center justify-center rounded-2xl bg-ios-blue/10 text-ios-blue dark:bg-ios-blue-dark/15 dark:text-ios-blue-dark">
          <svg class="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 3l1.9 5.8a2 2 0 0 0 1.3 1.3L21 12l-5.8 1.9a2 2 0 0 0-1.3 1.3L12 21l-1.9-5.8a2 2 0 0 0-1.3-1.3L3 12l5.8-1.9a2 2 0 0 0 1.3-1.3L12 3z" />
            <path d="M5 3v4" />
            <path d="M3 5h4" />
            <path d="M19 17v4" />
            <path d="M17 19h4" />
          </svg>
        </div>
        <p class="text-[15px] font-semibold">{{ t('CHAT_EMPTY_TITLE') }}</p>
        <p class="text-[12px] text-ios-label-secondary dark:text-ios-label-secondary-dark">{{ t('CHAT_EMPTY_EXAMPLE') }}</p>
      </div>
      <!-- 消息列表：每 5 条之间插入居中时间戳 -->
      <div v-else ref="contentRef" class="space-y-3">
        <template v-for="(msg, index) in messages" :key="msg.id">
          <ChatMessage
            :msg="msg"
            @apply="onApply(msg)"
            @regenerate="onRegenerate(msg)"
            @delete="onDeleteMessage(msg)"
          />
          <div v-if="(index + 1) % 5 === 0" class="text-center text-[11px] text-ios-label-secondary dark:text-ios-label-secondary-dark">
            {{ formatTime(msg.timestamp) }}
          </div>
        </template>
        <!-- 生成中底部加载指示 -->
        <div v-if="generating" class="flex items-center gap-2 pt-1 text-[11px] text-ios-label-secondary dark:text-ios-label-secondary-dark">
          <span class="flex items-center gap-0.5">
            <span class="gen-dot" />
            <span class="gen-dot gen-dot-2" />
            <span class="gen-dot gen-dot-3" />
          </span>
          {{ t('GENERATING') }}
        </div>
      </div>

      <!-- 未贴底时显示「回到底部」 -->
      <Transition name="fade">
        <button
          v-if="showScrollToBottom"
          type="button"
          :aria-label="t('BACK_TO_BOTTOM')"
          :title="t('BACK_TO_BOTTOM')"
          class="absolute bottom-3 right-3 z-10 flex h-8 w-8 items-center justify-center rounded-full border border-figma-border bg-figma-surface text-ios-label-secondary shadow-md transition-colors hover:text-ios-blue dark:border-figma-border-dark dark:bg-figma-surface-dark dark:text-ios-label-secondary-dark dark:hover:text-ios-blue-dark"
          @click="scrollToBottomSmooth"
        >
          <svg
            class="h-4 w-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M12 5v14M5 12l7 7 7-7" />
          </svg>
        </button>
      </Transition>
      </div>
    </div>
    <!-- 任务模式：任务进度与步骤详情（可展开） -->
    <TaskPanel />
    <!-- 底部输入区 -->
    <InputBar
      :generating="generating"
      :send-key="configStore.config.sendKey"
      @send="onSend"
      @stop="onStop"
      @manage-models="emit('manage-models')"
    />
  </div>
</template>

<style scoped>
/* 回到底部按钮淡入淡出 */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.15s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

/* 消息区细滚动条（iOS 系统灰） */
.msg-scroll {
  scrollbar-width: thin;
  scrollbar-color: rgba(142, 142, 147, 0.45) transparent;
}
.msg-scroll::-webkit-scrollbar {
  width: 6px;
}
.msg-scroll::-webkit-scrollbar-track {
  background: transparent;
}
.msg-scroll::-webkit-scrollbar-thumb {
  border-radius: 3px;
  background: rgba(142, 142, 147, 0.45);
}
/* 生成中加载点：跳动动画 */
.gen-dot {
  display: inline-block;
  width: 4px;
  height: 4px;
  border-radius: 9999px;
  background: currentColor;
  animation: gen-bounce 1s ease-in-out infinite;
}
.gen-dot-2 {
  animation-delay: 0.15s;
}
.gen-dot-3 {
  animation-delay: 0.3s;
}
@keyframes gen-bounce {
  0%,
  100% {
    transform: translateY(0);
    opacity: 0.4;
  }
  50% {
    transform: translateY(-3px);
    opacity: 1;
  }
}
</style>
