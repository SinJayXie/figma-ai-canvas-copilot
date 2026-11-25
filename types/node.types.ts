/**
 * 图层节点操作类型
 * 对应 Agent 输出的图层操作 JSON Schema（PRD 5.2.1），UI 层与沙箱渲染引擎共享
 */

export type NodeAction = 'create' | 'update'

export type NodeType = 'frame' | 'text' | 'rect' | 'ellipse' | 'line'

export type LayoutMode = 'vertical' | 'horizontal' | 'none'

/** Auto Layout 轴尺寸模式：fixed 固定尺寸 / hug 随内容自适应 */
export type LayoutSizingMode = 'fixed' | 'hug'

/** 轴尺寸配置（按水平/垂直描述，内部按布局方向映射到主轴/交叉轴） */
export interface NodeLayoutSizing {
  horizontal?: LayoutSizingMode
  vertical?: LayoutSizingMode
}

/** Auto Layout 配置（update 时未提供的字段保持现值） */
export interface NodeLayout {
  mode?: LayoutMode
  /** 子元素间距 */
  gap?: number
  /** 内边距 [上, 右, 下, 左] */
  padding?: [number, number, number, number]
  /** 对齐方式（映射 counterAxisAlignItems / primaryAxisAlignItems；stretch 会写入子级 layoutAlign） */
  alignItems?: string
  /** 主轴分布方式 */
  justifyContent?: string
  /** 轴尺寸模式；省略时新建 frame 默认 fixed，更新已有布局时保持现值 */
  sizing?: NodeLayoutSizing
  /** 自动换行（horizontal 布局常用） */
  wrap?: boolean
  /** 换行后的行间距 */
  counterAxisSpacing?: number
}

/** 文本自适应模式 */
export type TextAutoResize = 'NONE' | 'WIDTH_AND_HEIGHT' | 'HEIGHT' | 'TRUNCATE'

/** 填充输入：颜色字符串 / 纯色 / 渐变（图片需走 figma_call import_image） */
export type FillInput =
  | string
  | { type?: 'SOLID'; color: string; opacity?: number }
  | {
      type: 'GRADIENT_LINEAR' | 'GRADIENT_RADIAL' | 'GRADIENT_ANGULAR' | 'GRADIENT_DIAMOND'
      gradientStops: { position: number; color: string }[]
      /** 渐变角度（度）：0 = 左→右，45 = 左上→右下，90 = 上→下 */
      angle?: number
      /** Figma 原生 2x3 变换矩阵，提供时覆盖 angle */
      gradientTransform?: number[][]
      opacity?: number
    }

/** 效果输入（阴影 / 模糊），颜色为十六进制 */
export interface EffectInput {
  type: 'DROP_SHADOW' | 'INNER_SHADOW' | 'LAYER_BLUR' | 'BACKGROUND_BLUR'
  color?: string
  offset?: { x: number; y: number }
  radius?: number
  spread?: number
  visible?: boolean
}

/** 四角独立圆角 */
export interface CornerRadii {
  topLeft?: number
  topRight?: number
  bottomRight?: number
  bottomLeft?: number
}

/** 约束（相对父级缩放/对齐规则） */
export interface NodeConstraints {
  horizontal: 'MIN' | 'MAX' | 'CENTER' | 'STRETCH' | 'SCALE'
  vertical: 'MIN' | 'MAX' | 'CENTER' | 'STRETCH' | 'SCALE'
}

/** 布局网格（列 / 行 / 网格） */
export interface LayoutGridInput {
  pattern: 'COLUMNS' | 'ROWS' | 'GRID'
  visible?: boolean
  color?: string
  alignment?: 'MIN' | 'CENTER' | 'MAX'
  gutterSize?: number
  count?: number
  sectionSize?: number
  offset?: number
}

/** 子级在 Auto Layout 中的尺寸行为 */
export interface NodeChildSizing {
  horizontal?: 'fixed' | 'hug' | 'fill'
  vertical?: 'fixed' | 'hug' | 'fill'
}

/** 图层操作指令（update 时字段可选：仅修改显式给出的属性） */
export interface NodeOp {
  /** create 新建 / update 修改 */
  action: NodeAction
  /** 新建时由 LLM 生成唯一 ID；修改时为 Figma 原生图层 ID */
  id: string
  type: NodeType
  name: string
  /**
   * 目标父级。
   * - create：创建到该容器内（必须可 append）；"page" 强制创建到当前页；省略时按选中推断
   * - update：把节点移动到该容器（追加到末尾，可再用 insertAfter/insertBefore 定位）
   * 仅顶层节点生效；children 一律挂到所属 frame 内。
   */
  parent?: string
  /**
   * create：坐标语义（默认 auto）。
   * - absolute：严格使用 x/y，相对解析后的父级（父级为页面时即页面坐标）
   * - auto：由插件自动排布（页面已有内容右侧 / 容器内已有内容下方），忽略 x/y
   */
  position?: 'auto' | 'absolute'
  /**
   * create / update：把节点放到同父级下某个已有节点之后（原生 id）。
   * - create：在已有 Auto Layout 容器的中间插入内容
   * - update：调整已有子节点的顺序（Auto Layout 下 y 无效，只能靠顺序）
   * 同一批次中多个 op 使用相同 insertAfter 时，按数组顺序依次排在锚点之后。
   */
  insertAfter?: string
  /**
   * create / update：把节点放到同父级下某个已有节点之前（原生 id）。
   * 用于插到容器最前面（锚点为第一个子节点）或某个区块之前。
   */
  insertBefore?: string
  /** 坐标；父级为 auto layout 时忽略。absolute 时为父级相对坐标，否则由插件计算 */
  x?: number
  y?: number
  width?: number
  height?: number
  /** 填充色（十六进制）；"transparent" / "none" 表示无填充；frame 未提供填充时不填充 */
  fill?: string
  /** 圆角 */
  cornerRadius?: number
  /** 描边色，null 表示无描边 */
  stroke?: string | null
  strokeWeight?: number
  /** 填充列表（字符串/纯色/渐变）；提供时覆盖 fill，可多填充 */
  fills?: FillInput[]
  /** 图层透明度 0~1 */
  opacity?: number
  /** 混合模式，如 MULTIPLY / SCREEN（透传给 Figma 校验） */
  blendMode?: string
  /** 四角独立圆角（覆盖 cornerRadius） */
  cornerRadii?: CornerRadii
  /** 阴影 / 模糊效果 */
  effects?: EffectInput[]
  /** 描边位置 */
  strokeAlign?: 'INSIDE' | 'OUTSIDE' | 'CENTER'
  /** 四边独立描边宽度 */
  strokeWeights?: { top?: number; right?: number; bottom?: number; left?: number }
  /** 虚线样式 */
  dashPattern?: number[]
  /** 设计系统样式绑定（来自画布上下文的设计系统摘要） */
  fillStyleId?: string
  strokeStyleId?: string
  textStyleId?: string
  effectStyleId?: string
  layout?: NodeLayout
  /** type=text 时必填 */
  textContent?: string | null
  fontSize?: number
  fontWeight?: number
  textColor?: string
  /** 字体族，如 "PingFang SC" / "Inter"；update 未指定时保留原字体 */
  fontFamily?: string
  /** 文本自适应：WIDTH_AND_HEIGHT 表示不换行、宽度随内容 */
  textAutoResize?: TextAutoResize
  /** 行高（可选，px） */
  lineHeight?: number
  /** 字距（px，可为负） */
  letterSpacing?: number
  /** 段间距（px） */
  paragraphSpacing?: number
  textAlignHorizontal?: 'LEFT' | 'CENTER' | 'RIGHT' | 'JUSTIFIED'
  textAlignVertical?: 'TOP' | 'CENTER' | 'BOTTOM'
  textCase?: 'ORIGINAL' | 'UPPER' | 'LOWER' | 'TITLE'
  textDecoration?: 'NONE' | 'UNDERLINE' | 'STRIKETHROUGH'
  /** 文本截断方式（ENDING 时配合 maxLines 显示省略号） */
  textTruncation?: 'DISABLED' | 'ENDING'
  maxLines?: number
  /** 子级在 Auto Layout 中的尺寸行为（fill = 撑满父级对应轴） */
  layoutSizing?: NodeChildSizing
  /** Auto Layout 内绝对定位 */
  layoutPositioning?: 'AUTO' | 'ABSOLUTE'
  /** Auto Layout 尺寸约束 */
  minWidth?: number
  maxWidth?: number
  minHeight?: number
  maxHeight?: number
  /** 相对父级的约束规则 */
  constraints?: NodeConstraints
  /** 布局网格 */
  layoutGrids?: LayoutGridInput[]
  /** frame 是否裁剪超出内容 */
  clipsContent?: boolean
  /** 作为遮罩：遮住同父级中位于其下方的兄弟节点 */
  isMask?: boolean
  /** 遮罩类型，默认 ALPHA */
  maskType?: 'ALPHA' | 'VECTOR' | 'LUMINANCE'
  /** 嵌套子节点 */
  children: NodeOp[]
}

/** ops:create / ops:update 消息载荷 */
export interface OpsPayload {
  ops: NodeOp[]
}

/** 序列化后的图层节点（沙箱→UI，属性白名单精简结构，深度最多 5 层） */
export interface SerializedNode {
  id: string
  name: string
  type: NodeType | string
  /** 父级原生 id；父级为页面时为 "page"，用于创建时显式指定 parent */
  parentId?: string
  x: number
  y: number
  width: number
  height: number
  fill?: string
  /** 圆角（>0 时返回） */
  cornerRadius?: number
  /** Auto Layout 子元素间距（layoutMode 存在时返回） */
  itemSpacing?: number
  fontSize?: number
  textContent?: string
  layoutMode?: LayoutMode
  children?: SerializedNode[]
}

/** selection:get 响应 / selection:changed 事件载荷 */
export interface SelectionData {
  /** 选中节点数量 */
  count: number
  /** 序列化节点（选中超过 20 个时为空数组，仅返回统计摘要） */
  nodes: SerializedNode[]
  /** 数量截断标记 */
  truncated?: boolean
  /** 类型统计摘要 */
  summary?: string
}
