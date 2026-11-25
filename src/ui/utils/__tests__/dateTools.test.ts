import { describe, expect, it } from 'vitest'
import { isDateTool, runDateTool } from '../dateTools'

describe('dateTools', () => {
  it('识别日期工具名', () => {
    expect(isDateTool('get_current_time')).toBe(true)
    expect(isDateTool('date_math')).toBe(true)
    expect(isDateTool('figma_call')).toBe(false)
  })

  it('get_current_time 返回目标时区的日期时间字段', () => {
    const data = JSON.parse(
      runDateTool('get_current_time', JSON.stringify({ timezone: 'Asia/Shanghai' })).content,
    )
    expect(data.timezone).toBe('Asia/Shanghai')
    expect(data.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(data.time).toMatch(/^\d{2}:\d{2}:\d{2}$/)
    expect(typeof data.timestamp).toBe('number')
  })

  it('date_math 按 offset 加减日期', () => {
    const data = JSON.parse(
      runDateTool(
        'date_math',
        JSON.stringify({ base: '2026-11-25T00:00:00+08:00', offset: '3d', timezone: 'Asia/Shanghai' }),
      ).content,
    )
    expect(data.result.local).toBe('2026-11-28 00:00:00')
  })

  it('date_math 传入 to 时返回差值', () => {
    const data = JSON.parse(
      runDateTool(
        'date_math',
        JSON.stringify({ base: '2026-11-25', to: '2026-12-01', timezone: 'UTC' }),
      ).content,
    )
    expect(data.diffDays).toBe(6)
    expect(data.readable).toBe('+6d 0h 0m')
  })

  it('非法参数回填 error 而不是抛异常', () => {
    const badOffset = JSON.parse(runDateTool('date_math', JSON.stringify({ offset: '3' })).content)
    expect(badOffset.error).toBeTruthy()
    const badZone = JSON.parse(
      runDateTool('get_current_time', JSON.stringify({ timezone: 'Mars/Base' })).content,
    )
    expect(badZone.error).toBeTruthy()
  })
})
