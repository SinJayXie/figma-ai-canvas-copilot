<script setup lang="ts">
/** 开关组件：iOS 系统开关（开启绿色 / 关闭灰色，扁平无边框） */
const props = withDefaults(
  defineProps<{
    modelValue: boolean
    disabled?: boolean
  }>(),
  { disabled: false }
)
const emit = defineEmits<{ (e: 'update:modelValue', value: boolean): void }>()

function toggle(): void {
  if (!props.disabled) emit('update:modelValue', !props.modelValue)
}
</script>

<template>
  <button
    type="button"
    role="switch"
    :aria-checked="modelValue"
    :disabled="disabled"
    class="relative flex h-6 w-10 shrink-0 items-center rounded-full transition-colors duration-150 focus:outline-none disabled:cursor-not-allowed disabled:opacity-40"
    :class="
      modelValue
        ? 'bg-ios-green dark:bg-ios-green-dark'
        : 'bg-ios-fill-secondary dark:bg-ios-fill-secondary-dark'
    "
    @click="toggle"
  >
    <span
      class="ml-0.5 h-5 w-5 rounded-full bg-white transition-transform duration-150"
      :class="modelValue ? 'translate-x-4' : 'translate-x-0'"
    />
  </button>
</template>
