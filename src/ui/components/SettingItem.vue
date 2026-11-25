<script setup lang="ts">
/**
 * 设置表单项：iOS 分组列表行。
 * - 纵向（默认）：标签/说明在上，控件在下
 * - horizontal：标签/说明在左，控件在右（开关、下拉等单行设置）
 * 行内边距由该组件统一提供，配合 SettingGroup 的 divide-y 形成分组列表。
 */
withDefaults(
  defineProps<{
    label: string
    hint?: string
    horizontal?: boolean
  }>(),
  { hint: '', horizontal: false }
)
</script>

<template>
  <div
    class="flex gap-3 px-4 py-3"
    :class="horizontal ? 'flex-row items-center justify-between' : 'flex-col gap-2.5'"
  >
    <div class="flex min-w-0 flex-col gap-1">
      <span class="text-[14px] font-medium leading-5 text-figma-text dark:text-figma-text-dark">
        {{ label }}
      </span>
      <span
        v-if="hint"
        class="text-[12px] leading-[18px] text-ios-label-secondary dark:text-ios-label-secondary-dark"
      >
        {{ hint }}
      </span>
    </div>
    <div v-if="horizontal" class="shrink-0">
      <slot />
    </div>
    <div v-else class="flex flex-col gap-2">
      <slot />
    </div>
  </div>
</template>
