<script setup lang="ts">
import { computed } from 'vue'
import AgentSteps from './AgentSteps.vue'
import HtmlPreview from './HtmlPreview.vue'
import OpPreviewCard from './OpPreviewCard.vue'
import { showToast } from '../composables/useToast'
import { useT } from '../i18n'
import type { ChatMsg } from '../store/chat'
import { extractHtmlBlocks, renderMarkdown, stripHtmlBlocks } from '../utils/markdown'

const props = defineProps<{ msg: ChatMsg }>()
const t = useT()

defineEmits<{
  (e: 'apply'): void
  (e: 'regenerate'): void
  (e: 'delete'): void
}>()

const isUser = computed(() => props.msg.role === 'user')
const isError = computed(() => props.msg.role === 'error')

/** 消息里的 ```html 代码块：直接渲染为可切换的预览卡片 */
const htmlBlocks = computed(() =>
  isUser.value || isError.value ? [] : extractHtmlBlocks(props.msg.content),
)

/** 去掉 HTML 块后的正文（源码已放进预览卡片，避免重复） */
const markdownText = computed(() => stripHtmlBlocks(props.msg.content))

/** AI 消息按 Markdown 渲染；用户消息与错误提示保持纯文本 */
const renderedContent = computed(() =>
  !isUser.value && !isError.value ? renderMarkdown(markdownText.value) : '',
)

/** 复制消息全文；clipboard 不可用（插件 iframe / 无权限）时回退到临时 textarea */
async function copyMessage(): Promise<void> {
  const text = props.msg.content ?? ''
  if (!text.trim()) {
    showToast(t('NOTHING_TO_COPY'), 'info')
    return
  }
  try {
    await navigator.clipboard.writeText(text)
    showToast(t('MESSAGE_COPIED'), 'info')
  } catch {
    try {
      const area = document.createElement('textarea')
      area.value = text
      area.style.position = 'fixed'
      area.style.opacity = '0'
      document.body.appendChild(area)
      area.select()
      const ok = document.execCommand('copy')
      document.body.removeChild(area)
      showToast(ok ? t('MESSAGE_COPIED') : t('COPY_FAILED'), ok ? 'info' : 'error')
    } catch {
      showToast(t('COPY_FAILED'), 'error')
    }
  }
}

/** 按角色区分气泡样式：iOS Messages 扁平气泡（发送蓝 / 接收卡片白） */
const bubbleClass = computed(() => {
  switch (props.msg.role) {
    case 'user':
      return 'bg-ios-blue text-white dark:bg-ios-blue-dark'
    case 'error':
      return 'bg-ios-red/10 text-ios-red dark:bg-ios-red-dark/15 dark:text-ios-red-dark'
    default:
      return 'bg-figma-surface text-figma-text dark:bg-figma-surface-dark dark:text-figma-text-dark'
  }
})
</script>

<template>
  <div class="group flex items-start gap-1.5" :class="isUser ? 'justify-end' : 'justify-start'">
    <!-- 用户消息：操作按钮在气泡左侧（悬停显示） -->
    <div v-if="isUser" class="msg-actions mt-1 flex shrink-0 items-center gap-0.5">
      <button
        type="button"
        class="msg-action-btn"
        :title="t('COPY_MESSAGE')"
        :aria-label="t('COPY_MESSAGE')"
        @click="copyMessage"
      >
        <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect x="9" y="9" width="12" height="12" rx="2" />
          <path d="M5 15V5a2 2 0 0 1 2-2h10" />
        </svg>
      </button>
      <button
        type="button"
        class="msg-action-btn msg-action-btn--danger"
        :title="t('DELETE_THIS_TURN')"
        :aria-label="t('DELETE_THIS_TURN')"
        @click="$emit('delete')"
      >
        <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M3 6h18" />
          <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
          <path d="M10 11v6M14 11v6" />
        </svg>
      </button>
    </div>
    <div
      class="min-w-0 rounded-[18px] px-3.5 py-2 text-[13px] leading-5"
      :class="[
        bubbleClass,
        isUser ? 'max-w-[82%] rounded-br-[6px]' : 'w-[86%] rounded-bl-[6px]',
      ]"
    >
      <!-- 用户附件：图片缩略图 / 文件标签 -->
      <div
        v-if="msg.attachments && msg.attachments.length > 0"
        class="mb-2 flex flex-wrap gap-1.5"
      >
        <template v-for="att in msg.attachments" :key="att.id">
          <img
            v-if="att.kind === 'image' && att.dataUrl"
            :src="att.dataUrl"
            :alt="att.name"
            class="h-20 w-20 rounded-lg object-cover"
          />
          <span
            v-else
            class="inline-flex max-w-full items-center gap-1 rounded-md px-2 py-1 text-[11px]"
            :class="
              isUser
                ? 'bg-white/20 text-white'
                : 'bg-ios-fill text-ios-label-secondary dark:bg-ios-fill-dark dark:text-ios-label-secondary-dark'
            "
          >
            <svg
              class="h-3 w-3 shrink-0"
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
            <span class="truncate">{{ att.name }}</span>
          </span>
        </template>
      </div>
      <!-- Agent 执行步骤（IDE Agent 风格的过程记录） -->
      <AgentSteps v-if="!isUser && msg.steps && msg.steps.length > 0" :steps="msg.steps" />
      <div
        v-if="msg.content && (isUser || isError)"
        class="whitespace-pre-wrap break-words"
      >
        {{ msg.content }}<span v-if="msg.streaming" class="typing-cursor" />
      </div>
      <div v-else-if="markdownText" class="md-body break-words" v-html="renderedContent"></div>
      <HtmlPreview
        v-for="(block, index) in htmlBlocks"
        :key="index"
        :code="block"
        :index="htmlBlocks.length > 1 ? index + 1 : 0"
      />
      <span v-if="msg.streaming && !isUser && !isError" class="typing-cursor" />
      <!-- 历史记录：完整 ops 不落盘，仅展示节点数摘要 -->
      <div
        v-if="!msg.ops && msg.opsCount"
        class="mt-2 inline-flex items-center gap-1 rounded-md bg-ios-fill px-2 py-1 text-[11px] text-ios-label-secondary dark:bg-ios-fill-dark dark:text-ios-label-secondary-dark"
      >
        {{ t('NODES', { count: msg.opsCount }) }}{{ msg.opsStatus === 'applied' ? t('APPLIED') : '' }}
      </div>
      <OpPreviewCard
        v-if="msg.ops && msg.ops.length > 0"
        class="mt-2"
        :ops="msg.ops"
        :status="msg.opsStatus ?? 'pending'"
        @apply="$emit('apply')"
        @regenerate="$emit('regenerate')"
      />
    </div>
    <!-- AI / 错误消息：操作按钮在气泡右侧（悬停显示） -->
    <div v-if="!isUser" class="msg-actions mt-1 flex shrink-0 items-center gap-0.5">
      <button
        type="button"
        class="msg-action-btn"
        :title="t('COPY_MESSAGE')"
        :aria-label="t('COPY_MESSAGE')"
        @click="copyMessage"
      >
        <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect x="9" y="9" width="12" height="12" rx="2" />
          <path d="M5 15V5a2 2 0 0 1 2-2h10" />
        </svg>
      </button>
      <button
        type="button"
        class="msg-action-btn msg-action-btn--danger"
        :title="t('DELETE_THIS_TURN')"
        :aria-label="t('DELETE_THIS_TURN')"
        @click="$emit('delete')"
      >
        <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M3 6h18" />
          <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
          <path d="M10 11v6M14 11v6" />
        </svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
/* 气泡操作条：默认隐藏，悬停 / 键盘聚焦时淡入 */
.msg-actions {
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.15s ease;
}
.group:hover .msg-actions,
.msg-actions:focus-within {
  opacity: 1;
  pointer-events: auto;
}
.msg-action-btn {
  display: inline-flex;
  height: 24px;
  width: 24px;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  color: #8e8e93;
  transition: background-color 0.15s ease, color 0.15s ease;
}
.msg-action-btn:hover {
  background: rgba(142, 142, 147, 0.16);
  color: #111827;
}
.msg-action-btn--danger:hover {
  color: #ff3b30;
}
.dark .msg-action-btn:hover {
  background: rgba(142, 142, 147, 0.24);
  color: #f3f4f6;
}
.dark .msg-action-btn--danger:hover {
  color: #ff6961;
}
/* 触屏设备没有 hover：直接显示操作条 */
@media (hover: none) {
  .msg-actions {
    opacity: 1;
    pointer-events: auto;
  }
}

/* AI 消息 Markdown 排版（紧凑，适配 13px 气泡） */
.md-body {
  overflow-wrap: anywhere;
}
.md-body :deep(p) {
  margin: 0;
}
.md-body :deep(p + p) {
  margin-top: 6px;
}
.md-body :deep(ul),
.md-body :deep(ol) {
  margin: 4px 0;
  padding-left: 18px;
}
.md-body :deep(ul) {
  list-style: disc;
}
.md-body :deep(ol) {
  list-style: decimal;
}
.md-body :deep(li) {
  margin: 2px 0;
}
.md-body :deep(strong) {
  font-weight: 600;
}
.md-body :deep(a) {
  color: #007aff;
  text-decoration: underline;
}
.dark .md-body :deep(a) {
  color: #0a84ff;
}
.md-body :deep(code) {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
  padding: 1px 4px;
  border-radius: 4px;
  background: rgba(142, 142, 147, 0.16);
}
.md-body :deep(pre) {
  margin: 6px 0;
  padding: 8px;
  border-radius: 8px;
  background: rgba(142, 142, 147, 0.16);
  overflow-x: auto;
}
.md-body :deep(pre code) {
  padding: 0;
  background: transparent;
  font-size: 11px;
  line-height: 1.5;
}
.md-body :deep(blockquote) {
  margin: 6px 0;
  padding-left: 8px;
  border-left: 2px solid rgba(142, 142, 147, 0.4);
  opacity: 0.85;
}
.md-body :deep(h1),
.md-body :deep(h2),
.md-body :deep(h3) {
  margin: 8px 0 4px;
  font-size: 14px;
  font-weight: 600;
}
.md-body :deep(table) {
  margin: 6px 0;
  border-collapse: collapse;
  font-size: 12px;
}
.md-body :deep(th),
.md-body :deep(td) {
  padding: 2px 6px;
  border: 1px solid rgba(142, 142, 147, 0.3);
  text-align: left;
}
.md-body :deep(hr) {
  margin: 8px 0;
  border: 0;
  border-top: 1px solid rgba(142, 142, 147, 0.3);
}

/* 流式打字光标 */
.typing-cursor {
  display: inline-block;
  width: 2px;
  height: 1em;
  margin-left: 2px;
  vertical-align: text-bottom;
  background-color: currentColor;
  animation: typing-blink 0.8s step-end infinite;
}
@keyframes typing-blink {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0;
  }
}
</style>
