import { makeSolidPaint, hexToRgb, normalizePaints, normalizePaintItem } from "./write-helpers";

export const handleWriteStyleRequest = async (request: any) => {
  switch (request.type) {
    case "create_paint_style": {
      const p = request.params || {};
      if (!p.name) throw new Error("name is required");
      // 支持纯色 / 渐变 / 多填充三种预设
      const paints: Paint[] = Array.isArray(p.paints)
        ? normalizePaints(p.paints)
        : Array.isArray(p.gradientStops)
          ? [normalizePaintItem({
              type: String(p.type || "GRADIENT_LINEAR").toUpperCase(),
              gradientStops: p.gradientStops,
              angle: p.angle,
              gradientTransform: p.gradientTransform,
              opacity: p.opacity,
            })]
          : p.color
            ? [makeSolidPaint(p.color)]
            : [];
      if (paints.length === 0) {
        throw new Error("color / gradientStops / paints is required");
      }
      const existing = (await figma.getLocalPaintStylesAsync()).find(s => s.name === p.name);
      if (existing) {
        return { type: request.type, requestId: request.requestId, data: { id: existing.id, name: existing.name } };
      }
      const style = figma.createPaintStyle();
      style.name = p.name;
      style.paints = paints;
      if (p.description) style.description = p.description;
      figma.commitUndo();
      return {
        type: request.type,
        requestId: request.requestId,
        data: { id: style.id, name: style.name },
      };
    }

    case "create_text_style": {
      const p = request.params || {};
      if (!p.name) throw new Error("name is required");
      const existing = (await figma.getLocalTextStylesAsync()).find(s => s.name === p.name);
      if (existing) {
        return { type: request.type, requestId: request.requestId, data: { id: existing.id, name: existing.name } };
      }
      const family = p.fontFamily || "Inter";
      const fontStyle = p.fontStyle || "Regular";
      await figma.loadFontAsync({ family, style: fontStyle });
      const style = figma.createTextStyle();
      style.name = p.name;
      style.fontName = { family, style: fontStyle };
      if (p.fontSize != null) style.fontSize = Number(p.fontSize);
      if (p.description) style.description = p.description;
      if (p.textDecoration && p.textDecoration !== "NONE") {
        style.textDecoration = p.textDecoration;
      }
      if (p.lineHeightValue != null) {
        style.lineHeight = { value: Number(p.lineHeightValue), unit: p.lineHeightUnit || "PIXELS" };
      }
      if (p.letterSpacingValue != null) {
        style.letterSpacing = { value: Number(p.letterSpacingValue), unit: p.letterSpacingUnit || "PIXELS" };
      }
      if (p.paragraphSpacing != null) {
        style.paragraphSpacing = Number(p.paragraphSpacing);
      }
      if (p.textCase) {
        style.textCase = String(p.textCase).toUpperCase() as TextCase;
      }
      figma.commitUndo();
      return {
        type: request.type,
        requestId: request.requestId,
        data: { id: style.id, name: style.name },
      };
    }

    case "create_effect_style": {
      const p = request.params || {};
      if (!p.name) throw new Error("name is required");
      const existing = (await figma.getLocalEffectStylesAsync()).find(s => s.name === p.name);
      if (existing) {
        return { type: request.type, requestId: request.requestId, data: { id: existing.id, name: existing.name } };
      }
      const effectType = p.type || "DROP_SHADOW";
      let effect: Effect;
      if (effectType === "LAYER_BLUR") {
        effect = { type: "LAYER_BLUR", blurType: "NORMAL", radius: Number(p.radius ?? 4), visible: true };
      } else if (effectType === "BACKGROUND_BLUR") {
        effect = { type: "BACKGROUND_BLUR", blurType: "NORMAL", radius: Number(p.radius ?? 4), visible: true };
      } else {
        // DROP_SHADOW or INNER_SHADOW
        const { r, g, b, a } = hexToRgb(p.color || "#000000");
        const alpha = p.opacity != null ? Number(p.opacity) : (a !== 1 ? a : 0.25);
        effect = {
          type: effectType as "DROP_SHADOW" | "INNER_SHADOW",
          color: { r, g, b, a: alpha },
          offset: { x: Number(p.offsetX ?? 0), y: Number(p.offsetY ?? 4) },
          radius: Number(p.radius ?? 8),
          spread: Number(p.spread ?? 0),
          visible: true,
          blendMode: "NORMAL",
        };
      }
      const style = figma.createEffectStyle();
      style.name = p.name;
      style.effects = Array.isArray(p.effects) && p.effects.length > 0 ? p.effects : [effect];
      if (p.description) style.description = p.description;
      figma.commitUndo();
      return {
        type: request.type,
        requestId: request.requestId,
        data: { id: style.id, name: style.name },
      };
    }

    case "create_grid_style": {
      const p = request.params || {};
      if (!p.name) throw new Error("name is required");
      const existing = (await figma.getLocalGridStylesAsync()).find(s => s.name === p.name);
      if (existing) {
        return { type: request.type, requestId: request.requestId, data: { id: existing.id, name: existing.name } };
      }
      const pattern = p.pattern || "GRID";
      let grid: LayoutGrid;
      if (pattern === "COLUMNS" || pattern === "ROWS") {
        grid = {
          pattern,
          count: Number(p.count ?? 12),
          gutterSize: Number(p.gutterSize ?? 16),
          offset: Number(p.offset ?? 0),
          alignment: p.alignment || "STRETCH",
          visible: true,
        };
      } else {
        // GRID
        const { r, g, b, a } = hexToRgb(p.color || "#FF0000");
        grid = {
          pattern: "GRID",
          sectionSize: Number(p.sectionSize ?? 8),
          visible: true,
          color: { r, g, b, a: p.opacity != null ? Number(p.opacity) : (a !== 1 ? a : 0.1) },
        };
      }
      const style = figma.createGridStyle();
      style.name = p.name;
      style.layoutGrids = [grid];
      if (p.description) style.description = p.description;
      figma.commitUndo();
      return {
        type: request.type,
        requestId: request.requestId,
        data: { id: style.id, name: style.name },
      };
    }

    case "update_paint_style": {
      const p = request.params || {};
      if (!p.styleId) throw new Error("styleId is required");
      const style = await figma.getStyleByIdAsync(p.styleId);
      if (!style) throw new Error(`Style not found: ${p.styleId}`);
      if (style.type !== "PAINT") throw new Error(`Style ${p.styleId} is not a paint style`);
      if (p.name) style.name = p.name;
      if (Array.isArray(p.paints)) {
        (style as PaintStyle).paints = normalizePaints(p.paints);
      } else if (Array.isArray(p.gradientStops)) {
        (style as PaintStyle).paints = [normalizePaintItem({
          type: String(p.type || "GRADIENT_LINEAR").toUpperCase(),
          gradientStops: p.gradientStops,
          gradientTransform: p.gradientTransform,
          opacity: p.opacity,
        })];
      } else if (p.color) {
        (style as PaintStyle).paints = [makeSolidPaint(p.color)];
      }
      if (p.description != null) style.description = p.description;
      figma.commitUndo();
      return {
        type: request.type,
        requestId: request.requestId,
        data: { id: style.id, name: style.name },
      };
    }

    case "delete_style": {
      const p = request.params || {};
      if (!p.styleId) throw new Error("styleId is required");
      const style = await figma.getStyleByIdAsync(p.styleId);
      if (!style) throw new Error(`Style not found: ${p.styleId}`);
      style.remove();
      figma.commitUndo();
      return {
        type: request.type,
        requestId: request.requestId,
        data: { styleId: p.styleId, deleted: true },
      };
    }

    case "apply_style_to_node": {
      const p = request.params || {};
      const nodeIds = request.nodeIds || [];
      if (nodeIds.length === 0) throw new Error("nodeIds is required");
      if (!p.styleId) throw new Error("styleId is required");
      const style = await figma.getStyleByIdAsync(p.styleId);
      if (!style) throw new Error(`Style not found: ${p.styleId}`);

      // 同一套样式批量应用到多个图层
      const results: any[] = [];
      for (const nid of nodeIds) {
        const node = await figma.getNodeByIdAsync(nid);
        if (!node) { results.push({ nodeId: nid, error: "Node not found" }); continue; }
        const n = node as any;
        try {
          switch (style.type) {
            case "PAINT": {
              const target = p.target || "fill";
              if (target === "stroke") {
                if (!("strokeStyleId" in node)) throw new Error("Node does not support stroke styles");
                await n.setStrokeStyleIdAsync(p.styleId);
              } else {
                if (!("fillStyleId" in node)) throw new Error("Node does not support fill styles");
                await n.setFillStyleIdAsync(p.styleId);
              }
              break;
            }
            case "TEXT":
              if (!("textStyleId" in node)) throw new Error("Node does not support text styles");
              await n.setTextStyleIdAsync(p.styleId);
              break;
            case "EFFECT":
              if (!("effectStyleId" in node)) throw new Error("Node does not support effect styles");
              await n.setEffectStyleIdAsync(p.styleId);
              break;
            case "GRID":
              if (!("gridStyleId" in node)) throw new Error("Node does not support grid styles");
              await n.setGridStyleIdAsync(p.styleId);
              break;
            default:
              throw new Error(`Unknown style type: ${(style as any).type}`);
          }
          results.push({ id: n.id, name: n.name, styleId: p.styleId, styleType: style.type });
        } catch (e) {
          results.push({ nodeId: nid, error: e instanceof Error ? e.message : String(e) });
        }
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

    case "set_effects": {
      const p = request.params || {};
      const nodeIds = request.nodeIds || [];
      if (nodeIds.length === 0) throw new Error("nodeIds is required");
      if (!Array.isArray(p.effects)) throw new Error("effects array is required");
      const effects: Effect[] = p.effects.map((e: any) => {
        switch (e.type) {
          case "DROP_SHADOW":
          case "INNER_SHADOW": {
            const { r, g, b } = hexToRgb(e.color || "#000000");
            return {
              type: e.type as "DROP_SHADOW" | "INNER_SHADOW",
              color: { r, g, b, a: e.opacity != null ? Number(e.opacity) : 0.25 },
              offset: { x: Number(e.offsetX ?? 0), y: Number(e.offsetY ?? 4) },
              radius: Number(e.radius ?? 4),
              spread: Number(e.spread ?? 0),
              visible: e.visible ?? true,
              blendMode: (e.blendMode || "NORMAL") as BlendMode,
            } as DropShadowEffect;
          }
          case "LAYER_BLUR":
          case "BACKGROUND_BLUR":
            return {
              type: e.type as "LAYER_BLUR" | "BACKGROUND_BLUR",
              radius: Number(e.radius ?? 4),
              visible: e.visible ?? true,
            } as BlurEffect;
          case "NOISE": {
            const noiseType = (e.noiseType || "MONOTONE") as "MONOTONE" | "DUOTONE" | "MULTITONE";
            const { r, g, b } = hexToRgb(e.color || "#000000");
            const colorAlpha = e.colorOpacity != null ? Number(e.colorOpacity) : 1;
            const noise: any = {
              type: "NOISE",
              noiseType,
              noiseSize: Number(e.noiseSize ?? 2),
              density: Number(e.density ?? 0.5),
              color: { r, g, b, a: colorAlpha },
              visible: e.visible ?? true,
              blendMode: (e.blendMode || "NORMAL") as BlendMode,
            };
            if (noiseType === "DUOTONE") {
              const sc = hexToRgb(e.secondaryColor || "#ffffff");
              noise.secondaryColor = { r: sc.r, g: sc.g, b: sc.b, a: e.secondaryColorOpacity != null ? Number(e.secondaryColorOpacity) : 1 };
            }
            if (noiseType === "MULTITONE") {
              noise.opacity = e.opacity != null ? Number(e.opacity) : 0.5;
            }
            return noise as Effect;
          }
          default:
            throw new Error(`Unknown effect type: ${e.type}. Must be DROP_SHADOW, INNER_SHADOW, LAYER_BLUR, BACKGROUND_BLUR, or NOISE`);
        }
      });
      // 一次调用可批量作用于多个图层
      const results: any[] = [];
      for (const nid of nodeIds) {
        const n = await figma.getNodeByIdAsync(nid) as any;
        if (!n) { results.push({ nodeId: nid, error: "Node not found" }); continue; }
        if (!("effects" in n)) { results.push({ nodeId: nid, error: "Node does not support effects" }); continue; }
        n.effects = JSON.parse(JSON.stringify(effects));
        results.push({ id: n.id, name: n.name, effectCount: effects.length });
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

    case "bind_variable_to_node": {
      const p = request.params || {};
      const nodeId = request.nodeIds && request.nodeIds[0];
      if (!nodeId) throw new Error("nodeId is required");
      if (!p.field) throw new Error("field is required");
      const node = await figma.getNodeByIdAsync(nodeId) as any;
      if (!node) throw new Error(`Node not found: ${nodeId}`);
      // 校验字段所依托的属性是否存在
      if (p.field === "fillColor" && !("fills" in node)) {
        throw new Error(`Node ${nodeId} does not support fills`);
      }
      if (p.field === "strokeColor" && !("strokes" in node)) {
        throw new Error(`Node ${nodeId} does not support strokes`);
      }
      if (p.field === "effect" && !("effects" in node)) {
        throw new Error(`Node ${nodeId} does not support effects`);
      }
      if (p.field === "layoutGrid" && !("layoutGrids" in node)) {
        throw new Error(`Node ${nodeId} does not support layout grids`);
      }
      // variableId 可省略或为 null：配合 unbind 表示解绑
      let variable: Variable | null = null;
      if (p.variableId != null && p.unbind !== true) {
        variable = await figma.variables.getVariableByIdAsync(p.variableId);
        if (!variable) throw new Error(`Variable not found: ${p.variableId}`);
      }
      if (p.field === "fillColor") {
        const fills = [...(node.fills as Paint[])];
        const base = fills.length > 0 ? fills[0] : makeSolidPaint("#000000");
        const paint = figma.variables.setBoundVariableForPaint(base as SolidPaint, "color", variable);
        node.fills = [paint, ...fills.slice(1)];
      } else if (p.field === "strokeColor") {
        const strokes = [...(node.strokes as Paint[])];
        const base = strokes.length > 0 ? strokes[0] : makeSolidPaint("#000000");
        const paint = figma.variables.setBoundVariableForPaint(base as SolidPaint, "color", variable);
        node.strokes = [paint, ...strokes.slice(1)];
      } else if (p.field === "effect") {
        const index = Number(p.effectIndex ?? 0);
        const effects = [...(node.effects as Effect[])];
        if (!effects[index]) throw new Error(`Node ${nodeId} has no effect at index ${index}`);
        const effectField = (p.effectField || "color") as VariableBindableEffectField;
        const validFields = ["color", "radius", "spread", "offsetX", "offsetY"];
        if (!validFields.includes(effectField)) {
          throw new Error(`effectField must be one of ${validFields.join(", ")}`);
        }
        effects[index] = figma.variables.setBoundVariableForEffect(effects[index], effectField, variable);
        node.effects = effects;
      } else if (p.field === "layoutGrid") {
        const index = Number(p.gridIndex ?? 0);
        const grids = [...(node.layoutGrids as LayoutGrid[])];
        if (!grids[index]) throw new Error(`Node ${nodeId} has no layout grid at index ${index}`);
        const gridField = (p.gridField || "sectionSize") as VariableBindableLayoutGridField;
        const validFields = ["sectionSize", "count", "offset", "gutterSize"];
        if (!validFields.includes(gridField)) {
          throw new Error(`gridField must be one of ${validFields.join(", ")}`);
        }
        grids[index] = figma.variables.setBoundVariableForLayoutGrid(grids[index], gridField, variable);
        node.layoutGrids = grids;
      } else {
        if (!(p.field in node)) throw new Error(`Node ${nodeId} does not have field: ${p.field}`);
        node.setBoundVariable(p.field, variable);
      }
      figma.commitUndo();
      return {
        type: request.type,
        requestId: request.requestId,
        data: {
          id: node.id,
          name: node.name,
          field: p.field,
          variableId: variable?.id ?? null,
          bound: !!variable,
        },
      };
    }

    case "import_style_by_key": {
      const p = request.params || {};
      if (!p.key) throw new Error("key is required");
      const style = await figma.importStyleByKeyAsync(String(p.key));
      figma.commitUndo();
      return {
        type: request.type,
        requestId: request.requestId,
        data: { id: style.id, name: style.name, type: style.type, key: style.key },
      };
    }

    case "reorder_styles": {
      const p = request.params || {};
      const validTypes = ["PAINT", "TEXT", "EFFECT", "GRID"];
      const styleType = p.type != null ? String(p.type).toUpperCase() : "";
      if (!styleType || !validTypes.includes(styleType)) {
        throw new Error("type is required: PAINT, TEXT, EFFECT, or GRID");
      }
      if (!p.styleId) throw new Error("styleId is required");
      const target = await figma.getStyleByIdAsync(p.styleId);
      if (!target) throw new Error(`Style not found: ${p.styleId}`);
      if (target.type !== styleType) {
        throw new Error(`Style ${p.styleId} is not a ${styleType} style`);
      }
      let reference: BaseStyle | null = null;
      if (p.beforeStyleId) {
        reference = await figma.getStyleByIdAsync(String(p.beforeStyleId));
        if (!reference) throw new Error(`Style not found: ${p.beforeStyleId}`);
      }
      switch (styleType) {
        case "PAINT":
          figma.moveLocalPaintStyleAfter(target as PaintStyle, reference as PaintStyle | null);
          break;
        case "TEXT":
          figma.moveLocalTextStyleAfter(target as TextStyle, reference as TextStyle | null);
          break;
        case "EFFECT":
          figma.moveLocalEffectStyleAfter(target as EffectStyle, reference as EffectStyle | null);
          break;
        case "GRID":
          figma.moveLocalGridStyleAfter(target as GridStyle, reference as GridStyle | null);
          break;
      }
      figma.commitUndo();
      return {
        type: request.type,
        requestId: request.requestId,
        data: {
          id: target.id,
          name: target.name,
          type: target.type,
          beforeStyleId: p.beforeStyleId ?? null,
        },
      };
    }

    default:
      return null;
  }
};
