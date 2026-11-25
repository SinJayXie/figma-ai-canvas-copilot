import { describe, expect, it } from 'vitest'
import {
  applyGradientOrientation,
  collectPaintsFromParams,
  makeSolidPaint,
  normalizePaintItem,
  normalizePaints,
  parseColorValue,
} from '../write-helpers'

describe('parseColorValue', () => {
  it('解析十六进制字符串（含短写、无 #、带透明度）', () => {
    expect(parseColorValue('#FF0000')).toMatchObject({ r: 1, g: 0, b: 0, a: 1 })
    expect(parseColorValue('FF0000')).toMatchObject({ r: 1, g: 0, b: 0 })
    expect(parseColorValue('#F00')).toMatchObject({ r: 1, g: 0, b: 0 })
    expect(parseColorValue('#FF000080')?.a).toBeCloseTo(128 / 255, 5)
  })

  it('解析 rgb()/rgba() 字符串', () => {
    expect(parseColorValue('rgb(255, 0, 0)')).toMatchObject({ r: 1, g: 0, b: 0, a: 1 })
    expect(parseColorValue('rgba(0, 0, 255, 0.5)')).toMatchObject({ r: 0, g: 0, b: 1, a: 0.5 })
  })

  it('解析对象与包装对象', () => {
    expect(parseColorValue({ r: 0, g: 1, b: 0 })).toMatchObject({ r: 0, g: 1, b: 0, a: 1 })
    expect(parseColorValue({ hex: '#00FF00' })).toMatchObject({ r: 0, g: 1, b: 0 })
    expect(parseColorValue({ color: '#0000FF' })).toMatchObject({ r: 0, g: 0, b: 1 })
    // 0~255 取值约定
    expect(parseColorValue({ r: 255, g: 0, b: 0 })).toMatchObject({ r: 1, g: 0, b: 0 })
    expect(parseColorValue({ value: '#FF0000' })).toMatchObject({ r: 1, g: 0, b: 0 })
  })

  it('非法输入返回 null 而不是抛错', () => {
    expect(parseColorValue(undefined)).toBeNull()
    expect(parseColorValue(null)).toBeNull()
    expect(parseColorValue('#GGG')).toBeNull()
    expect(parseColorValue({ foo: 1 })).toBeNull()
  })
})

describe('makeSolidPaint / normalizePaints', () => {
  it('生成 SOLID paint，非法颜色给出可读错误', () => {
    expect(makeSolidPaint('#FF0000')).toMatchObject({ type: 'SOLID' })
    expect(() => makeSolidPaint(undefined)).toThrow(/颜色参数无效/)
  })

  it('paint 数组支持颜色字符串与对象混写', () => {
    const paints = normalizePaints(['#FF0000', { color: '#00FF00', opacity: 0.5 }])
    expect(paints).toHaveLength(2)
    expect(paints[1]).toMatchObject({ type: 'SOLID', opacity: 0.5 })
  })

  it('渐变 Paint 透传并归一化色标颜色', () => {
    const paint: any = normalizePaintItem({
      type: 'GRADIENT_LINEAR',
      gradientStops: [
        { position: 1, color: '#0000FF' },
        { position: 0, color: '#FF0000' },
      ],
    })
    expect(paint.type).toBe('GRADIENT_LINEAR')
    expect(paint.gradientStops).toHaveLength(2)
    // 按 position 升序排列，色标支持十六进制
    expect(paint.gradientStops[0].position).toBe(0)
    expect(paint.gradientStops[0].color).toMatchObject({ r: 1, g: 0, b: 0 })
    expect(paint.gradientTransform).toEqual([
      [1, 0, 0],
      [0, 1, 0],
    ])
  })

  it('渐变缺色标时给出可读错误', () => {
    expect(() => normalizePaintItem({ type: 'GRADIENT_LINEAR', gradientStops: [] })).toThrow(
      /至少需要 2 个色标/,
    )
  })
})

describe('collectPaintsFromParams', () => {
  it('params.color 十六进制', () => {
    const paints = collectPaintsFromParams({ color: '#FF0000' }, {}, 'fills')
    expect(paints).toHaveLength(1)
    expect(paints[0]).toMatchObject({ type: 'SOLID' })
  })

  it('params.fills 支持数组与单个 Paint', () => {
    expect(collectPaintsFromParams({ fills: ['#FF0000', '#00FF00'] }, {}, 'fills')).toHaveLength(2)
    expect(collectPaintsFromParams({ fills: '#FF0000' }, {}, 'fills')).toHaveLength(1)
  })

  it('回退到请求顶层 color 字段', () => {
    const paints = collectPaintsFromParams({}, { color: '#0000FF' }, 'strokes')
    expect(paints).toHaveLength(1)
  })

  it('兼容 fillColor / strokeColor 别名', () => {
    expect(collectPaintsFromParams({ fillColor: '#FF0000' }, {}, 'fills')).toHaveLength(1)
    expect(collectPaintsFromParams({ strokeColor: '#00FF00' }, {}, 'strokes')).toHaveLength(1)
  })

  it('fills 空数组 / null / transparent 均表示清空', () => {
    expect(collectPaintsFromParams({ fills: [] }, {}, 'fills')).toEqual([])
    expect(collectPaintsFromParams({ fills: null }, {}, 'fills')).toEqual([])
    expect(collectPaintsFromParams({ fills: 'transparent' }, {}, 'fills')).toEqual([])
    expect(collectPaintsFromParams({ color: 'none' }, {}, 'fills')).toEqual([])
  })

  it('完全缺失时报错并回显收到的字段名', () => {
    expect(() => collectPaintsFromParams({ foo: 1 }, {}, 'fills')).toThrow(/Received params keys: foo/)
  })
})

describe('渐变方向', () => {
  const stops = [
    { position: 0, color: '#87CEFA' },
    { position: 1, color: '#F2F2F7' },
  ]

  it('angle=45 写入围绕中心旋转的 gradientTransform', () => {
    const paint = normalizePaintItem({ type: 'GRADIENT_LINEAR', gradientStops: stops, angle: 45 }) as any
    const [[a, b, c], [d, e, f]] = paint.gradientTransform
    expect(a).toBeCloseTo(Math.SQRT1_2, 4)
    expect(b).toBeCloseTo(Math.SQRT1_2, 4)
    expect(d).toBeCloseTo(-Math.SQRT1_2, 4)
    expect(e).toBeCloseTo(Math.SQRT1_2, 4)
    expect(c).toBeCloseTo(0.5 - Math.SQRT1_2, 4)
    expect(f).toBeCloseTo(0.5, 4)
  })

  it('缺省 angle 为左→右（单位变换）', () => {
    const paint = normalizePaintItem({ type: 'GRADIENT_LINEAR', gradientStops: stops }) as any
    expect(paint.gradientTransform).toEqual([
      [1, 0, 0],
      [0, 1, 0],
    ])
  })

  it('显式 gradientTransform 优先于 angle', () => {
    const paint = normalizePaintItem({
      type: 'GRADIENT_LINEAR',
      gradientStops: stops,
      angle: 45,
      gradientTransform: [
        [0, 1, 0],
        [-1, 0, 1],
      ],
    }) as any
    expect(paint.gradientTransform).toEqual([
      [0, 1, 0],
      [-1, 0, 1],
    ])
  })

  it('applyGradientOrientation 支持 params 级的独立 angle', () => {
    const paint = normalizePaintItem({ type: 'GRADIENT_LINEAR', gradientStops: stops }) as any
    applyGradientOrientation(paint, 90)
    expect(paint.gradientTransform[1][1]).toBeCloseTo(0, 4)
    expect(paint.gradientTransform[0][1]).toBeCloseTo(1, 4)
  })
})
