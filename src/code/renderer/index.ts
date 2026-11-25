/**
 * 渲染引擎主流程（Task 3.4 / 3.6）
 * 批量策略：递归创建全部节点 → 逐个解析父级并挂载 → 先父后子设置 Auto Layout → 统一应用样式。
 *
 * 父级/坐标解析优先级（顶层节点）：
 * 1. op.parent 为原生 id → 创建到该容器；op.parent === 'page' → 当前页
 * 2. 未指定 parent → 选中单个容器则创建到容器内；选中普通图层则创建到其父级；否则当前页
 * 3. op.position === 'absolute' → 严格使用 x/y（相对解析后的父级，页面坐标时即绝对坐标）
 *    否则由插件自动排布：页面已有内容右侧 / 容器内已有内容下方，绝不覆盖现有内容
 * 4. 父级为 Auto Layout → 只按数组顺序 append，x/y 一律忽略
 *
 * 子节点：一律挂到所属 frame 内；frame 无 Auto Layout 时使用子节点的 x/y（相对 frame），
 * 有 Auto Layout 时按数组顺序 append。
 */

import type { NodeOp, OpsPayload } from '../../../types/node.types'
import { applyStyles, buildTree, type CreatedNode } from './createNode'
import { applyChildSizing } from './applyAppearance'
import { applyLayout } from './layoutMapper'
import { updateNodeFromOp } from './updateNode'
import { ensureFontsLoaded } from './fonts'

/** 单次渲染建议上限，超出时结果中标注提示（仍会执行） */
export const MAX_RENDER_NODES = 300
/** 顶层节点与页面已有内容右边缘的间距 */
const VIEWPORT_MARGIN = 100
/** 多个顶层节点横向/纵向排开的间距 */
const TOP_LEVEL_GAP = 100
/** 容器内节点的纵向间距 */
const CONTAINER_GAP = 24
const MIN_SIZE = 0.01

/** 单条顶层节点的实际落位（供 UI 展示与模型后续引用） */
export interface CreatePlacement {
  /** 指令里的本地 id */
  opId: string
  /** 创建后的原生 id */
  nodeId: string
  /** 父级原生 id；页面为 "page" */
  parentId: string
  parentName?: string
  x: number
  y: number
  /** 父级是否 Auto Layout（此时坐标由布局决定） */
  autoLayout: boolean
}

export interface CreateOpsResult {
  created: number
  skipped: number
  errors: string[]
  /** 所有顶层节点落在同一目标容器时的容器名称；落在页面或分散在多个容器时为空 */
  containerName?: string
  /** 新建的顶层节点 id（用于生成后自动选中与结果校验） */
  ids?: string[]
  /** op.id → 原生 node.id（含嵌套节点），便于后续 update / 定位 */
  idMap?: Record<string, string>
  /** 顶层节点落位明细 */
  placements?: CreatePlacement[]
}

export interface UpdateOpsResult {
  updated: number
  skipped: number
  errors: string[]
}

/** 统计 ops（含子级）节点总数 */
export function countOpNodes(ops: NodeOp[]): number {
  let total = 0
  const walk = (list: NodeOp[]): void => {
    for (const op of list) {
      total++
      if (op.children?.length) walk(op.children)
    }
  }
  walk(ops)
  return total
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function walkTree(tree: CreatedNode, visit: (item: CreatedNode) => void): void {
  visit(tree)
  for (const child of tree.children) walkTree(child, visit)
}

/** 可作为创建目标父级的节点类型 */
type AppendableNode = PageNode | FrameNode | ComponentNode | SectionNode | GroupNode

function canAppend(node: unknown): node is AppendableNode {
  return !!node && typeof (node as { appendChild?: unknown }).appendChild === 'function'
}

function isPageNode(node: AppendableNode): node is PageNode {
  return node.type === 'PAGE'
}

function isContainerNode(node: SceneNode): node is FrameNode | ComponentNode | SectionNode {
  return node.type === 'FRAME' || node.type === 'COMPONENT' || node.type === 'SECTION'
}

/** 父级是否为 Auto Layout 容器（子级位置与 x/y 均由布局接管） */
function hasAutoLayout(node: AppendableNode): boolean {
  return !isPageNode(node) && 'layoutMode' in node && node.layoutMode !== 'NONE'
}

/** 指令是否声明了 Auto Layout（用于挂载子节点前判断，此时布局尚未应用） */
function willUseAutoLayout(op: NodeOp): boolean {
  return op.type === 'frame' && !!op.layout && op.layout.mode !== 'none'
}

/** 未显式指定 parent 时的默认目标 */
interface FallbackTarget {
  parent: AppendableNode
  containerName?: string
}

/**
 * 默认目标推断（从高到低）：
 * 1. 选中单个 Frame/Component/Section → 该容器
 * 2. 选中普通图层 → 该图层的父级容器
 * 3. 无选中 → 当前页
 */
function resolveFallbackTarget(): FallbackTarget {
  const page = figma.currentPage
  const selection = [...page.selection]

  if (selection.length === 1) {
    const node = selection[0]
    if (isContainerNode(node) && canAppend(node)) {
      return { parent: node, containerName: node.name }
    }
  }

  if (selection.length > 0) {
    const anchor = selection[selection.length - 1]
    const parent = (anchor as { parent?: unknown }).parent
    if (canAppend(parent)) {
      return {
        parent,
        containerName: isPageNode(parent) ? undefined : parent.name,
      }
    }
  }

  return { parent: page }
}

/** 解析单个顶层节点的父级：显式 parent 优先，非法时抛错由调用方记录 */
async function resolveOpParent(op: NodeOp, fallback: FallbackTarget): Promise<AppendableNode> {
  if (op.parent === 'page') return figma.currentPage
  if (!op.parent) return fallback.parent

  const node = await figma.getNodeByIdAsync(op.parent)
  if (!node) {
    throw new Error(`父级节点不存在：${op.parent}（请使用画布上下文中的原生 id，或省略 parent 让插件推断）`)
  }
  if (node.type === 'INSTANCE') {
    throw new Error(`实例节点不能作为创建父级：${op.parent}`)
  }
  if (!canAppend(node)) {
    throw new Error(`父级节点不可容纳子节点：${op.parent}（${node.type}）`)
  }
  return node
}

/** 容器内自动插入点：空容器居中，已有内容接在内容底部 */
function containerInsertPoint(
  container: Exclude<AppendableNode, PageNode>,
  nodeWidth: number,
  nodeHeight: number,
): { x: number; y: number } {
  const children = 'children' in container ? container.children : []
  if (children.length === 0) {
    return {
      x: Math.max(0, Math.round((container.width - nodeWidth) / 2)),
      y: Math.max(0, Math.round((container.height - nodeHeight) / 2)),
    }
  }
  let bottom = 0
  for (const child of children) {
    if ('y' in child && 'height' in child) {
      bottom = Math.max(bottom, child.y + child.height)
    }
  }
  return { x: 0, y: Math.round(bottom + CONTAINER_GAP) }
}

/**
 * 页面级自动插入点：放在现有内容右侧，垂直居中于视口。
 * 排除尚未挂载的本批新建节点（创建 API 会先落到当前页），避免把自己算进内容边界。
 */
function computePageInsertPoint(trees: CreatedNode[]): { x: number; y: number } {
  const page = figma.currentPage
  const pending = new Set<string>()
  for (const tree of trees) walkTree(tree, ({ node }) => pending.add(node.id))

  const existing = page.children.filter((child) => !pending.has(child.id) && 'x' in child && 'width' in child)
  const center = figma.viewport.center
  const maxHeight = Math.max(0, ...trees.map((tree) => tree.node.height))

  if (existing.length === 0) {
    const maxWidth = Math.max(0, ...trees.map((tree) => tree.node.width))
    return {
      x: Math.round(center.x - maxWidth / 2),
      y: Math.round(center.y - maxHeight / 2),
    }
  }

  const right = Math.max(...existing.map((child) => child.x + child.width))
  return { x: Math.round(right + VIEWPORT_MARGIN), y: Math.round(center.y - maxHeight / 2) }
}

/**
 * 挂载子树：根节点挂到 parent，子级依次挂入 frame。
 * - position 有值时在 append 之后写入 x/y（append 会重算坐标，必须先挂后定位）
 * - 声明了 Auto Layout 的 frame 只 append 子节点，位置交给布局
 * - 未声明布局的 frame 使用子节点 x/y（相对 frame）
 */
function mountTree(tree: CreatedNode, parent: AppendableNode, position?: { x: number; y: number }): void {
  parent.appendChild(tree.node)
  if (position) {
    tree.node.x = Math.round(position.x)
    tree.node.y = Math.round(position.y)
  }

  if (tree.node.type !== 'FRAME') return
  const frame = tree.node
  const useLayout = willUseAutoLayout(tree.op)

  for (const child of tree.children) {
    if (useLayout) {
      mountTree(child, frame)
    } else {
      mountTree(child, frame, { x: child.op.x ?? 0, y: child.op.y ?? 0 })
    }
  }
}

/**
 * 解析插入锚点：insertAfter 可以是画布原生 id，也可以是同批次中更早创建的 op id。
 * 锚点必须是目标父级的直接子节点，否则返回 null（调用方回退为追加）。
 */
async function resolveInsertAnchor(
  anchorId: string,
  parent: AppendableNode,
  idMap: Record<string, string>,
): Promise<SceneNode | null> {
  const nativeId = idMap[anchorId] ?? anchorId
  const node = await figma.getNodeByIdAsync(nativeId)
  if (!node) return null
  const parentId = (node as { parent?: { id?: string } | null }).parent?.id
  if (parentId !== parent.id) return null
  return node as SceneNode
}

/**
 * 把节点移动到锚点之前/之后。
 * 同批次多个节点共用同一锚点时，用游标记录链尾，保证按数组顺序排列。
 */
function insertRelativeToAnchor(
  parent: AppendableNode,
  node: SceneNode,
  anchor: SceneNode,
  before: boolean,
  cursorKey: string,
  cursors: Map<string, SceneNode>,
): boolean {
  if (!('children' in parent) || !('insertChild' in parent)) return false
  if (anchor.id === node.id) return false
  const hasCursor = cursors.has(cursorKey)
  const previous = cursors.get(cursorKey) ?? anchor
  const index = parent.children.indexOf(previous)
  if (index < 0) return false
  // before：首个插在锚点位置；同锚点连续插入时排在上一节点之后，保持数组顺序
  const targetIndex = before && !hasCursor ? index : index + 1
  parent.insertChild(targetIndex, node)
  cursors.set(cursorKey, node)
  return true
}

/** update 扩展：把已有节点移动到新父级（同父级时保持不变） */
async function moveNodeToParent(node: SceneNode, parentRef: string): Promise<AppendableNode> {
  const parent =
    parentRef === 'page' ? figma.currentPage : await figma.getNodeByIdAsync(parentRef)
  if (!parent) throw new Error(`父级节点不存在：${parentRef}`)
  if (parent.type === 'INSTANCE') throw new Error(`实例节点不能作为父级：${parentRef}`)
  if (!canAppend(parent)) throw new Error(`父级节点不可容纳子节点：${parentRef}（${parent.type}）`)

  // 防止把节点移动到自身或自己的子级里（形成环）
  let cursor: BaseNode | null = parent
  while (cursor) {
    if (cursor.id === node.id) throw new Error('不能把节点移动到自身或其子级中')
    cursor = cursor.parent as BaseNode | null
  }

  if (node.parent?.id !== parent.id) parent.appendChild(node)
  return parent
}

/** 批量执行创建指令 */
export async function executeCreateOps(payload: OpsPayload): Promise<CreateOpsResult> {
  const errors: string[] = []
  let created = 0
  let skipped = 0
  const roots = payload?.ops ?? []
  if (!roots.length) return { created, skipped, errors }

  const total = countOpNodes(roots)
  if (total > MAX_RENDER_NODES) {
    errors.push(`节点总数 ${total} 超过单次渲染上限 ${MAX_RENDER_NODES}，本次已全部执行，建议确认后分批渲染`)
  }

  // 预加载全部文本字体，避免逐节点等待
  await ensureFontsLoaded(roots)

  // 阶段一：递归创建所有节点（暂不建立层级、不设样式）；非法节点跳过
  const trees: CreatedNode[] = []
  for (const op of roots) {
    try {
      trees.push(buildTree(op))
    } catch (e) {
      skipped++
      errors.push(`创建节点「${op.name || op.type || 'unknown'}」失败：${errorMessage(e)}`)
    }
  }
  if (!trees.length) return { created, skipped, errors }

  const fallback = resolveFallbackTarget()
  const pageInsert = computePageInsertPoint(trees)

  // 阶段二：逐个解析父级并挂载（每个顶层节点独立解析，支持分散到多个容器）
  let pageCursorY = pageInsert.y
  const createdNodes: SceneNode[] = []
  /** 成功挂载的根节点树：失败/已移除的树不能进入后续阶段（访问已移除节点的 parent 会抛 get_parent） */
  const mountedTrees: CreatedNode[] = []
  const placements: CreatePlacement[] = []
  const idMap: Record<string, string> = {}
  /** insertAfter 链尾游标：同一锚点的连续插入依次排在后面 */
  const insertCursors = new Map<string, SceneNode>()
  const parentRefs = new Set<string>()
  let resolvedParentName: string | undefined
  let mixedParents = false

  for (const tree of trees) {
    const label = tree.op.name || tree.op.type
    let parent: AppendableNode
    try {
      parent = await resolveOpParent(tree.op, fallback)
    } catch (e) {
      skipped++
      errors.push(`解析「${label}」的父级失败：${errorMessage(e)}`)
      try {
        tree.node.remove()
      } catch {
        // 清理失败忽略
      }
      continue
    }

    try {
      const autoLayout = hasAutoLayout(parent)
      const explicit = tree.op.position === 'absolute'
      let position: { x: number; y: number } | undefined

      if (explicit) {
        // 严格使用指令坐标：父级为页面时即页面坐标，否则为父级相对坐标
        position = { x: tree.op.x ?? 0, y: tree.op.y ?? 0 }
      } else if (autoLayout) {
        // 位置由布局接管，append 顺序即顺序
        position = undefined
      } else if (isPageNode(parent)) {
        position = { x: pageInsert.x, y: pageCursorY }
        pageCursorY += tree.node.height + TOP_LEVEL_GAP
      } else {
        position = containerInsertPoint(parent, tree.node.width, tree.node.height)
      }

      mountTree(tree, parent, position)

      // 指定了 insertAfter / insertBefore：把节点移动到锚点前后（Auto Layout 容器内即插到中间）
      const anchorId = tree.op.insertAfter ?? tree.op.insertBefore
      if (anchorId && !isPageNode(parent)) {
        const before = !tree.op.insertAfter
        const anchor = await resolveInsertAnchor(anchorId, parent, idMap)
        const inserted =
          !!anchor &&
          insertRelativeToAnchor(
            parent,
            tree.node,
            anchor,
            before,
            `${before ? 'before' : 'after'}:${anchorId}`,
            insertCursors,
          )
        if (!inserted) {
          errors.push(
            `「${label}」的插入锚点无效：${anchorId}（需为同一父级下的节点 id），已追加到末尾`,
          )
        }
      }

      // 记录落位与 id 映射
      walkTree(tree, ({ op, node }) => {
        if (op.id) idMap[op.id] = node.id
      })
      createdNodes.push(tree.node)
      created++
      parentRefs.add(isPageNode(parent) ? 'page' : parent.id)
      if (isPageNode(parent)) {
        mixedParents = mixedParents || resolvedParentName !== undefined
        resolvedParentName = undefined
      } else {
        mixedParents = mixedParents || (resolvedParentName !== undefined && resolvedParentName !== parent.name)
        resolvedParentName = parent.name
      }
      placements.push({
        opId: tree.op.id,
        nodeId: tree.node.id,
        parentId: isPageNode(parent) ? 'page' : parent.id,
        parentName: isPageNode(parent) ? undefined : parent.name,
        x: tree.node.x,
        y: tree.node.y,
        autoLayout,
      })
      mountedTrees.push(tree)
    } catch (e) {
      skipped++
      errors.push(`挂载节点「${label}」失败：${errorMessage(e)}`)
      try {
        tree.node.remove()
      } catch {
        // 清理失败忽略
      }
    }
  }

  // 阶段三：先父后子设置 Auto Layout，并按指令尺寸兜底 resize
  for (const tree of mountedTrees) {
    walkTree(tree, ({ op, node }) => {
      if (node.type === 'FRAME' && op.layout && op.layout.mode !== 'none') {
        try {
          applyLayout(node, op.layout)
          const width = op.width ?? 0
          const height = op.height ?? 0
          // hug 轴由内容决定尺寸，不能再用指令尺寸 resize（否则会把 AUTO 改回 FIXED）
          const sizing = op.layout.sizing
          const hug = sizing?.horizontal === 'hug' || sizing?.vertical === 'hug'
          if (!hug && width > 0 && height > 0) {
            node.resize(Math.max(width, MIN_SIZE), Math.max(height, MIN_SIZE))
          }
        } catch (e) {
          errors.push(`设置布局「${op.name || op.type}」失败：${errorMessage(e)}`)
        }
      }
    })
  }

  // 阶段三点五：子级 Fill container / Hug contents（必须在挂载且父级布局就绪后设置）
  for (const tree of mountedTrees) {
    walkTree(tree, ({ op, node }) => {
      if (!op.layoutSizing) return
      try {
        applyChildSizing(node, op)
      } catch (e) {
        errors.push(
          `设置「${op.name || op.type}」的填充/自适应失败：${errorMessage(e)}（填充容器需要父级开启 Auto Layout）`,
        )
      }
    })
  }

  // 阶段四：统一样式
  for (const tree of mountedTrees) {
    walkTree(tree, ({ op, node }) => {
      try {
        applyStyles(node, op)
      } catch (e) {
        errors.push(`设置样式「${op.name || op.type}」失败：${errorMessage(e)}`)
      }
    })
  }

  if (created > 0) {
    try {
      figma.commitUndo()
    } catch {
      // 撤销记录失败不影响渲染结果
    }
    // 生成后自动选中新建节点：便于设计师继续操作，也让校验步骤能读回结果
    try {
      figma.currentPage.selection = createdNodes
    } catch {
      // 选中失败不影响生成
    }
  }

  const sameContainer = !mixedParents && parentRefs.size <= 1
  return {
    created,
    skipped,
    errors,
    containerName: sameContainer ? resolvedParentName : undefined,
    ids: createdNodes.map((node) => node.id),
    idMap,
    placements,
  }
}

/** 批量执行更新指令 */
export async function executeUpdateOps(payload: OpsPayload): Promise<UpdateOpsResult> {
  const errors: string[] = []
  let updated = 0
  let skipped = 0
  const ops = payload?.ops ?? []
  if (!ops.length) return { updated, skipped, errors }

  // 并行预取节点：写操作仍需顺序执行，但查 id 不必逐条串行
  const lookups = await Promise.all(
    ops.map((op) =>
      op && op.action === 'update' && typeof op.id === 'string' && op.id
        ? figma.getNodeByIdAsync(op.id)
        : Promise.resolve(null),
    ),
  )

  /** insertAfter 链尾游标：同一锚点的连续移动依次排在后面 */
  const updateCursors = new Map<string, SceneNode>()

  for (let index = 0; index < ops.length; index++) {
    const op = ops[index]
    if (!op || op.action !== 'update') {
      skipped++
      errors.push(`已跳过非 update 操作（id: ${op?.id ?? 'unknown'}）`)
      continue
    }
    const result = await updateNodeFromOp(op, lookups[index])
    if (!result.ok) {
      skipped++
      errors.push(result.error ?? `更新失败（id: ${op.id}）`)
      continue
    }
    updated++

    const node = lookups[index] as SceneNode | null
    if (!node) continue

    // 跨容器移动：appendChild 会重算坐标，非 Auto Layout 父级下按显式 x/y 重新定位
    if (op.parent) {
      try {
        const parent = await moveNodeToParent(node, op.parent)
        if (!hasAutoLayout(parent) && op.x != null && op.y != null) {
          node.x = op.x
          node.y = op.y
        }
      } catch (e) {
        errors.push(`移动「${op.name || op.id}」到新父级失败：${errorMessage(e)}`)
      }
    }

    // 调整子节点顺序：Auto Layout 容器内 y 无效，只能通过移动到锚点前后实现
    const anchorId = op.insertAfter ?? op.insertBefore
    if (anchorId) {
      const before = !op.insertAfter
      const parent = node.parent
      if (!parent || !canAppend(parent)) {
        errors.push(`移动「${op.name || op.id}」失败：父级不支持调整子节点顺序`)
        continue
      }
      const anchor = await resolveInsertAnchor(anchorId, parent, {})
      const moved =
        !!anchor &&
        insertRelativeToAnchor(
          parent,
          node,
          anchor,
          before,
          `${before ? 'before' : 'after'}:${anchorId}`,
          updateCursors,
        )
      if (!moved) {
        errors.push(`移动「${op.name || op.id}」失败：插入锚点无效 ${anchorId}`)
      }
    }
  }

  if (updated > 0) {
    try {
      figma.commitUndo()
    } catch {
      // 撤销记录失败不影响更新结果
    }
  }
  return { updated, skipped, errors }
}
