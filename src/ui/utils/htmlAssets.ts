/**
 * HTML 预览素材解析
 * 约定：HTML 中以 `assets/<图层原生 id>.<ext>` 引用画布素材，
 * 由插件从 Figma 导出成 Blob：预览替换成 blob URL，导出 ZIP 时写入 assets/ 目录。
 */

export type AssetFormat = 'png' | 'jpg' | 'jpeg' | 'svg' | 'pdf'

export interface AssetRef {
  /** HTML 中的原始引用，如 assets/2013:239.png */
  raw: string
  /** 图层原生 id 或语义文件名，如 2013:239 / icon-search */
  nodeId: string
  /** 文件扩展名（小写） */
  ext: AssetFormat
  /** 落盘路径：把 Windows / URL 不允许的字符（如 id 里的冒号）替换成短横线 */
  filePath: string
}

/** 支持的扩展名 → 导出格式 */
const FORMAT_MAP: Record<AssetFormat, 'PNG' | 'JPG' | 'SVG' | 'PDF'> = {
  png: 'PNG',
  jpg: 'JPG',
  jpeg: 'JPG',
  svg: 'SVG',
  pdf: 'PDF',
}

export function exportFormatOf(ext: AssetFormat): 'PNG' | 'JPG' | 'SVG' | 'PDF' {
  return FORMAT_MAP[ext]
}

/**
 * Figma 原生 id 允许 : ; - _，同时兼容 URL 编码的 %3A 与语义文件名
 * （icon-search / logo 之类的文件名由插件按图层名反查）
 */
const ASSET_PATTERN = /assets\/([A-Za-z0-9_:;%.-]+)\.(png|jpe?g|svg|pdf)/gi

/** 统一 `./assets/`、`/assets/` 为 `assets/`，避免替换后残留前缀 */
function normalizePrefix(html: string): string {
  return html.replace(/(^|[^A-Za-z0-9_-])(?:\.\/|\/)?assets\//gi, '$1assets/')
}

/**
 * 规范化为安全的文件名：Figma id 里的冒号在 Windows / 多数解压工具下非法，
 * 统一替换成短横线，保证 ZIP 能在任意平台解压且与 HTML 引用一致。
 */
export function safeAssetFileName(nodeId: string): string {
  return nodeId
    .replace(/%3A/gi, ':')
    .replace(/[:;\\/*?"<>|\s]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

/** 提取 HTML 中引用的画布素材（去重，保持出现顺序） */
export function extractAssetRefs(html: string): AssetRef[] {
  if (!html || !/assets\//i.test(html)) return []
  const seen = new Set<string>()
  const refs: AssetRef[] = []
  const normalized = normalizePrefix(html)
  ASSET_PATTERN.lastIndex = 0
  let matched: RegExpExecArray | null
  while ((matched = ASSET_PATTERN.exec(normalized)) !== null) {
    const raw = matched[0]
    if (seen.has(raw)) continue
    seen.add(raw)
    const ext = matched[2].toLowerCase() as AssetFormat
    refs.push({
      raw,
      nodeId: matched[1],
      ext,
      filePath: `assets/${safeAssetFileName(matched[1])}.${ext}`,
    })
  }
  return refs
}

/** 把 HTML 里的素材引用替换成运行时地址（预览为 blob URL，导出为同名相对路径） */
export function replaceAssetRefs(html: string, mapping: Map<string, string>): string {
  let out = normalizePrefix(html)
  for (const [raw, url] of mapping) {
    out = out.split(raw).join(url)
  }
  return out
}

/** 从引用里解析出可用的图层 id：兼容 %3A、2013-239、语义文件名 */
export function normalizeNodeRef(nodeId: string): string {
  const decoded = nodeId.replace(/%3A/gi, ':')
  // 2013-239 → 2013:239（模型常把冒号写成短横线）
  return /^\d+-\d+$/.test(decoded) ? decoded.replace('-', ':') : decoded
}

/** 从 HTML 里取标题，用于下载文件名 */
export function htmlTitle(html: string): string {
  const matched = html.match(/<title[^>]*>([^<]*)<\/title>/i)
  const title = matched?.[1]?.trim()
  return title ? title.slice(0, 40).replace(/[\\/:*?"<>|]/g, '-') : 'preview'
}
