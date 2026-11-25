/**
 * Figma 主题同步（DEV.md 4.5 + M3 7.3 主题跟随完善）
 * followTheme=true：跟随沙箱推送的 theme:changed（无 id 事件）；false：固定亮色不跟随
 * 当前主题探测复用 themeColors 注入的 Figma CSS 变量兜底，不改动沙箱协议
 */
import { watch } from 'vue'
import type { ThemeMode } from '../../../types/message.types'
import { useConfigStore } from '../store/config'

/** 在 documentElement 上切换暗色类名 */
function applyTheme(mode: ThemeMode): void {
  document.documentElement.classList.toggle('dark', mode === 'dark')
}

/** 兜底解析：读取 themeColors 注入的 Figma CSS 变量背景色，按亮度判断明暗 */
function detectThemeFromCss(): ThemeMode {
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--figma-color-bg').trim()
  const hex = /#([0-9a-fA-F]{6})/.exec(bg)?.[1]
  if (!hex) return 'light'
  const value = parseInt(hex, 16)
  const r = (value >> 16) & 0xff
  const g = (value >> 8) & 0xff
  const b = value & 0xff
  return (r * 299 + g * 587 + b * 114) / 1000 < 128 ? 'dark' : 'light'
}

/** 初始化主题同步：按 followTheme 探测初始主题，并通过 CSS 变量变化监听后续切换 */
export function initTheme(): void {
  const configStore = useConfigStore()
  // 当前主题（沙箱不支持 themechange 事件，统一从 themeColors 注入的 Figma CSS 变量探测）
  let current: ThemeMode = configStore.config.followTheme ? detectThemeFromCss() : 'light'

  const syncTheme = (): void => {
    const next = configStore.config.followTheme ? detectThemeFromCss() : 'light'
    if (next !== current) {
      current = next
      applyTheme(current)
    }
  }

  applyTheme(current)
  // 配置异步加载完成后（followTheme 可能与默认值不同）按配置重设一次
  watch(
    () => configStore.config.followTheme,
    () => syncTheme(),
  )
  // Figma 切换主题时会更新 documentElement 上的 CSS 变量，监听属性变化实现跟随
  const observer = new MutationObserver(syncTheme)
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['style', 'class', 'data-theme'],
  })
}
