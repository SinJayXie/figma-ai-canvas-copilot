/**
 * 设置页模型校验纯函数（ModelsTab 弹窗校验与 SettingsView 保存兜底共用）
 */
import { getProviderPreset, normalizeBaseUrl, type ModelEntry } from '../../../../types/config.types'

export function isValidBaseUrl(url: string): boolean {
  if (!/^https?:\/\//i.test(url)) return false
  try {
    const parsed = new URL(url)
    return /^https?:$/.test(parsed.protocol) && parsed.hostname.length > 0
  } catch {
    return false
  }
}

/** 单条模型的校验信息；空字符串表示通过 */
export function modelError(entry: ModelEntry): string {
  if (!entry.model.trim()) return '请填写 API 模型 ID'
  const baseUrl = normalizeBaseUrl(entry.baseUrl)
  if (!baseUrl) return '请填写 Base URL'
  if (!isValidBaseUrl(baseUrl)) return 'Base URL 必须是 http(s) 地址'
  const preset = getProviderPreset(entry.provider)
  if (preset.requiresApiKey && !entry.apiKey.trim()) return `${preset.name} 需要 API Key`
  return ''
}

/** 同一 Base URL 下重复模型 ID 的兜底查找（返回第一条重复项） */
export function findDuplicateModel(models: ModelEntry[]): ModelEntry | undefined {
  return models.find((entry, index) =>
    models.some(
      (other, otherIndex) =>
        otherIndex !== index &&
        other.model.trim() === entry.model.trim() &&
        normalizeBaseUrl(other.baseUrl) === normalizeBaseUrl(entry.baseUrl)
    )
  )
}

export function draftNameError(draft: ModelEntry | null): string {
  if (!draft) return ''
  return draft.name.trim().length > 40 ? '显示名称不能超过 40 个字符' : ''
}

export function draftModelIdError(draft: ModelEntry | null, models: ModelEntry[]): string {
  if (!draft) return ''
  const modelId = draft.model.trim()
  if (!modelId) return '请填写 API 模型 ID'
  if (/\s/.test(modelId)) return '模型 ID 不能包含空格'
  if (modelId.length > 200) return '模型 ID 过长'
  const baseUrl = normalizeBaseUrl(draft.baseUrl)
  const duplicated =
    !!baseUrl &&
    models.some(
      (item) =>
        item.id !== draft.id &&
        item.model.trim() === modelId &&
        normalizeBaseUrl(item.baseUrl) === baseUrl
    )
  return duplicated ? '当前 Base URL 下已存在相同模型 ID' : ''
}

export function draftBaseUrlError(draft: ModelEntry | null): string {
  if (!draft) return ''
  const baseUrl = normalizeBaseUrl(draft.baseUrl)
  if (!baseUrl) return '请填写 Base URL'
  if (!isValidBaseUrl(baseUrl)) return 'Base URL 必须是 http(s) 地址'
  try {
    const parsed = new URL(baseUrl)
    if (parsed.search || parsed.hash) return 'Base URL 不能包含查询参数或锚点'
    if (/\/chat\/completions$/i.test(parsed.pathname.replace(/\/+$/, ''))) {
      return '请填写到 /v1 层级，不要包含 /chat/completions'
    }
  } catch {
    return 'Base URL 格式不正确'
  }
  return ''
}

export function draftApiKeyError(draft: ModelEntry | null): string {
  if (!draft) return ''
  const preset = getProviderPreset(draft.provider)
  const apiKey = draft.apiKey.trim()
  if (preset.requiresApiKey && !apiKey) return `${preset.name} 需要 API Key`
  if (apiKey && /\s/.test(apiKey)) return 'API Key 不能包含空格或换行'
  return ''
}
