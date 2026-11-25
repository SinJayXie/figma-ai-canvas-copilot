import { hexToRgb } from "./write-helpers";

// 变量作用域合法值（与 VariableScope 保持一致）
const VARIABLE_SCOPES = [
  "ALL_SCOPES",
  "TEXT_CONTENT",
  "CORNER_RADIUS",
  "WIDTH_HEIGHT",
  "GAP",
  "ALL_FILLS",
  "FRAME_FILL",
  "SHAPE_FILL",
  "TEXT_FILL",
  "STROKE_COLOR",
  "STROKE_FLOAT",
  "EFFECT_FLOAT",
  "EFFECT_COLOR",
  "OPACITY",
  "COLOR_OPACITY",
  "FONT_FAMILY",
  "FONT_STYLE",
  "FONT_WEIGHT",
  "FONT_SIZE",
  "LINE_HEIGHT",
  "LETTER_SPACING",
  "PARAGRAPH_SPACING",
  "PARAGRAPH_INDENT",
];

const parseVariableValue = (type: string, value: any): VariableValue => {
  if (type === "COLOR") {
    if (typeof value === "string") {
      const { r, g, b, a } = hexToRgb(value);
      return { r, g, b, a };
    }
    return value as RGBA;
  }
  if (type === "FLOAT") return typeof value === "number" ? value : parseFloat(String(value));
  if (type === "BOOLEAN") return value === true || value === "true";
  return String(value); // STRING
};

export const handleWriteVariableRequest = async (request: any) => {
  switch (request.type) {
    case "create_variable_collection": {
      const p = request.params || {};
      if (!p.name) throw new Error("name is required");
      const collection = figma.variables.createVariableCollection(p.name);
      if (p.initialModeName && collection.modes.length > 0) {
        collection.renameMode(collection.modes[0].modeId, p.initialModeName);
      }
      figma.commitUndo();
      return {
        type: request.type,
        requestId: request.requestId,
        data: {
          id: collection.id,
          name: collection.name,
          modes: collection.modes.map((m) => ({ modeId: m.modeId, name: m.name })),
        },
      };
    }

    case "add_variable_mode": {
      const p = request.params || {};
      if (!p.collectionId) throw new Error("collectionId is required");
      if (!p.modeName) throw new Error("modeName is required");
      const collection = await figma.variables.getVariableCollectionByIdAsync(p.collectionId);
      if (!collection) throw new Error(`Collection not found: ${p.collectionId}`);
      const modeId = collection.addMode(p.modeName);
      figma.commitUndo();
      return {
        type: request.type,
        requestId: request.requestId,
        data: { collectionId: p.collectionId, modeId, modeName: p.modeName },
      };
    }

    case "create_variable": {
      const p = request.params || {};
      if (!p.name) throw new Error("name is required");
      if (!p.collectionId) throw new Error("collectionId is required");
      const validTypes = ["COLOR", "FLOAT", "STRING", "BOOLEAN"];
      if (!p.type || !validTypes.includes(p.type)) {
        throw new Error("type is required: COLOR, FLOAT, STRING, or BOOLEAN");
      }
      const collection = await figma.variables.getVariableCollectionByIdAsync(p.collectionId);
      if (!collection) throw new Error(`Collection not found: ${p.collectionId}`);
      const variable = figma.variables.createVariable(p.name, collection, p.type as VariableResolvedDataType);
      if (p.value != null && collection.modes.length > 0) {
        const modeId = collection.modes[0].modeId;
        variable.setValueForMode(modeId, parseVariableValue(p.type, p.value));
      }
      figma.commitUndo();
      return {
        type: request.type,
        requestId: request.requestId,
        data: {
          id: variable.id,
          name: variable.name,
          resolvedType: variable.resolvedType,
          collectionId: p.collectionId,
        },
      };
    }

    case "set_variable_value": {
      const p = request.params || {};
      if (!p.variableId) throw new Error("variableId is required");
      if (!p.modeId) throw new Error("modeId is required");
      const variable = await figma.variables.getVariableByIdAsync(p.variableId);
      if (!variable) throw new Error(`Variable not found: ${p.variableId}`);
      let aliasVariableId: string | undefined;
      if (p.aliasVariableId != null) {
        // 别名赋值优先于字面量
        aliasVariableId = String(p.aliasVariableId);
        const alias = await figma.variables.createVariableAliasByIdAsync(aliasVariableId);
        variable.setValueForMode(p.modeId, alias);
      } else {
        if (p.value == null) throw new Error("value is required");
        variable.setValueForMode(p.modeId, parseVariableValue(variable.resolvedType, p.value));
      }
      figma.commitUndo();
      return {
        type: request.type,
        requestId: request.requestId,
        data: { variableId: variable.id, name: variable.name, modeId: p.modeId, aliasVariableId },
      };
    }

    case "rename_variable_collection": {
      const p = request.params || {};
      if (!p.collectionId) throw new Error("collectionId is required");
      const collection = await figma.variables.getVariableCollectionByIdAsync(p.collectionId);
      if (!collection) throw new Error(`Collection not found: ${p.collectionId}`);
      if (!p.name) throw new Error("name is required");
      collection.name = String(p.name);
      figma.commitUndo();
      return {
        type: request.type,
        requestId: request.requestId,
        data: { id: collection.id, name: collection.name },
      };
    }

    case "rename_variable_mode": {
      const p = request.params || {};
      if (!p.collectionId) throw new Error("collectionId is required");
      if (!p.modeId) throw new Error("modeId is required");
      if (!p.name) throw new Error("name is required");
      const collection = await figma.variables.getVariableCollectionByIdAsync(p.collectionId);
      if (!collection) throw new Error(`Collection not found: ${p.collectionId}`);
      if (!collection.modes.some((m) => m.modeId === p.modeId)) {
        throw new Error(`Mode not found: ${p.modeId}`);
      }
      collection.renameMode(p.modeId, String(p.name));
      figma.commitUndo();
      return {
        type: request.type,
        requestId: request.requestId,
        data: {
          collectionId: collection.id,
          modeId: p.modeId,
          modes: collection.modes.map((m) => ({ modeId: m.modeId, name: m.name })),
        },
      };
    }

    case "delete_variable_mode": {
      const p = request.params || {};
      if (!p.collectionId) throw new Error("collectionId is required");
      if (!p.modeId) throw new Error("modeId is required");
      const collection = await figma.variables.getVariableCollectionByIdAsync(p.collectionId);
      if (!collection) throw new Error(`Collection not found: ${p.collectionId}`);
      if (!collection.modes.some((m) => m.modeId === p.modeId)) {
        throw new Error(`Mode not found: ${p.modeId}`);
      }
      collection.removeMode(p.modeId);
      figma.commitUndo();
      return {
        type: request.type,
        requestId: request.requestId,
        data: {
          collectionId: collection.id,
          modeId: p.modeId,
          modes: collection.modes.map((m) => ({ modeId: m.modeId, name: m.name })),
        },
      };
    }

    case "update_variable": {
      const p = request.params || {};
      if (!p.variableId) throw new Error("variableId is required");
      const variable = await figma.variables.getVariableByIdAsync(p.variableId);
      if (!variable) throw new Error(`Variable not found: ${p.variableId}`);
      const hasDescription = typeof p.description === "string";
      const hasHidden = typeof p.hiddenFromPublishing === "boolean";
      const hasScopes = Array.isArray(p.scopes);
      const hasCodeSyntax =
        p.codeSyntax != null && typeof p.codeSyntax === "object" && !Array.isArray(p.codeSyntax);
      if (!hasDescription && !hasHidden && !hasScopes && !hasCodeSyntax) {
        throw new Error(
          "description / hiddenFromPublishing / scopes / codeSyntax 至少提供一个",
        );
      }
      if (hasDescription) variable.description = p.description;
      if (hasHidden) variable.hiddenFromPublishing = p.hiddenFromPublishing;
      if (hasScopes) {
        const scopes = p.scopes.map((scope: any) => {
          const value = String(scope).toUpperCase();
          if (!VARIABLE_SCOPES.includes(value)) {
            throw new Error(`非法的作用域值: ${scope}`);
          }
          return value as VariableScope;
        });
        variable.scopes = scopes;
      }
      if (hasCodeSyntax) {
        const platforms: CodeSyntaxPlatform[] = ["WEB", "ANDROID", "iOS"];
        for (const platform of platforms) {
          const value = p.codeSyntax[platform];
          if (value === null) {
            variable.removeVariableCodeSyntax(platform);
          } else if (typeof value === "string") {
            variable.setVariableCodeSyntax(platform, value);
          }
        }
      }
      figma.commitUndo();
      return {
        type: request.type,
        requestId: request.requestId,
        data: {
          id: variable.id,
          name: variable.name,
          description: variable.description,
          scopes: variable.scopes,
          hiddenFromPublishing: variable.hiddenFromPublishing,
          codeSyntax: variable.codeSyntax,
        },
      };
    }

    case "import_variable_by_key": {
      const p = request.params || {};
      if (!p.key) throw new Error("key is required");
      const variable = await figma.variables.importVariableByKeyAsync(String(p.key));
      figma.commitUndo();
      return {
        type: request.type,
        requestId: request.requestId,
        data: {
          id: variable.id,
          name: variable.name,
          resolvedType: variable.resolvedType,
          variableCollectionId: variable.variableCollectionId,
          key: variable.key,
        },
      };
    }

    case "delete_variable": {
      const p = request.params || {};
      if (p.variableId) {
        const variable = await figma.variables.getVariableByIdAsync(p.variableId);
        if (!variable) throw new Error(`Variable not found: ${p.variableId}`);
        variable.remove();
        figma.commitUndo();
        return {
          type: request.type,
          requestId: request.requestId,
          data: { variableId: p.variableId, deleted: true },
        };
      } else if (p.collectionId) {
        const collection = await figma.variables.getVariableCollectionByIdAsync(p.collectionId);
        if (!collection) throw new Error(`Collection not found: ${p.collectionId}`);
        collection.remove();
        figma.commitUndo();
        return {
          type: request.type,
          requestId: request.requestId,
          data: { collectionId: p.collectionId, deleted: true },
        };
      } else {
        throw new Error("variableId or collectionId is required");
      }
    }

    case "set_variable_mode_on_node": {
      const p = request.params || {};
      const nodeId = request.nodeIds && request.nodeIds[0];
      if (!nodeId) throw new Error("nodeId is required");
      const node = (await figma.getNodeByIdAsync(nodeId)) as any;
      if (!node) throw new Error(`Node not found: ${nodeId}`);
      if (typeof node.setExplicitVariableModeForCollection !== "function") {
        throw new Error(`Node ${nodeId} 不支持变量模式`);
      }
      if (!p.collectionId) throw new Error("collectionId is required");
      const collection = await figma.variables.getVariableCollectionByIdAsync(p.collectionId);
      if (!collection) throw new Error(`Collection not found: ${p.collectionId}`);
      let modeId: string | null = null;
      if (p.clear === true) {
        node.clearExplicitVariableModeForCollection(collection);
      } else {
        if (!p.modeId) throw new Error("modeId is required");
        if (!collection.modes.some((m) => m.modeId === p.modeId)) {
          throw new Error(`Mode not found: ${p.modeId}`);
        }
        node.setExplicitVariableModeForCollection(collection, p.modeId);
        modeId = p.modeId;
      }
      figma.commitUndo();
      return {
        type: request.type,
        requestId: request.requestId,
        data: {
          id: node.id,
          name: node.name,
          collectionId: p.collectionId,
          modeId,
          explicitVariableModes: node.explicitVariableModes,
        },
      };
    }

    default:
      return null;
  }
};
