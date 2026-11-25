/**
 * 生成唯一 ID
 * 注：Figma 插件 iframe 中 crypto.randomUUID 可能不可用，需兜底实现
 */
export function generateId(prefix = ''): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return prefix ? `${prefix}-${crypto.randomUUID()}` : crypto.randomUUID()
  }
  return `${prefix ? prefix + '-' : ''}${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}
