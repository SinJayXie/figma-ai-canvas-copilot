<script setup lang="ts">
/**
 * 数字步进输入框：左右 − / + 按钮 + 中间输入。
 * - 空值 / 非法输入以 null 上抛，由调用方决定回退默认值
 * - min / max 在失焦与步进时限幅；step 支持小数（0.1 / 0.05 等）
 */
import { ref, watch } from 'vue'
import { useT } from '../i18n'

const props = withDefaults(
  defineProps<{
    modelValue: number | null
    min?: number
    max?: number
    step?: number
    placeholder?: string
    ariaLabel?: string
  }>(),
  { min: 0, max: 1000000, step: 1, placeholder: '', ariaLabel: '' }
)
const t = useT()

const emit = defineEmits<{ (e: 'update:modelValue', value: number | null): void }>()

const text = ref(props.modelValue === null ? '' : String(props.modelValue))

// 外部值变化（快捷标签 / 重置）时同步显示；用户正在输入的中间态不回写
watch(
  () => props.modelValue,
  (value) => {
    const current = text.value.trim()
    const currentNum = current === '' ? null : Number(current)
    if (currentNum !== value) text.value = value === null ? '' : String(value)
  }
)

function clamp(value: number): number {
  const rounded = Math.round(value * 1000) / 1000
  return Math.min(props.max, Math.max(props.min, rounded))
}

function onInput(event: Event): void {
  const raw = (event.target as HTMLInputElement).value.trim()
  if (!raw) {
    emit('update:modelValue', null)
    return
  }
  const parsed = Number(raw)
  // 非法中间态（如 "-"）不上抛，等失焦时清理
  if (!Number.isFinite(parsed)) return
  emit('update:modelValue', parsed)
}

function onBlur(event: Event): void {
  const raw = (event.target as HTMLInputElement).value.trim()
  if (!raw) return
  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) {
    emit('update:modelValue', null)
    text.value = ''
    return
  }
  emit('update:modelValue', clamp(parsed))
}

function stepBy(direction: -1 | 1): void {
  const base = props.modelValue ?? (props.min > 0 ? props.min : 0)
  emit('update:modelValue', clamp(base + direction * props.step))
}
</script>

<template>
  <div
    class="flex h-9 w-full items-stretch overflow-hidden rounded-lg border border-transparent bg-ios-fill transition-colors focus-within:border-ios-blue/40 dark:bg-ios-fill-dark dark:focus-within:border-ios-blue-dark/40"
  >
    <button
      type="button"
      :aria-label="t('DECREASE')"
      class="w-9 shrink-0 text-[15px] leading-none text-figma-text transition-colors hover:bg-ios-fill-secondary active:bg-ios-fill-secondary dark:text-figma-text-dark dark:hover:bg-ios-fill-secondary-dark"
      @click="stepBy(-1)"
    >
      −
    </button>
    <input
      v-model="text"
      type="text"
      inputmode="decimal"
      :placeholder="placeholder"
      :aria-label="ariaLabel || undefined"
      class="min-w-0 flex-1 border-x border-figma-border bg-transparent text-center text-[14px] text-figma-text outline-none placeholder:text-ios-label-tertiary dark:border-figma-border-dark dark:text-figma-text-dark dark:placeholder:text-ios-label-tertiary-dark"
      @input="onInput"
      @blur="onBlur"
    />
    <button
      type="button"
      :aria-label="t('INCREASE')"
      class="w-9 shrink-0 text-[15px] leading-none text-figma-text transition-colors hover:bg-ios-fill-secondary active:bg-ios-fill-secondary dark:text-figma-text-dark dark:hover:bg-ios-fill-secondary-dark"
      @click="stepBy(1)"
    >
      +
    </button>
  </div>
</template>
