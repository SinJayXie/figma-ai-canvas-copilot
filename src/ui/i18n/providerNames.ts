import type { ProviderId } from '../../../types/config.types'
import { currentLocale, type Locale } from './index'

/** 服务商展示名（品牌名保留原文，中文/繁中做必要本地化） */
const PROVIDER_NAMES: Record<ProviderId, Record<Locale, string>> = {
  deepseek: { 'zh-CN': 'DeepSeek', 'zh-TW': 'DeepSeek', 'en-US': 'DeepSeek' },
  openai: { 'zh-CN': 'OpenAI', 'zh-TW': 'OpenAI', 'en-US': 'OpenAI' },
  moonshot: { 'zh-CN': 'Kimi / Moonshot', 'zh-TW': 'Kimi / Moonshot', 'en-US': 'Kimi / Moonshot' },
  zhipu: { 'zh-CN': '智谱 GLM', 'zh-TW': '智譜 GLM', 'en-US': 'Zhipu GLM' },
  qwen: { 'zh-CN': '通义千问', 'zh-TW': '通義千問', 'en-US': 'Qwen' },
  siliconflow: { 'zh-CN': '硅基流动', 'zh-TW': '矽基流動', 'en-US': 'SiliconFlow' },
  openrouter: { 'zh-CN': 'OpenRouter', 'zh-TW': 'OpenRouter', 'en-US': 'OpenRouter' },
  groq: { 'zh-CN': 'Groq', 'zh-TW': 'Groq', 'en-US': 'Groq' },
  mistral: { 'zh-CN': 'Mistral', 'zh-TW': 'Mistral', 'en-US': 'Mistral' },
  xai: { 'zh-CN': 'xAI Grok', 'zh-TW': 'xAI Grok', 'en-US': 'xAI Grok' },
  gemini: { 'zh-CN': 'Google Gemini', 'zh-TW': 'Google Gemini', 'en-US': 'Google Gemini' },
  ollama: { 'zh-CN': 'Ollama（本地）', 'zh-TW': 'Ollama（本地）', 'en-US': 'Ollama (local)' },
  custom: { 'zh-CN': '自定义', 'zh-TW': '自訂', 'en-US': 'Custom' },
}

/** 按当前界面语言返回服务商展示名 */
export function localizedProviderName(id: ProviderId): string {
  return PROVIDER_NAMES[id]?.[currentLocale()] ?? id
}
