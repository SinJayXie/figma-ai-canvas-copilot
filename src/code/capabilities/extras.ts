/**
 * 官方 Plugin API 能力补齐（对照 @figma/plugin-typings 清点后新增）
 * 读：get_plugin_data / get_main_component / get_component_properties / get_export_settings
 * 写：文本排版(set_font)、圆角/描边细节、网格、选择与视口、导出、布尔运算、扁平化/转轮廓、
 *     实例与变体、页面复制/排序/流程起点、样式更新、变量重命名/删除集合、插件数据、星形/多边形、对齐分布
 * 约定与其他能力一致：返回 { type, requestId, data }，未知类型返回 null 以便链式分发
 */

import { resolveFamily, resolveFont, resolveFontLike } from "../renderer/fonts";
import { makeSolidPaint, normalizePaints } from "./write-helpers";

const ok = (request: any, data: any) => ({
  type: request.type,
  requestId: request.requestId,
  data,
});

const getNodeById = async (id?: string) => {
  if (!id) throw new Error("nodeId is required");
  const node = await figma.getNodeByIdAsync(id);
  if (!node) throw new Error(`Node not found: ${id}`);
  return node;
};

const getNodesByIds = async (ids: string[]) => {
  if (!ids || ids.length === 0) throw new Error("nodeIds is required");
  return Promise.all(ids.map((id) => getNodeById(id)));
};

const upper = (value: any, allowed: string[], field: string): string => {
  const v = String(value ?? "").toUpperCase();
  if (!allowed.includes(v)) {
    throw new Error(`${field} 仅支持 ${allowed.join(" / ")}`);
  }
  return v;
};

/** Figma 批注颜色枚举（小写） */
const ANNOTATION_COLORS = ["yellow", "orange", "red", "pink", "violet", "blue", "teal", "green"];

/** 归一化批注颜色：统一小写并校验枚举 */
const normalizeAnnotationColor = (value: any) => {
  const color = String(value ?? "").toLowerCase();
  if (!ANNOTATION_COLORS.includes(color)) {
    throw new Error(`color 仅支持 ${ANNOTATION_COLORS.join(" / ")}`);
  }
  return color as AnnotationCategoryColor;
};

const isContainer = (node: any): boolean =>
  node && (node.type === "PAGE" || node.type === "FRAME" || node.type === "COMPONENT" || node.type === "SECTION" || node.type === "GROUP");

/** 解析目标父级：显式 parentId → 选中容器 → 当前页 */
const resolveParent = async (parentId?: string) => {
  if (parentId === "page") return figma.currentPage as any;
  if (parentId) {
    const parent = await getNodeById(parentId);
    if (parent.type === "INSTANCE") throw new Error(`实例节点不能作为父级：${parentId}`);
    if (!("appendChild" in parent)) throw new Error(`Node ${parentId} cannot have children`);
    return parent as any;
  }
  const selection = figma.currentPage.selection;
  if (selection.length === 1) {
    const node = selection[0];
    if (isContainer(node)) return node as any;
    const parent = (node as any).parent;
    if (parent && "appendChild" in parent) return parent;
  }
  if (selection.length > 1) {
    const parent = (selection[selection.length - 1] as any).parent;
    if (parent && "appendChild" in parent) return parent;
  }
  return figma.currentPage as any;
};

/** 统一父级：优先第一个节点的父级，否则当前页 */
const commonParent = (nodes: readonly BaseNode[]) => {
  const parent = (nodes[0] as any)?.parent;
  if (parent && "appendChild" in parent) return parent as any;
  return figma.currentPage as any;
};

const applySizeAndPosition = (node: any, p: any) => {
  if (p.width != null && p.height != null && "resize" in node) {
    node.resize(Math.max(Number(p.width), 0.01), Math.max(Number(p.height), 0.01));
  }
  // Auto Layout 父级下坐标由布局决定，写 x/y 只会误导调用方
  const parent = (node as any).parent;
  const autoLayout =
    !!parent && parent.type !== "PAGE" && "layoutMode" in parent && parent.layoutMode !== "NONE";
  if (!autoLayout) {
    if (p.x != null && "x" in node) node.x = Number(p.x);
    if (p.y != null && "y" in node) node.y = Number(p.y);
  }
  if (p.name) node.name = String(p.name);
  if (p.fill && "fills" in node) node.fills = [makeSolidPaint(p.fill)];
};

const normalizeLayoutGrids = (input: any) => {
  if (!Array.isArray(input)) throw new Error("layoutGrids 必须是数组");
  return input.map((g: any, index: number) => {
    const pattern = upper(g?.pattern ?? "COLUMNS", ["COLUMNS", "ROWS", "GRID"], `layoutGrids[${index}].pattern`);
    const grid: any = { ...g, pattern, visible: g?.visible !== false };
    if (pattern !== "GRID") {
      grid.alignment = upper(g?.alignment ?? "MIN", ["MIN", "MAX", "CENTER", "STRETCH"], `layoutGrids[${index}].alignment`);
      grid.gutterSize = Number(g?.gutterSize ?? 0);
      grid.count = Number(g?.count ?? 1);
      grid.offset = Number(g?.offset ?? 0);
      grid.sectionSize = Number(g?.sectionSize ?? 0);
    } else {
      grid.gutterSize = Number(g?.gutterSize ?? 0);
      grid.numSections = Number(g?.numSections ?? g?.count ?? 1);
      grid.sectionSize = Number(g?.sectionSize ?? 0);
    }
    return grid;
  });
};

/* ============================ 读能力 ============================ */
export const handleReadExtrasRequest = async (request: any) => {
  switch (request.type) {
    case "get_plugin_data": {
      const node = await getNodeById(request.nodeIds?.[0]);
      const key = request.params?.key;
      if (key != null) return ok(request, { key, value: node.getPluginData(String(key)) });
      const keys = node.getPluginDataKeys();
      return ok(request, { keys, entries: Object.fromEntries(keys.map((k) => [k, node.getPluginData(k)])) });
    }

    case "get_main_component": {
      const node = await getNodeById(request.nodeIds?.[0]);
      if (node.type !== "INSTANCE") throw new Error(`Node ${node.id} 不是实例节点`);
      const main = await node.getMainComponentAsync();
      return ok(request, main ? { id: main.id, name: main.name, key: main.key } : null);
    }

    case "get_component_properties": {
      const node = await getNodeById(request.nodeIds?.[0]);
      const defs = (node as any).componentPropertyDefinitions;
      if (!defs) throw new Error(`Node ${node.id} 没有组件属性定义（需为 COMPONENT 或 COMPONENT_SET）`);
      // 变体属性只在变体组件（COMPONENT_SET / 变体 COMPONENT）上存在，缺失时为 null
      const variantProperties = (node as any).variantProperties ?? null;
      return ok(request, { properties: defs, variantProperties });
    }

    case "get_export_settings": {
      const node = await getNodeById(request.nodeIds?.[0]);
      return ok(request, { exportSettings: (node as any).exportSettings ?? [] });
    }

    case "get_annotation_categories": {
      const raw = await figma.annotations.getAnnotationCategoriesAsync();
      const categories = raw.map((category) => ({
        id: category.id,
        label: category.label,
        color: category.color,
        isPreset: category.isPreset,
      }));
      return ok(request, { count: categories.length, categories });
    }

    case "get_current_user": {
      // Figma Plugin API 不提供文件权限 / 协作者角色查询，只能返回当前身份与在线用户
      const user = figma.currentUser;
      const activeUsers = figma.activeUsers ?? [];
      return ok(request, {
        user: user
          ? { id: user.id, name: user.name, photoUrl: user.photoUrl, color: user.color }
          : null,
        fileKey: figma.fileKey ?? null,
        fileName: figma.root.name,
        editorType: figma.editorType,
        activeUserCount: activeUsers.length,
        activeUsers: activeUsers.slice(0, 20).map((item) => ({ id: item.id, name: item.name })),
        canReadPermissions: false,
      });
    }

    case "get_css": {
      const ids: string[] = request.nodeIds || [];
      if (ids.length === 0) throw new Error("nodeIds is required");
      const styles: Array<{ nodeId: string; name: string; css: any }> = [];
      for (const id of ids) {
        const node = (await getNodeById(id)) as any;
        if (typeof node.getCSSAsync !== "function") continue;
        styles.push({ nodeId: node.id, name: node.name, css: await node.getCSSAsync() });
      }
      if (styles.length === 0) throw new Error("这些节点不支持 get_css");
      return ok(request, { styles });
    }

    default:
      return null;
  }
};

/* ============================ 写能力 ============================ */
export const handleWriteExtrasRequest = async (request: any) => {
  const p = request.params || {};
  const nodeIds: string[] = request.nodeIds || [];

  switch (request.type) {
    /* ---------- 文本排版 ---------- */
    case "set_font": {
      const node = await getNodeById(nodeIds[0]);
      if (node.type !== "TEXT") throw new Error(`Node ${node.id} 不是文本节点`);
      const current = typeof node.fontName === "object" ? node.fontName : null;
      const family = resolveFamily(p.family ?? current?.family);
      let font: { family: string; style: string } | null = null;
      if (p.style) {
        try {
          await figma.loadFontAsync({ family, style: String(p.style) });
          font = { family, style: String(p.style) };
        } catch {
          font = await resolveFontLike(family, String(p.style));
        }
      } else {
        font = await resolveFont(family, p.weight ?? p.fontWeight);
      }
      if (font) node.fontName = font;
      if (p.fontSize != null) node.fontSize = Number(p.fontSize);
      if (p.lineHeight != null) {
        node.lineHeight =
          String(p.lineHeight).toUpperCase() === "AUTO"
            ? { unit: "AUTO" }
            : { value: Number(p.lineHeight), unit: "PIXELS" };
      }
      if (p.letterSpacing != null) {
        node.letterSpacing =
          typeof p.letterSpacing === "number"
            ? { value: p.letterSpacing, unit: "PIXELS" }
            : {
                value: Number(p.letterSpacing.value ?? 0),
                unit: String(p.letterSpacing.unit ?? "PIXELS").toUpperCase() === "PERCENT" ? "PERCENT" : "PIXELS",
              };
      }
      if (p.textAlignHorizontal) {
        node.textAlignHorizontal = upper(p.textAlignHorizontal, ["LEFT", "CENTER", "RIGHT", "JUSTIFIED"], "textAlignHorizontal") as any;
      }
      if (p.textAlignVertical) {
        node.textAlignVertical = upper(p.textAlignVertical, ["TOP", "CENTER", "BOTTOM"], "textAlignVertical") as any;
      }
      if (p.textCase) {
        node.textCase = upper(p.textCase, ["ORIGINAL", "UPPER", "LOWER", "TITLE", "SMALL_CAPS", "SMALL_CAPS_FORCED"], "textCase") as any;
      }
      if (p.textDecoration) {
        node.textDecoration = upper(p.textDecoration, ["NONE", "UNDERLINE", "STRIKETHROUGH"], "textDecoration") as any;
      }
      if (p.paragraphSpacing != null) node.paragraphSpacing = Number(p.paragraphSpacing);
      if (p.textAutoResize) {
        node.textAutoResize = upper(p.textAutoResize, ["NONE", "WIDTH_AND_HEIGHT", "HEIGHT", "TRUNCATE"], "textAutoResize") as any;
      }
      figma.commitUndo();
      return ok(request, { id: node.id, name: node.name, fontName: node.fontName, fontSize: node.fontSize });
    }

    /* ---------- 圆角 / 描边细节 ---------- */
    case "set_corner_radii": {
      const node = await getNodeById(nodeIds[0]) as any;
      if (!("topLeftRadius" in node)) throw new Error(`Node ${node.id} 不支持圆角`);
      const uniform = p.radius;
      const map: Array<[string, any]> = [
        ["topLeftRadius", p.topLeft ?? uniform],
        ["topRightRadius", p.topRight ?? uniform],
        ["bottomRightRadius", p.bottomRight ?? uniform],
        ["bottomLeftRadius", p.bottomLeft ?? uniform],
      ];
      for (const [field, value] of map) {
        if (value != null) node[field] = Number(value);
      }
      if (p.smoothing != null && "cornerSmoothing" in node) node.cornerSmoothing = Number(p.smoothing);
      figma.commitUndo();
      return ok(request, {
        id: node.id,
        radii: {
          topLeft: node.topLeftRadius,
          topRight: node.topRightRadius,
          bottomRight: node.bottomRightRadius,
          bottomLeft: node.bottomLeftRadius,
        },
      });
    }

    case "set_stroke_properties": {
      const node = await getNodeById(nodeIds[0]) as any;
      if (p.align != null && "strokeAlign" in node) {
        node.strokeAlign = upper(p.align, ["INSIDE", "OUTSIDE", "CENTER"], "align");
      }
      if (p.cap != null && "strokeCap" in node) {
        node.strokeCap = upper(p.cap, ["NONE", "ROUND", "SQUARE", "ARROW_LINES", "ARROW_EQUILATERAL"], "cap");
      }
      if (p.join != null && "strokeJoin" in node) {
        node.strokeJoin = upper(p.join, ["MITER", "BEVEL", "ROUND"], "join");
      }
      if (Array.isArray(p.dashPattern) && "dashPattern" in node) {
        node.dashPattern = p.dashPattern.map((v: any) => Number(v));
      }
      if (p.strokeWeight != null && "strokeWeight" in node) node.strokeWeight = Number(p.strokeWeight);
      figma.commitUndo();
      return ok(request, { id: node.id, name: node.name });
    }

    case "set_layout_grids": {
      const node = await getNodeById(nodeIds[0]) as any;
      if (!("layoutGrids" in node)) throw new Error(`Node ${node.id} 不支持布局网格`);
      node.layoutGrids = normalizeLayoutGrids(p.layoutGrids);
      figma.commitUndo();
      return ok(request, { id: node.id, count: node.layoutGrids.length });
    }

    /* ---------- 选择 / 视口 / 导出 ---------- */
    case "select_nodes": {
      const nodes = await getNodesByIds(nodeIds);
      figma.currentPage.selection = nodes as any;
      if (p.zoom !== false) figma.viewport.scrollAndZoomIntoView(nodes);
      return ok(request, { count: nodes.length, ids: nodes.map((n) => n.id) });
    }

    case "zoom_to_node": {
      const node = await getNodeById(nodeIds[0]);
      figma.viewport.scrollAndZoomIntoView([node]);
      return ok(request, { id: node.id, name: node.name });
    }

    case "export_node": {
      const node = await getNodeById(nodeIds[0]) as any;
      if (!("exportAsync" in node)) throw new Error(`Node ${node.id} 不支持导出`);
      const format = upper(p.format ?? "PNG", ["PNG", "JPG", "SVG", "PDF"], "format");
      if (format === "SVG") {
        const svg = await node.exportAsync({ format: "SVG_STRING" });
        return ok(request, { format, svg });
      }
      const settings: any = { format };
      if (format !== "PDF") settings.constraint = { type: "SCALE", value: Number(p.scale ?? 2) };
      const bytes: Uint8Array = await node.exportAsync(settings);
      return ok(request, {
        format,
        byteLength: bytes.length,
        base64: figma.base64Encode(bytes),
      });
    }

    case "set_export_settings": {
      const node = (await getNodeById(nodeIds[0])) as any;
      if (!Array.isArray(p.settings) || p.settings.length === 0) {
        throw new Error("settings 必须是非空数组");
      }
      if (!("exportSettings" in node)) throw new Error(`Node ${node.id} 不支持导出设置`);
      const settings = p.settings.map((item: any, index: number) => {
        if (!item || typeof item !== "object") throw new Error(`settings[${index}] 必须是对象`);
        // 其余字段（suffix / svgOutlineText / svgIdAttribute 等）原样透传
        const out: any = {
          ...item,
          format: upper(item.format, ["PNG", "JPG", "SVG", "PDF"], `settings[${index}].format`),
        };
        if (item.constraint != null) {
          const type = upper(
            item.constraint.type,
            ["SCALE", "WIDTH", "HEIGHT"],
            `settings[${index}].constraint.type`,
          );
          const value = Number(item.constraint.value);
          if (!Number.isFinite(value) || value <= 0) {
            throw new Error(`settings[${index}].constraint.value 必须是正数`);
          }
          out.constraint = { type, value };
        }
        if (item.suffix != null) out.suffix = String(item.suffix);
        return out;
      });
      node.exportSettings = settings;
      figma.commitUndo();
      return ok(request, { id: node.id, name: node.name, settings: node.exportSettings });
    }

    /* ---------- 布尔运算 / 扁平化 / 转轮廓 ---------- */
    case "boolean_operation": {
      const nodes = await getNodesByIds(nodeIds);
      if (nodes.length < 2) throw new Error("布尔运算至少需要 2 个节点");
      const operation = upper(p.operation ?? "UNION", ["UNION", "SUBTRACT", "INTERSECT", "EXCLUDE"], "operation");
      const fn = {
        UNION: figma.union,
        SUBTRACT: figma.subtract,
        INTERSECT: figma.intersect,
        EXCLUDE: figma.exclude,
      }[operation] as any;
      const parent = commonParent(nodes);
      const result = fn(nodes, parent);
      if (p.name) result.name = String(p.name);
      figma.commitUndo();
      return ok(request, { id: result.id, name: result.name, operation });
    }

    case "flatten_nodes": {
      const nodes = await getNodesByIds(nodeIds);
      const result = figma.flatten(nodes, commonParent(nodes));
      if (p.name) result.name = String(p.name);
      figma.commitUndo();
      return ok(request, { id: result.id, name: result.name, type: result.type });
    }

    case "outline_stroke": {
      const node = await getNodeById(nodeIds[0]) as any;
      if (typeof node.outlineStroke !== "function") throw new Error(`Node ${node.id} 不支持描边转轮廓`);
      const result = node.outlineStroke();
      figma.commitUndo();
      return ok(request, { id: result?.id, name: result?.name, type: result?.type });
    }

    /* ---------- 实例 / 变体 ---------- */
    case "create_instance": {
      const componentKey =
        typeof p.componentKey === "string" ? p.componentKey.trim() : "";
      let component: any;
      if (componentKey) {
        // 资源库组件：按 key 直接导入（需该库已启用且组件已发布）
        component = await figma.importComponentByKeyAsync(componentKey);
      } else {
        component = await getNodeById(p.componentId ?? nodeIds[0]);
      }
      if (!component || component.type !== "COMPONENT") {
        throw new Error(`目标不是组件（需 COMPONENT，可用 componentId 或 componentKey）`);
      }
      const instance = component.createInstance();
      const parent = await resolveParent(p.parentId);
      parent.appendChild(instance);
      applySizeAndPosition(instance, p);
      figma.commitUndo();
      return ok(request, {
        id: instance.id,
        name: instance.name,
        mainComponentId: component.id,
        mainComponentKey: componentKey || undefined,
      });
    }

    case "reset_instance_overrides": {
      const node = await getNodeById(nodeIds[0]);
      if (node.type !== "INSTANCE") throw new Error(`Node ${node.id} 不是实例节点`);
      node.resetOverrides();
      figma.commitUndo();
      return ok(request, { id: node.id, name: node.name });
    }

    case "set_instance_properties": {
      const node = await getNodeById(nodeIds[0]);
      if (node.type !== "INSTANCE") throw new Error(`Node ${node.id} 不是实例节点`);
      if (!p.properties || typeof p.properties !== "object") throw new Error("properties 必须是对象");
      node.setProperties(p.properties);
      figma.commitUndo();
      return ok(request, { id: node.id, name: node.name });
    }

    case "combine_as_variants": {
      const nodes = await getNodesByIds(nodeIds);
      if (!nodes.every((n) => n.type === "COMPONENT")) throw new Error("combine_as_variants 需要全部为 COMPONENT 节点");
      const result = figma.combineAsVariants(nodes as ComponentNode[], commonParent(nodes));
      if (p.name) result.name = String(p.name);
      figma.commitUndo();
      return ok(request, { id: result.id, name: result.name, type: result.type });
    }

    /* ---------- 页面 ---------- */
    case "duplicate_page": {
      const source = nodeIds[0] ? await getNodeById(nodeIds[0]) : figma.currentPage;
      if (source.type !== "PAGE") throw new Error(`Node ${source.id} 不是页面`);
      const copy = source.clone() as PageNode;
      try {
        figma.root.appendChild(copy);
      } catch {
        // clone 已自动插入时忽略
      }
      if (p.name) copy.name = String(p.name);
      figma.commitUndo();
      return ok(request, { id: copy.id, name: copy.name });
    }

    case "reorder_pages": {
      const page = nodeIds[0] ? await getNodeById(nodeIds[0]) : figma.currentPage;
      if (page.type !== "PAGE") throw new Error(`Node ${page.id} 不是页面`);
      const index = Number(p.index ?? 0);
      figma.root.insertChild(Math.max(0, Math.min(figma.root.children.length - 1, index)), page);
      figma.commitUndo();
      return ok(request, { id: page.id, name: page.name, index });
    }

    case "set_flow_starting_point": {
      const page = nodeIds[0] ? await getNodeById(nodeIds[0]) : figma.currentPage;
      const target = page.type === "PAGE" ? page : figma.currentPage;
      if (p.clear) {
        target.flowStartingPoints = [];
        return ok(request, { cleared: true });
      }
      const node = await getNodeById(p.nodeId ?? nodeIds[1]);
      const existing = target.flowStartingPoints.filter((f) => f.nodeId !== node.id);
      target.flowStartingPoints = [
        ...existing,
        { nodeId: node.id, name: String(p.name ?? node.name) },
      ];
      figma.commitUndo();
      return ok(request, { nodeId: node.id, name: String(p.name ?? node.name), count: target.flowStartingPoints.length });
    }

    case "set_overflow": {
      const node = await getNodeById(nodeIds[0]) as any;
      if (!("overflowDirection" in node)) throw new Error(`Node ${node.id} 不支持溢出滚动（需 FRAME）`);
      node.overflowDirection = upper(p.direction ?? "NONE", ["NONE", "HORIZONTAL", "VERTICAL", "BOTH"], "direction");
      figma.commitUndo();
      return ok(request, { id: node.id, overflowDirection: node.overflowDirection });
    }

    /* ---------- 样式更新 ---------- */
    case "update_text_style": {
      const style = (await figma.getStyleByIdAsync(String(p.styleId ?? ""))) as TextStyle | null;
      if (!style || style.type !== "TEXT") throw new Error(`文字样式不存在：${p.styleId}`);
      if (p.name) style.name = String(p.name);
      if (p.description != null) style.description = String(p.description);
      if (p.fontName?.family) {
        await figma.loadFontAsync(p.fontName);
        style.fontName = p.fontName;
      }
      if (p.fontSize != null) style.fontSize = Number(p.fontSize);
      if (p.lineHeight != null) {
        style.lineHeight =
          String(p.lineHeight).toUpperCase() === "AUTO"
            ? { unit: "AUTO" }
            : { value: Number(p.lineHeight), unit: "PIXELS" };
      }
      if (p.letterSpacing != null) style.letterSpacing = { value: Number(p.letterSpacing), unit: "PIXELS" };
      if (p.paragraphSpacing != null) style.paragraphSpacing = Number(p.paragraphSpacing);
      if (p.textCase) style.textCase = upper(p.textCase, ["ORIGINAL", "UPPER", "LOWER", "TITLE"], "textCase") as any;
      if (p.textDecoration) style.textDecoration = upper(p.textDecoration, ["NONE", "UNDERLINE", "STRIKETHROUGH"], "textDecoration") as any;
      figma.commitUndo();
      return ok(request, { id: style.id, name: style.name });
    }

    case "update_effect_style": {
      const style = (await figma.getStyleByIdAsync(String(p.styleId ?? ""))) as EffectStyle | null;
      if (!style || style.type !== "EFFECT") throw new Error(`效果样式不存在：${p.styleId}`);
      if (!Array.isArray(p.effects)) throw new Error("effects 必须是数组");
      if (p.name) style.name = String(p.name);
      style.effects = p.effects;
      figma.commitUndo();
      return ok(request, { id: style.id, name: style.name, count: p.effects.length });
    }

    case "update_grid_style": {
      const style = (await figma.getStyleByIdAsync(String(p.styleId ?? ""))) as GridStyle | null;
      if (!style || style.type !== "GRID") throw new Error(`网格样式不存在：${p.styleId}`);
      if (p.name) style.name = String(p.name);
      style.layoutGrids = normalizeLayoutGrids(p.layoutGrids);
      figma.commitUndo();
      return ok(request, { id: style.id, name: style.name, count: style.layoutGrids.length });
    }

    /* ---------- 变量 ---------- */
    case "rename_variable": {
      const variable = await figma.variables.getVariableByIdAsync(String(p.variableId ?? ""));
      if (!variable) throw new Error(`变量不存在：${p.variableId}`);
      if (p.name) variable.name = String(p.name);
      if (p.description != null) variable.description = String(p.description);
      figma.commitUndo();
      return ok(request, { id: variable.id, name: variable.name, description: variable.description });
    }

    case "delete_variable_collection": {
      const collection = await figma.variables.getVariableCollectionByIdAsync(String(p.collectionId ?? ""));
      if (!collection) throw new Error(`变量集合不存在：${p.collectionId}`);
      collection.remove();
      figma.commitUndo();
      return ok(request, { id: String(p.collectionId), deleted: true });
    }

    /* ---------- 插件数据 ---------- */
    case "set_node_plugin_data": {
      const node = await getNodeById(nodeIds[0]);
      if (!p.key) throw new Error("key 不能为空");
      node.setPluginData(String(p.key), String(p.value ?? ""));
      return ok(request, { id: node.id, key: String(p.key) });
    }

    /* ---------- 星形 / 多边形 ---------- */
    case "create_star": {
      const node = figma.createStar();
      node.pointCount = Math.max(3, Number(p.pointCount ?? 5));
      if (p.innerRadius != null) node.innerRadius = Number(p.innerRadius);
      const parent = await resolveParent(p.parentId);
      parent.appendChild(node);
      applySizeAndPosition(node, p);
      figma.commitUndo();
      return ok(request, { id: node.id, name: node.name, type: node.type });
    }

    case "create_polygon": {
      const node = figma.createPolygon();
      node.pointCount = Math.max(3, Number(p.pointCount ?? 6));
      const parent = await resolveParent(p.parentId);
      parent.appendChild(node);
      applySizeAndPosition(node, p);
      figma.commitUndo();
      return ok(request, { id: node.id, name: node.name, type: node.type });
    }

    /* ---------- 对齐 / 分布 ---------- */
    case "align_nodes": {
      const ids = nodeIds.length > 0 ? nodeIds : figma.currentPage.selection.map((n) => n.id);
      if (ids.length < 2) throw new Error("align_nodes 需要至少 2 个节点");
      const nodes = (await getNodesByIds(ids)) as any[];
      const parent = nodes[0].parent;
      if (!parent || !nodes.every((n) => n.parent === parent)) {
        throw new Error("对齐要求所有节点在同一父级");
      }
      const movable = nodes.filter((n) => "x" in n && "y" in n && "width" in n && "height" in n);
      if (movable.length < 2) throw new Error("可移动节点不足 2 个");
      const align = upper(
        p.align ?? "LEFT",
        ["LEFT", "RIGHT", "TOP", "BOTTOM", "CENTER_H", "CENTER_V", "DISTRIBUTE_H", "DISTRIBUTE_V"],
        "align",
      );
      const minX = Math.min(...movable.map((n) => n.x));
      const maxX = Math.max(...movable.map((n) => n.x + n.width));
      const minY = Math.min(...movable.map((n) => n.y));
      const maxY = Math.max(...movable.map((n) => n.y + n.height));

      if (align === "DISTRIBUTE_H" || align === "DISTRIBUTE_V") {
        const horizontal = align === "DISTRIBUTE_H";
        const sorted = [...movable].sort((a, b) => (horizontal ? a.x - b.x : a.y - b.y));
        const total = sorted.reduce((sum, n) => sum + (horizontal ? n.width : n.height), 0);
        const span = horizontal ? maxX - minX : maxY - minY;
        const gap = (span - total) / (sorted.length - 1);
        let cursor = horizontal ? minX : minY;
        for (const n of sorted) {
          if (horizontal) n.x = cursor;
          else n.y = cursor;
          cursor += (horizontal ? n.width : n.height) + gap;
        }
      } else {
        for (const n of movable) {
          if (align === "LEFT") n.x = minX;
          else if (align === "RIGHT") n.x = maxX - n.width;
          else if (align === "TOP") n.y = minY;
          else if (align === "BOTTOM") n.y = maxY - n.height;
          else if (align === "CENTER_H") n.x = minX + (maxX - minX - n.width) / 2;
          else if (align === "CENTER_V") n.y = minY + (maxY - minY - n.height) / 2;
        }
      }
      figma.commitUndo();
      return ok(request, { align, count: movable.length });
    }

    /* ---------- 批注 ---------- */
    case "set_annotations": {
      const node = (await getNodeById(nodeIds[0])) as any;
      if (!("annotations" in node)) throw new Error(`Node ${node.id} 不支持批注`);
      if (!Array.isArray(p.annotations)) throw new Error("annotations 必须是数组");
      // 仅保留 API 支持的四个字段，properties 元素只保留 type
      const annotations = p.annotations.map((item: any, index: number) => {
        const out: any = {};
        if (item?.label != null) out.label = String(item.label);
        if (item?.labelMarkdown != null) out.labelMarkdown = String(item.labelMarkdown);
        // categoryId 为 null 时直接省略，避免写入非法值
        if (item?.categoryId != null) out.categoryId = String(item.categoryId);
        if (item?.properties != null) {
          if (!Array.isArray(item.properties)) throw new Error(`annotations[${index}].properties 必须是数组`);
          out.properties = item.properties.map((prop: any) => ({ type: prop?.type }));
        }
        return out;
      });
      node.annotations = annotations;
      figma.commitUndo();
      return ok(request, { id: node.id, name: node.name, annotations: node.annotations });
    }

    case "add_annotation_category": {
      const label = p.label != null ? String(p.label) : "";
      if (!label) throw new Error("label 不能为空");
      const color = normalizeAnnotationColor(p.color);
      const category = await figma.annotations.addAnnotationCategoryAsync({ label, color });
      return ok(request, { id: category.id, label: category.label, color: category.color, isPreset: category.isPreset });
    }

    case "update_annotation_category": {
      const categoryId = p.categoryId != null ? String(p.categoryId) : "";
      if (!categoryId) throw new Error("categoryId 不能为空");
      const category = await figma.annotations.getAnnotationCategoryByIdAsync(categoryId);
      if (!category) throw new Error(`批注分类不存在：${categoryId}`);
      if (p.label == null && p.color == null) throw new Error("label 与 color 至少提供一个");
      if (p.label != null) category.setLabel(String(p.label));
      if (p.color != null) category.setColor(normalizeAnnotationColor(p.color));
      return ok(request, { id: category.id, label: category.label, color: category.color, isPreset: category.isPreset });
    }

    case "delete_annotation_category": {
      const categoryId = p.categoryId != null ? String(p.categoryId) : "";
      if (!categoryId) throw new Error("categoryId 不能为空");
      const category = await figma.annotations.getAnnotationCategoryByIdAsync(categoryId);
      if (!category) throw new Error(`批注分类不存在：${categoryId}`);
      category.remove();
      return ok(request, { categoryId, deleted: true });
    }

    /* ---------- 页面属性 / 文件操作 ---------- */
    case "set_page_backgrounds": {
      const page = p.pageId ? await getNodeById(String(p.pageId)) : figma.currentPage;
      if (page.type !== "PAGE") throw new Error(`Node ${page.id} 不是页面`);
      const target = page as PageNode;
      // dynamic-page 下写入非当前页前需要先加载
      if (target.id !== figma.currentPage.id && typeof (target as any).loadAsync === "function") {
        await target.loadAsync();
      }
      // 页面背景只支持单色：多于一个时取第一个
      const resolvePaintList = (list: any, color: any): Paint[] | null => {
        if (Array.isArray(list)) {
          const paints = normalizePaints(list);
          return paints.length > 1 ? [paints[0]] : paints;
        }
        if (color != null) return [makeSolidPaint(color)];
        return null;
      };
      const backgrounds = resolvePaintList(p.backgrounds, p.color);
      const prototypeBackgrounds = resolvePaintList(p.prototypeBackgrounds, p.prototypeColor);
      if (!backgrounds && !prototypeBackgrounds) {
        throw new Error("backgrounds / color / prototypeBackgrounds / prototypeColor 至少提供一个");
      }
      if (backgrounds) target.backgrounds = backgrounds;
      if (prototypeBackgrounds) target.prototypeBackgrounds = prototypeBackgrounds;
      figma.commitUndo();
      return ok(request, {
        id: target.id,
        name: target.name,
        backgrounds: target.backgrounds,
        prototypeBackgrounds: target.prototypeBackgrounds,
      });
    }

    case "set_file_thumbnail": {
      if (p.nodeId === null) {
        await figma.setFileThumbnailNodeAsync(null);
        return ok(request, { cleared: true });
      }
      const node = await getNodeById(p.nodeId ?? nodeIds[0]);
      if (!["FRAME", "COMPONENT", "COMPONENT_SET", "SECTION"].includes(node.type)) {
        throw new Error("缩略图节点必须是 Frame/Component/ComponentSet/Section");
      }
      await figma.setFileThumbnailNodeAsync(node as any);
      return ok(request, { nodeId: node.id, cleared: false });
    }

    case "save_file_version": {
      if (!p.title) throw new Error("title 不能为空");
      const title = String(p.title);
      const result = await figma.saveVersionHistoryAsync(
        title,
        p.description != null ? String(p.description) : undefined,
      );
      return ok(request, { id: result.id, title });
    }

    default:
      return null;
  }
};
