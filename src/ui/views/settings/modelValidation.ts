/**
 * 设置页模型校验纯函数（ModelsTab 弹窗校验与 SettingsView 保存兜底共用）
 */
import { getProviderPreset, normalizeBaseUrl, type ModelEntry } from '../../../../types/config.types'
import { t } from '../../i18n'
import { localizedProviderName } from '../../i18n/providerNames'

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
  if (!entry.model.trim()) return t('ENTER_AN_API_MODEL_ID')
  const baseUrl = normalizeBaseUrl(entry.baseUrl)
  if (!baseUrl) return t('ENTER_A_BASE_URL')
  if (!isValidBaseUrl(baseUrl)) return t('BASE_URL_MUST_BE_AN_HTTP')
  const preset = getProviderPreset(entry.provider)
  if (preset.requiresApiKey && !entry.apiKey.trim()) return t('REQUIRES_AN_API_KEY', { provider: localizedProviderName(entry.provider) })
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
  return draft.name.trim().length > 40 ? t('DISPLAY_NAME_MUST_BE_40_CHARACTERS') : ''
}

export function draftModelIdError(draft: ModelEntry | null, models: ModelEntry[]): string {
  if (!draft) return ''
  const modelId = draft.model.trim()
  if (!modelId) return t('ENTER_AN_API_MODEL_ID')
  if (/\s/.test(modelId)) return t('MODEL_ID_CANNOT_CONTAIN_SPACES')
  if (modelId.length > 200) return t('MODEL_ID_IS_TOO_LONG')
  const baseUrl = normalizeBaseUrl(draft.baseUrl)
  const duplicated =
    !!baseUrl &&
    models.some(
      (item) =>
        item.id !== draft.id &&
        item.model.trim() === modelId &&
        normalizeBaseUrl(item.baseUrl) === baseUrl
    )
  return duplicated ? t('DUPLICATE_MODEL_ID') : ''
}

export function draftBaseUrlError(draft: ModelEntry | null): string {
  if (!draft) return ''
  const baseUrl = normalizeBaseUrl(draft.baseUrl)
  if (!baseUrl) return t('ENTER_A_BASE_URL')
  if (!isValidBaseUrl(baseUrl)) return t('BASE_URL_MUST_BE_AN_HTTP')
  try {
    const parsed = new URL(baseUrl)
    if (parsed.search || parsed.hash) return t('BASE_URL_CANNOT_CONTAIN_QUERY_PARAMETERS')
    if (/\/chat\/completions$/i.test(parsed.pathname.replace(/\/+$/, ''))) {
      return t('USE_THE_V1_LEVEL_AND_OMIT')
    }
  } catch {
    return t('INVALID_BASE_URL_FORMAT')
  }
  return ''
}

export function draftApiKeyError(draft: ModelEntry | null): string {
  if (!draft) return ''
  const preset = getProviderPreset(draft.provider)
  const apiKey = draft.apiKey.trim()
  if (preset.requiresApiKey && !apiKey) return t('REQUIRES_AN_API_KEY', { provider: localizedProviderName(draft.provider) })
  if (apiKey && /\s/.test(apiKey)) return t('API_KEY_CANNOT_CONTAIN_SPACES_OR')
  return ''
}
