/**
 * 极简 ZIP 写入（仅 store，不压缩）
 * 浏览器端打包 HTML + 素材足够用，避免引入额外依赖。
 */

const encoder = new TextEncoder()

/** CRC32 查表 */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[i] = c >>> 0
  }
  return table
})()

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff
  for (let i = 0; i < data.length; i++) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

export interface ZipEntry {
  /** 解压后的相对路径，如 index.html / assets/2013-239.png */
  path: string
  data: Uint8Array
}

/** 生成 ZIP Blob（UTF-8 文件名，store 方式） */
export function createZip(entries: ZipEntry[]): Blob {
  const locals: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let offset = 0

  for (const entry of entries) {
    const name = encoder.encode(entry.path.replace(/\\/g, '/'))
    const crc = crc32(entry.data)
    const size = entry.data.length

    // 本地文件头（30 + 文件名）
    const local = new Uint8Array(30 + name.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true)
    lv.setUint16(4, 20, true) // 解压所需版本
    lv.setUint16(6, 0x0800, true) // UTF-8 文件名
    lv.setUint16(8, 0, true) // 压缩方式：store
    lv.setUint16(10, 0, true) // 时间
    lv.setUint16(12, 0x0021, true) // 日期：1980-01-01
    lv.setUint32(14, crc, true)
    lv.setUint32(18, size, true)
    lv.setUint32(22, size, true)
    lv.setUint16(26, name.length, true)
    lv.setUint16(28, 0, true)
    local.set(name, 30)

    // 中央目录项（46 + 文件名）
    const central = new Uint8Array(46 + name.length)
    const cv = new DataView(central.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint16(4, 20, true)
    cv.setUint16(6, 20, true)
    cv.setUint16(8, 0x0800, true)
    cv.setUint16(10, 0, true)
    cv.setUint16(12, 0, true)
    cv.setUint16(14, 0x0021, true)
    cv.setUint32(16, crc, true)
    cv.setUint32(20, size, true)
    cv.setUint32(24, size, true)
    cv.setUint16(28, name.length, true)
    cv.setUint32(42, offset, true)
    central.set(name, 46)

    locals.push(local, entry.data)
    centrals.push(central)
    offset += local.length + size
  }

  const centralSize = centrals.reduce((sum, item) => sum + item.length, 0)
  const end = new Uint8Array(22)
  const ev = new DataView(end.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(8, entries.length, true)
  ev.setUint16(10, entries.length, true)
  ev.setUint32(12, centralSize, true)
  ev.setUint32(16, offset, true)

  const parts: BlobPart[] = [...locals, ...centrals, end] as BlobPart[]
  return new Blob(parts, { type: 'application/zip' })
}
