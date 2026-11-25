export const handleWriteComponentRequest = async (request: any) => {
  switch (request.type) {
    case "swap_component": {
      const p = request.params || {};
      const nodeId = request.nodeIds && request.nodeIds[0];
      if (!nodeId) throw new Error("nodeId is required");
      if (!p.componentId) throw new Error("componentId is required");
      const node = await figma.getNodeByIdAsync(nodeId);
      if (!node) throw new Error(`Node not found: ${nodeId}`);
      if (node.type !== "INSTANCE") throw new Error(`Node ${nodeId} is not a component INSTANCE`);
      const component = await figma.getNodeByIdAsync(p.componentId);
      if (!component) throw new Error(`Component not found: ${p.componentId}`);
      if (component.type !== "COMPONENT") throw new Error(`Node ${p.componentId} is not a COMPONENT`);
      node.swapComponent(component);
      figma.commitUndo();
      return {
        type: request.type,
        requestId: request.requestId,
        data: { id: node.id, name: node.name, componentId: component.id, componentName: component.name },
      };
    }

    case "detach_instance": {
      const nodeIds = request.nodeIds || [];
      if (nodeIds.length === 0) throw new Error("nodeIds is required");
      const results: any[] = [];
      for (const nid of nodeIds) {
        const n = await figma.getNodeByIdAsync(nid);
        if (!n) { results.push({ nodeId: nid, error: "Node not found" }); continue; }
        if (n.type !== "INSTANCE") { results.push({ nodeId: nid, error: "Node is not an INSTANCE" }); continue; }
        const frame = n.detachInstance();
        results.push({ nodeId: nid, newId: frame.id, name: frame.name });
      }
      figma.commitUndo();
      return {
        type: request.type,
        requestId: request.requestId,
        data: { results },
      };
    }

    case "delete_nodes": {
      const nodeIds = request.nodeIds || [];
      if (nodeIds.length === 0) throw new Error("nodeIds is required");
      const results: any[] = [];
      for (const nid of nodeIds) {
        const n = await figma.getNodeByIdAsync(nid);
        if (!n) { results.push({ nodeId: nid, error: "Node not found" }); continue; }
        n.remove();
        results.push({ nodeId: nid, deleted: true });
      }
      figma.commitUndo();
      return { type: request.type, requestId: request.requestId, data: { results } };
    }

    case "navigate_to_page": {
      const p = request.params || {};
      let page: PageNode | undefined;
      if (p.pageId) {
        const found = await figma.getNodeByIdAsync(p.pageId);
        if (!found) throw new Error(`Page not found: ${p.pageId}`);
        if (found.type !== "PAGE") throw new Error(`Node ${p.pageId} is not a PAGE`);
        page = found as PageNode;
      } else if (p.pageName) {
        page = figma.root.children.find(pg => pg.name === p.pageName) as PageNode | undefined;
        if (!page) throw new Error(`Page not found with name: ${p.pageName}`);
      } else {
        throw new Error("pageId or pageName is required");
      }
      await figma.setCurrentPageAsync(page);
      return {
        type: request.type,
        requestId: request.requestId,
        data: { id: page.id, name: page.name },
      };
    }

    case "group_nodes": {
      const p = request.params || {};
      const nodeIds = request.nodeIds || [];
      if (nodeIds.length === 0) throw new Error("nodeIds is required");
      const nodes = await Promise.all(nodeIds.map((id: string) => figma.getNodeByIdAsync(id)));
      const validNodes = nodes.filter((n): n is SceneNode => n !== null && n.type !== "DOCUMENT" && n.type !== "PAGE");
      if (validNodes.length === 0) throw new Error("No valid scene nodes found");
      const parent = validNodes[0].parent;
      if (!parent) throw new Error("Nodes must have a parent");
      const group = figma.group(validNodes, parent as any);
      if (p.name) group.name = p.name;
      figma.commitUndo();
      return {
        type: request.type,
        requestId: request.requestId,
        data: { id: group.id, name: group.name, type: group.type },
      };
    }

    case "ungroup_nodes": {
      const nodeIds = request.nodeIds || [];
      if (nodeIds.length === 0) throw new Error("nodeIds is required");
      const results: any[] = [];
      for (const nid of nodeIds) {
        const n = await figma.getNodeByIdAsync(nid);
        if (!n) { results.push({ nodeId: nid, error: "Node not found" }); continue; }
        if (n.type !== "GROUP") { results.push({ nodeId: nid, error: "Node is not a GROUP" }); continue; }
        const group = n as GroupNode;
        const children = figma.ungroup(group);
        results.push({ nodeId: nid, childIds: children.map((c) => c.id) });
      }
      figma.commitUndo();
      return { type: request.type, requestId: request.requestId, data: { results } };
    }

    case "add_component_property": {
      const p = request.params || {};
      const nodeId = request.nodeIds && request.nodeIds[0];
      if (!nodeId) throw new Error("nodeId is required");
      const node = await figma.getNodeByIdAsync(nodeId);
      if (!node) throw new Error(`Node not found: ${nodeId}`);
      if (node.type !== "COMPONENT" && node.type !== "COMPONENT_SET") {
        throw new Error(`Node ${nodeId} is not a COMPONENT or COMPONENT_SET`);
      }
      if (!p.name) throw new Error("name is required");
      const validTypes = ["BOOLEAN", "TEXT", "INSTANCE_SWAP", "VARIANT", "SLOT"];
      const type = String(p.type || "TEXT").toUpperCase();
      if (!validTypes.includes(type)) {
        throw new Error(`type must be one of ${validTypes.join(", ")}`);
      }
      if (p.defaultValue == null) throw new Error("defaultValue is required");
      const defaultValue = type === "BOOLEAN"
        ? p.defaultValue === true || p.defaultValue === "true"
        : String(p.defaultValue);
      const options: any = {};
      if (p.preferredValues != null) options.preferredValues = p.preferredValues;
      const propertyName = node.addComponentProperty(
        p.name,
        type as ComponentPropertyType,
        defaultValue,
        options,
      );
      figma.commitUndo();
      return {
        type: request.type,
        requestId: request.requestId,
        data: {
          id: node.id,
          name: node.name,
          propertyName,
          definitions: node.componentPropertyDefinitions,
        },
      };
    }

    case "edit_component_property": {
      const p = request.params || {};
      const nodeId = request.nodeIds && request.nodeIds[0];
      if (!nodeId) throw new Error("nodeId is required");
      const node = await figma.getNodeByIdAsync(nodeId);
      if (!node) throw new Error(`Node not found: ${nodeId}`);
      if (node.type !== "COMPONENT" && node.type !== "COMPONENT_SET") {
        throw new Error(`Node ${nodeId} is not a COMPONENT or COMPONENT_SET`);
      }
      const propertyName = p.propertyName || p.name;
      if (!propertyName) throw new Error("propertyName is required");
      const newValue: any = {};
      const newName = p.newName ?? p.newPropertyName;
      if (newName != null) newValue.name = String(newName);
      if (p.defaultValue != null) {
        const definition = node.componentPropertyDefinitions[propertyName];
        newValue.defaultValue = definition?.type === "BOOLEAN"
          ? p.defaultValue === true || p.defaultValue === "true"
          : String(p.defaultValue);
      }
      if (p.preferredValues != null) newValue.preferredValues = p.preferredValues;
      const updatedName = node.editComponentProperty(propertyName, newValue);
      figma.commitUndo();
      return {
        type: request.type,
        requestId: request.requestId,
        data: {
          id: node.id,
          name: node.name,
          propertyName: updatedName,
          definitions: node.componentPropertyDefinitions,
        },
      };
    }

    case "delete_component_property": {
      const p = request.params || {};
      const nodeId = request.nodeIds && request.nodeIds[0];
      if (!nodeId) throw new Error("nodeId is required");
      const node = await figma.getNodeByIdAsync(nodeId);
      if (!node) throw new Error(`Node not found: ${nodeId}`);
      if (node.type !== "COMPONENT" && node.type !== "COMPONENT_SET") {
        throw new Error(`Node ${nodeId} is not a COMPONENT or COMPONENT_SET`);
      }
      const propertyName = p.propertyName || p.name;
      if (!propertyName) throw new Error("propertyName is required");
      node.deleteComponentProperty(propertyName);
      figma.commitUndo();
      return {
        type: request.type,
        requestId: request.requestId,
        data: { id: node.id, propertyName, deleted: true },
      };
    }

    case "set_component_property_references": {
      const p = request.params || {};
      const nodeId = request.nodeIds && request.nodeIds[0];
      if (!nodeId) throw new Error("nodeId is required");
      const node = (await figma.getNodeByIdAsync(nodeId)) as any;
      if (!node) throw new Error(`Node not found: ${nodeId}`);
      if (!p.references || typeof p.references !== "object" || Array.isArray(p.references)) {
        throw new Error("references object is required");
      }
      const allowedKeys = ["visible", "characters", "mainComponent"];
      const references: any = {};
      for (const key of allowedKeys) {
        const value = p.references[key];
        if (value === undefined) continue;
        if (value !== null && typeof value !== "string") {
          throw new Error(`references.${key} must be a string or null`);
        }
        references[key] = value;
      }
      node.componentPropertyReferences = Object.keys(references).length > 0 ? references : null;
      figma.commitUndo();
      return {
        type: request.type,
        requestId: request.requestId,
        data: {
          id: node.id,
          name: node.name,
          componentPropertyReferences: node.componentPropertyReferences,
        },
      };
    }

    default:
      return null;
  }
};
