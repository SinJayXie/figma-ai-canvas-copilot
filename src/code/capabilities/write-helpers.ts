// Write helpers — utilities used exclusively by write handlers.

export const hexToRgb = (hex: string) => {
  const clean = hex.replace("#", "");
  return {
    r: parseInt(clean.slice(0, 2), 16) / 255,
    g: parseInt(clean.slice(2, 4), 16) / 255,
    b: parseInt(clean.slice(4, 6), 16) / 255,
    a: clean.length >= 8 ? parseInt(clean.slice(6, 8), 16) / 255 : 1,
  };
};

/**
 * 宽松颜色解析：支持
 * - 十六进制字符串 "#FF0000" / "FF0000" / "#F00" / "#FF000080"
 * - rgb()/rgba() 字符串
 * - Figma 颜色对象 { r, g, b, a }（0~1）
 * - 包装对象 { hex } / { color }
 * 解析失败返回 null
 */
export const parseColorValue = (
  input: any,
): { r: number; g: number; b: number; a: number } | null => {
  if (input == null) return null

  if (typeof input === "string") {
    const raw = input.trim()
    const rgbMatch = raw.match(/^rgba?\(([^)]+)\)$/i)
    if (rgbMatch) {
      const parts = rgbMatch[1].split(",").map((v) => parseFloat(v.trim()))
      if (parts.length >= 3 && parts.slice(0, 3).every((v) => !Number.isNaN(v))) {
        return {
          r: Math.min(255, Math.max(0, parts[0])) / 255,
          g: Math.min(255, Math.max(0, parts[1])) / 255,
          b: Math.min(255, Math.max(0, parts[2])) / 255,
          a: parts[3] != null && !Number.isNaN(parts[3]) ? Math.min(1, Math.max(0, parts[3])) : 1,
        }
      }
      return null
    }
    let hex = raw.replace(/^#/, "")
    if (hex.length === 3) hex = hex.split("").map((c) => c + c).join("")
    if (hex.length !== 6 && hex.length !== 8) return null
    if (!/^[0-9a-fA-F]+$/.test(hex)) return null
    return hexToRgb(hex)
  }

  if (typeof input === "object") {
    if (input.r != null && input.g != null && input.b != null) {
      const raw = { r: Number(input.r), g: Number(input.g), b: Number(input.b) }
      // 兼容 0~255 与 0~1 两种取值约定
      const scale = raw.r > 1 || raw.g > 1 || raw.b > 1 ? 255 : 1
      const alpha = input.a != null ? Number(input.a) : 1
      return {
        r: raw.r / scale,
        g: raw.g / scale,
        b: raw.b / scale,
        a: alpha > 1 ? alpha / 255 : alpha,
      }
    }
    // { hex: "#FF0000" } / { color: "#FF0000" } / { value: "#FF0000" }
    if (input.hex != null) return parseColorValue(input.hex)
    if (input.color != null) return parseColorValue(input.color)
    if (input.value != null) return parseColorValue(input.value)
  }

  return null
};

/** 模型常用 transparent / none 表示无填充 / 无描边 */
export const isNoFill = (input: any): boolean =>
  typeof input === "string" && /^(transparent|none)$/i.test(input.trim());

export const makeSolidPaint = (colorInput: any, opacityOverride?: number): SolidPaint => {
  const rgba = parseColorValue(colorInput)
  if (!rgba) {
    throw new Error(
      `颜色参数无效：${JSON.stringify(colorInput) ?? String(colorInput)}。请传十六进制字符串（如 "#FF0000"）或 { r, g, b }（0~1）`,
    )
  }
  const eff = opacityOverride != null ? opacityOverride : rgba.a
  const paint: any = { type: "SOLID", color: { r: rgba.r, g: rgba.g, b: rgba.b } }
  if (eff !== 1) paint.opacity = eff
  return paint
};

/** 宽松 Paint 列表解析：元素可为颜色字符串、{color|hex,...}、SolidPaint 或 Figma 渐变 Paint */
export const normalizePaints = (input: any): Paint[] => {
  if (!Array.isArray(input)) return [];
  return input.filter((item) => !isNoFill(item)).map((item) => normalizePaintItem(item));
};

/** 渐变角度（度，Figma 约定：0 = 左→右，90 = 上→下）→ 围绕中心旋转的 2x3 变换矩阵 */
const gradientTransformFromAngle = (angle: number): number[][] => {
  const rad = (angle * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return [
    [cos, sin, 0.5 - 0.5 * cos - 0.5 * sin],
    [-sin, cos, 0.5 + 0.5 * sin - 0.5 * cos],
  ];
};

/** 解析渐变方向：合法 gradientTransform 优先，其次 angle，缺省为左→右 */
export const resolveGradientTransform = (input: {
  angle?: unknown;
  gradientTransform?: unknown;
}): number[][] => {
  const matrix = input.gradientTransform;
  if (Array.isArray(matrix) && matrix.length >= 2) {
    const [row0, row1] = matrix;
    if (
      Array.isArray(row0) &&
      Array.isArray(row1) &&
      row0.length >= 3 &&
      row1.length >= 3 &&
      [...row0, ...row1].every((v) => typeof v === "number" && Number.isFinite(v))
    ) {
      return [
        [row0[0], row0[1], row0[2]],
        [row1[0], row1[1], row1[2]],
      ];
    }
  }
  const angle = Number(input.angle);
  if (input.angle != null && Number.isFinite(angle)) {
    return gradientTransformFromAngle(angle);
  }
  return [
    [1, 0, 0],
    [0, 1, 0],
  ];
};

/** 给渐变 Paint 写入方向（params.angle / params.gradientTransform 单独传参时使用） */
export const applyGradientOrientation = (paint: any, angle?: unknown, transform?: unknown): void => {
  if (!paint || typeof paint.type !== "string" || !paint.type.startsWith("GRADIENT")) return;
  if (angle == null && transform == null) return;
  paint.gradientTransform = resolveGradientTransform({ angle, gradientTransform: transform });
};

/**
 * 单个 Paint 归一化：
 * - 颜色字符串 / { color | hex } → SOLID
 * - type=SOLID → SOLID
 * - type=GRADIENT_*（或带 gradientStops）→ 渐变，色标颜色可为十六进制，支持 angle 方向
 * - 其余类型（IMAGE 等）原样透传，由 Figma 校验
 */
export const normalizePaintItem = (input: any): Paint => {
  if (typeof input === "string") return makeSolidPaint(input)
  if (!input || typeof input !== "object") {
    throw new Error(`填充项无效：${JSON.stringify(input) ?? String(input)}`)
  }

  const rawType = typeof input.type === "string" ? input.type.toUpperCase() : ""
  const hasStops = Array.isArray(input.gradientStops);
  const isGradient = rawType.startsWith("GRADIENT") || (!rawType && hasStops);

  if (isGradient) {
    const stops = hasStops ? input.gradientStops : [];
    if (stops.length < 2) throw new Error("渐变填充至少需要 2 个色标（gradientStops）");
    const gradientStops = stops
      .map((stop: any) => {
        const color = parseColorValue(stop?.color ?? stop?.hex ?? stop);
        if (!color) throw new Error(`渐变色标颜色无效：${JSON.stringify(stop)}`);
        return { position: Number(stop?.position ?? 0), color };
      })
      .sort((a: any, b: any) => a.position - b.position);
    const paint: any = {
      type: rawType || "GRADIENT_LINEAR",
      gradientStops,
      // 方向：gradientTransform 优先，其次 angle，缺省左→右
      gradientTransform: resolveGradientTransform(input),
    };
    if (input.opacity != null) paint.opacity = input.opacity;
    if (input.visible === false) paint.visible = false;
    return paint as Paint;
  }

  if (rawType && rawType !== "SOLID") {
    // IMAGE 等由 Figma 自行校验
    return input as Paint;
  }

  return makeSolidPaint(input.color ?? input.hex ?? input, input.opacity);
};

/**
 * 从能力参数中提取 Paint 列表（容错版）：
 * 依次尝试 params.fills/strokes（数组或单个，空数组/null 表示清空）→ params.color/hex/fill/fillColor
 * /strokeColor/value/paint → 请求顶层同名字段。全部缺失时抛出带「实际收到的字段名」的错误，便于模型自我纠正。
 */
export const collectPaintsFromParams = (
  p: any,
  request: any,
  listKey: "fills" | "strokes",
): Paint[] => {
  const toPaints = (value: any): Paint[] => {
    if (Array.isArray(value)) return normalizePaints(value);
    // transparent / none：清空填充（或描边），而不是按颜色解析报错
    if (isNoFill(value)) return [];
    return [normalizePaintItem(value)];
  };

  if (p && listKey in p) {
    const list = p[listKey];
    // 空数组 / 显式 null：清空填充或描边
    if (list == null) return [];
    return toPaints(list);
  }

  // 兼容模型常用别名（fillColor / strokeColor 等与 create_frame 参数同名）
  const colorKeys =
    listKey === "fills"
      ? ["color", "hex", "fill", "fillColor", "value", "paint", "paints", "gradient"]
      : ["color", "hex", "stroke", "strokeColor", "value", "paint", "paints", "gradient"];
  for (const key of colorKeys) {
    if (p && key in p) {
      if (p[key] == null) return [];
      return toPaints(p[key]);
    }
  }
  for (const key of colorKeys) {
    if (request && key in request) {
      if (request[key] == null) return [];
      return toPaints(request[key]);
    }
  }

  const keys = Object.keys(p ?? {});
  const capability = listKey === "fills" ? "set_fills" : "set_strokes";
  throw new Error(
    `${capability} requires params.color (hex string such as "#FF0000", or a gradient object) or params.${listKey} (array of paints; [] clears it). Received params keys: ${keys.length ? keys.join(", ") : "(none)"}`,
  );
};

/** 父级是否为 Auto Layout 容器（此时子节点位置由布局接管，x/y 无效） */
export const isAutoLayoutParent = (parent: any): boolean =>
  !!parent && parent.type !== "PAGE" && "layoutMode" in parent && parent.layoutMode !== "NONE";

export const getParentNode = async (parentId: string | undefined) => {
  if (!parentId || parentId === "page") return figma.currentPage;
  const parent = await figma.getNodeByIdAsync(parentId);
  if (!parent) throw new Error(`Parent node not found: ${parentId}`);
  if (parent.type === "INSTANCE") throw new Error(`Instance ${parentId} cannot contain new children`);
  if (!("appendChild" in parent)) throw new Error(`Node ${parentId} cannot have children`);
  return parent as ChildrenMixin & BaseNode;
};

/**
 * 先挂载后定位：appendChild 会重算坐标，先设 x/y 再 append 会导致位置丢失。
 * Auto Layout 父级忽略 x/y（位置由布局决定）。
 */
export const appendAndPlace = (parent: any, node: SceneNode, x?: number, y?: number) => {
  parent.appendChild(node);
  if (isAutoLayoutParent(parent)) return;
  node.x = x != null ? Number(x) : 0;
  node.y = y != null ? Number(y) : 0;
};

export const applyAutoLayout = (frame: FrameNode, p: any) => {
  if (p.layoutMode != null) frame.layoutMode = p.layoutMode;
  if (p.paddingTop != null) frame.paddingTop = Number(p.paddingTop);
  if (p.paddingRight != null) frame.paddingRight = Number(p.paddingRight);
  if (p.paddingBottom != null) frame.paddingBottom = Number(p.paddingBottom);
  if (p.paddingLeft != null) frame.paddingLeft = Number(p.paddingLeft);
  if (p.itemSpacing != null) frame.itemSpacing = Number(p.itemSpacing);
  if (frame.layoutMode !== "NONE") {
    if (p.primaryAxisAlignItems) frame.primaryAxisAlignItems = p.primaryAxisAlignItems;
    if (p.counterAxisAlignItems) frame.counterAxisAlignItems = p.counterAxisAlignItems;
    if (p.primaryAxisSizingMode) frame.primaryAxisSizingMode = p.primaryAxisSizingMode;
    if (p.counterAxisSizingMode) frame.counterAxisSizingMode = p.counterAxisSizingMode;
    if (p.layoutWrap) frame.layoutWrap = p.layoutWrap;
    if (p.counterAxisSpacing != null && frame.layoutWrap === "WRAP") {
      frame.counterAxisSpacing = Number(p.counterAxisSpacing);
    }
  }
};

export const base64ToBytes = (b64: string) => {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const lookup: Record<string, number> = {};
  for (let i = 0; i < chars.length; i++) lookup[chars[i]] = i;
  const padded = b64.replace(/[^A-Za-z0-9+/=]/g, "");
  const clean = padded.replace(/=/g, "");
  let outLen = Math.floor(padded.length * 3 / 4);
  if (padded.endsWith("==")) outLen -= 2;
  else if (padded.endsWith("=")) outLen -= 1;
  const bytes = new Uint8Array(outLen);
  let j = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const a = lookup[clean[i]] || 0;
    const bv = lookup[clean[i + 1]] || 0;
    const c = lookup[clean[i + 2]] || 0;
    const d = lookup[clean[i + 3]] || 0;
    bytes[j++] = (a << 2) | (bv >> 4);
    if (j < outLen) bytes[j++] = ((bv & 15) << 4) | (c >> 2);
    if (j < outLen) bytes[j++] = ((c & 3) << 6) | d;
  }
  return bytes;
};
