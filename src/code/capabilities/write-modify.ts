import { getBounds } from "./serializers";
import { collectPaintsFromParams, getParentNode, applyAutoLayout, isAutoLayoutParent, applyGradientOrientation } from "./write-helpers";

/** 枚举值归一化为大写并校验，非法值抛中文错误 */
const toEnum = (value: any, allowed: string[], field: string): string => {
  const v = String(value ?? "").toUpperCase();
  if (!allowed.includes(v)) {
    throw new Error(`${field} 仅支持 ${allowed.join(" / ")}`);
  }
  return v;
};

/** 文本范围参数解析：默认整段，向下取整并校验 0 <= start < end <= length */
const resolveTextRange = (p: any, length: number) => {
  const rawStart = Number(p.start ?? 0);
  const rawEnd = Number(p.end ?? length);
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
  return { start, end };
};

export const handleWriteModifyRequest = async (request: any) => {
  switch (request.type) {
    case "set_text": {
      const p = request.params || {};
      const nodeId = request.nodeIds && request.nodeIds[0];
      if (!nodeId) throw new Error("nodeId is required");
      const node = await figma.getNodeByIdAsync(nodeId);
      if (!node) throw new Error(`Node not found: ${nodeId}`);
      if (node.type !== "TEXT") throw new Error(`Node ${nodeId} is not a TEXT node`);
      const fontName = typeof node.fontName === "symbol"
        ? { family: "Inter", style: "Regular" }
        : node.fontName;
      await figma.loadFontAsync(fontName);
      node.characters = p.text;
      figma.commitUndo();
      return {
        type: request.type,
        requestId: request.requestId,
        data: { id: node.id, name: node.name, characters: node.characters },
      };
    }

    case "set_text_range": {
      const p = request.params || {};
      const nodeId = request.nodeIds && request.nodeIds[0];
      if (!nodeId) throw new Error("nodeId is required");
      const node = await figma.getNodeByIdAsync(nodeId) as any;
      if (!node) throw new Error(`Node not found: ${nodeId}`);
      if (node.type !== "TEXT") throw new Error(`Node ${nodeId} is not a TEXT node`);
      const { start, end } = resolveTextRange(p, node.characters.length);

      // 字体：兼容 fontName {family,style} 与扁平 fontFamily/fontStyle
      let fontName: { family: string; style: string } | null = null;
      if (p.fontName && typeof p.fontName === "object" && p.fontName.family) {
        fontName = {
          family: String(p.fontName.family),
          style: String(p.fontName.style || "Regular"),
        };
      } else if (p.fontFamily != null) {
        fontName = {
          family: String(p.fontFamily),
          style: String(p.fontStyle || "Regular"),
        };
      }
      if (fontName && typeof node.setRangeFontName === "function") {
        try {
          await figma.loadFontAsync(fontName);
        } catch {
          throw new Error(`字体加载失败：${fontName.family} ${fontName.style}，请确认字体可用`);
        }
        node.setRangeFontName(start, end, fontName);
      }

      if (p.fontSize != null && typeof node.setRangeFontSize === "function") {
        node.setRangeFontSize(start, end, Number(p.fontSize));
      }

      // 填充：显式传 fills / color 时才读取，空数组视为不改动（范围填充不支持清空）
      if ((p.fills !== undefined || p.color !== undefined) && typeof node.setRangeFills === "function") {
        const paints = collectPaintsFromParams(p, request, "fills");
        if (paints.length > 0) node.setRangeFills(start, end, paints);
      }

      if (p.textStyleId && typeof node.setRangeTextStyleIdAsync === "function") {
        await node.setRangeTextStyleIdAsync(start, end, String(p.textStyleId));
      }
      if (p.fillStyleId && typeof node.setRangeFillStyleIdAsync === "function") {
        await node.setRangeFillStyleIdAsync(start, end, String(p.fillStyleId));
      }

      if (p.lineHeight != null && typeof node.setRangeLineHeight === "function") {
        node.setRangeLineHeight(
          start,
          end,
          String(p.lineHeight).toUpperCase() === "AUTO"
            ? { unit: "AUTO" }
            : { value: Number(p.lineHeight), unit: p.lineHeightUnit || "PIXELS" },
        );
      }

      if (p.letterSpacing != null && typeof node.setRangeLetterSpacing === "function") {
        node.setRangeLetterSpacing(
          start,
          end,
          typeof p.letterSpacing === "number"
            ? { value: p.letterSpacing, unit: "PIXELS" }
            : {
                value: Number(p.letterSpacing.value ?? 0),
                unit: String(p.letterSpacing.unit ?? "PIXELS").toUpperCase(),
              },
        );
      }

      if (p.textCase != null && typeof node.setRangeTextCase === "function") {
        node.setRangeTextCase(
          start,
          end,
          toEnum(
            p.textCase,
            ["ORIGINAL", "UPPER", "LOWER", "TITLE", "SMALL_CAPS", "SMALL_CAPS_FORCED"],
            "textCase",
          ),
        );
      }
      if (p.textDecoration != null && typeof node.setRangeTextDecoration === "function") {
        node.setRangeTextDecoration(
          start,
          end,
          toEnum(p.textDecoration, ["NONE", "UNDERLINE", "STRIKETHROUGH"], "textDecoration"),
        );
      }
      if (p.listOptions != null && typeof node.setRangeListOptions === "function") {
        // 兼容字符串与 { type } 两种写法
        const rawListType =
          p.listOptions && typeof p.listOptions === "object"
            ? p.listOptions.type
            : p.listOptions;
        node.setRangeListOptions(start, end, {
          type: toEnum(rawListType, ["ORDERED", "UNORDERED", "NONE"], "listOptions"),
        });
      }
      if (p.listSpacing != null && typeof node.setRangeListSpacing === "function") {
        node.setRangeListSpacing(start, end, Number(p.listSpacing));
      }
      if (p.indentation != null && typeof node.setRangeIndentation === "function") {
        node.setRangeIndentation(start, end, Number(p.indentation));
      }
      if (p.paragraphIndent != null && typeof node.setRangeParagraphIndent === "function") {
        node.setRangeParagraphIndent(start, end, Number(p.paragraphIndent));
      }
      if (p.paragraphSpacing != null && typeof node.setRangeParagraphSpacing === "function") {
        node.setRangeParagraphSpacing(start, end, Number(p.paragraphSpacing));
      }
      if (p.textWrapStyle != null && typeof node.setRangeTextWrapStyle === "function") {
        node.setRangeTextWrapStyle(
          start,
          end,
          toEnum(p.textWrapStyle, ["AUTO", "BALANCE", "PRETTY"], "textWrapStyle"),
        );
      }

      if (p.hyperlink !== undefined && typeof node.setRangeHyperlink === "function") {
        let target: any = null;
        if (p.hyperlink != null) {
          target = typeof p.hyperlink === "string"
            ? { type: "URL", value: p.hyperlink }
            : {
                type: p.hyperlink.type || "URL",
                value: p.hyperlink.value ?? p.hyperlink.url,
              };
        }
        node.setRangeHyperlink(start, end, target);
      }

      figma.commitUndo();
      return {
        type: request.type,
        requestId: request.requestId,
        data: {
          id: node.id,
          name: node.name,
          start,
          end,
          characters: node.characters.slice(start, end),
        },
      };
    }

    case "set_fills": {
      const p = request.params || {};
      const nodeIds = request.nodeIds || [];
      if (nodeIds.length === 0) throw new Error("nodeIds is required");
      // 容错提取 paint：params.fills（数组/单个）→ params.color/hex/fill/value → 顶层同名字段
      const paints = collectPaintsFromParams(p, request, "fills");
      // 渐变角度允许单独放在 params.angle / params.gradientTransform（不写在 paint 里）
      for (const paint of paints) {
        applyGradientOrientation(paint, p.angle ?? p.gradientAngle, p.gradientTransform);
      }
      if (p.opacity != null && paints.length === 1) (paints[0] as any).opacity = Number(p.opacity);

      // 一次调用可批量作用于多个图层（同一套填充规则），避免逐层多轮往返
      const results: any[] = [];
      for (const nid of nodeIds) {
        const n = await figma.getNodeByIdAsync(nid) as any;
        if (!n) { results.push({ nodeId: nid, error: "Node not found" }); continue; }
        if (!("fills" in n)) { results.push({ nodeId: nid, error: "Node does not support fills" }); continue; }
        // 每个节点使用独立 paint 副本，避免共享对象被后续修改牵连
        const next = paints.map((paint) => ({ ...paint }));
        n.fills = p.mode === "append" ? [...(n.fills as Paint[]), ...next] : next;
        results.push({ id: n.id, name: n.name });
      }
      if (results.every((item) => item.error)) {
        throw new Error(results.map((item) => `${item.nodeId}: ${item.error}`).join("; "));
      }
      figma.commitUndo();
      return {
        type: request.type,
        requestId: request.requestId,
        data: results.length === 1 ? results[0] : { updated: results.filter((item) => !item.error).length, results },
      };
    }

    case "set_strokes": {
      const p = request.params || {};
      const nodeIds = request.nodeIds || [];
      if (nodeIds.length === 0) throw new Error("nodeIds is required");
      const paints = collectPaintsFromParams(p, request, "strokes");
      for (const paint of paints) {
        applyGradientOrientation(paint, p.angle ?? p.gradientAngle, p.gradientTransform);
      }
      if (p.opacity != null && paints.length === 1) (paints[0] as any).opacity = Number(p.opacity);

      const results: any[] = [];
      for (const nid of nodeIds) {
        const n = await figma.getNodeByIdAsync(nid) as any;
        if (!n) { results.push({ nodeId: nid, error: "Node not found" }); continue; }
        if (!("strokes" in n)) { results.push({ nodeId: nid, error: "Node does not support strokes" }); continue; }
        const next = paints.map((paint) => ({ ...paint }));
        n.strokes = p.mode === "append" ? [...(n.strokes as Paint[]), ...next] : next;
        if (p.strokeWeight != null) n.strokeWeight = p.strokeWeight;
        results.push({ id: n.id, name: n.name });
      }
      if (results.every((item) => item.error)) {
        throw new Error(results.map((item) => `${item.nodeId}: ${item.error}`).join("; "));
      }
      figma.commitUndo();
      return {
        type: request.type,
        requestId: request.requestId,
        data: results.length === 1 ? results[0] : { updated: results.filter((item) => !item.error).length, results },
      };
    }

    case "move_nodes": {
      const p = request.params || {};
      const nodeIds = request.nodeIds || [];
      if (nodeIds.length === 0) throw new Error("nodeIds is required");
      const results: any[] = [];
      for (const nid of nodeIds) {
        const n = await figma.getNodeByIdAsync(nid) as any;
        if (!n) { results.push({ nodeId: nid, error: "Node not found" }); continue; }
        if (!("x" in n)) { results.push({ nodeId: nid, error: "Node does not support position" }); continue; }
        if (p.x != null) n.x = p.x;
        if (p.y != null) n.y = p.y;
        results.push({ nodeId: nid, x: n.x, y: n.y });
      }
      figma.commitUndo();
      return { type: request.type, requestId: request.requestId, data: { results } };
    }

    case "resize_nodes": {
      const p = request.params || {};
      const nodeIds = request.nodeIds || [];
      if (nodeIds.length === 0) throw new Error("nodeIds is required");
      const results: any[] = [];
      for (const nid of nodeIds) {
        const n = await figma.getNodeByIdAsync(nid) as any;
        if (!n) { results.push({ nodeId: nid, error: "Node not found" }); continue; }
        if (!("resize" in n)) { results.push({ nodeId: nid, error: "Node does not support resize" }); continue; }
        const w = p.width != null ? p.width : n.width;
        const h = p.height != null ? p.height : n.height;
        n.resize(w, h);
        results.push({ nodeId: nid, width: n.width, height: n.height });
      }
      figma.commitUndo();
      return { type: request.type, requestId: request.requestId, data: { results } };
    }

    case "rename_node": {
      const p = request.params || {};
      const nodeIds = request.nodeIds || [];
      if (nodeIds.length === 0) throw new Error("nodeIds is required");
      const results: any[] = [];
      for (const nid of nodeIds) {
        const n = await figma.getNodeByIdAsync(nid);
        if (!n) { results.push({ nodeId: nid, error: "Node not found" }); continue; }
        n.name = p.name;
        results.push({ id: n.id, name: n.name });
      }
      if (results.every((item) => item.error)) {
        throw new Error(results.map((item) => `${item.nodeId}: ${item.error}`).join("; "));
      }
      return {
        type: request.type,
        requestId: request.requestId,
        data: results.length === 1 ? results[0] : { updated: results.filter((item) => !item.error).length, results },
      };
    }

    case "clone_node": {
      const p = request.params || {};
      const nodeId = request.nodeIds && request.nodeIds[0];
      if (!nodeId) throw new Error("nodeId is required");
      const node = await figma.getNodeByIdAsync(nodeId) as any;
      if (!node) throw new Error(`Node not found: ${nodeId}`);
      const clone = node.clone();
      if (p.parentId) {
        // 先挂载后定位：appendChild 会重算坐标；Auto Layout 父级下坐标由布局决定
        const parent = await getParentNode(p.parentId);
        (parent as any).appendChild(clone);
        if (!isAutoLayoutParent(parent)) {
          if (p.x != null) clone.x = p.x;
          if (p.y != null) clone.y = p.y;
        }
      } else {
        if (p.x != null) clone.x = p.x;
        if (p.y != null) clone.y = p.y;
      }
      figma.commitUndo();
      return {
        type: request.type,
        requestId: request.requestId,
        data: { id: clone.id, name: clone.name, type: clone.type, bounds: getBounds(clone) },
      };
    }

    case "set_opacity": {
      const p = request.params || {};
      const nodeIds = request.nodeIds || [];
      if (nodeIds.length === 0) throw new Error("nodeIds is required");
      const results: any[] = [];
      for (const nid of nodeIds) {
        const n = await figma.getNodeByIdAsync(nid) as any;
        if (!n) { results.push({ nodeId: nid, error: "Node not found" }); continue; }
        if (!("opacity" in n)) { results.push({ nodeId: nid, error: "Node does not support opacity" }); continue; }
        n.opacity = p.opacity;
        results.push({ nodeId: nid, opacity: n.opacity });
      }
      figma.commitUndo();
      return { type: request.type, requestId: request.requestId, data: { results } };
    }

    case "set_corner_radius": {
      const p = request.params || {};
      const nodeIds = request.nodeIds || [];
      if (nodeIds.length === 0) throw new Error("nodeIds is required");
      const results: any[] = [];
      for (const nid of nodeIds) {
        const n = await figma.getNodeByIdAsync(nid) as any;
        if (!n) { results.push({ nodeId: nid, error: "Node not found" }); continue; }
        if (!("cornerRadius" in n)) { results.push({ nodeId: nid, error: "Node does not support corner radius" }); continue; }
        if (p.cornerRadius != null) n.cornerRadius = p.cornerRadius;
        if (p.topLeftRadius != null) n.topLeftRadius = p.topLeftRadius;
        if (p.topRightRadius != null) n.topRightRadius = p.topRightRadius;
        if (p.bottomLeftRadius != null) n.bottomLeftRadius = p.bottomLeftRadius;
        if (p.bottomRightRadius != null) n.bottomRightRadius = p.bottomRightRadius;
        results.push({ nodeId: nid, cornerRadius: n.cornerRadius });
      }
      figma.commitUndo();
      return { type: request.type, requestId: request.requestId, data: { results } };
    }

    case "set_auto_layout": {
      const p = request.params || {};
      const nodeId = request.nodeIds && request.nodeIds[0];
      if (!nodeId) throw new Error("nodeId is required");
      const node = await figma.getNodeByIdAsync(nodeId);
      if (!node) throw new Error(`Node not found: ${nodeId}`);
      if (node.type !== "FRAME") throw new Error(`Node ${nodeId} is not a FRAME`);
      applyAutoLayout(node, p);
      figma.commitUndo();
      return {
        type: request.type,
        requestId: request.requestId,
        data: { id: node.id, name: node.name },
      };
    }

    case "set_visible": {
      const p = request.params || {};
      const nodeIds = request.nodeIds || [];
      if (nodeIds.length === 0) throw new Error("nodeIds is required");
      const results: any[] = [];
      for (const nid of nodeIds) {
        const n = await figma.getNodeByIdAsync(nid) as any;
        if (!n) { results.push({ nodeId: nid, error: "Node not found" }); continue; }
        if (!("visible" in n)) { results.push({ nodeId: nid, error: "Node does not support visibility" }); continue; }
        n.visible = p.visible;
        results.push({ nodeId: nid, visible: n.visible });
      }
      figma.commitUndo();
      return { type: request.type, requestId: request.requestId, data: { results } };
    }

    case "lock_nodes":
    case "unlock_nodes": {
      const nodeIds = request.nodeIds || [];
      if (nodeIds.length === 0) throw new Error("nodeIds is required");
      const locked = request.type === "lock_nodes";
      const results: any[] = [];
      for (const nid of nodeIds) {
        const n = await figma.getNodeByIdAsync(nid) as any;
        if (!n) { results.push({ nodeId: nid, error: "Node not found" }); continue; }
        if (!("locked" in n)) { results.push({ nodeId: nid, error: "Node does not support locking" }); continue; }
        n.locked = locked;
        results.push({ nodeId: nid, locked: n.locked });
      }
      figma.commitUndo();
      return { type: request.type, requestId: request.requestId, data: { results } };
    }

    case "rotate_nodes": {
      const p = request.params || {};
      const nodeIds = request.nodeIds || [];
      if (nodeIds.length === 0) throw new Error("nodeIds is required");
      const results: any[] = [];
      for (const nid of nodeIds) {
        const n = await figma.getNodeByIdAsync(nid) as any;
        if (!n) { results.push({ nodeId: nid, error: "Node not found" }); continue; }
        if (!("rotation" in n)) { results.push({ nodeId: nid, error: "Node does not support rotation" }); continue; }
        n.rotation = p.rotation;
        results.push({ nodeId: nid, rotation: n.rotation });
      }
      figma.commitUndo();
      return { type: request.type, requestId: request.requestId, data: { results } };
    }

    case "reorder_nodes": {
      const p = request.params || {};
      const nodeIds = request.nodeIds || [];
      if (nodeIds.length === 0) throw new Error("nodeIds is required");
      const validOrders = ["bringToFront", "sendToBack", "bringForward", "sendBackward"];
      if (!validOrders.includes(p.order)) {
        throw new Error(`order must be bringToFront, sendToBack, bringForward, or sendBackward`);
      }
      const results: any[] = [];
      for (const nid of nodeIds) {
        const n = await figma.getNodeByIdAsync(nid) as any;
        if (!n) { results.push({ nodeId: nid, error: "Node not found" }); continue; }
        const parent = n.parent as any;
        if (!parent || !("children" in parent)) { results.push({ nodeId: nid, error: "Node has no reorderable parent" }); continue; }
        const siblings = parent.children as any[];
        const currentIndex = siblings.indexOf(n);
        let newIndex: number;
        switch (p.order) {
          case "bringToFront":   newIndex = siblings.length - 1; break;
          case "sendToBack":     newIndex = 0; break;
          case "bringForward":   newIndex = Math.min(currentIndex + 1, siblings.length - 1); break;
          case "sendBackward":   newIndex = Math.max(currentIndex - 1, 0); break;
          default:               newIndex = currentIndex;
        }
        parent.insertChild(newIndex, n);
        results.push({ nodeId: nid, index: newIndex });
      }
      figma.commitUndo();
      return { type: request.type, requestId: request.requestId, data: { results } };
    }

    case "set_blend_mode": {
      const p = request.params || {};
      const nodeIds = request.nodeIds || [];
      if (nodeIds.length === 0) throw new Error("nodeIds is required");
      const results: any[] = [];
      for (const nid of nodeIds) {
        const n = await figma.getNodeByIdAsync(nid) as any;
        if (!n) { results.push({ nodeId: nid, error: "Node not found" }); continue; }
        if (!("blendMode" in n)) { results.push({ nodeId: nid, error: "Node does not support blend mode" }); continue; }
        n.blendMode = p.blendMode;
        results.push({ nodeId: nid, blendMode: n.blendMode });
      }
      figma.commitUndo();
      return { type: request.type, requestId: request.requestId, data: { results } };
    }

    case "set_constraints": {
      const p = request.params || {};
      const nodeIds = request.nodeIds || [];
      if (nodeIds.length === 0) throw new Error("nodeIds is required");
      const results: any[] = [];
      for (const nid of nodeIds) {
        const n = await figma.getNodeByIdAsync(nid) as any;
        if (!n) { results.push({ nodeId: nid, error: "Node not found" }); continue; }
        if (!("constraints" in n)) { results.push({ nodeId: nid, error: "Node does not support constraints" }); continue; }
        const updated: any = { ...n.constraints };
        if (p.horizontal) updated.horizontal = p.horizontal;
        if (p.vertical)   updated.vertical   = p.vertical;
        n.constraints = updated;
        results.push({ nodeId: nid, constraints: n.constraints });
      }
      figma.commitUndo();
      return { type: request.type, requestId: request.requestId, data: { results } };
    }

    case "set_mask": {
      const p = request.params || {};
      const nodeIds = request.nodeIds || [];
      if (nodeIds.length === 0) throw new Error("nodeIds is required");
      const results: any[] = [];
      for (const nid of nodeIds) {
        const n = await figma.getNodeByIdAsync(nid) as any;
        if (!n) { results.push({ nodeId: nid, error: "Node not found" }); continue; }
        if (!("isMask" in n)) { results.push({ nodeId: nid, error: "Node does not support masks" }); continue; }
        // isMask=false 取消遮罩；maskType 仅在开启时生效（ALPHA / VECTOR / LUMINANCE）
        n.isMask = p.isMask !== false;
        if (n.isMask && p.maskType && "maskType" in n) {
          n.maskType = String(p.maskType).toUpperCase();
        }
        results.push({ nodeId: nid, isMask: n.isMask, maskType: n.isMask ? n.maskType : undefined });
      }
      figma.commitUndo();
      return { type: request.type, requestId: request.requestId, data: { results } };
    }

    case "reparent_nodes": {
      const p = request.params || {};
      const nodeIds = request.nodeIds || [];
      if (nodeIds.length === 0) throw new Error("nodeIds is required");
      if (!p.parentId) throw new Error("parentId is required");
      const newParent = await figma.getNodeByIdAsync(p.parentId) as any;
      if (!newParent) throw new Error(`Parent not found: ${p.parentId}`);
      if (!("appendChild" in newParent)) throw new Error(`Node ${p.parentId} cannot contain children`);
      const results: any[] = [];
      for (const nid of nodeIds) {
        const n = await figma.getNodeByIdAsync(nid) as any;
        if (!n) { results.push({ nodeId: nid, error: "Node not found" }); continue; }
        try {
          newParent.appendChild(n);
          results.push({ nodeId: nid, newParentId: p.parentId });
        } catch (e: any) {
          results.push({ nodeId: nid, error: e.message });
        }
      }
      figma.commitUndo();
      return { type: request.type, requestId: request.requestId, data: { results } };
    }

    case "batch_rename_nodes": {
      const p = request.params || {};
      const nodeIds = request.nodeIds || [];
      if (nodeIds.length === 0) throw new Error("nodeIds is required");
      const results: any[] = [];
      for (const nid of nodeIds) {
        const n = await figma.getNodeByIdAsync(nid) as any;
        if (!n) { results.push({ nodeId: nid, error: "Node not found" }); continue; }
        const oldName: string = n.name;
        let newName = oldName;
        if (p.find !== undefined && p.replace !== undefined) {
          if (p.useRegex) {
            try {
              const regex = new RegExp(p.find, p.regexFlags || "g");
              newName = newName.replace(regex, p.replace);
            } catch (e: any) {
              results.push({ nodeId: nid, error: `Invalid regex: ${e.message}` }); continue;
            }
          } else {
            newName = newName.split(p.find).join(p.replace);
          }
        }
        if (p.prefix) newName = p.prefix + newName;
        if (p.suffix) newName = newName + p.suffix;
        n.name = newName;
        results.push({ nodeId: nid, oldName, name: newName });
      }
      figma.commitUndo();
      return { type: request.type, requestId: request.requestId, data: { results } };
    }

    case "find_replace_text": {
      const p = request.params || {};
      if (!p.find) throw new Error("find is required");
      if (p.replace === undefined) throw new Error("replace is required");
      const rootNodeId = request.nodeIds && request.nodeIds[0];
      const root: any = rootNodeId
        ? await figma.getNodeByIdAsync(rootNodeId)
        : figma.currentPage;
      if (!root) throw new Error(`Root node not found: ${rootNodeId}`);
      const textNodes: any[] = [];
      const collect = (node: any) => {
        if (node.type === "TEXT") textNodes.push(node);
        if ("children" in node) (node.children as any[]).forEach(collect);
      };
      collect(root);
      const results: any[] = [];
      for (const tn of textNodes) {
        const originalText: string = tn.characters;
        let newText: string;
        if (p.useRegex) {
          try {
            const regex = new RegExp(p.find, p.regexFlags || "g");
            newText = originalText.replace(regex, p.replace);
          } catch (e: any) {
            results.push({ nodeId: tn.id, nodeName: tn.name, error: `Invalid regex: ${e.message}` });
            continue;
          }
        } else {
          newText = originalText.split(p.find).join(p.replace);
        }
        if (newText !== originalText) {
          const fontName = typeof tn.fontName === "symbol"
            ? { family: "Inter", style: "Regular" }
            : tn.fontName;
          await figma.loadFontAsync(fontName);
          tn.characters = newText;
          results.push({ nodeId: tn.id, nodeName: tn.name, oldText: originalText, newText });
        }
      }
      figma.commitUndo();
      const successCount = results.filter((r: any) => !r.error).length;
      return { type: request.type, requestId: request.requestId, data: { replaced: successCount, results } };
    }

    default:
      return null;
  }
};
