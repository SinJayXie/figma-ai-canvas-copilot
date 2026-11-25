import { describe, expect, it } from 'vitest'
import {
  exportFormatOf,
  extractAssetRefs,
  htmlTitle,
  normalizeNodeRef,
  replaceAssetRefs,
} from '../htmlAssets'
import { createZip } from '../zip'

describe('htmlAssets', () => {
  it('提取 assets/<nodeId>.<ext> 引用并去重，文件名去掉非法字符', () => {
    const html = '<img src="assets/2013:239.png"><img src="assets/2013:239.png"><div style="background:url(assets/1:2.svg)"></div>'
    expect(extractAssetRefs(html)).toEqual([
      { raw: 'assets/2013:239.png', nodeId: '2013:239', ext: 'png', filePath: 'assets/2013-239.png' },
      { raw: 'assets/1:2.svg', nodeId: '1:2', ext: 'svg', filePath: 'assets/1-2.svg' },
    ])
  })

  it('兼容 /assets 绝对路径与 JPEG 扩展名', () => {
    expect(extractAssetRefs('<img src="/assets/12:3.JPEG">')).toEqual([
      { raw: 'assets/12:3.JPEG', nodeId: '12:3', ext: 'jpeg', filePath: 'assets/12-3.jpeg' },
    ])
  })

  it('兼容 URL 编码的冒号与语义文件名', () => {
    const refs = extractAssetRefs('<img src="./assets/12%3A3.png"><img src="assets/icon-search.svg">')
    expect(refs.map((ref) => [ref.nodeId, ref.filePath])).toEqual([
      ['12%3A3', 'assets/12-3.png'],
      ['icon-search', 'assets/icon-search.svg'],
    ])
    expect(normalizeNodeRef('12%3A3')).toBe('12:3')
    expect(normalizeNodeRef('12-3')).toBe('12:3')
  })

  it('无引用时返回空数组，导出格式映射正确', () => {
    expect(extractAssetRefs('<p>hi</p>')).toEqual([])
    expect(exportFormatOf('jpeg')).toBe('JPG')
    expect(exportFormatOf('svg')).toBe('SVG')
  })

  it('replaceAssetRefs 全部替换成运行时地址', () => {
    const html = '<img src="/assets/1:2.png"><i style="background:url(assets/1:2.png)"></i>'
    const out = replaceAssetRefs(html, new Map([['assets/1:2.png', 'blob:http://x/1']]))
    expect(out).toBe('<img src="blob:http://x/1"><i style="background:url(blob:http://x/1)"></i>')
  })

  it('从 <title> 推导下载文件名', () => {
    expect(htmlTitle('<title>锁屏界面</title>')).toBe('锁屏界面')
    expect(htmlTitle('<title>a/b:c</title>')).toBe('a-b-c')
    expect(htmlTitle('<p>无标题</p>')).toBe('preview')
  })
})

describe('createZip', () => {
  const encoder = new TextEncoder()

  it('生成合法 ZIP：本地头 / 中央目录 / 结束记录', () => {
    const html = '<h1>hi</h1>'
    const asset = new Uint8Array([1, 2, 3, 4])
    const blob = createZip([
      { path: 'index.html', data: encoder.encode(html) },
      { path: 'assets/1:2.png', data: asset },
    ])
    expect(blob.type).toBe('application/zip')
    // Blob 大小 = 本地头(30+名字) + 数据 + 中央目录(46+名字) + 结束记录(22)
    const name1 = 'index.html'.length
    const name2 = 'assets/1:2.png'.length
    expect(blob.size).toBe(
      30 + name1 + encoder.encode(html).length +
      30 + name2 + asset.length +
      46 + name1 + 46 + name2 + 22,
    )
  })
})
