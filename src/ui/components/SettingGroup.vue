<script setup lang="ts">
/** 设置分组容器：iOS inset grouped 卡片（扁平、无阴影、发丝级分隔线） */
defineProps<{ title: string }>()
</script>

<template>
  <section class="flex flex-col gap-2">
    <h3 class="px-1 text-[12px] font-semibold tracking-[0.04em] text-ios-label-secondary dark:text-ios-label-secondary-dark">
      {{ title }}
    </h3>
    <div
      class="divide-y divide-figma-border overflow-hidden rounded-xl bg-figma-surface dark:divide-figma-border-dark dark:bg-figma-surface-dark"
    >
      <slot />
    </div>
  </section>
</template>
