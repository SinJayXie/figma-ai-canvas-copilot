import { createI18n, useI18n } from 'vue-i18n'
import type { LanguageSetting } from '../../../types/config.types'
import enUS from './locales/en-US'
import zhCN from './locales/zh-CN'
import zhTW from './locales/zh-TW'

/** 实际生效的界面语言（auto 会被解析为其中之一） */
export type Locale = Exclude<LanguageSetting, 'auto'>

export const SUPPORTED_LOCALES: Locale[] = ['zh-CN', 'zh-TW', 'en-US']

/** 语言选项的中文源文案，由 t() 输出对应语言 */
export const LANGUAGE_OPTIONS: { value: LanguageSetting; label: string }[] = [
  { value: 'auto', label: 'FOLLOW_SYSTEM' },
  { value: 'zh-CN', label: 'ZH_CN' },
  { value: 'zh-TW', label: 'ZH_TW' },
  { value: 'en-US', label: 'ENGLISH' },
]

const DICTIONARIES: Record<Locale, Record<string, string>> = {
  'zh-CN': zhCN,
  'zh-TW': zhTW,
  'en-US': enUS,
}

/** 按系统 / 浏览器语言选择初始界面语言 */
export function detectLocale(): Locale {
  if (typeof navigator === 'undefined') return 'en-US'
  const tags = navigator.languages?.length ? navigator.languages : [navigator.language]
  for (const tag of tags) {
    const value = (tag ?? '').toLowerCase()
    if (value.startsWith('zh')) {
      // 显式简体优先，避免 zh-Hans-HK 被地区码误判成繁体
      if (value.includes('hans')) return 'zh-CN'
      if (value.includes('hant') || /(?:^|-)tw(?:-|$)|(?:^|-)hk(?:-|$)|(?:^|-)mo(?:-|$)/.test(value)) {
        return 'zh-TW'
      }
      return 'zh-CN'
    }
    if (value.startsWith('en')) return 'en-US'
  }
  return 'en-US'
}

/** 是否为明确的固定语言（auto / 非法值都走系统检测） */
function isExplicitLocale(setting: LanguageSetting | string | undefined): setting is Locale {
  return setting === 'zh-CN' || setting === 'zh-TW' || setting === 'en-US'
}

/** auto 跟随系统，其余直接使用配置值 */
export function resolveLocale(setting: LanguageSetting | string | undefined): Locale {
  return isExplicitLocale(setting) ? setting : detectLocale()
}

export const i18n = createI18n({
  legacy: false,
  locale: detectLocale(),
  fallbackLocale: 'en-US',
  messages: {
    'zh-CN': zhCN,
    'zh-TW': zhTW,
    'en-US': enUS,
  },
  flatJson: true,
  missingWarn: false,
  fallbackWarn: false,
})

/** 切换语言并同步 <html lang>，供设置页与配置加载共用 */
export function setLocale(locale: Locale): void {
  i18n.global.locale.value = locale
  if (typeof document !== 'undefined') document.documentElement.lang = locale
}

/** auto 模式下跟随系统语言变化 */
let autoMode = false
let languageListenerBound = false

function bindSystemLanguageListener(): void {
  if (languageListenerBound || typeof window === 'undefined') return
  languageListenerBound = true
  window.addEventListener('languagechange', () => {
    if (autoMode) setLocale(detectLocale())
  })
}

/** 按配置项应用语言（auto 会按系统环境解析） */
export function applyLanguage(setting: LanguageSetting | string | undefined): Locale {
  const locale = resolveLocale(setting)
  autoMode = !isExplicitLocale(setting)
  bindSystemLanguageListener()
  setLocale(locale)
  return locale
}

export type TranslateParams = Record<string, string | number>

/** 替换 {name} 形式的插值，缺失参数保持原样 */
function interpolate(template: string, params?: TranslateParams): string {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(params, key) ? String(params[key]) : match,
  )
}

/** 英文等语言使用 `单数 | 复数` 形式，按 Intl.PluralRules 选择 */
function selectPlural(template: string, locale: Locale, params?: TranslateParams): string {
  if (!template.includes('|') || !params) return template
  const count = Number(params.count)
  if (!Number.isFinite(count)) return template
  const forms = template.split('|').map((item) => item.trim())
  if (forms.length < 2) return forms[0]
  return new Intl.PluralRules(locale).select(count) === 'one' ? forms[0] : forms[1]
}

/**
 * 文案查找：所有语言共用同一套大写英文语义 key。
 * 回退顺序：当前语言 → 简体中文 → English → key，避免新增 key 时直接暴露原始标识符。
 */
export function translate(
  locale: Locale,
  key: string,
  params?: TranslateParams,
): string {
  const chain: Locale[] =
    locale === 'zh-TW' ? ['zh-TW', 'zh-CN', 'en-US'] : locale === 'zh-CN' ? ['zh-CN', 'en-US'] : ['en-US', 'zh-CN']
  let template: string | undefined
  for (const candidate of chain) {
    const dict = DICTIONARIES[candidate]
    if (dict && Object.prototype.hasOwnProperty.call(dict, key)) {
      template = dict[key]
      break
    }
  }
  return interpolate(selectPlural(template ?? key, locale, params), params)
}

/** 非组件环境（service / store）使用的翻译函数 */
export function t(key: string, params?: TranslateParams): string {
  return translate(i18n.global.locale.value as Locale, key, params)
}

/** 组件内使用的响应式翻译函数：语言切换后模板会自动重渲染 */
export function useT(): (key: string, params?: TranslateParams) => string {
  const { locale } = useI18n({ useScope: 'global' })
  return (key: string, params?: TranslateParams) =>
    translate(locale.value as Locale, key, params)
}

/** 当前语言（用于依赖语言的计算属性） */
export function currentLocale(): Locale {
  return i18n.global.locale.value as Locale
}

// 初始化 <html lang> 并绑定 automatic 模式下的系统语言变化
applyLanguage('auto')
