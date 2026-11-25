/**
 * Figma 插件打包脚本：把可发布的运行文件压成 release/<name>-v<version>.zip
 * 内容：manifest.json + dist/（code.js / ui.html）+ icon.png
 *
 * 用法：npm run package（会先执行 build）
 * 纯 Node 实现（deflate + ZIP 结构），不依赖系统 zip / PowerShell，条目统一使用 / 分隔符。
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateRawSync } from 'node:zlib'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const name = pkg.name || 'figma-plugin'
const version = pkg.version || '0.0.0'
const zipName = `${name}-v${version}.zip`
const releaseDir = join(root, 'release')
const zipPath = join(releaseDir, zipName)

/** 需要打进 zip 的产物（路径相对项目根目录） */
const entries = ['manifest.json', 'dist', 'icon.png']

const missing = entries.filter((entry) => !existsSync(join(root, entry)))
if (missing.length > 0) {
  console.error(`缺少打包文件：${missing.join(', ')}\n请先执行 npm run build`)
  process.exit(1)
}

const requiredFiles = ['dist/code.js', 'dist/ui.html']
const missingFiles = requiredFiles.filter((file) => !existsSync(join(root, file)))
if (missingFiles.length > 0) {
  console.error(`dist 产物不完整：${missingFiles.join(', ')}\n请先执行 npm run build`)
  process.exit(1)
}

/** 递归收集文件，返回相对项目根目录、以 / 分隔的路径 */
function collectFiles(entry) {
  const abs = join(root, entry)
  if (statSync(abs).isFile()) return [relative(root, abs).split(sep).join('/')]
  return readdirSync(abs)
    .sort()
    .flatMap((child) => collectFiles(join(entry, child)))
}

const files = entries.flatMap((entry) => collectFiles(entry))

/** CRC32（ZIP 校验字段） */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[i] = c >>> 0
  }
  return table
})()

function crc32(buffer) {
  let crc = 0xffffffff
  for (let i = 0; i < buffer.length; i++) crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

/** DOS 时间/日期（ZIP 本地头与中央目录头需要） */
function dosDateTime(date) {
  return {
    time:
      ((date.getHours() & 0x1f) << 11) |
      ((date.getMinutes() & 0x3f) << 5) |
      (Math.floor(date.getSeconds() / 2) & 0x1f),
    date:
      (((date.getFullYear() - 1980) & 0x7f) << 9) |
      (((date.getMonth() + 1) & 0x0f) << 5) |
      (date.getDate() & 0x1f),
  }
}

const now = new Date()
const dos = dosDateTime(now)
const localParts = []
const centralParts = []
let offset = 0

for (const file of files) {
  const data = readFileSync(join(root, file))
  const compressed = deflateRawSync(data, { level: 9 })
  const checksum = crc32(data)
  const nameBuffer = Buffer.from(file, 'utf8')

  const local = Buffer.alloc(30)
  local.writeUInt32LE(0x04034b50, 0) // 本地文件头签名
  local.writeUInt16LE(20, 4) // 解压所需版本
  local.writeUInt16LE(0x0800, 6) // bit 11：文件名 UTF-8
  local.writeUInt16LE(8, 8) // deflate
  local.writeUInt16LE(dos.time, 10)
  local.writeUInt16LE(dos.date, 12)
  local.writeUInt32LE(checksum, 14)
  local.writeUInt32LE(compressed.length, 18)
  local.writeUInt32LE(data.length, 22)
  local.writeUInt16LE(nameBuffer.length, 26)
  local.writeUInt16LE(0, 28) // extra 长度
  localParts.push(local, nameBuffer, compressed)

  const central = Buffer.alloc(46)
  central.writeUInt32LE(0x02014b50, 0) // 中央目录头签名
  central.writeUInt16LE(20, 4) // version made by
  central.writeUInt16LE(20, 6) // version needed
  central.writeUInt16LE(0x0800, 8)
  central.writeUInt16LE(8, 10)
  central.writeUInt16LE(dos.time, 12)
  central.writeUInt16LE(dos.date, 14)
  central.writeUInt32LE(checksum, 16)
  central.writeUInt32LE(compressed.length, 20)
  central.writeUInt32LE(data.length, 24)
  central.writeUInt16LE(nameBuffer.length, 28)
  central.writeUInt16LE(0, 30) // extra
  central.writeUInt16LE(0, 32) // comment
  central.writeUInt16LE(0, 34) // disk
  central.writeUInt16LE(0, 36) // internal attrs
  central.writeUInt32LE(0, 38) // external attrs
  central.writeUInt32LE(offset, 42) // 本地头偏移
  centralParts.push(central, nameBuffer)

  offset += local.length + nameBuffer.length + compressed.length
}

const centralDirectory = Buffer.concat(centralParts)
const endRecord = Buffer.alloc(22)
endRecord.writeUInt32LE(0x06054b50, 0) // EOCD 签名
endRecord.writeUInt16LE(0, 4)
endRecord.writeUInt16LE(0, 6)
endRecord.writeUInt16LE(files.length, 8)
endRecord.writeUInt16LE(files.length, 10)
endRecord.writeUInt32LE(centralDirectory.length, 12)
endRecord.writeUInt32LE(offset, 16)
endRecord.writeUInt16LE(0, 20)

mkdirSync(releaseDir, { recursive: true })
if (existsSync(zipPath)) rmSync(zipPath)
writeFileSync(zipPath, Buffer.concat([...localParts, centralDirectory, endRecord]))

const sizeKb = Math.round(statSync(zipPath).size / 1024)
console.log(`\n✓ 已生成 ${join('release', zipName)}（${sizeKb} KB）`)
console.log(`  文件：${files.join('、')}`)
console.log('  解压后在 Figma 中导入 manifest.json 即可使用')
