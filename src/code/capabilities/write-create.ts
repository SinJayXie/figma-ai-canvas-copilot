import { getBounds } from "./serializers";
import { makeSolidPaint, getParentNode, base64ToBytes, applyAutoLayout, appendAndPlace, normalizePaints, isNoFill } from "./write-helpers";

/** UTF-8 解码（沙箱不保证有 TextDecoder，用于 base64 SVG） */
function utf8Decode(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; ) {
    const b0 = bytes[i++];
    if (b0 < 0x80) out += String.fromCharCode(b0);
    else if (b0 < 0xe0) out += String.fromCharCode(((b0 & 0x1f) << 6) | (bytes[i++] & 0x3f));
    else if (b0 < 0xf0) {
      out += String.fromCharCode(((b0 & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f));
    } else {
      const cp =
        ((b0 & 0x07) << 18) |
        ((bytes[i++] & 0x3f) << 12) |
        ((bytes[i++] & 0x3f) << 6) |
        (bytes[i++] & 0x3f);
      const v = cp - 0x10000;
      out += String.fromCharCode(0xd800 + (v >> 10), 0xdc00 + (v & 0x3ff));
    }
  }
  return out;
}

export const handleWriteCreateRequest = async (request: any) => {
  switch (request.type) {
    case "create_frame": {
      const p = request.params || {};
      const parent = await getParentNode(p.parentId);
      const frame = figma.createFrame();
      frame.resize(p.width || 100, p.height || 100);
      if (p.name) frame.name = p.name;
      // 未指定或显式透明时不填充，避免 Figma 默认白底遮挡背景
      frame.fills = p.fillColor && !isNoFill(p.fillColor) ? [makeSolidPaint(p.fillColor)] : [];
      applyAutoLayout(frame, p);
      // 先挂载后定位：Auto Layout 父级下 x/y 会被忽略
      appendAndPlace(parent, frame, p.x, p.y);
      figma.commitUndo();
      return {
        type: request.type,
        requestId: request.requestId,
        data: { id: frame.id, name: frame.name, type: frame.type, bounds: getBounds(frame) },
      };
    }

    case "create_rectangle": {
      const p = request.params || {};
      const parent = await getParentNode(p.parentId);
      const rect = figma.createRectangle();
      rect.resize(p.width || 100, p.height || 100);
      if (p.name) rect.name = p.name;
      if (p.fillColor) rect.fills = [makeSolidPaint(p.fillColor)];
      if (p.cornerRadius != null) rect.cornerRadius = p.cornerRadius;
      appendAndPlace(parent, rect, p.x, p.y);
      figma.commitUndo();
      return {
        type: request.type,
        requestId: request.requestId,
        data: { id: rect.id, name: rect.name, type: rect.type, bounds: getBounds(rect) },
      };
    }

    case "create_ellipse": {
      const p = request.params || {};
      const parent = await getParentNode(p.parentId);
      const ellipse = figma.createEllipse();
      ellipse.resize(p.width || 100, p.height || 100);
      if (p.name) ellipse.name = p.name;
      if (p.fillColor) ellipse.fills = [makeSolidPaint(p.fillColor)];
      appendAndPlace(parent, ellipse, p.x, p.y);
      figma.commitUndo();
      return {
        type: request.type,
        requestId: request.requestId,
        data: { id: ellipse.id, name: ellipse.name, type: ellipse.type, bounds: getBounds(ellipse) },
      };
    }

    case "create_text": {
      const p = request.params || {};
      const parent = await getParentNode(p.parentId);
      const fontFamily = p.fontFamily || "Inter";
      const fontStyle = p.fontStyle || "Regular";
      await figma.loadFontAsync({ family: fontFamily, style: fontStyle });
      const textNode = figma.createText();
      textNode.fontName = { family: fontFamily, style: fontStyle };
      if (p.fontSize != null) textNode.fontSize = Number(p.fontSize);
      textNode.characters = p.text || "";
      if (p.name) textNode.name = p.name;
      if (p.fillColor) textNode.fills = [makeSolidPaint(p.fillColor)];
      appendAndPlace(parent, textNode, p.x, p.y);
      figma.commitUndo();
      return {
        type: request.type,
        requestId: request.requestId,
        data: { id: textNode.id, name: textNode.name, type: textNode.type, bounds: getBounds(textNode) },
      };
    }

    case "import_image": {
      const p = request.params || {};
      if (!p.imageData) throw new Error("imageData (base64) is required");
      const parent = await getParentNode(p.parentId);
      const bytes = base64ToBytes(p.imageData);
      const image = figma.createImage(bytes);
      const rect = figma.createRectangle();
      rect.resize(p.width || 200, p.height || 200);
      if (p.name) rect.name = p.name;
      rect.fills = [{ type: "IMAGE", imageHash: image.hash, scaleMode: p.scaleMode || "FILL" }];
      appendAndPlace(parent, rect, p.x, p.y);
      figma.commitUndo();
      return {
        type: request.type,
        requestId: request.requestId,
        data: { id: rect.id, name: rect.name, type: rect.type, bounds: getBounds(rect) },
      };
    }

    case "create_image_from_url": {
      const p = request.params || {};
      const url = typeof p.url === "string" ? p.url.trim() : "";
      if (!/^https?:\/\//i.test(url)) throw new Error("url 必填且必须以 http:// 或 https:// 开头");
      const image = await figma.createImageAsync(url);

      // 尺寸优先取显式宽高，缺省时按原图尺寸
      let width = p.width != null ? Number(p.width) : undefined;
      let height = p.height != null ? Number(p.height) : undefined;
      if (width == null || height == null) {
        const size = await image.getSizeAsync();
        if (width == null) width = size.width;
        if (height == null) height = size.height;
      }

      const rect = figma.createRectangle();
      rect.resize(Math.max(0.01, width), Math.max(0.01, height));
      if (p.name) rect.name = String(p.name);
      rect.fills = [{ type: "IMAGE", imageHash: image.hash, scaleMode: p.scaleMode || "FILL" }];
      const parent = await getParentNode(p.parentId);
      appendAndPlace(parent, rect, p.x, p.y);
      figma.commitUndo();
      return {
        type: request.type,
        requestId: request.requestId,
        data: {
          id: rect.id,
          name: rect.name,
          type: rect.type,
          bounds: getBounds(rect),
          imageHash: image.hash,
        },
      };
    }

    case "import_svg": {
      const p = request.params || {};
      let svg = typeof p.svg === "string" ? p.svg : "";
      if (!svg && typeof p.svgData === "string") {
        try {
          svg = utf8Decode(base64ToBytes(p.svgData));
        } catch {
          svg = "";
        }
      }
      if (!svg.trim()) throw new Error("svg（字符串）或 svgData（base64）必填");
      if (!/<svg[\s>]/i.test(svg)) throw new Error("svg 内容必须是完整的 <svg> 字符串");

      // 目标节点：parentId / target / parent 任一即可；都省略时回退到当前选中的容器
      const parentRef =
        p.parentId ??
        p.target ??
        p.parent ??
        (figma.currentPage.selection.length === 1 &&
        "appendChild" in figma.currentPage.selection[0]
          ? figma.currentPage.selection[0].id
          : undefined);
      const parent = await getParentNode(typeof parentRef === "string" ? parentRef : undefined);
      const node = figma.createNodeFromSvg(svg);
      if (p.name) node.name = String(p.name);

      // 等比缩放：只给宽或高时保持比例；两者都给则按指定尺寸
      if (p.width != null && p.height != null) {
        node.resize(Math.max(0.01, Number(p.width)), Math.max(0.01, Number(p.height)));
      } else if (p.width != null) {
        const ratio = Number(p.width) / (node.width || 1);
        node.resize(Math.max(0.01, Number(p.width)), Math.max(0.01, node.height * ratio));
      } else if (p.height != null) {
        const ratio = Number(p.height) / (node.height || 1);
        node.resize(Math.max(0.01, node.width * ratio), Math.max(0.01, Number(p.height)));
      }

      appendAndPlace(parent, node, p.x, p.y);
      figma.commitUndo();
      return {
        type: request.type,
        requestId: request.requestId,
        data: {
          id: node.id,
          name: node.name,
          type: node.type,
          bounds: getBounds(node),
          childCount: node.children.length,
        },
      };
    }

    case "create_component": {
      const p = request.params || {};
      const nodeId = request.nodeIds && request.nodeIds[0];
      if (!nodeId) throw new Error("nodeId is required");
      const node = await figma.getNodeByIdAsync(nodeId) as any;
      if (!node) throw new Error(`Node not found: ${nodeId}`);
      if (node.type !== "FRAME") throw new Error(`Node ${nodeId} is not a FRAME — only frames can be converted to components`);

      // 原生转换会保留子节点、样式与位置，无需手工复制
      const component = figma.createComponentFromNode(node as FrameNode);
      if (p.name) component.name = String(p.name);
      figma.commitUndo();
      return {
        type: request.type,
        requestId: request.requestId,
        data: { id: component.id, name: component.name, type: component.type, bounds: getBounds(component) },
      };
    }

    case "create_section": {
      const p = request.params || {};
      const section = figma.createSection();
      if (p.name) section.name = p.name;
      if (p.x != null) section.x = p.x;
      if (p.y != null) section.y = p.y;
      if (p.width != null || p.height != null) {
        section.resizeWithoutConstraints(p.width || section.width, p.height || section.height);
      }
      figma.commitUndo();
      return {
        type: request.type,
        requestId: request.requestId,
        data: { id: section.id, name: section.name, type: section.type, bounds: getBounds(section) },
      };
    }

    case "create_line": {
      const p = request.params || {};
      const parent = await getParentNode(p.parentId);
      const line = figma.createLine();
      const width = p.width != null ? Number(p.width) : 100;
      // 线条高度恒为 0，靠描边呈现
      line.resize(Math.max(0.01, width), 0);
      line.strokes = [makeSolidPaint(p.strokeColor ?? p.color ?? "#000000")];
      const weight = p.strokeWeight != null ? Number(p.strokeWeight) : 1;
      if (Number.isFinite(weight) && weight > 0) line.strokeWeight = weight;
      if (p.strokeCap) {
        const cap = String(p.strokeCap).toUpperCase();
        if (cap !== "NONE" && cap !== "ROUND" && cap !== "SQUARE") {
          throw new Error(`strokeCap 必须是 NONE / ROUND / SQUARE，收到：${p.strokeCap}`);
        }
        line.strokeCap = cap as any;
      }
      if (p.name) line.name = String(p.name);
      appendAndPlace(parent, line, p.x, p.y);
      figma.commitUndo();
      return {
        type: request.type,
        requestId: request.requestId,
        data: { id: line.id, name: line.name, type: line.type, bounds: getBounds(line) },
      };
    }

    case "create_vector": {
      const p = request.params || {};
      // 路径归一化：字符串视为 svg path data，对象取其 windingRule / data
      const normalizedPaths = (Array.isArray(p.paths) ? p.paths : [])
        .map((item: any) => {
          if (typeof item === "string") return { windingRule: "NONZERO", data: item };
          if (!item || typeof item !== "object") return null;
          const rule = typeof item.windingRule === "string" ? item.windingRule.toUpperCase() : "NONZERO";
          return {
            windingRule: rule === "EVENODD" ? "EVENODD" : "NONZERO",
            data: typeof item.data === "string" ? item.data : "",
          };
        })
        .filter((item: any) => !!item && item.data.trim() !== "");
      if (!normalizedPaths.length) throw new Error("paths 至少需要一个有效路径");

      const node = figma.createVector() as any;
      node.vectorPaths = normalizedPaths;
      if (p.width != null && p.height != null) {
        node.resize(Math.max(0.01, Number(p.width)), Math.max(0.01, Number(p.height)));
      }
      if (p.fills != null) node.fills = normalizePaints(p.fills);
      else if (p.fillColor != null || p.color != null) node.fills = [makeSolidPaint(p.fillColor ?? p.color)];
      if (p.strokeColor != null || p.stroke != null) {
        node.strokes = [makeSolidPaint(p.strokeColor ?? p.stroke)];
      }
      const weight = p.strokeWeight != null ? Number(p.strokeWeight) : 0;
      if (Number.isFinite(weight) && weight > 0) node.strokeWeight = weight;
      if (p.name) node.name = String(p.name);

      const parent = await getParentNode(p.parentId);
      appendAndPlace(parent, node, p.x, p.y);
      figma.commitUndo();
      return {
        type: request.type,
        requestId: request.requestId,
        data: { id: node.id, name: node.name, type: node.type, bounds: getBounds(node) },
      };
    }

    case "create_slice": {
      const p = request.params || {};
      const width = Number(p.width);
      const height = Number(p.height);
      if (!(width > 0) || !(height > 0)) throw new Error("create_slice 需要正数 width 与 height");
      const parent = await getParentNode(p.parentId);
      const slice = figma.createSlice();
      slice.resize(Math.max(0.01, width), Math.max(0.01, height));
      if (p.name) slice.name = String(p.name);
      appendAndPlace(parent, slice, p.x, p.y);
      figma.commitUndo();
      return {
        type: request.type,
        requestId: request.requestId,
        data: { id: slice.id, name: slice.name, type: slice.type, bounds: getBounds(slice) },
      };
    }

    default:
      return null;
  }
};
