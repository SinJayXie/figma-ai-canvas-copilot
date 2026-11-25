import { serializeVariableValue } from "./serializers";

export const handleReadStyleRequest = async (request: any) => {
  switch (request.type) {
    case "get_styles": {
      const params = request.params || {};
      const query =
        typeof params.query === "string" ? params.query.trim().toLowerCase() : "";
      const match = (name: string) => !query || name.toLowerCase().includes(query);
      const [paintStyles, textStyles, effectStyles, gridStyles] =
        await Promise.all([
          figma.getLocalPaintStylesAsync(),
          figma.getLocalTextStylesAsync(),
          figma.getLocalEffectStylesAsync(),
          figma.getLocalGridStylesAsync(),
        ]);
      return {
        type: request.type,
        requestId: request.requestId,
        data: {
          paints: paintStyles.filter((s) => match(s.name)).map((s) => ({
            id: s.id,
            name: s.name,
            description: s.description || undefined,
            paints: s.paints,
          })),
          text: textStyles.filter((s) => match(s.name)).map((s) => ({
            id: s.id,
            name: s.name,
            description: s.description || undefined,
            fontSize: s.fontSize,
            fontFamily: s.fontName ? s.fontName.family : undefined,
            fontStyle: s.fontName ? s.fontName.style : undefined,
            textDecoration:
              s.textDecoration !== "NONE" ? s.textDecoration : undefined,
            lineHeight: (s as any).lineHeight,
            letterSpacing: (s as any).letterSpacing,
          })),
          effects: effectStyles.filter((s) => match(s.name)).map((s) => ({
            id: s.id,
            name: s.name,
            description: s.description || undefined,
            effects: s.effects,
          })),
          grids: gridStyles.filter((s) => match(s.name)).map((s) => ({
            id: s.id,
            name: s.name,
            description: s.description || undefined,
            layoutGrids: s.layoutGrids,
          })),
        },
      };
    }

    case "get_variable_defs": {
      const collections =
        await figma.variables.getLocalVariableCollectionsAsync();
      const variableData = await Promise.all(
        collections.map(async (collection) => {
          const variables = await Promise.all(
            collection.variableIds.map((id) =>
              figma.variables.getVariableByIdAsync(id),
            ),
          );
          return {
            id: collection.id,
            name: collection.name,
            modes: collection.modes.map((mode) => ({
              modeId: mode.modeId,
              name: mode.name,
            })),
            variables: variables
              .filter((v) => v !== null)
              .map((variable) => ({
                id: variable!.id,
                name: variable!.name,
                resolvedType: variable!.resolvedType,
                valuesByMode: Object.fromEntries(
                  Object.entries(variable!.valuesByMode).map(
                    ([modeId, value]) => [
                      modeId,
                      serializeVariableValue(value),
                    ],
                  ),
                ),
              })),
          };
        }),
      );
      return {
        type: request.type,
        requestId: request.requestId,
        data: { collections: variableData },
      };
    }

    case "get_local_components": {
      const pages = figma.root.children;
      const allComponents: any[] = [];
      const componentSetsMap = new Map<string, any>();
      for (let i = 0; i < pages.length; i++) {
        const page = pages[i];
        await page.loadAsync();
        const pageNodes = page.findAllWithCriteria({
          types: ["COMPONENT", "COMPONENT_SET"],
        });
        for (const n of pageNodes) {
          if (n.type === "COMPONENT_SET") {
            componentSetsMap.set(n.id, {
              id: n.id,
              name: n.name,
              key: "key" in n ? n.key : null,
            });
          } else {
            const parentIsSet =
              n.parent && n.parent.type === "COMPONENT_SET";
            allComponents.push({
              id: n.id,
              name: n.name,
              key: "key" in n ? n.key : null,
              componentSetId: parentIsSet ? n.parent!.id : null,
              variantProperties:
                "variantProperties" in n ? n.variantProperties : null,
            });
          }
        }
        figma.ui.postMessage({
          type: "progress_update",
          requestId: request.requestId,
          progress: Math.round(((i + 1) / pages.length) * 90) + 1,
          message: `Scanned ${page.name}: ${allComponents.length} components so far`,
        });
        await new Promise((r) => setTimeout(r, 0));
      }
      // 资源库组件无法整体枚举，但「已在当前文件中使用」的库组件可以从实例反查 key，
      // 之后可用 create_instance(componentKey) 复用。
      const libraryMap = new Map<string, any>();
      for (const page of pages) {
        const instances = page.findAllWithCriteria({ types: ["INSTANCE"] });
        for (const instance of instances.slice(0, 300)) {
          if (libraryMap.size >= 100) break;
          try {
            const main = await (instance as InstanceNode).getMainComponentAsync();
            if (!main || !main.key || !main.remote) continue;
            if (!libraryMap.has(main.key)) {
              libraryMap.set(main.key, {
                key: main.key,
                name: main.name,
                remote: true,
                componentSetName:
                  main.parent && main.parent.type === "COMPONENT_SET" ? main.parent.name : null,
              });
            }
          } catch {
            // 跨文件/未加载的实例忽略
          }
        }
      }
      return {
        type: request.type,
        requestId: request.requestId,
        data: {
          count: allComponents.length,
          components: allComponents,
          componentSets: Array.from(componentSetsMap.values()),
          libraryComponents: Array.from(libraryMap.values()),
        },
      };
    }

    case "get_annotations": {
      const nodeId = request.params && request.params.nodeId;
      const nodeAnnotations = (n: any) => {
        const anns = n.annotations;
        return Array.isArray(anns) ? anns : null;
      };
      if (nodeId) {
        const node = await figma.getNodeByIdAsync(nodeId);
        if (!node) throw new Error(`Node not found: ${nodeId}`);
        const mergedAnnotations: any[] = [];
        const collect = (n: any) => {
          const anns = nodeAnnotations(n);
          if (anns)
            for (const a of anns)
              mergedAnnotations.push({ nodeId: n.id, annotation: a });
          if ("children" in n) for (const child of n.children) collect(child);
        };
        collect(node);
        return {
          type: request.type,
          requestId: request.requestId,
          data: {
            nodeId: node.id,
            name: node.name,
            annotations: mergedAnnotations,
          },
        };
      }
      const annotated: any[] = [];
      const processNode = (n: any) => {
        const anns = nodeAnnotations(n);
        if (anns && anns.length > 0)
          annotated.push({ nodeId: n.id, name: n.name, annotations: anns });
        if ("children" in n) for (const child of n.children) processNode(child);
      };
      processNode(figma.currentPage);
      return {
        type: request.type,
        requestId: request.requestId,
        data: { annotatedNodes: annotated },
      };
    }

    case "export_tokens": {
      const format = (request.params && request.params.format) || "json";

      const collections = await figma.variables.getLocalVariableCollectionsAsync();
      const paintStyles = await figma.getLocalPaintStylesAsync();

      if (format === "css") {
        const lines: string[] = [":root {"];
        for (const coll of collections) {
          const firstMode = coll.modes[0];
          if (!firstMode) continue;
          for (const varId of coll.variableIds) {
            const variable = await figma.variables.getVariableByIdAsync(varId);
            if (!variable) continue;
            const val = variable.valuesByMode[firstMode.modeId];
            const cssName = "--" + variable.name.toLowerCase().replace(/[/\s]+/g, "-").replace(/[^a-z0-9-]/g, "");
            let cssValue: string | null = null;
            if (variable.resolvedType === "COLOR" && val && typeof val === "object" && "r" in val) {
              const c = val as RGBA;
              const r = Math.round(c.r * 255);
              const g = Math.round(c.g * 255);
              const b = Math.round(c.b * 255);
              cssValue = c.a < 1 ? `rgba(${r}, ${g}, ${b}, ${c.a.toFixed(2)})` : `rgb(${r}, ${g}, ${b})`;
            } else if (variable.resolvedType === "FLOAT" || variable.resolvedType === "STRING" || variable.resolvedType === "BOOLEAN") {
              cssValue = String(val);
            }
            if (cssValue !== null) lines.push(`  ${cssName}: ${cssValue};`);
          }
        }
        for (const style of paintStyles) {
          if (style.paints.length === 1 && style.paints[0].type === "SOLID") {
            const paint = style.paints[0] as SolidPaint;
            const cssName = "--" + style.name.toLowerCase().replace(/[/\s]+/g, "-").replace(/[^a-z0-9-]/g, "");
            const r = Math.round(paint.color.r * 255);
            const g = Math.round(paint.color.g * 255);
            const b = Math.round(paint.color.b * 255);
            const a = paint.opacity ?? 1;
            const cssValue = a < 1 ? `rgba(${r}, ${g}, ${b}, ${a.toFixed(2)})` : `rgb(${r}, ${g}, ${b})`;
            lines.push(`  ${cssName}: ${cssValue};`);
          }
        }
        lines.push("}");
        return { type: request.type, requestId: request.requestId, data: { css: lines.join("\n") } };
      }

      // JSON format: nested token tree per collection
      const tokens: any = {};
      for (const coll of collections) {
        const collTokens: any = {};
        for (const varId of coll.variableIds) {
          const variable = await figma.variables.getVariableByIdAsync(varId);
          if (!variable) continue;
          const modeValues: any = {};
          for (const mode of coll.modes) {
            modeValues[mode.name] = serializeVariableValue(variable.valuesByMode[mode.modeId]);
          }
          const parts = variable.name.split("/");
          let obj = collTokens;
          for (let i = 0; i < parts.length - 1; i++) {
            if (!obj[parts[i]]) obj[parts[i]] = {};
            obj = obj[parts[i]];
          }
          obj[parts[parts.length - 1]] = { type: variable.resolvedType, value: modeValues };
        }
        tokens[coll.name] = collTokens;
      }
      const styleTokens: any = {};
      for (const style of paintStyles) {
          if (style.paints.length === 1 && style.paints[0].type === "SOLID") {
            const paint = style.paints[0] as SolidPaint;
            const r = Math.round(paint.color.r * 255).toString(16).padStart(2, "0");
            const g = Math.round(paint.color.g * 255).toString(16).padStart(2, "0");
            const b = Math.round(paint.color.b * 255).toString(16).padStart(2, "0");
            const parts = style.name.split("/");
            let obj = styleTokens;
            for (let i = 0; i < parts.length - 1; i++) {
              if (!obj[parts[i]]) obj[parts[i]] = {};
              obj = obj[parts[i]];
            }
            obj[parts[parts.length - 1]] = { type: "COLOR", value: `#${r}${g}${b}` };
          }
      }
      if (Object.keys(styleTokens).length > 0) {
        tokens["_styles"] = { paint: styleTokens };
      }
      return { type: request.type, requestId: request.requestId, data: { tokens } };
    }

    case "get_local_variables": {
      const params = request.params || {};
      let type: VariableResolvedDataType | undefined;
      if (params.type != null && params.type !== "") {
        const validTypes = ["COLOR", "FLOAT", "STRING", "BOOLEAN"];
        const normalized = String(params.type).toUpperCase();
        if (!validTypes.includes(normalized)) {
          throw new Error(`Invalid variable type: ${params.type}. Must be COLOR, FLOAT, STRING, or BOOLEAN`);
        }
        type = normalized as VariableResolvedDataType;
      }
      const variables = type
        ? await figma.variables.getLocalVariablesAsync(type)
        : await figma.variables.getLocalVariablesAsync();
      const collectionId = params.collectionId ? String(params.collectionId) : null;
      const query = typeof params.query === "string" ? params.query.trim().toLowerCase() : "";
      const rawLimit = Number(params.limit);
      const limit = Number.isFinite(rawLimit)
        ? Math.min(2000, Math.max(1, Math.floor(rawLimit)))
        : 500;
      const filtered = variables.filter(
        (v) =>
          (!collectionId || v.variableCollectionId === collectionId) &&
          (!query || v.name.toLowerCase().includes(query)),
      );
      const truncated = filtered.length > limit;
      const items = (truncated ? filtered.slice(0, limit) : filtered).map((v) => ({
        id: v.id,
        name: v.name,
        description: v.description,
        resolvedType: v.resolvedType,
        variableCollectionId: v.variableCollectionId,
        remote: v.remote,
        hiddenFromPublishing: v.hiddenFromPublishing,
        scopes: v.scopes,
        codeSyntax: v.codeSyntax,
        valuesByMode: Object.fromEntries(
          Object.entries(v.valuesByMode).map(([modeId, value]) => [
            modeId,
            serializeVariableValue(value),
          ]),
        ),
      }));
      return {
        type: request.type,
        requestId: request.requestId,
        data: {
          count: items.length,
          variables: items,
          ...(truncated ? { truncated: true } : {}),
        },
      };
    }

    case "get_library_variables": {
      const params = request.params || {};
      if (!params.collectionKey) {
        const collections =
          await figma.teamLibrary.getAvailableLibraryVariableCollectionsAsync();
        return {
          type: request.type,
          requestId: request.requestId,
          data: { collections },
        };
      }
      const collectionKey = String(params.collectionKey);
      const variables =
        await figma.teamLibrary.getVariablesInLibraryCollectionAsync(collectionKey);
      return {
        type: request.type,
        requestId: request.requestId,
        data: { collectionKey, count: variables.length, variables },
      };
    }

    case "get_selection_colors": {
      const colors = figma.getSelectionColors();
      return {
        type: request.type,
        requestId: request.requestId,
        data: { colors },
      };
    }

    default:
      return null;
  }
};
