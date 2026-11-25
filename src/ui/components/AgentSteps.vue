<script setup lang="ts">
/**
 * Agent 执行步骤列表（IDE Agent 风格）
 * - 每步：MDI 图标 + 单行标题 + 单行摘要，进行中图标旋转
 * - 配色采用 iOS 系统色，亮/暗色随 Figma 主题（tailwind dark: 变体）
 */
import {
  mdiAlertCircle,
  mdiBrain,
  mdiCheckCircle,
  mdiCursorDefault,
  mdiLayers,
  mdiLoading,
  mdiMagnify,
  mdiShieldCheckOutline,
  mdiWrench,
} from '@mdi/js'
import { nextTick, ref, watch } from 'vue'
import type { AgentStep, StepIcon } from '../store/chat'

const props = defineProps<{ steps: AgentStep[] }>()

/** 步骤列表容器：新步骤 / 状态变化时自动滚到底部 */
const listRef = ref<HTMLElement | null>(null)

function scrollToBottom(): void {
  const el = listRef.value
  if (el) el.scrollTop = el.scrollHeight
}

watch(
  () => props.steps.length,
  () => nextTick(scrollToBottom),
  { flush: 'post' },
)

watch(
  () => props.steps.map((step) => `${step.status}:${step.detail ?? ''}`).join('|'),
  () => nextTick(scrollToBottom),
  { flush: 'post' },
)

const ICONS: Record<StepIcon, string> = {
  think: mdiBrain,
  context: mdiMagnify,
  tool: mdiWrench,
  ops: mdiLayers,
  apply: mdiCursorDefault,
  verify: mdiShieldCheckOutline,
  error: mdiAlertCircle,
}

function iconOf(step: AgentStep): string {
  if (step.status === 'running') return mdiLoading
  if (step.status === 'failed') return mdiAlertCircle
  return ICONS[step.icon] ?? mdiWrench
}

/** 图标配色：进行中 iOS 蓝并旋转、失败 iOS 红、生成操作用紫、其余完成用绿 */
function iconClass(step: AgentStep): string {
  if (step.status === 'running') return 'animate-spin text-ios-blue dark:text-ios-blue-dark'
  if (step.status === 'failed') return 'text-ios-red dark:text-ios-red-dark'
  if (step.icon === 'ops') return 'text-ios-purple dark:text-ios-purple-dark'
  return 'text-ios-green dark:text-ios-green-dark'
}

function labelClass(step: AgentStep): string {
  if (step.status === 'failed') return 'text-ios-red dark:text-ios-red-dark'
  if (step.status === 'running') return 'text-figma-text dark:text-figma-text-dark'
  return 'text-figma-text-secondary dark:text-ios-gray-dark'
}

function statusText(step: AgentStep): string {
  if (step.status === 'running') return '进行中'
  if (step.status === 'failed') return '失败'
  return ''
}
</script>

<template>
  <ul
    ref="listRef"
    class="mb-2 max-h-44 space-y-1.5 overflow-y-auto"
  >
    <li v-for="step in steps" :key="step.id" class="flex items-start gap-1.5">
      <!-- 思考完成：绿色状态条，不再展示思考内容 -->
      <div
        v-if="step.icon === 'think' && step.status === 'done'"
        class="inline-flex items-center gap-1 rounded-md bg-ios-green/10 px-2 py-0.5 text-[11px] font-medium text-ios-green dark:bg-ios-green-dark/15 dark:text-ios-green-dark"
      >
        <svg class="h-3 w-3" viewBox="0 0 24 24" aria-hidden="true">
          <path :d="mdiCheckCircle" fill="currentColor" />
        </svg>
        思考完成
      </div>
      <template v-else>
        <svg
          class="mt-[2px] h-3.5 w-3.5 shrink-0"
          :class="iconClass(step)"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path :d="iconOf(step)" fill="currentColor" />
        </svg>
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-1">
            <span class="truncate text-[12px]" :class="labelClass(step)">{{ step.label }}</span>
            <span
              v-if="statusText(step)"
              class="shrink-0 text-[10px]"
              :class="
                step.status === 'failed'
                  ? 'text-ios-red dark:text-ios-red-dark'
                  : 'text-ios-blue dark:text-ios-blue-dark'
              "
              >{{ statusText(step) }}</span
            >
          </div>
          <div
            v-if="step.detail"
            class="truncate text-[11px] text-figma-text-secondary dark:text-ios-gray-dark"
            :title="step.detail"
          >
            {{ step.detail }}
          </div>
        </div>
      </template>
    </li>
  </ul>
</template>
