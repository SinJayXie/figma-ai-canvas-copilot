import {
  serializeNode,
  getBounds,
  serializeStyles,
  serializeCompactExtra,
  isMixed,
  deduplicateStyles,
  createSerializeBudget,
  serializePaints,
} from "./serializers";

/** 读能力默认深度与节点上限：避免整页无限递归卡死沙箱 / 超出 postMessage 限制 */
const READ_DEPTH_LIMIT = 5;
const READ_NODE_BUDGET = 2000;
/** get_design_context 单次请求最多展开的节点数 */
const CONTEXT_NODE_LIMIT = 1500;
/** get_text_range 默认返回的文本样式字段 */
const TEXT_SEGMENT_FIELDS = [
  "fontName",
  "fontSize",
  "fontWeight",
  "fills",
  "lineHeight",
  "letterSpacing",
  "textCase",
  "textDecoration",
  "hyperlink",
  "listOptions",
  "paragraphIndent",
  "paragraphSpacing",
];

/** 样式值可能含 mixed 符号：递归转成可安全 postMessage 的普通值 */
const jsonSafe = (value: any): any => {
  if (typeof value === "symbol") return "mixed";
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === "object") {
    const out: any = {};
    for (const [key, item] of Object.entries(value)) out[key] = jsonSafe(item);
    return out;
  }
  return value;
};

/** 分段的 fills 优先复用紧凑 hex 格式；无法表示（如 IMAGE 填充）时回退原值 */
const serializeSegmentFills = (value: any) => {
  try {
    const serialized = serializePaints(value);
    return serialized !== undefined ? serialized : jsonSafe(value);
  } catch {
    return jsonSafe(value);
  }
};

export const handleReadDocumentRequest = async (request: any) => {
  switch (request.type) {
    case "get_document": {
      const rawDepth = Number(request.params?.maxDepth ?? READ_DEPTH_LIMIT);
      const rawNodes = Number(request.params?.maxNodes ?? READ_NODE_BUDGET);
      const depth = Number.isFinite(rawDepth) ? Math.max(0, Math.floor(rawDepth)) : READ_DEPTH_LIMIT;
      const budget = createSerializeBudget(
        Number.isFinite(rawNodes) ? Math.max(1, Math.floor(rawNodes)) : READ_NODE_BUDGET,
      );
      const raw = await serializeNode(figma.currentPage, depth, budget);
      const { tree, globalVars } = deduplicateStyles(raw);
      return {
        type: request.type,
        requestId: request.requestId,
        data: {
          ...(globalVars ? { ...tree, globalVars } : tree),
          ...(budget.truncated ? { truncated: true } : {}),
        },
      };
    }

    case "get_selection": {
      const budget = createSerializeBudget(READ_NODE_BUDGET);
      return {
        type: request.type,
        requestId: request.requestId,
        data: await Promise.all(
          figma.currentPage.selection.map((node) =>
            serializeNode(node, READ_DEPTH_LIMIT, budget),
          ),
        ),
      };
    }

    case "get_node": {
      const nodeId = request.nodeIds && request.nodeIds[0];
      if (!nodeId) throw new Error("nodeIds is required for get_node");
      const node = await figma.getNodeByIdAsync(nodeId);
      if (!node || node.type === "DOCUMENT")
        throw new Error(`Node not found: ${nodeId}`);
      const budget = createSerializeBudget(READ_NODE_BUDGET);
      const data = await serializeNode(node, READ_DEPTH_LIMIT, budget);
      return {
        type: request.type,
        requestId: request.requestId,
        data: { ...data, ...(budget.truncated ? { truncated: true } : {}) },
      };
    }

    case "get_nodes_info": {
      if (!request.nodeIds || request.nodeIds.length === 0)
        throw new Error("nodeIds is required for get_nodes_info");
      const nodes = await Promise.all(
        request.nodeIds.map((id: string) => figma.getNodeByIdAsync(id)),
      );
      const budget = createSerializeBudget(READ_NODE_BUDGET);
      return {
        type: request.type,
        requestId: request.requestId,
        data: await Promise.all(
          nodes
            .filter((n) => n !== null && n.type !== "DOCUMENT")
            .map((n) => serializeNode(n, READ_DEPTH_LIMIT, budget)),
        ),
      };
    }

    case "get_text_range": {
      const params: any = request.params || {};
      const nodeId = request.nodeIds && request.nodeIds[0];
      if (!nodeId) throw new Error("nodeIds is required for get_text_range");
      const node = await figma.getNodeByIdAsync(nodeId) as any;
      if (!node) throw new Error(`Node not found: ${nodeId}`);
      if (node.type !== "TEXT") throw new Error(`Node ${nodeId} is not a TEXT node`);

      const length = node.characters.length;
      const rawStart = Number(params.start ?? 0);
      const rawEnd = Number(params.end ?? length);
      const start = Number.isFinite(rawStart) ? Math.floor(rawStart) : NaN;
      const end = Number.isFinite(rawEnd) ? Math.floor(rawEnd) : NaN;
      if (
        !Number.isFinite(start) ||
        !Number.isFinite(end) ||
        start < 0 ||
        start >= end ||
        end > length
      ) {
        throw new Error(
          `文本范围无效：start=${rawStart} end=${rawEnd}，当前文本长度 ${length}（需满足 0 <= start < end <= length）`,
        );
      }

      const fields: string[] = Array.isArray(params.fields) && params.fields.length > 0
        ? params.fields.map((field: any) => String(field))
        : [...TEXT_SEGMENT_FIELDS];

      let segments: any[] = [];
      if (typeof node.getStyledTextSegments === "function") {
        const rawSegments: any[] = node.getStyledTextSegments(fields, start, end);
        segments = rawSegments.map((raw) => {
          const segment: any = { start: raw.start, end: raw.end, characters: raw.characters };
          for (const field of fields) {
            if (field === "fills") {
              segment.fills = serializeSegmentFills(raw.fills);
            } else if (field in raw) {
              segment[field] = jsonSafe(raw[field]);
            }
          }
          return segment;
        });
      } else {
        // 旧版本 API 无分段能力：退化为单段，并逐个用 getRange* 读取可用字段
        const segment: any = { start, end, characters: node.characters.slice(start, end) };
        const fallbackReaders: Array<[string, string]> = [
          ["fontName", "getRangeFontName"],
          ["fontSize", "getRangeFontSize"],
          ["fills", "getRangeFills"],
          ["lineHeight", "getRangeLineHeight"],
          ["letterSpacing", "getRangeLetterSpacing"],
        ];
        for (const [field, method] of fallbackReaders) {
          if (!fields.includes(field) || typeof node[method] !== "function") continue;
          const value = node[method](start, end);
          segment[field] = field === "fills" ? serializeSegmentFills(value) : jsonSafe(value);
        }
        segments = [segment];
      }

      return {
        type: request.type,
        requestId: request.requestId,
        data: {
          nodeId: node.id,
          name: node.name,
          characters: node.characters,
          length,
          start,
          end,
          segments,
        },
      };
    }

    case "get_design_context": {
      const depth =
        request.params && request.params.depth != null
          ? request.params.depth
          : 2;
      const detail = (request.params && request.params.detail) || "full";
      const dedupeComponents = !!(request.params && request.params.dedupeComponents);
      const componentDefs = new Map<string, any>();
      // 单次请求的节点预算：无选中时会以整页为上下文，必须限流
      const contextBudget = createSerializeBudget(CONTEXT_NODE_LIMIT);
      let visitedNodes = 0;

      const serializeForDetail = async (n: any) => {
        const base = {
          id: n.id,
          name: n.name,
          type: n.type,
          parentId: n.parent ? (n.parent.type === "PAGE" ? "page" : n.parent.id) : undefined,
          bounds: getBounds(n),
        };
        if (detail === "minimal") return base;
        const styles = await serializeStyles(n);
        const result: any = Object.assign({}, base);
        if (Object.keys(styles).length > 0) result.styles = styles;
        if ("opacity" in n && n.opacity !== 1) result.opacity = n.opacity;
        if ("visible" in n && !n.visible) result.visible = false;
        if (detail === "compact") {
          // 补充排版 / auto layout / sizing / 约束 / 绝对定位等关键信息：
          // 只有尺寸和填充时，模型无法判断字体层级与布局结构
          const extra = serializeCompactExtra(n);
          if (extra) result.extra = extra;
          return result;
        }
        return await serializeNode(n, READ_DEPTH_LIMIT, contextBudget);
      };

      const extractInstanceOverrides = async (
        instanceNode: any,
        componentNode: any,
      ): Promise<{ id: string; name: string; type: string; characters?: string; mainComponentId?: string | null; visible?: boolean; opacity?: number; fills?: any }[]> => {
        const overrides: any[] = [];
        if (!instanceNode?.children || !componentNode?.children) return overrides;
        for (let i = 0; i < instanceNode.children.length; i++) {
          const instChild = instanceNode.children[i];
          const compChild = componentNode.children[i];
          if (!instChild || !compChild) continue;

          // Detect property overrides (visible, opacity, fills) for all node types
          const propChanges: any = {};
          if ("visible" in instChild && "visible" in compChild && instChild.visible !== compChild.visible) {
            propChanges.visible = instChild.visible;
          }
          if ("opacity" in instChild && "opacity" in compChild && instChild.opacity !== compChild.opacity) {
            propChanges.opacity = instChild.opacity;
          }
          if ("fills" in instChild && "fills" in compChild && !isMixed(instChild.fills) && !isMixed(compChild.fills)) {
            if (JSON.stringify(instChild.fills) !== JSON.stringify(compChild.fills)) {
              propChanges.fills = instChild.fills;
            }
          }

          if (instChild.type === "TEXT") {
            const override: any = { id: instChild.id, name: instChild.name, type: "TEXT" };
            let hasChange = false;
            if (instChild.characters !== compChild.characters) {
              override.characters = instChild.characters;
              hasChange = true;
            }
            if (Object.keys(propChanges).length > 0) {
              Object.assign(override, propChanges);
              hasChange = true;
            }
            if (hasChange) overrides.push(override);
            continue;
          }

          if (instChild.type === "INSTANCE") {
            const [nestedMc, compMc] = await Promise.all([
              instChild.getMainComponentAsync(),
              compChild.type === "INSTANCE" ? compChild.getMainComponentAsync() : Promise.resolve(null),
            ]);
            if (nestedMc?.id !== compMc?.id) {
              const override: any = { id: instChild.id, name: instChild.name, type: "INSTANCE", mainComponentId: nestedMc?.id ?? null };
              if (Object.keys(propChanges).length > 0) Object.assign(override, propChanges);
              overrides.push(override);
              continue;
            }
            if (Object.keys(propChanges).length > 0) {
              overrides.push({ id: instChild.id, name: instChild.name, type: "INSTANCE", mainComponentId: nestedMc?.id ?? null, ...propChanges });
            }
            if (nestedMc) overrides.push(...await extractInstanceOverrides(instChild, nestedMc));
            continue;
          }

          if (Object.keys(propChanges).length > 0) {
            overrides.push({ id: instChild.id, name: instChild.name, type: instChild.type, ...propChanges });
          }
          if ("children" in instChild) {
            overrides.push(...await extractInstanceOverrides(instChild, compChild));
          }
        }
        return overrides;
      };

      const serializeWithDepth = async (node: any, currentDepth: number): Promise<any> => {
        if (visitedNodes >= CONTEXT_NODE_LIMIT) {
          contextBudget.truncated = true;
          return { id: node.id, name: node.name, type: node.type, truncated: true };
        }
        visitedNodes += 1;

        if (dedupeComponents && node.type === "INSTANCE") {
          const mc = await node.getMainComponentAsync();
          if (mc && !componentDefs.has(mc.id)) {
            componentDefs.set(mc.id, await serializeNode(mc, 3, contextBudget));
          }
          const props: Record<string, any> = {};
          if (node.componentProperties) {
            for (const [key, prop] of Object.entries(node.componentProperties)) {
              props[key] = (prop as any).value;
            }
          }
          const result: any = {
            id: node.id,
            name: node.name,
            type: node.type,
            bounds: getBounds(node),
            mainComponentId: mc?.id ?? null,
          };
          if (Object.keys(props).length > 0) result.componentProperties = props;
          const overrides = await extractInstanceOverrides(node, mc);
          if (overrides.length > 0) result.overrides = overrides;
          return result;
        }
        if (detail === "full") {
          const remaining = depth - currentDepth;
          // Without per-descendant component dedupe there is nothing to inspect
          // level by level, so one depth-limited pass produces the whole result.
          if (!dedupeComponents) return await serializeNode(node, remaining, contextBudget);

          // dedupeComponents has to see every descendant INSTANCE, so keep
          // walking level by level -- but serialize only this node (depth 0) and
          // recurse over node.children directly instead of serializing the whole
          // subtree and then re-fetching each child by ID.
          const serialized = await serializeNode(node, 0, contextBudget);
          if (remaining <= 0 || !("children" in node)) return serialized;
          const serializedChildren = await Promise.all(
            node.children
              .filter((n: any) => n.type !== "DOCUMENT")
              .map((n: any) => serializeWithDepth(n, currentDepth + 1)),
          );
          return Object.assign({}, serialized, {
            children: serializedChildren,
            childCount: undefined,
          });
        }

        const serialized = await serializeForDetail(node);
        const hasChildren = "children" in node && node.children.length > 0;
        if (!hasChildren) return serialized;
        if (currentDepth >= depth) {
          return Object.assign({}, serialized, { childCount: node.children.length });
        }
        const serializedChildren = await Promise.all(
          node.children
            .filter((n: any) => n.type !== "DOCUMENT")
            .map((n: any) => serializeWithDepth(n, currentDepth + 1)),
        );
        return Object.assign({}, serialized, { children: serializedChildren });
      };

      const selection = figma.currentPage.selection;
      const rawContextNodes =
        selection.length > 0
          ? await Promise.all(
              selection.map((node) => serializeWithDepth(node, 0)),
            )
          : [await serializeWithDepth(figma.currentPage, 0)];
      const { tree: dedupedNodes, globalVars } = deduplicateStyles({ children: rawContextNodes });
      const contextNodes = (dedupedNodes as any).children;
      return {
        type: request.type,
        requestId: request.requestId,
        data: {
          fileName: figma.root.name,
          currentPage: {
            id: figma.currentPage.id,
            name: figma.currentPage.name,
          },
          selectionCount: selection.length,
          context: contextNodes,
          ...(componentDefs.size > 0 ? { componentDefs: Object.fromEntries(componentDefs) } : {}),
          ...(globalVars ? { globalVars } : {}),
          ...(contextBudget.truncated || visitedNodes >= CONTEXT_NODE_LIMIT
            ? { truncated: true, nodeLimit: CONTEXT_NODE_LIMIT }
            : {}),
        },
      };
    }

    case "get_metadata":
      return {
        type: request.type,
        requestId: request.requestId,
        data: {
          fileName: figma.root.name,
          currentPageId: figma.currentPage.id,
          currentPageName: figma.currentPage.name,
          pageCount: figma.root.children.length,
          pages: figma.root.children.map((page) => ({
            id: page.id,
            name: page.name,
          })),
        },
      };

    case "get_pages":
      return {
        type: request.type,
        requestId: request.requestId,
        data: {
          currentPageId: figma.currentPage.id,
          pages: figma.root.children.map((page) => ({
            id: page.id,
            name: page.name,
          })),
        },
      };

    case "get_page": {
      const params: any = request.params || {};
      let page: PageNode;
      if (params.pageId) {
        const node = await figma.getNodeByIdAsync(String(params.pageId));
        if (!node) throw new Error(`Page not found: ${params.pageId}`);
        if (node.type !== "PAGE") throw new Error(`Node ${params.pageId} is not a PAGE node`);
        page = node as PageNode;
      } else {
        page = figma.currentPage;
      }
      // dynamic-page 下读取非当前页属性前需要先加载
      if (page.id !== figma.currentPage.id && typeof (page as any).loadAsync === "function") {
        await page.loadAsync();
      }
      const prototypeStartNode = (page as any).prototypeStartNode;
      return {
        type: request.type,
        requestId: request.requestId,
        data: {
          id: page.id,
          name: page.name,
          isCurrent: page.id === figma.currentPage.id,
          childCount: page.children.length,
          backgrounds: serializePaints(page.backgrounds) ?? [],
          prototypeBackgrounds: serializePaints((page as any).prototypeBackgrounds) ?? [],
          flowStartingPoints: page.flowStartingPoints,
          prototypeStartNode: prototypeStartNode
            ? { id: prototypeStartNode.id, name: prototypeStartNode.name }
            : null,
        },
      };
    }

    case "get_viewport":
      return {
        type: request.type,
        requestId: request.requestId,
        data: {
          center: { x: figma.viewport.center.x, y: figma.viewport.center.y },
          zoom: figma.viewport.zoom,
          bounds: {
            x: figma.viewport.bounds.x,
            y: figma.viewport.bounds.y,
            width: figma.viewport.bounds.width,
            height: figma.viewport.bounds.height,
          },
        },
      };

    case "get_fonts": {
      const fontMap = new Map<string, any>();
      await figma.currentPage.loadAsync();
      for (const n of figma.currentPage.findAllWithCriteria({ types: ["TEXT"] })) {
        const fontName = n.fontName;
        if (typeof fontName !== "symbol" && fontName) {
          const key = `${fontName.family}::${fontName.style}`;
          if (!fontMap.has(key)) {
            fontMap.set(key, { family: fontName.family, style: fontName.style, nodeCount: 0 });
          }
          fontMap.get(key).nodeCount++;
        }
      }
      const fonts = Array.from(fontMap.values()).sort((a, b) => b.nodeCount - a.nodeCount);
      return {
        type: request.type,
        requestId: request.requestId,
        data: { count: fonts.length, fonts },
      };
    }

    case "list_available_fonts": {
      const params: any = request.params || {};
      const all = await figma.listAvailableFontsAsync();
      const familyFilter = params.family != null ? String(params.family).toLowerCase() : "";
      const styleFilter = params.style != null ? String(params.style).toLowerCase() : "";
      const seen = new Set<string>();
      const fonts: Array<{ family: string; style: string }> = [];
      for (const font of all) {
        if (familyFilter && !font.fontName.family.toLowerCase().includes(familyFilter)) continue;
        if (styleFilter && font.fontName.style.toLowerCase() !== styleFilter) continue;
        const key = `${font.fontName.family}::${font.fontName.style}`;
        if (seen.has(key)) continue;
        seen.add(key);
        fonts.push({ family: font.fontName.family, style: font.fontName.style });
      }
      const rawLimit = Number(params.limit ?? 200);
      const limit = Number.isFinite(rawLimit)
        ? Math.min(2000, Math.max(1, Math.floor(rawLimit)))
        : 200;
      const limited = fonts.slice(0, limit);
      return {
        type: request.type,
        requestId: request.requestId,
        data: {
          count: limited.length,
          fonts: limited,
          ...(fonts.length > limited.length ? { truncated: true } : {}),
        },
      };
    }

    case "search_nodes": {
      const query = request.params && request.params.query
        ? request.params.query.toLowerCase()
        : "";
      const scopeNodeId = request.params && request.params.nodeId;
      const types = request.params && request.params.types ? request.params.types : [];
      const limit = request.params && request.params.limit ? request.params.limit : 50;
      const root: any = scopeNodeId
        ? await figma.getNodeByIdAsync(scopeNodeId)
        : figma.currentPage;
      if (!root) throw new Error(`Node not found: ${scopeNodeId}`);
      if (root.type === "PAGE") await root.loadAsync();
      const typeSet = new Set<string>(types);
      const results: any[] = [];
      // Kept as a manual walk rather than findAllWithCriteria: the limit lets us
      // stop early, which an index-wide search cannot do.
      const search = (n: any) => {
        if (results.length >= limit) return;
        if (n !== root) {
          const nameMatch = !query || n.name.toLowerCase().includes(query);
          const typeMatch = typeSet.size === 0 || typeSet.has(n.type);
          if (nameMatch && typeMatch) {
            results.push({
              id: n.id,
              name: n.name,
              type: n.type,
              bounds: getBounds(n),
            });
          }
        }
        if (results.length < limit && "children" in n) {
          for (const child of n.children) search(child);
        }
      };
      search(root);
      return {
        type: request.type,
        requestId: request.requestId,
        data: { count: results.length, nodes: results },
      };
    }

    case "get_reactions": {
      const nodeId = request.nodeIds && request.nodeIds[0];
      if (!nodeId) throw new Error("nodeId is required for get_reactions");
      const node = await figma.getNodeByIdAsync(nodeId);
      if (!node || node.type === "DOCUMENT") throw new Error(`Node not found: ${nodeId}`);
      const reactions = "reactions" in node ? node.reactions : [];
      return {
        type: request.type,
        requestId: request.requestId,
        data: { nodeId: node.id, name: node.name, reactions },
      };
    }

    case "scan_text_nodes": {
      const params: any = request.params || {};
      // 兼容三种传参：params.nodeId / params.rootId / nodeIds[0]；都不传则扫当前页
      const nodeId = params.nodeId ?? params.rootId ?? (request.nodeIds && request.nodeIds[0]);
      const root: any = nodeId
        ? await figma.getNodeByIdAsync(String(nodeId))
        : figma.currentPage;
      if (!root) throw new Error(`Node not found: ${nodeId}`);
      if (root.type === "PAGE" && typeof root.loadAsync === "function") {
        await root.loadAsync();
      }
      try {
        figma.ui.postMessage({
          type: "progress_update",
          requestId: request.requestId,
          progress: 10,
          message: "Scanning text nodes...",
        });
      } catch {
        // UI 已关闭时忽略进度通知
      }
      await new Promise((r) => setTimeout(r, 0));

      // findAllWithCriteria 走 Figma 类型索引（快），且不包含调用节点自身；
      // 旧版本 API / 动态页未完全加载时退回递归遍历。
      let found: any[] = [];
      if (root.type === "TEXT") {
        found = [root];
      } else if (typeof root.findAllWithCriteria === "function") {
        try {
          found = root.findAllWithCriteria({ types: ["TEXT"] }) ?? [];
        } catch {
          found = [];
        }
      }
      if (found.length === 0 && root.type !== "TEXT") {
        const stack: any[] = [...(root.children ?? [])];
        while (stack.length > 0 && found.length < 2000) {
          const node = stack.pop();
          if (!node) continue;
          if (node.type === "TEXT") found.push(node);
          if ("children" in node && Array.isArray(node.children)) stack.push(...node.children);
        }
      }

      const limited = found.slice(0, 2000);
      const textNodes = limited.map((n: any) => ({
        id: n.id,
        name: n.name,
        characters: n.characters,
        fontSize: isMixed(n.fontSize) ? "mixed" : n.fontSize,
        fontName: isMixed(n.fontName) ? "mixed" : n.fontName,
      }));
      return {
        type: request.type,
        requestId: request.requestId,
        data: {
          count: textNodes.length,
          textNodes,
          ...(found.length > limited.length ? { truncated: true } : {}),
        },
      };
    }

    case "scan_nodes_by_types": {
      const params: any = request.params || {};
      const nodeId = params.nodeId ?? params.rootId ?? (request.nodeIds && request.nodeIds[0]);
      const types: string[] = Array.isArray(params.types) ? params.types : [];
      if (types.length === 0) throw new Error("types must be a non-empty array");
      const root: any = nodeId
        ? await figma.getNodeByIdAsync(String(nodeId))
        : figma.currentPage;
      if (!root) throw new Error(`Node not found: ${nodeId}`);
      if (root.type === "PAGE" && typeof root.loadAsync === "function") {
        await root.loadAsync();
      }
      const typeSet = new Set<string>(types.map((type) => String(type).toUpperCase()));
      const matchingNodes: any[] = [];
      // Manual walk, not findAllWithCriteria: this tool prunes whole invisible
      // subtrees, which an index search would flatten back in.
      const findByTypes = (n: any) => {
        if (matchingNodes.length >= 2000) return;
        if ("visible" in n && !n.visible) return;
        if (typeSet.has(n.type)) {
          matchingNodes.push({
            id: n.id,
            name: n.name,
            type: n.type,
            bbox: {
              x: "x" in n ? n.x : 0,
              y: "y" in n ? n.y : 0,
              width: "width" in n ? n.width : 0,
              height: "height" in n ? n.height : 0,
            },
          });
        }
        if ("children" in n && Array.isArray(n.children)) {
          for (const child of n.children) findByTypes(child);
        }
      };
      try {
        figma.ui.postMessage({
          type: "progress_update",
          requestId: request.requestId,
          progress: 10,
          message: `Scanning for types: ${types.join(", ")}...`,
        });
      } catch {
        // UI 已关闭时忽略进度通知
      }
      await new Promise((r) => setTimeout(r, 0));
      findByTypes(root);
      return {
        type: request.type,
        requestId: request.requestId,
        data: {
          count: matchingNodes.length,
          matchingNodes,
          searchedTypes: types,
          ...(matchingNodes.length >= 2000 ? { truncated: true } : {}),
        },
      };
    }

    default:
      return null;
  }
};
