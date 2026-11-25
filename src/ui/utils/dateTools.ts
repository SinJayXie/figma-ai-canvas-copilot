/**
 * 日期工具（本地执行，不走 Figma 沙箱）
 * 模型本身没有时钟、也不能可靠推算日期，这里提供真实的「现在」与日期加减 / 差值计算。
 */
import { currentLocale, t } from '../i18n'

export const DATE_TOOL_NAMES = ['get_current_time', 'date_math'] as const

export function isDateTool(name: string): boolean {
  return (DATE_TOOL_NAMES as readonly string[]).includes(name)
}

/** 单次日期工具的执行结果：content 回填模型，detail 作为步骤行摘要 */
export interface DateToolResult {
  content: string
  detail: string
}

interface DateDescription {
  /** ISO 8601（UTC） */
  iso: string
  /** 目标时区的本地时间 YYYY-MM-DD HH:mm:ss */
  local: string
  date: string
  time: string
  weekday: string
  weekdayZh: string
  weekdayLocalized: string
  timezone: string
  utcOffset: string
  /** 毫秒时间戳 */
  timestamp: number
}

const UNIT_MS = {
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
} as const

/** 默认使用运行环境的本地时区 */
function localTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
}

/** 校验时区；非法时返回 null，由调用方回填错误给模型 */
function readTimeZone(input: unknown): string | null {
  if (input === undefined || input === null || input === '') return localTimeZone()
  if (typeof input !== 'string') return null
  const zone = input.trim()
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone }).format(new Date())
    return zone
  } catch {
    return null
  }
}

/** 把时间点按目标时区展开成可读字段 */
function describe(date: Date, timeZone: string): DateDescription {
  const formatter = new Intl.DateTimeFormat('sv-SE', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  })
  // sv-SE 的输出固定为 YYYY-MM-DD HH:mm:ss，可直接切分
  const [datePart, timePart] = formatter.format(date).split(' ')
  const offsetPart = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
    .formatToParts(date)
    .find((part) => part.type === 'timeZoneName')?.value
  return {
    iso: date.toISOString(),
    local: `${datePart} ${timePart}`,
    date: datePart,
    time: timePart,
    weekday: new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'long' }).format(date),
    weekdayZh: new Intl.DateTimeFormat('zh-CN', { timeZone, weekday: 'long' }).format(date),
    weekdayLocalized: new Intl.DateTimeFormat(currentLocale(), {
      timeZone,
      weekday: 'long',
    }).format(date),
    timezone: timeZone,
    utcOffset: offsetPart && offsetPart !== 'GMT' ? offsetPart : '+00:00',
    timestamp: date.getTime(),
  }
}

/** 解析日期：支持 2026-11-25 与完整 ISO 字符串；返回 null 表示无法解析 */
function parseDate(input: unknown): Date | null {
  if (typeof input !== 'string' || !input.trim()) return null
  const date = new Date(input.trim())
  return Number.isNaN(date.getTime()) ? null : date
}

/** 解析时长：3d / -2h / 30m / 1w（必须带单位，避免歧义） */
function parseOffset(input: unknown): number | null {
  if (typeof input !== 'string') return null
  const matched = input.trim().match(/^([+-]?\d+(?:\.\d+)?)\s*(m|min|h|hr|d|day|w|week)s?$/i)
  if (!matched) return null
  const amount = Number(matched[1])
  if (!Number.isFinite(amount)) return null
  const unit = matched[2].toLowerCase()
  const key = unit.startsWith('d') ? 'd' : unit.startsWith('w') ? 'w' : unit.startsWith('h') ? 'h' : 'm'
  return amount * UNIT_MS[key]
}

function errorContent(message: string): DateToolResult {
  return { content: JSON.stringify({ error: message }), detail: message.slice(0, 60) }
}

function readArgs(raw: string): Record<string, unknown> {
  if (!raw.trim()) return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

/**
 * 执行日期工具：
 * - get_current_time：返回当前时间（可指定 IANA 时区）
 * - date_math：base 加/减 offset，或当传入 to 时返回两时间的差值
 */
export function runDateTool(name: string, argsJson: string): DateToolResult {
  const args = readArgs(argsJson)
  const timeZone = readTimeZone(args.timezone)
  if (!timeZone) {
    return errorContent(t('INVALID_DATE_TIMEZONE', { value: String(args.timezone) }))
  }

  if (name === 'get_current_time') {
    const now = describe(new Date(), timeZone)
    return {
      content: JSON.stringify(now),
      detail: `${now.local} ${now.weekdayLocalized}`,
    }
  }

  if (name === 'date_math') {
    const base = args.base === undefined || args.base === '' ? new Date() : parseDate(args.base)
    if (!base) return errorContent(t('INVALID_BASE_DATE', { value: String(args.base) }))

    // 传了 to：计算两个时间点的差值
    if (args.to !== undefined && args.to !== '') {
      const target = parseDate(args.to)
      if (!target) return errorContent(t('INVALID_TO_DATE', { value: String(args.to) }))
      const diff = target.getTime() - base.getTime()
      const sign = diff < 0 ? '-' : '+'
      const abs = Math.abs(diff)
      const days = Math.floor(abs / UNIT_MS.d)
      const hours = Math.floor((abs % UNIT_MS.d) / UNIT_MS.h)
      const minutes = Math.floor((abs % UNIT_MS.h) / UNIT_MS.m)
      return {
        content: JSON.stringify({
          from: describe(base, timeZone),
          to: describe(target, timeZone),
          diffMs: diff,
          diffDays: diff / UNIT_MS.d,
          readable: `${sign}${days}d ${hours}h ${minutes}m`,
          note: 'Positive when the target time is later than the base time',
        }),
        detail: t('DATE_DIFF_DETAIL', { value: `${sign}${days}d ${hours}h` }),
      }
    }

    const offset = parseOffset(args.offset)
    if (offset === null) {
      return errorContent(t('INVALID_OFFSET'))
    }
    const result = describe(new Date(base.getTime() + offset), timeZone)
    return {
      content: JSON.stringify({
        base: describe(base, timeZone),
        offset: String(args.offset),
        result,
      }),
      detail: `${result.local} ${result.weekdayLocalized}`,
    }
  }

  return errorContent(t('UNKNOWN_DATE_TOOL', { value: name }))
}
