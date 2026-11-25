<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { acceptConfirm, cancelConfirm, discardConfirm, useConfirm } from '../composables/useConfirm'

const state = useConfirm()
const cancelRef = ref<HTMLButtonElement | null>(null)

/** 打开时聚焦「取消」，避免误按回车执行危险操作 */
watch(
  () => state.visible,
  (visible) => {
    if (visible) void nextTick(() => cancelRef.value?.focus())
  },
)

/** Esc 取消（弹窗在 iframe 内渲染，监听 window 保证焦点在任意位置都能关闭） */
function onKeydown(event: KeyboardEvent): void {
  if (!state.visible) return
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    cancelConfirm()
  }
}

onMounted(() => window.addEventListener('keydown', onKeydown, true))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown, true))
</script>

<template>
  <Transition name="confirm">
    <div
      v-if="state.visible"
      class="fixed inset-0 z-[80] flex items-center justify-center px-6"
      role="alertdialog"
      aria-modal="true"
      :aria-label="state.title"
    >
      <div class="absolute inset-0 bg-black/30 dark:bg-black/60" @click="cancelConfirm" />
      <div
        class="relative w-full max-w-[300px] overflow-hidden rounded-2xl bg-figma-surface text-center dark:bg-figma-surface-dark"
      >
        <div class="px-4 pb-4 pt-5">
          <p class="text-[15px] font-semibold text-figma-text dark:text-figma-text-dark">
            {{ state.title }}
          </p>
          <p
            class="mt-1.5 whitespace-pre-wrap break-words text-[12px] leading-5 text-ios-label-secondary dark:text-ios-label-secondary-dark"
          >
            {{ state.message }}
          </p>
        </div>
        <!-- 三选项：确认 / 放弃 / 取消（竖排，避免小屏挤压） -->
        <div
          v-if="state.discardText"
          class="border-t border-figma-border text-[14px] dark:border-figma-border-dark"
        >
          <button
            type="button"
            class="w-full border-b border-figma-border py-3 font-semibold transition-colors hover:bg-ios-fill focus:outline-none dark:border-figma-border-dark dark:hover:bg-ios-fill-dark"
            :class="
              state.danger
                ? 'text-ios-red dark:text-ios-red-dark'
                : 'text-ios-blue dark:text-ios-blue-dark'
            "
            @click="acceptConfirm"
          >
            {{ state.confirmText }}
          </button>
          <button
            type="button"
            class="w-full border-b border-figma-border py-3 font-medium text-ios-red transition-colors hover:bg-ios-fill focus:outline-none dark:border-figma-border-dark dark:text-ios-red-dark dark:hover:bg-ios-fill-dark"
            @click="discardConfirm"
          >
            {{ state.discardText }}
          </button>
          <button
            ref="cancelRef"
            type="button"
            class="w-full py-3 font-medium text-ios-blue transition-colors hover:bg-ios-fill focus:outline-none dark:text-ios-blue-dark dark:hover:bg-ios-fill-dark"
            @click="cancelConfirm"
          >
            {{ state.cancelText }}
          </button>
        </div>
        <div
          v-else
          class="grid grid-cols-2 border-t border-figma-border text-[14px] dark:border-figma-border-dark"
        >
          <button
            ref="cancelRef"
            type="button"
            class="border-r border-figma-border py-3 font-medium text-ios-blue transition-colors hover:bg-ios-fill focus:outline-none dark:border-figma-border-dark dark:text-ios-blue-dark dark:hover:bg-ios-fill-dark"
            @click="cancelConfirm"
          >
            {{ state.cancelText }}
          </button>
          <button
            type="button"
            class="py-3 font-semibold transition-colors hover:bg-ios-fill focus:outline-none dark:hover:bg-ios-fill-dark"
            :class="
              state.danger
                ? 'text-ios-red dark:text-ios-red-dark'
                : 'text-ios-blue dark:text-ios-blue-dark'
            "
            @click="acceptConfirm"
          >
            {{ state.confirmText }}
          </button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.confirm-enter-active,
.confirm-leave-active {
  transition: opacity 0.18s ease;
}
.confirm-enter-from,
.confirm-leave-to {
  opacity: 0;
}
</style>
