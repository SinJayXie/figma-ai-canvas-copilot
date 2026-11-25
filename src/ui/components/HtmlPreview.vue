<script setup lang="ts">
/**
 * HTML 预览卡片：模型输出的 ```html 代码块可直接渲染成静态预览。
 * - HTML 中的 assets/<图层id>.<ext> 由插件从画布导出成 Blob，预览替换为 blob URL
 * - iframe 使用 sandbox="allow-same-origin"（允许读 blob，仍禁止脚本执行）
 * - 支持插件内全屏预览，以及「下载 ZIP」（index.html + assets/ 素材）
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { showToast } from '../composables/useToast'
import { useT } from '../i18n'
import { buildHtmlZip, downloadBlob, resolveHtmlAssets } from '../services/htmlAsset.service'
import { extractAssetRefs } from '../utils/htmlAssets'

const props = withDefaults(defineProps<{ code: string; index?: number }>(), { index: 0 })

const mode = ref<'preview' | 'code'>('preview')
const fullscreen = ref(false)
const t = useT()
/** 实际交给 iframe 的 HTML（素材已替换为 blob URL） */
const previewHtml = ref(props.code)
const assetLoading = ref(false)
const assetFailed = ref<string[]>([])
const downloading = ref(false)

const label = computed(() => (props.index > 0 ? t('HTML_PREVIEW', { index: props.index }) : t('HTML_PREVIEW_LABEL')))
const hasAssets = computed(() => extractAssetRefs(props.code).length > 0)

function tabClass(active: boolean): string {
  return [
    'rounded-md px-1.5 py-0.5 text-[11px] font-medium transition-colors',
    active
      ? 'bg-ios-blue/10 text-ios-blue dark:bg-ios-blue-dark/15 dark:text-ios-blue-dark'
      : 'text-ios-label-secondary hover:bg-ios-fill dark:text-ios-label-secondary-dark dark:hover:bg-ios-fill-dark',
  ].join(' ')
}

/** 解析素材：无引用时直接用原始 HTML，避免多余的异步闪烁 */
let resolveToken = 0
watch(
  () => props.code,
  async (code) => {
    const token = ++resolveToken
    assetFailed.value = []
    if (extractAssetRefs(code).length === 0) {
      previewHtml.value = code
      assetLoading.value = false
      return
    }
    assetLoading.value = true
    try {
      const result = await resolveHtmlAssets(code)
      if (token !== resolveToken) return
      previewHtml.value = result.html
      assetFailed.value = result.failed
    } catch {
      if (token !== resolveToken) return
      previewHtml.value = code
    } finally {
      if (token === resolveToken) assetLoading.value = false
    }
  },
  { immediate: true },
)

async function downloadZip(): Promise<void> {
  if (downloading.value) return
  downloading.value = true
  try {
    const { blob, name, failed } = await buildHtmlZip(props.code)
    downloadBlob(blob, name)
    showToast(
      failed.length > 0
        ? t('ZIP_DOWNLOADED_ASSETS_FAILED', { count: failed.length })
        : t('ZIP_DOWNLOADED_WITH_ASSETS'),
      failed.length > 0 ? 'error' : 'info',
    )
  } catch (err) {
    showToast(err instanceof Error ? t('EXPORT_FAILED', { message: err.message }) : t('EXPORT_FAILED_PLAIN'), 'error')
  } finally {
    downloading.value = false
  }
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') fullscreen.value = false
}

watch(fullscreen, (open) => {
  if (open) window.addEventListener('keydown', onKeydown)
  else window.removeEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div class="mt-2 overflow-hidden rounded-xl border border-figma-border dark:border-figma-border-dark">
    <div
      class="flex items-center justify-between gap-2 border-b border-figma-border bg-ios-fill/60 px-2.5 py-1.5 dark:border-figma-border-dark dark:bg-ios-fill-dark/60"
    >
      <span class="truncate text-[11px] font-medium text-ios-label-secondary dark:text-ios-label-secondary-dark">
        {{ label }}
      </span>
      <div class="flex shrink-0 items-center gap-0.5">
        <button type="button" :class="tabClass(mode === 'preview')" @click="mode = 'preview'">
          {{ t('PREVIEW') }}
        </button>
        <button type="button" :class="tabClass(mode === 'code')" @click="mode = 'code'">
          {{ t('CODE') }}
        </button>
        <button
          type="button"
          class="ml-0.5 flex h-5 w-5 items-center justify-center rounded-md text-ios-label-secondary transition-colors hover:bg-ios-fill hover:text-figma-text disabled:cursor-not-allowed disabled:opacity-40 dark:text-ios-label-secondary-dark dark:hover:bg-ios-fill-dark dark:hover:text-figma-text-dark"
          :title="t('DOWNLOAD_ZIP_WITH_ASSETS')"
          :aria-label="t('DOWNLOAD_ZIP')"
          :disabled="downloading"
          @click="downloadZip"
        >
          <svg v-if="!downloading" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />
          </svg>
          <span v-else class="block h-2 w-2 animate-pulse rounded-full bg-current" />
        </button>
        <button
          type="button"
          class="flex h-5 w-5 items-center justify-center rounded-md text-ios-label-secondary transition-colors hover:bg-ios-fill hover:text-figma-text dark:text-ios-label-secondary-dark dark:hover:bg-ios-fill-dark dark:hover:text-figma-text-dark"
          :title="t('FULL_SCREEN_PREVIEW')"
          :aria-label="t('FULL_SCREEN_PREVIEW')"
          @click="fullscreen = true"
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
          </svg>
        </button>
      </div>
    </div>

    <p
      v-if="assetFailed.length > 0"
      class="border-b border-figma-border px-2.5 py-1 text-[10px] leading-4 text-ios-red dark:border-figma-border-dark dark:text-ios-red-dark"
    >
      {{ t('ASSETS_FAILED_PREVIEW_BLANK', { count: assetFailed.length, names: assetFailed.join(', ') }) }}
    </p>

    <div v-if="mode === 'preview' && assetLoading" class="flex h-[280px] items-center justify-center bg-figma-surface text-[11px] text-ios-label-secondary dark:bg-figma-surface-dark dark:text-ios-label-secondary-dark">
      {{ t('EXPORTING_ASSETS_FROM_THE_CANVAS') }}
    </div>
    <iframe
      v-else-if="mode === 'preview'"
      :srcdoc="previewHtml"
      sandbox="allow-same-origin"
      class="h-[280px] w-full border-0 bg-white"
      :title="t('HTML_PREVIEW_LABEL')"
    />
    <pre
      v-else
      class="max-h-[280px] overflow-auto bg-figma-surface p-2.5 text-[11px] leading-4 text-figma-text dark:bg-figma-surface-dark dark:text-figma-text-dark"
    ><code>{{ code }}</code></pre>

    <!-- 全屏预览：覆盖整个插件窗口 -->
    <Teleport to="body">
      <Transition name="html-fullscreen">
        <div
          v-if="fullscreen"
          class="fixed inset-0 z-[90] flex flex-col bg-figma-bg dark:bg-figma-bg-dark"
        >
          <div
            class="flex h-11 shrink-0 items-center gap-2 border-b border-figma-border px-2 dark:border-figma-border-dark"
          >
            <span class="min-w-0 flex-1 truncate text-[13px] font-semibold text-figma-text dark:text-figma-text-dark">
              {{ label }}
            </span>
            <span v-if="hasAssets" class="shrink-0 text-[10px] text-ios-label-secondary dark:text-ios-label-secondary-dark">
              {{ assetLoading ? t('EXPORTING_ASSETS') : assetFailed.length > 0 ? t('ASSETS_FAILED', { count: assetFailed.length }) : t('ASSETS_READY') }}
            </span>
            <button type="button" :class="tabClass(mode === 'preview')" @click="mode = 'preview'">
              {{ t('PREVIEW') }}
            </button>
            <button type="button" :class="tabClass(mode === 'code')" @click="mode = 'code'">
              {{ t('CODE') }}
            </button>
            <button
              type="button"
              class="flex h-7 w-7 items-center justify-center rounded-full text-ios-label-secondary transition-colors hover:bg-ios-fill dark:text-ios-label-secondary-dark dark:hover:bg-ios-fill-dark"
              :aria-label="t('EXIT_FULL_SCREEN')"
              :title="t('EXIT_FULL_SCREEN_ESC')"
              @click="fullscreen = false"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>

          <iframe
            v-if="mode === 'preview'"
            :srcdoc="previewHtml"
            sandbox="allow-same-origin"
            class="min-h-0 w-full flex-1 border-0 bg-white"
            :title="t('FULL_SCREEN_HTML_PREVIEW')"
          />
          <pre
            v-else
            class="min-h-0 flex-1 overflow-auto bg-figma-surface p-3 text-[11px] leading-4 text-figma-text dark:bg-figma-surface-dark dark:text-figma-text-dark"
          ><code>{{ code }}</code></pre>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.html-fullscreen-enter-active,
.html-fullscreen-leave-active {
  transition: opacity 0.18s ease;
}
.html-fullscreen-enter-from,
.html-fullscreen-leave-to {
  opacity: 0;
}
</style>
