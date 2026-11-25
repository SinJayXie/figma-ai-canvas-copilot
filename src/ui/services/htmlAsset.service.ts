/**
 * HTML 预览素材服务
 * - 从画布导出被引用的图层（assets/<nodeId>.<ext>）
 * - 预览：转成 Blob + object URL，直接喂给 iframe
 * - 导出：连同 index.html 打成 ZIP，素材统一放在 assets/ 目录
 */
import { invokeCapability } from './capabilities.service'
import { t } from '../i18n'
import { createZip } from '../utils/zip'
import {
  exportFormatOf,
  extractAssetRefs,
  htmlTitle,
  normalizeNodeRef,
  replaceAssetRefs,
  type AssetRef,
} from '../utils/htmlAssets'

interface ExportedAsset {
  bytes: Uint8Array
  mime: string
  /** 实际落盘路径（SVG 导出失败回退 PNG 时会改扩展名） */
  path: string
}

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
}

/** nodeId+ext+scale → 导出任务（同一素材只导出一次） */
const exportCache = new Map<string, Promise<ExportedAsset>>()
/** 原始引用 → object URL，供预览复用 */
const objectUrls = new Map<string, string>()

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function cacheKey(ref: AssetRef, scale: number): string {
  return `${ref.nodeId}|${ref.ext}|${scale}`
}

/** 语义文件名 → 图层 id 的反查缓存 */
const nodeIdCache = new Map<string, string>()
const FIGMA_ID = /^\d+:\d+$/

/**
 * 解析素材对应的图层 id：
 * - 原生 id（2013:239 / 2013-239 / 2013%3A239）直接使用
 * - 语义文件名（icon-search.svg / logo）按图层名在画布中反查
 */
async function resolveNodeId(raw: string): Promise<string> {
  const candidate = normalizeNodeRef(raw)
  if (FIGMA_ID.test(candidate)) return candidate

  const cached = nodeIdCache.get(candidate)
  if (cached) return cached

  const base = candidate.replace(/^(icon|img|image|slice|asset)[-_]/i, '')
  const queries = [candidate, base, base.replace(/[-_]+/g, ' ')].filter(Boolean)
  for (const query of queries) {
    const data = await invokeCapability<{ nodes?: { id: string; name: string }[] }>(
      'search_nodes',
      { params: { query, limit: 20 } },
    )
    const nodes = data?.nodes ?? []
    const lower = query.toLowerCase()
    const hit = nodes.find((node) => node.name.toLowerCase() === lower) ?? nodes[0]
    if (hit) {
      nodeIdCache.set(candidate, hit.id)
      return hit.id
    }
  }
  throw new Error(t('MATERIAL_NOT_FOUND', { value: raw }))
}

/** 调用沙箱 export_node 导出单个素材（图标优先 SVG，失败回退 PNG） */
function exportAsset(ref: AssetRef, scale: number): Promise<ExportedAsset> {
  const key = cacheKey(ref, scale)
  const cached = exportCache.get(key)
  if (cached) return cached

  const task = (async (): Promise<ExportedAsset> => {
    const format = exportFormatOf(ref.ext)
    const nodeId = await resolveNodeId(ref.nodeId)
    try {
      const data = await invokeCapability<{ svg?: string; base64?: string }>(
        'export_node',
        { nodeIds: [nodeId], params: { format, scale } },
        60000,
      )
      if (format === 'SVG' && typeof data?.svg === 'string') {
        return { bytes: new TextEncoder().encode(data.svg), mime: 'image/svg+xml', path: ref.filePath }
      }
      if (!data?.base64) throw new Error(t('EXPORT_RESULT_EMPTY'))
      return {
        bytes: base64ToBytes(data.base64),
        mime: MIME_BY_EXT[ref.ext] ?? 'application/octet-stream',
        path: ref.filePath,
      }
    } catch (error) {
      // 混合了位图的图层无法导出 SVG：回退成 PNG，保证预览与 ZIP 都可用
      if (format !== 'SVG') throw error
      const data = await invokeCapability<{ base64?: string }>(
        'export_node',
        { nodeIds: [nodeId], params: { format: 'PNG', scale } },
        60000,
      )
      if (!data?.base64) throw error
      return {
        bytes: base64ToBytes(data.base64),
        mime: MIME_BY_EXT.png,
        path: ref.filePath.replace(/\.svg$/i, '.png'),
      }
    }
  })()

  exportCache.set(key, task)
  // 失败不缓存，允许下次重试
  task.catch(() => exportCache.delete(key))
  return task
}

/** 预览用：导出素材并替换成 blob URL */
export async function resolveHtmlAssets(
  html: string,
  scale = 2,
): Promise<{ html: string; failed: string[] }> {
  const refs = extractAssetRefs(html)
  if (refs.length === 0) return { html, failed: [] }

  const mapping = new Map<string, string>()
  const failed: string[] = []
  await Promise.all(
    refs.map(async (ref) => {
      try {
        const asset = await exportAsset(ref, scale)
        let url = objectUrls.get(ref.raw)
        if (!url) {
          url = URL.createObjectURL(new Blob([asset.bytes as unknown as BlobPart], { type: asset.mime }))
          objectUrls.set(ref.raw, url)
        }
        mapping.set(ref.raw, url)
      } catch {
        failed.push(ref.raw)
      }
    }),
  )
  return { html: replaceAssetRefs(html, mapping), failed }
}

/** 导出 ZIP：index.html + assets/…（HTML 内仍保留相对路径引用） */
export async function buildHtmlZip(
  html: string,
  scale = 2,
): Promise<{ blob: Blob; name: string; failed: string[] }> {
  const refs = extractAssetRefs(html)
  const failed: string[] = []
  const entries: { path: string; data: Uint8Array }[] = []
  /** 原始引用 → 实际落盘路径（冒号等非法字符已替换，HTML 需同步改写） */
  const mapping = new Map<string, string>()

  for (const ref of refs) {
    try {
      const asset = await exportAsset(ref, scale)
      entries.push({ path: asset.path, data: asset.bytes })
      mapping.set(ref.raw, asset.path)
    } catch {
      failed.push(ref.raw)
    }
  }

  const finalHtml = replaceAssetRefs(html, mapping)
  entries.unshift({ path: 'index.html', data: new TextEncoder().encode(finalHtml) })

  return { blob: createZip(entries), name: `${htmlTitle(html)}.zip`, failed }
}

/** 触发浏览器下载 */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}
