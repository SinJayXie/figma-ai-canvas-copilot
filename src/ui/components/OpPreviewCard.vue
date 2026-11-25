<script setup lang="ts">
import { computed, ref } from 'vue'
import { mdiAlertCircle, mdiCheckCircle, mdiChevronDown, mdiChevronUp, mdiCodeJson, mdiCursorDefault, mdiLayers, mdiLoading, mdiRefresh } from '@mdi/js'
import type { NodeOp } from '../../../types/node.types'
import type { OpsStatus } from '../store/chat'

const props = withDefaults(
  defineProps<{
    ops: NodeOp[]
    status?: OpsStatus
  }>(),
  { status: 'pending' },
)

defineEmits<{
  (e: 'apply'): void
  (e: 'regenerate'): void
}>()

/** 节点类型中文标签 */
const NODE_TYPE_LABELS: Record<string, string> = {
  frame: '框架',
  text: '文本',
  rect: '矩形',
  ellipse: '圆形',
  line: '线条',
}

interface OpStats {
  total: number
  creates: number
  updates: number
  typeCounts: Array<{ type: string; label: string; count: number }>
}

/** 递归统计节点总数与类型分布 */
const stats = computed<OpStats>(() => {
  let total = 0
  let creates = 0
  let updates = 0
  const counts = new Map<string, number>()
  const walk = (op: NodeOp): void => {
    total++
    if (op.action === 'update') updates++
    else creates++
    counts.set(op.type, (counts.get(op.type) ?? 0) + 1)
    for (const child of op.children ?? []) walk(child)
  }
  for (const op of props.ops) walk(op)
  const typeCounts = Array.from(counts.entries()).map(([type, count]) => ({
    type,
    label: NODE_TYPE_LABELS[type] ?? type,
    count,
  }))
  return { total, creates, updates, typeCounts }
})

const showDetail = ref(false)
const detailJson = computed(() => JSON.stringify(props.ops, null, 2))

/** 类型标签最多展示 3 个，其余收成 +N，避免卡片被撑高 */
const MAX_VISIBLE_TYPES = 3
const visibleTypeCounts = computed(() => stats.value.typeCounts.slice(0, MAX_VISIBLE_TYPES))
const hiddenTypeCount = computed(() =>
  Math.max(0, stats.value.typeCounts.length - MAX_VISIBLE_TYPES),
)
</script>

<template>
  <div class="w-full rounded-xl bg-ios-grouped p-2.5 dark:bg-ios-fill-dark">
    <!-- 摘要行 -->
    <div class="flex items-center justify-between gap-2 text-nowrap">
      <span class="flex shrink-0 items-center gap-1 text-[12px] font-semibold">
        <svg class="h-3.5 w-3.5 text-ios-blue dark:text-ios-blue-dark" viewBox="0 0 24 24" aria-hidden="true">
          <path :d="mdiLayers" fill="currentColor" />
        </svg>
        画布操作
      </span>
      <span class="min-w-0 truncate text-[11px] text-ios-label-secondary dark:text-ios-label-secondary-dark">
        共 {{ stats.total }} · 新 {{ stats.creates }} · 改 {{ stats.updates }}
      </span>
    </div>
    <!-- 类型分布 -->
    <div v-if="stats.typeCounts.length" class="mt-1.5 flex flex-wrap gap-1">
      <span
        v-for="t in visibleTypeCounts"
        :key="t.type"
        class="rounded-md bg-figma-surface px-1.5 py-0.5 text-[10px] text-ios-label-secondary dark:bg-ios-fill-secondary-dark dark:text-ios-label-secondary-dark"
      >
        {{ t.label }} ×{{ t.count }}
      </span>
      <span
        v-if="hiddenTypeCount > 0"
        class="rounded-md bg-figma-surface px-1.5 py-0.5 text-[10px] text-ios-label-tertiary dark:bg-ios-fill-secondary-dark dark:text-ios-label-tertiary-dark"
      >
        +{{ hiddenTypeCount }}
      </span>
    </div>
    <!-- 执行状态 -->
    <div
      v-if="status === 'applying'"
      class="mt-1.5 flex items-center gap-1 text-[11px] font-medium text-ios-blue dark:text-ios-blue-dark"
    >
      <svg class="h-3 w-3 animate-spin" viewBox="0 0 24 24" aria-hidden="true">
        <path :d="mdiLoading" fill="currentColor" />
      </svg>
      正在应用到画布…
    </div>
    <div
      v-else-if="status === 'applied'"
      class="mt-1.5 flex items-center gap-1 text-[11px] font-medium text-ios-green dark:text-ios-green-dark"
    >
      <svg class="h-3 w-3" viewBox="0 0 24 24" aria-hidden="true">
        <path :d="mdiCheckCircle" fill="currentColor" />
      </svg>
      已应用到画布
    </div>
    <div
      v-else-if="status === 'failed'"
      class="mt-1.5 flex items-center gap-1 text-[11px] font-medium text-ios-red dark:text-ios-red-dark"
    >
      <svg class="h-3 w-3" viewBox="0 0 24 24" aria-hidden="true">
        <path :d="mdiAlertCircle" fill="currentColor" />
      </svg>
      应用失败，请重试
    </div>
    <!-- 操作按钮：单行紧凑布局 -->
    <div class="mt-2 flex items-center gap-1.5">
      <button
        v-if="status !== 'applied'"
        type="button"
        class="flex min-w-0 flex-1 items-center justify-center gap-1 rounded-lg bg-ios-blue px-2 py-1.5 text-[12px] font-semibold text-white transition-colors hover:bg-ios-blue/90 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-ios-blue-dark dark:hover:bg-ios-blue-dark/90"
        :disabled="status === 'applying'"
        @click="$emit('apply')"
      >
        <svg class="h-3 w-3 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
          <path :d="mdiCursorDefault" fill="currentColor" />
        </svg>
        <span class="truncate">{{ status === 'applying' ? '应用中…' : '应用' }}</span>
      </button>
      <button
        type="button"
        class="flex min-w-0 flex-1 items-center justify-center gap-1 rounded-lg bg-figma-surface px-2 py-1.5 text-[12px] font-medium text-figma-text transition-colors hover:bg-ios-fill disabled:cursor-not-allowed disabled:opacity-50 dark:bg-ios-fill-secondary-dark dark:text-figma-text-dark dark:hover:bg-ios-fill-dark"
        :disabled="status === 'applying'"
        @click="$emit('regenerate')"
      >
        <svg class="h-3 w-3 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
          <path :d="mdiRefresh" fill="currentColor" />
        </svg>
        <span class="truncate">重新生成</span>
      </button>
      <button
        type="button"
        class="flex shrink-0 items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-[12px] text-ios-label-secondary transition-colors hover:bg-ios-fill hover:text-ios-blue dark:text-ios-label-secondary-dark dark:hover:bg-ios-fill-dark dark:hover:text-ios-blue-dark"
        @click="showDetail = !showDetail"
      >
        <svg class="h-3 w-3" viewBox="0 0 24 24" aria-hidden="true">
          <path :d="mdiCodeJson" fill="currentColor" />
        </svg>
        <span>{{ showDetail ? '收起' : '详情' }}</span>
        <svg class="h-2.5 w-2.5" viewBox="0 0 24 24" aria-hidden="true">
          <path :d="showDetail ? mdiChevronUp : mdiChevronDown" fill="currentColor" />
        </svg>
      </button>
    </div>
    <!-- 完整 JSON 详情 -->
    <pre v-if="showDetail" class="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-figma-surface p-2 text-[10px] leading-4 text-ios-label-secondary dark:bg-ios-fill-secondary-dark dark:text-ios-label-secondary-dark">{{ detailJson }}</pre>
  </div>
</template>
