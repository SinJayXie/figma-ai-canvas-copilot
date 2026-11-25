import { handleWriteCreateRequest } from "./write-create";
import { handleWriteModifyRequest } from "./write-modify";
import { handleWriteStyleRequest } from "./write-styles";
import { handleWriteVariableRequest } from "./write-variables";
import { handleWriteComponentRequest } from "./write-components";
import { handleWritePrototypeRequest } from "./write-prototype";
import { handleWritePageRequest } from "./write-page";
import { handleWriteExtrasRequest } from "./extras";

/**
 * 单节点实现、但语义上是「同一套参数作用于多个图层」的能力。
 * 这些能力内部只取 nodeIds[0]，这里统一按 id 逐个执行并合并结果，
 * 避免 AI 为了改三张卡片而发起三轮工具调用。
 * （set_fills / set_strokes / set_effects / set_corner_radius / apply_style_to_node
 *   / rename_node / move_nodes / resize_nodes 等已在各自实现中支持数组，不在此列）
 */
const PER_NODE_CAPABILITIES = new Set<string>([
  "set_text",
  "set_auto_layout",
  "set_font",
  "set_corner_radii",
  "set_stroke_properties",
  "set_layout_grids",
  "set_overflow",
  "set_annotations",
  "set_instance_properties",
  "reset_instance_overrides",
  "set_node_plugin_data",
  "set_export_settings",
  "bind_variable_to_node",
  "set_variable_mode_on_node",
  "set_reactions",
  "remove_reactions",
])

/** 依次尝试各处理器：第一个返回非空结果的处理器即为实现 */
const invoke = async (request: any) =>
  (await handleWriteCreateRequest(request)) ??
  (await handleWriteModifyRequest(request)) ??
  (await handleWriteStyleRequest(request)) ??
  (await handleWriteVariableRequest(request)) ??
  (await handleWriteComponentRequest(request)) ??
  (await handleWritePrototypeRequest(request)) ??
  (await handleWritePageRequest(request)) ??
  (await handleWriteExtrasRequest(request));

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const handleWriteRequest = async (request: any) => {
  const ids: string[] = Array.isArray(request?.nodeIds)
    ? request.nodeIds.filter((id: unknown) => typeof id === "string" && id.trim())
    : [];
  if (!PER_NODE_CAPABILITIES.has(request?.type) || ids.length <= 1) {
    return invoke(request);
  }

  // 批量执行：单节点失败不影响其它节点，全部失败时抛错让模型看到原因
  const results: any[] = [];
  for (const id of ids) {
    try {
      const result = await invoke({ ...request, nodeIds: [id] });
      results.push(result && typeof result === "object" && "data" in result ? result.data : { nodeId: id });
    } catch (error) {
      results.push({ nodeId: id, error: errorText(error) });
    }
  }
  if (results.every((item) => item.error)) {
    throw new Error(results.map((item) => `${item.nodeId}: ${item.error}`).join("; "));
  }
  return {
    type: request.type,
    requestId: request.requestId,
    data: {
      updated: results.filter((item) => !item.error).length,
      results,
    },
  };
};
