/**
 * 沙箱能力调用（cap:invoke）
 * - invokeCapability：Promise 化调用单个 Figma 读写能力，超时 reject
 * - READ_CAPABILITIES / WRITE_CAPABILITIES：能力名清单，供 figma_call 工具描述复用
 */
import { bridge } from './bridge.service'

/** 读能力（34 个）：获取文档/选区/节点/样式/变量/组件/截图/插件数据等 */
export const READ_CAPABILITIES: string[] = [
  'get_document',
  'get_selection',
  'get_node',
  'get_nodes_info',
  'get_design_context',
  'get_metadata',
  'get_pages',
  'get_viewport',
  'get_fonts',
  'search_nodes',
  'get_reactions',
  'scan_text_nodes',
  'scan_nodes_by_types',
  'get_styles',
  'get_variable_defs',
  'get_local_components',
  'get_annotations',
  'export_tokens',
  'get_screenshot',
  'export_frames_to_pdf',
  // 官方 API 补齐
  'get_plugin_data',
  'get_main_component',
  'get_component_properties',
  'get_export_settings',
  // 文本区间 / 图片字节 / CSS / 字体列表
  'get_text_range',
  'get_image',
  'get_css',
  'list_available_fonts',
  // 页面 / 变量库 / 选区配色 / 批注分类 / 当前用户
  'get_page',
  'get_local_variables',
  'get_library_variables',
  'get_selection_colors',
  'get_annotation_categories',
  'get_current_user',
]

/** 写能力（106 个）：创建/修改图层、样式、变量、组件、原型、页面、布尔运算、对齐、遮罩、SVG 等 */
export const WRITE_CAPABILITIES: string[] = [
  'create_frame',
  'create_rectangle',
  'create_ellipse',
  'create_text',
  'import_image',
  'create_component',
  'create_section',
  'set_text',
  'set_fills',
  'set_strokes',
  'move_nodes',
  'resize_nodes',
  'rename_node',
  'clone_node',
  'set_opacity',
  'set_corner_radius',
  'set_auto_layout',
  'set_visible',
  'lock_nodes',
  'unlock_nodes',
  'rotate_nodes',
  'reorder_nodes',
  'set_blend_mode',
  'set_constraints',
  'reparent_nodes',
  'batch_rename_nodes',
  'find_replace_text',
  'create_paint_style',
  'create_text_style',
  'create_effect_style',
  'create_grid_style',
  'update_paint_style',
  'delete_style',
  'apply_style_to_node',
  'set_effects',
  'bind_variable_to_node',
  'create_variable_collection',
  'add_variable_mode',
  'create_variable',
  'set_variable_value',
  'delete_variable',
  'swap_component',
  'detach_instance',
  'delete_nodes',
  'navigate_to_page',
  'group_nodes',
  'ungroup_nodes',
  'set_reactions',
  'remove_reactions',
  'add_page',
  'delete_page',
  'rename_page',
  // 官方 API 补齐：文本排版 / 细节属性 / 网格
  'set_font',
  'set_corner_radii',
  'set_stroke_properties',
  'set_layout_grids',
  // 选择 / 视口 / 导出
  'select_nodes',
  'zoom_to_node',
  'export_node',
  // 布尔运算 / 扁平化 / 转轮廓
  'boolean_operation',
  'flatten_nodes',
  'outline_stroke',
  // 实例 / 变体
  'create_instance',
  'reset_instance_overrides',
  'set_instance_properties',
  'combine_as_variants',
  // 页面与原型
  'duplicate_page',
  'reorder_pages',
  'set_flow_starting_point',
  'set_overflow',
  // 样式与变量更新
  'update_text_style',
  'update_effect_style',
  'update_grid_style',
  'rename_variable',
  'delete_variable_collection',
  // 插件数据 / 新形状 / 对齐
  'set_node_plugin_data',
  'create_star',
  'create_polygon',
  'align_nodes',
  // 遮罩 / SVG
  'set_mask',
  'import_svg',
  // 文本区间 / 组件属性 / 图片 / 导出 / 变量模式
  'set_text_range',
  'add_component_property',
  'edit_component_property',
  'delete_component_property',
  'set_component_property_references',
  'create_image_from_url',
  'set_export_settings',
  'set_variable_mode_on_node',
  // 变量集合 / 模式 / 变量更新 / 库资源导入 / 样式排序
  'rename_variable_collection',
  'rename_variable_mode',
  'delete_variable_mode',
  'update_variable',
  'import_variable_by_key',
  'import_style_by_key',
  'reorder_styles',
  // 批注 / 页面背景 / 文件封面与版本
  'set_annotations',
  'add_annotation_category',
  'update_annotation_category',
  'delete_annotation_category',
  'set_page_backgrounds',
  'set_file_thumbnail',
  'save_file_version',
  // 线条 / 自定义矢量 / 切图
  'create_line',
  'create_vector',
  'create_slice',
]

/**
 * 破坏性能力：会删除图层/页面/样式/变量，或让组件实例失去可编辑结构。
 * figma_call 执行前必须由用户确认，避免模型误判直接销毁用户资产。
 */
export const DESTRUCTIVE_CAPABILITIES = new Set([
  'delete_nodes',
  'delete_page',
  'delete_style',
  'delete_variable',
  'delete_variable_collection',
  'detach_instance',
  'reset_instance_overrides',
])

/** 是否为破坏性能力（未知的 delete_* 同样按破坏性处理） */
export function isDestructiveCapability(type: string): boolean {
  return DESTRUCTIVE_CAPABILITIES.has(type) || type.startsWith('delete_')
}

export interface CapabilityOptions {
  /** 目标图层原生 ID（针对具体图层的能力使用） */
  nodeIds?: string[]
  /** 能力具体参数（如 search_nodes 的 query/types/limit） */
  params?: Record<string, unknown>
}

/**
 * 调用沙箱能力：走 cap:invoke，成功时 resolve 该能力的 data 部分；
 * 失败时 bridge 以 Error reject。默认超时 60s（部分导出/截图能力耗时较长）。
 */
export function invokeCapability<T = unknown>(
  type: string,
  options: CapabilityOptions = {},
  timeout = 60000,
): Promise<T> {
  return bridge.request<T>('cap:invoke', { type, ...options }, timeout)
}
