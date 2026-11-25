import { describe, expect, it } from 'vitest'
import type { NodeOp } from '../../../../types/node.types'
import { lintOps } from '../designLint'

function op(partial: Partial<NodeOp>): NodeOp {
  return { action: 'create', id: 'n1', type: 'frame', name: '容器', children: [], ...partial }
}

describe('lintOps', () => {
  it('8pt 网格：间距 / 内边距 / 圆角不在 8 的倍数时提示', () => {
    const issues = lintOps([
      op({
        layout: { mode: 'vertical', gap: 5, padding: [10, 16, 10, 16] },
        cornerRadius: 12,
      }),
    ])
    const text = issues.map((i) => i.message).join('|')
    expect(text).toContain('间距 5')
    expect(text).toContain('内边距 10')
    expect(text).toContain('圆角 12')
  })

  it('字号不在类型阶梯内时提示', () => {
    const issues = lintOps([op({ type: 'text', fontSize: 15, textContent: '标题' })])
    expect(issues[0].message).toContain('字号 15')
  })

  it('文字与父容器填充对比度不足时提示', () => {
    const issues = lintOps([
      op({
        fill: '#FFFFFF',
        children: [op({ id: 'n2', type: 'text', name: '说明文字', textColor: '#999999' })],
      }),
    ])
    expect(issues.map((i) => i.message).join('|')).toContain('对比度')
  })

  it('按钮高度小于触控目标时提示', () => {
    const issues = lintOps([op({ name: '登录按钮', height: 32 })])
    expect(issues.map((i) => i.message).join('|')).toContain('触控目标')
  })

  it('符合规范时不产生提示', () => {
    const issues = lintOps([
      op({
        fill: '#FFFFFF',
        layout: { mode: 'vertical', gap: 16, padding: [24, 24, 24, 24] },
        cornerRadius: 16,
        children: [
          op({ id: 'n2', type: 'text', name: '标题', fontSize: 24, textColor: '#111111' }),
          op({ id: 'n3', name: '登录按钮', height: 48 }),
        ],
      }),
    ])
    expect(issues).toHaveLength(0)
  })
})
