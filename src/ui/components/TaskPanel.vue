<script setup lang="ts">
/**
 * 任务模式任务面板：显示任务进度与当前步骤，可展开查看完整任务列表。
 * 任务列表由模型通过 update_tasks 工具维护，保存于当前会话。
 */
import { computed, ref } from 'vue'
import { clearTaskList, completeTaskManually } from '../services/agent.service'
import { useChatStore } from '../store/chat'

const chatStore = useChatStore()
const expanded = ref(false)

/** 手动完成：把剩余任务全部标记完成并停止续跑 */
function onComplete(): void {
  completeTaskManually()
  expanded.value = false
}

/** 清空任务：移除任务列表并停止续跑 */
function onClear(): void {
  clearTaskList()
  expanded.value = false
}

const tasks = computed(() => chatStore.tasks)
const total = computed(() => tasks.value.length)
const completed = computed(() => tasks.value.filter((task) => task.status === 'completed').length)
const currentIndex = computed(() => tasks.value.findIndex((task) => task.status === 'in_progress'))
const current = computed(() => (currentIndex.value >= 0 ? tasks.value[currentIndex.value] : undefined))
const currentStep = computed(() => {
  if (currentIndex.value >= 0) return currentIndex.value + 1
  return total.value > 0 ? Math.min(completed.value + 1, total.value) : 0
})
const allDone = computed(() => total.value > 0 && completed.value === total.value)
</script>

<template>
  <div
    v-if="total > 0"
    class="mx-3 mb-2 shrink-0 overflow-hidden rounded-xl border border-figma-border bg-figma-surface dark:border-figma-border-dark dark:bg-figma-surface-dark"
  >
    <div class="flex items-center gap-1 px-2 py-2">
      <button
        type="button"
        class="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1 py-0.5 text-left transition-colors hover:bg-ios-fill dark:hover:bg-ios-fill-dark"
        :aria-expanded="expanded"
        @click="expanded = !expanded"
      >
        <span
          class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
          :class="
            allDone
              ? 'bg-ios-green/12 text-ios-green dark:bg-ios-green-dark/15 dark:text-ios-green-dark'
              : 'bg-ios-blue/10 text-ios-blue dark:bg-ios-blue-dark/15 dark:text-ios-blue-dark'
          "
        >
          <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M9 6h11M9 12h11M9 18h11" />
            <path d="M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2" />
          </svg>
        </span>
        <span class="min-w-0 flex-1">
          <span class="flex items-center gap-1.5">
            <span class="text-[13px] font-semibold text-figma-text dark:text-figma-text-dark">任务进度</span>
            <span class="rounded-full bg-ios-fill px-1.5 py-px text-[10px] font-medium text-ios-label-secondary dark:bg-ios-fill-dark dark:text-ios-label-secondary-dark">
              {{ completed }}/{{ total }}
            </span>
            <span v-if="!allDone" class="text-[10px] font-medium text-ios-blue dark:text-ios-blue-dark">
              第 {{ currentStep }} 步
            </span>
          </span>
          <span class="mt-0.5 block truncate text-[11px] text-ios-label-secondary dark:text-ios-label-secondary-dark">
            {{ allDone ? '全部任务已完成' : current?.title ?? '等待下一步' }}
          </span>
        </span>
        <svg
          class="h-3.5 w-3.5 shrink-0 text-ios-label-tertiary transition-transform dark:text-ios-label-tertiary-dark"
          :class="expanded ? 'rotate-180' : ''"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      <!-- 手动完成：剩余任务全部标记完成并停止续跑 -->
      <button
        v-if="!allDone"
        type="button"
        title="标记全部完成"
        aria-label="标记全部完成"
        class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-ios-label-secondary transition-colors hover:bg-ios-fill hover:text-ios-green dark:text-ios-label-secondary-dark dark:hover:bg-ios-fill-dark dark:hover:text-ios-green-dark"
        @click="onComplete"
      >
        <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M2 12l4 4L14 8" />
          <path d="M9 12l4 4L22 6" />
        </svg>
      </button>
      <!-- 清空任务列表 -->
      <button
        type="button"
        title="清空任务列表"
        aria-label="清空任务列表"
        class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-ios-label-secondary transition-colors hover:bg-ios-fill hover:text-ios-red dark:text-ios-label-secondary-dark dark:hover:bg-ios-fill-dark dark:hover:text-ios-red-dark"
        @click="onClear"
      >
        <svg class="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </div>

    <div v-if="expanded" class="max-h-56 overflow-y-auto border-t border-figma-border px-3 py-2 dark:border-figma-border-dark">
      <ol class="flex flex-col gap-1.5">
        <li
          v-for="(task, index) in tasks"
          :key="task.id"
          class="flex items-start gap-2 rounded-lg px-1.5 py-1"
          :class="task.status === 'in_progress' ? 'bg-ios-blue/10 dark:bg-ios-blue-dark/10' : ''"
        >
          <span class="mt-0.5 w-6 shrink-0 text-[10px] tabular-nums text-ios-label-tertiary dark:text-ios-label-tertiary-dark">
            {{ String(index + 1).padStart(2, '0') }}
          </span>
          <span class="mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center">
            <svg
              v-if="task.status === 'completed'"
              class="h-3.5 w-3.5 text-ios-green dark:text-ios-green-dark"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M20 6L9 17l-5-5" />
            </svg>
            <span
              v-else-if="task.status === 'in_progress'"
              class="h-2 w-2 animate-pulse rounded-full bg-ios-blue dark:bg-ios-blue-dark"
            />
            <span v-else class="h-2 w-2 rounded-full border border-ios-label-tertiary dark:border-ios-label-tertiary-dark" />
          </span>
          <span
            class="min-w-0 flex-1 text-[12px] leading-[18px]"
            :class="
              task.status === 'completed'
                ? 'text-ios-label-tertiary line-through dark:text-ios-label-tertiary-dark'
                : task.status === 'in_progress'
                  ? 'font-medium text-figma-text dark:text-figma-text-dark'
                  : 'text-ios-label-secondary dark:text-ios-label-secondary-dark'
            "
          >
            {{ task.title }}
          </span>
        </li>
      </ol>
    </div>
  </div>
</template>
