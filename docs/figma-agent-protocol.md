# Figma 官方 Agent 请求与流式处理拆解（复刻参考）

> 分析对象：www.figma.com 线上 `webpack-artifacts` 产物（按你贴的调用栈定位）。
> 产物为 minified JS，本文结论来自静态还原 + 命名/字符串/结构比对，关键处已标注模块号，便于复核。
> 分析时间：2026-11-24

---

## 0. 一句话结论

Figma 的 Assistant/Agent 不是「客户端自己循环调 LLM」，而是：

**薄客户端 + 服务端 Agent Runtime（Cortex）**。
客户端只做三件事：

1. 把「这一轮的用户消息 + 画布/线程上下文」POST 到 `/api/cortex/assistant/chat`；
2. 解析一条**带类型语义的 SSE 事件流**（text / reasoning / tool-call / tool-result / step / compression / outcome …）并落到本地消息树；
3. 必要时在本地执行少数 client-side 工具、维护快照以支持「断线重放」与「步骤回滚」。

工具编排、上下文压缩、多步推理、sandbox 执行、prompt 生命周期都在服务端完成。

---

## 1. 代码考古：调用栈 → 模块

| 产物 | 模块 | 角色 |
| --- | --- | --- |
| `70742-*.min.js` | `556592` | Agent 基类 `g`：`sendMessage / runAgentLoop / processResponseStreamFromAgent / streamResponse` |
| `70742-*.min.js` | `779318` | Figma 版 Agent `Eb extends g`：持有 `configurationKey / globalOptions / globalState`，`buildRequest` |
| `70742-*.min.js` | `951451` | ThreadBuilder 基类：messages / pendingToolCalls / toolCall 参数流式累积 / snapshot |
| `54933-*.min.js` | `940276` | UI 适配层：`createTools()`、构造 Agent 实例、`clientDependencies.streamResponse` |
| `figma_app-*.min.js` | `553447` | Cortex API client 工厂：路由表、headers、WAF、SSE 管道、错误封装 |
| `figma_app-*.min.js` | `279598` | `/assistant/chat` **请求 schema**（`Bq`）与请求构造 `N()` |
| `figma_app-*.min.js` | `819074` | `/assistant/chat` **流事件 schema**（`Uv`）与首包事件集合 `ZV` |
| `figma_app-*.min.js` | `94172` | `isClientSideRetryableError`（客户端重试判定） |
| `1366-*.min.js` | `209333` | ThreadBuilder 子类：`processStreamPart` 的具体消息落盘规则 |
| `1366-*.min.js` | `406631` | 通用 SSE 解析器（按行 `data:` 聚合） |
| `1366-*.min.js` | `450907` | 流中间件：zod 校验（丢弃脏 chunk）、请求 UUID 注入、错误映射 |
| `vendor-df99*.min.js` | `406631` | 同上 SSE 解析器的底层实现 |

对应关系（可用来对照自己的抓包）：

```
window.fetch
  ← s/o @ 70742 (retry / fetch 包装)
    ← (anonymous) @ 54933:3     // clientDependencies.streamResponse 的箭头函数
      ← streamResponse @ 70742  // Agent 基类：this.clientDependencies.streamResponse(req)
        ← processResponseStreamFromAgent @ 70742
          ← runAgentLoop @ 70742
            ← sendMessage @ 70742
```

---

## 2. 请求协议

### 2.1 端点

| 用途 | 方法 | 路径 |
| --- | --- | --- |
| 主对话（流式） | POST | `/api/cortex/assistant/chat` |
| 转向/插话（流式回合中追加指令） | POST | `/api/cortex/assistant/chat`（body `delivery: "steer"`） |
| 撤销 | POST | `/api/cortex/assistant/undo` |
| 埋点 | POST | `/api/cortex/assistant/trace_event` |
| 沙箱中断 | POST | `/api/cortex/foundry/interrupt` |

主对话在 API client 里注册为：

```js
chat: eJ("/api/cortex/assistant/chat", requestSchema /* Bq */, streamSchema /* Uv */, opts)
```

`eJ` = 生产环境 + `isStreaming: true`。

### 2.2 请求体（schema 还原，模块 279598）

```ts
{
  threadId: string,                 // 服务端线程 id
  messages: [Message],              // 见下方说明：实际只发「最后一条 user 消息」
  userMessagePlainText?: string,    // 用户原文（便于服务端做纯文本处理）
  webSearchEnabled?: boolean,
  overrides?: {                     // 本轮临时覆盖 agent 配置
    effort?: string,
    maxTurns?: number,
    systemPrompt?: string,
    serverOptions?: { model?: {...}, systemPrompt?: { type: "literal" | "function" | "sandbox_prompt_function", ... } },
    serverOverridesOpaqueKey?: string
  },
  workloadPayload: {
    productType: "design" | "figjam" | "slides" | "dev_handoff" | "figspec" | "willow",
    configurationKey?: string,      // agent 配置（模型、工具集、提示词都由它决定）
    currentPageId?: string,
    viewport?: { x, y, width, height },
    selectedNodeIds?: string[],
    enabledLibraryKeys?: string[],
    bundleIds?: string[],
    subscribedLibraryKeys?: string[],
    selectedNodeLibraryKeys?: string[],
    enabledLibrariesKind?: string,
    skillInvocations?: SkillInvocation[],
    userMessageOrigin?: string,
    makeEditsDebugOverrides?: object,
    figmakeClientModel?: string,
    metronomeContext?: { isInMetronomeMode, currentTimeSeconds?, viewedTimeline? },
    codeLayerVersionOrigin?: string,
    globalOptions?: { fileSystemConfig?: ... }
  }
}
```

关键点（这条最容易踩坑）：

- **请求体 schema 里没有 `tools` 字段**。工具集由服务端 `configurationKey / agentConfigId` 决定；客户端只保留 `toolName → executor` 的映射。
- Figma Web 端的 UI 适配层在组装请求时，会把 Agent 传下来的 `messages[]` **只取最后一条 `role === "user"` 的消息**塞进 `messages: [message]`：
  会话历史、tool-call、tool-result 全部由服务端按 `threadId` 维护。
  所以「多轮工具循环」并不会把 tool result 再 POST 回来——sandbox 模式下工具本来就在服务端跑。
- 如果走「server-side chat」分支（`serverSideChatParams` 有值），客户端只发 `getLatestMessage()`，并且**禁用客户端重试**。

### 2.3 请求头（模块 553447 `eY`）

```ts
{
  "Content-Type": "application/json",
  "X-Figma-Org-ID": string,
  "X-Figma-Team-ID": string,
  "X-Figma-File-Key": string,
  "X-Figma-File-Seq": string,
  "X-Figma-User-ID": string,
  "X-Figma-Client-Lifecycle-ID": string,          // 一次 UI 生命周期
  "X-Figma-Support-Request-ID"?: string,
  "X-Figma-Persistent-Entity-ID": string,
  "X-Figma-Cortex-Client-Generated-Request-UUID": string,
  "Tsid": string,                                  // session id
  "X-Referer-Service": "web",
  "X-Referer-ID": string,
  "X-Referer-Owner": string,
  "X-Referer-Type": string,
  "X-Figma-Owner-ID": string,
  "X-Figma-Owner-Type": string,
  // 额外（feature gate 控制）
  "x-figma-client-version"?: string,
  "x-cortex-integration-test"?: string,
  "x-cortex-frontend-skill-overrides"?: string
}
```

`clientLifecycleId / supportRequestId / persistentEntityId` 是贯穿整条链路（前端 → Cortex → sandbox）的追踪三件套，报错上报、埋点、工具回填都带它们。

### 2.4 网络层容错（`eY` 内建）

1. **WAF Challenge**：响应命中 challenge 时弹验证 → 重新 replay，最多 3 次，超过抛 `WAFRetryLimitExceededError`；每次 replay 前 `response.body.cancel()`。
2. **非 2xx**：解析 body，支持 `{ cortex_error: { type, data, devStack, trace } }` 或序列化的 `CortexErrorV2`；404/502/503/504 映射为 `service_busy` / `generic`。
3. **网络错误归一化**：`Failed to fetch` / `Load failed` / `TypeError` → `NetworkError`；离线时 → `OfflineError`。
4. `AbortSignal` 全程透传，取消统一抛 `AbortError`。

---

## 3. 响应：SSE 事件流

### 3.1 传输与解析

```
response.body
  → SSE 解码 (module 406631)：按行解析，data 行以 "\n" 拼接，空行触发 onEvent
  → JSON.parse(chunk.data)          // 每条 data 是一个完整的 JSON 对象
  → 错误探测：若命中 cortex_error / serialized CortexErrorV2 → stream.error()
  → 可选注入：X-Cortex-Request-UUID → { requestUuid }
  → 可选注入：chunk.trace → 写入 IndexedDB（仅保留最近 30 条）+ 发 { trace }
  → zod 校验 (module 450907 `Wd`)：safeParse，**不合法直接丢弃**并上报 onZodParseError
  → 以 ReadableStream<StreamPart> 交给 Agent
```

- SSE 的 `event:` 字段不用，**事件类型全在 `data.type` 里**。
- 用 zod 丢弃非法 chunk 是刻意设计：服务端加新事件类型时，老客户端不会崩，只会静默忽略。
- 事件帧示例：`data: {"type":"text-delta","textDelta":"你好"}\n\n`

### 3.2 事件类型全表（模块 819074 `Uv`）

| type | 字段 | 客户端落盘动作 |
| --- | --- | --- |
| `text-delta` | `textDelta` | 追加到当前 assistant 的 text part |
| `reasoning` | `textDelta`, `isComplete?`, `reasoningBlockId?`, `reasoningDurationMs?` | 累积 reasoning part |
| `reasoning-signature` | `signature` | 写入 reasoning.signature（模型思考签名，回放需要） |
| `redacted-reasoning` | `data` | 存入 redacted-reasoning part |
| `tool-call-start` | `toolCallId`, `toolName`, `parentToolCallId?`, `executingAgent?`, `questionCardVariant?` | 建流式参数 builder；UI 先显示「正在调用 xxx」 |
| `tool-call-delta` | `toolCallId`, `toolName`, `argsTextDelta` | 累积 JSON 参数文本，实时渲染 |
| `tool-call` | `toolCallId`, `toolName`, `args`, `parentToolCallId?`, `executingAgent?`, `providerMetadata?` | 参数定稿；写入 assistant 消息；加入 `pendingToolCalls` |
| `tool-result` | `toolCallId`, `toolName`, `result`, `subagentType?`, `executingAgent?` | 写入独立 `role:"tool"` 消息；从 pending 移除 |
| `tool-progress` | `toolCallId`, `toolName`, `message`, `metadata?` | 更新工具进度文案 |
| `harness-event` | `event`（见 3.3） | 域事件（缺字体、版本创建、画布目标更新…） |
| `step-start` | – | 步骤开始（占位） |
| `step-finish` | – | 记 `lastStepFinishMessagesSize`，作为回滚点 |
| `step-rollback` | – | 回滚到上一个 step-finish 的消息长度，清空 pending/streaming |
| `prompt-outcome` | `outcome: "success" \| "error" \| "interrupted" \| "unknown"` | 写 `assistant-prompt-lifecycle` part；`interrupted` 用于「已停止」态 |
| `messagesCommitted` | `lastCommittedMessageIndex`, `committedMessageIndices?`, `hadCodeChanges?` | 提交锚点（撤销/续写） |
| `client-undo-token` | `token?`, `fileVersion?` | 交给 `onClientUndoToken` 回调 |
| `usage-info` | `contextUsageRatio`, `turnActivity?` | 上下文占用、本轮耗时统计 |
| `compressionStart` / `compressionFinish` | – | 服务端压缩历史时的 UI 状态 |
| `tool-deferred` | `stopReason: "tool_deferred"`, `deferredToolUse` | 工具延后执行（等待用户批准/外部条件） |
| `user-input` | `inputId`, `text` | steering 插话在流中被「回填」成一条 user 消息 |
| `heartbeat` | – | 保活 |

> `ZV`（首包事件集合）= `text-delta / reasoning / reasoning-signature / redacted-reasoning / tool-call-start / tool-call-delta / tool-call`，用于统计 TTFT（首个模型输出时间）。

### 3.3 `harness-event` 的细分类型

`library_guidelines_read`、`version_created`、`canvas_target_update`、`descriptive_tool_call`、`run_plugin`、`react_to_canvas_debug`、`missing_fonts`、`design_progress_milestone`，以及兜底：

- 未知类型 → 服务端或客户端统一改写成 `unsupported_harness_event`（保留 `originalType`、`toolCallId`）；
- `progress_update` 显式降级为 `unsupported_harness_event`。

客户端只特殊处理 `missing_fonts`（记录 toolCallId，用于「字体缺失」错误不弹错误 toast），其余原样挂在 assistant 消息的 `harness-event` part 上。

---

## 4. Agent 循环（可复刻的核心）

### 4.1 `sendMessage`

```
1. 记录本轮使用的 skills / 埋点（MESSAGE_SENT、@mention 等）
2. threadBuilder.appendUserMessage(userMessage)
3. turnStartedAtMs = now；重置 seenFirstModelOutput / seenFirstTextDelta / seenFirstReasoning
4. runAgentLoop({ serverSideChatParams })
5. 成功：onUpdateThread(getNewMessages(), final=true)；上报 RESPONSE_RECEIVED
6. 失败：根据是否 Abort 上报 aborted / failed；
   若本地一条 assistant 消息都没有，则伪造一条兜底文案
7. finally：resolveFirstToolCall()（补报首个工具调用的耗时）
```

### 4.2 `processResponseStreamFromAgent`（单次网络往返 + 解析）

```ts
const messages = serverSideChatParams
  ? [threadBuilder.getLatestMessage()]
  : threadBuilder.getNewMessages();

const req = this.buildRequest({ messages, serverSideChatParams });
const snapshot = threadBuilder.createSnapshot();   // 重试回滚点
let attempt = 0;

for (;;) {
  this.wasInterrupted = false;
  try {
    const reader = (await this.streamResponse(req)).getReader();
    for (;;) {
      const { done, value: part } = await reader.read();
      if (done) break;

      // TTFT 打点
      if (!seenFirstModelOutput && FIRST_OUTPUT_TYPES.has(part.type)) {
        seenFirstModelOutput = true;
        part.type !== "tool-call" && onFirstModelOutput?.();
      }

      switch (part.type) {
        case "text-delta":   /* onFirstTextDelta once */ break;
        case "reasoning":    /* onFirstReasoning once */ break;
        case "tool-call":    sandboxToolCallObserver.processToolCall(part);
                             onFirstModelOutput?.();
                             resolveFirstToolCall(part.toolCallId); break;
        case "tool-call-start": sandboxToolCallObserver.processToolCallStart(part, now()); break;
        case "tool-result":     sandboxToolCallObserver.processToolResult(part, {...}); break;
        case "harness-event":   /* missing_fonts → missingFontToolCallIds */ break;
        case "prompt-outcome":  this.wasInterrupted = part.outcome === "interrupted"; break;
        case "step-finish":     onStepFinish?.(); break;
        case "step-rollback":   onStepRollback?.(); break;
        case "compressionStart":onCompressionStateChange?.(true); break;
        case "compressionFinish":onCompressionStateChange?.(false); break;
        case "usage-info":      part.turnActivity && (this.lastTurnActivity = part.turnActivity);
      }
      threadBuilder.processStreamPart(part);   // 统一落盘
    }
    return;
  } catch (err) {
    if (!isClientSideRetryableError(err) || this.isAbortedError(err)) throw err;
    if (serverSideChatParams) throw err;       // server-side chat 不重试
    if (attempt >= 2) throw err;
    threadBuilder.restoreSnapshot(snapshot);   // 关键：整体回滚
    await sleep(Math.min(1000 * 2 ** attempt + 500 * Math.random(), 5000));
    attempt++;
  } finally {
    onCompressionStateChange?.(false);
  }
}
```

**重试策略（注意：只重试网络类错误）**

| 维度 | 规则 |
| --- | --- |
| 可重试 | `OfflineError` / `NetworkError`（marker 判定）或 `statusCode ∈ {502, 504}` |
| 不可重试 | 用户 Abort、`serverSideChatParams` 模式、4xx / 业务错误 / 内容安全 |
| 次数 | 最多 2 次重试（共 3 次尝试） |
| 退避 | `min(1000·2^n + 500·random, 5000)` |
| 回滚 | `restoreSnapshot` 同时恢复 `newMessages` 与 `pendingToolCalls`，避免「半个 tool-call」污染下一轮 |

> 这就是「断点重放」的正确姿势：不是把错误拼成一条 user 消息重发，而是把本地消息树回滚到请求前，再重发同一个请求（服务端按 thread 幂等地续上）。

### 4.3 `runAgentLoop`（多步工具循环）

```
for (;;) {
  await processResponseStreamFromAgent(...)

  if (isSandboxStream) {
    // 工具在服务端 sandbox 执行，tool-result 也会随流推回；客户端不再二次执行
    if (pendingToolCalls.length) log("sandbox stream ended with dangling tool calls")
    break
  }

  const pending = threadBuilder.getPendingToolCalls()
  if (pending.length === 0) break                 // 没有工具调用 → 本轮结束

  const unknown = pending.filter(c => !tools[c.toolName])
  if (unknown.length) throw MissingToolError(unknown)

  for (const call of pending) {
    const tool = tools[call.toolName]
    toolCallTracker.push({ toolCallId, trackingName: tool.trackingName, metadata })

    onToolCallStart?.()
    try {
      const result = await tool.executeClientSide(call.args, ctx, abortSignal)
      appendToolResult(call, result)               // 大结果可上传 blobstore → tool-result-ref
      toolCallTracker.markSuccess / markFailure
    } catch (e) {
      appendToolResult(call, { error: `${e.name}: ${e.message}` })  // 错误也回填，让模型自愈
    } finally {
      onToolCallEnd?.()
    }
  }
  // 回到循环顶部：带着新的 tool 消息再请求一次（server-side 场景则由服务端自己转）
}
```

要点：

- **maxTurns 不在客户端控制**，由服务端 `overrides.maxTurns` / agent 配置决定；客户端循环只受 `pendingToolCalls` 驱动。
- 工具执行失败不中断回合，而是把 `{ error }` 作为 tool 结果回填。
- 工具输出支持「引用化」：`tryUploadToolResultToBlobStore` 成功时写 `tool-result-ref`（带 `blobstoreContentKey`），避免大 JSON 撑爆消息体；上传失败降级为普通 tool-result。
- `isSandboxStream = true` 时客户端只渲染，不执行工具，也不继续循环。

---

## 5. ThreadBuilder：消息模型与流式落盘

### 5.1 消息与 part

```ts
type Message = {
  createdAtMs: number
  role: "user" | "assistant" | "tool"
  content: Part[]          // 见下表
  clientId?: string        // steering 去重 / 对账
  index?: number           // 服务端消息序号（带 messageIndexOffset）
  makeVersion?: ...
}

type Part =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string; signature?: string }
  | { type: "redacted-reasoning"; data: string }
  | { type: "tool-call"; toolCallId; toolName; argsJSON; parentToolCallId?;
      questionCardVariant?; progressJSON?; isPartiallyStreamed?: boolean }
  | { type: "tool-result"; toolCallId; toolName; resultJSON }
  | { type: "tool-result-ref"; toolCallId; toolName; blobstoreContentKey }
  | { type: "harness-event"; event: HarnessEvent }
  | { type: "client-undo-token"; token?: string }
  | { type: "assistant-prompt-lifecycle"; state: "started" | "success" | "error" | "interrupted" | "unknown" }
  | { type: "selected-nodes" | "selected-node-ids" | "image" | "local-assets-enabled"
        | "enabled-libraries" | "referenced-file" | "referenced-template"
        | "comment-thread-reference" | "current-time" | "selected-view" | "selected-plan"
        | "user-org-team-membership" | "slack-thread-context" | "jsx" | "code-sources"
        | "undo-last-committed-change" | ... /* 上下文类 part */ }
```

`appendUserMessage` 会**逐类型白名单拷贝**，未知类型直接抛错（`Content part X is not implemented for Assistant.`）——这是一种强约束：新 part 类型必须显式接线。

### 5.2 流式 tool-call 参数（很值得抄）

服务端把工具参数按字符流下发（`tool-call-delta.argsTextDelta`），客户端边收边解析：

1. `handleToolCallStartBase`：用 `toolCallStartSchema` 校验后建 `builder`；
2. `handleToolCallDeltaBase`：把 delta 塞进 `JsonStreamParser`（增量 JSON 解析器）；
3. 每次 flush：
   - `successful-parse` → 直接用；
   - `repaired-parse` → 修复（补括号/截断）后标记 `isPartiallyStreamed`；
   - `failed-parse` → 用「逐步前缀 + 二分」找最长可解析前缀兜底；
4. `tool-call`（完整事件）到达后覆盖前面流式写入的临时 part（按 `toolCallId` 定位，去重）。

UI 因此可以做到：**参数还在流式生成时就把「调用 xxx / 参数预览」渲染出来**，而不是等整个参数 JSON 结束。

### 5.3 回滚与提交

- `step-finish` 记录 `lastStepFinishMessagesSize`；
- `step-rollback`：`newMessages.length = lastStepFinishMessagesSize`，清空 `streamingToolCallBuilders / pendingToolCalls`；
- `createSnapshot / restoreSnapshot`：深拷贝 `newMessages` + `pendingToolCalls`（重试用）；
- `messagesCommitted` + `client-undo-token`：与服务端对齐「已提交消息边界」和撤销 token，支持 undo 后重放。

### 5.4 工具结果插入位置

`pushToolResult` 不是简单 append，而是：

1. 找到「含该 `toolCallId` 的 assistant 消息」的位置 `i`；
2. 若 `i+1` 是 `tool` 消息 → append 进去；否则**插入一条新的 `role:"tool"` 消息**在 `i+1`。

保证 OpenAI/Anthropic 风格的消息顺序（assistant tool-call 紧邻 tool result）。

---

## 6. 工具系统

客户端工具表形态（由 `createTools()` 产出，按 `name` 查表）：

```ts
type ClientTool = {
  name: string               // 模型侧名字
  trackingName: string       // 埋点/日志名（如 "make-edits"）
  parameters: ZodSchema      // 参数 schema（本地校验 / 埋点解析）
  executeClientSide: (args, ctx, signal) => Promise<unknown>
  // ctx = { ...trackingContext, toolCallId, toolName }
}
```

- 工具清单示例（设计域）：`edit_design`、`create_design`、`select_layers`、`component_search`、`local_component_search`、`serialize_nodes`、`render_node`、`export_assets`、`search_current_design_file`、`get_visible_libraries`、`execute_plugin_code`、`lookup_plugin_api` …
- 每个工具都有 `trackingName` 与 `makeEditsConfigurationKey` 等元数据，用于埋点聚合；
- `skill` 类工具（`use_skill`）单独归类，首个工具调用的 TTFT 统计会区分 `tool / skill`；
- 工具结果统一 `JSON.stringify`；错误约定为 `{ error: { errorName, errorMessage } }` 或 `{ error: "Name: message" }`。

> 复刻时注意：**工具 schema 不一定非要由客户端下发给模型**。Figma 的做法是「schema 在 agent 配置里，客户端只按 name 实现执行器」。如果自建后端不方便集中管理，也可以退化为 OpenAI tools 随请求下发（你们现在就是这样）。

---

## 7. 其他工程细节（容易被忽略但很关键）

1. **首包/首字/首思考**分开打点：`onFirstModelOutput / onFirstTextDelta / onFirstReasoning`，并区分 tool/skill。
2. **compressionStart/Finish** 驱动「正在压缩上下文」的 UI，且在 `finally` 中强制复位，避免卡在压缩态。
3. **usage-info.turnActivity**：`toolUseMs / llmApiMs / numToolCalls / numLlmCalls / timeToFirstLlmCallMs`，用于性能回归。
4. **trace 落 IndexedDB**：每个 fileKey 最多 30 条执行 trace，供调试面板回放。
5. **模拟错误注入**（模块 449511，`make_edits_debug` gate）：可注入 `NetworkError / ProviderRateLimitExceededError / MidStreamError / SandboxDisconnectedError` 等，分别模拟「请求前失败 / 合成流失败 / 真流中途失败」——做容错测试时可以直接照抄这个思路。
6. **steering（回合中插话）**：幂等键是 `clientId`；先 POST `delivery:"steer"` 拿 `steered / not_steered`，主流的 `user-input` 事件再把这条消息插到正确位置；`appendUserMessage` 会对同 `clientId` 的 user 消息去重。
7. **Abort 语义**：客户端 abort → fetch 抛 `AbortError` → 不重试、不报错，保留已渲染内容；服务端会补 `prompt-outcome: interrupted`。
8. **Zod 丢弃脏数据**：不要为了「兼容」把未知事件硬塞进消息树，官方是静默丢弃 + 上报，保证 UI 永远只处理已知形状。

---

## 8. 与当前 `ai-canvas-copilot` 的差异

| 能力 | Figma 官方 | 当前实现（[agent.service.ts](file:///e:/figma-countdown/ai-canvas-copilot/src/ui/services/agent.service.ts) / [llm.service.ts](file:///e:/figma-countdown/ai-canvas-copilot/src/ui/services/llm.service.ts)） |
| --- | --- | --- |
| 会话状态 | 服务端按 `threadId` 持有，客户端只发最后一条 user 消息 | 客户端每次拼全量 `messages` |
| 流协议 | 20+ 种语义化 part（reasoning/tool-call-delta/step/compression/outcome…） | OpenAI `choices[0].delta`（content / reasoning_content / tool_calls） |
| 工具循环 | 服务端 Agent Runtime；sandbox 模式下客户端不执行工具 | 客户端 `runAgentLoop` 自己循环，最多 4 轮 |
| 工具 schema | 服务端 agent 配置决定，客户端只实现 executor | `TOOLS` 随请求下发 |
| 失败重试 | 仅网络错误，快照回滚 + 指数退避，最多 2 次 | 「把错误拼成 user 消息重发」，最多 3 次（语义不同） |
| 步骤边界 | `step-start / step-finish / step-rollback` 由服务端给 | UI 侧手工 `addStep / updateStep` |
| 流式参数 | `tool-call-delta` + JSON 增量修复 | `tool_calls[index].arguments` 拼接 |
| 上下文压缩 | 服务端压缩 + `compressionStart/Finish` | 无 |
| 撤销 | `messagesCommitted + client-undo-token + /assistant/undo` | 无 |
| 回合中插话 | steering + `user-input` 回填 | 无（生成中直接禁止发送） |
| 可观测性 | TTFT / turnActivity / trace / 首工具调用耗时 | 仅有步骤文案 |

---

## 9. 复刻路线（按依赖顺序，可直接排期）

### P0 传输层：把「一行行 delta」升级为「事件流」

```ts
// src/ui/services/cortex/transport.ts
export type StreamPart = /* 见 3.2 的联合类型 */

export async function* openChatStream(req: ChatRequest, signal: AbortSignal) {
  const res = await fetch("/api/agent/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Request-Id": crypto.randomUUID() },
    body: JSON.stringify(req),
    signal,
  })
  if (!res.ok) throw await toApiError(res)
  yield* parseSSE<StreamPart>(res.body!, signal)
}

// SSE：按空行切事件，data 行以 \n 拼接，JSON.parse 后按 type 分发；
// 解析失败仅上报并跳过（不要 throw）。
```

要点：错误信封统一为 `{ error: { type, message, retryable, status } }`；`retryable` 由服务端给，客户端只认这个字段 + 网络异常。

### P1 ThreadBuilder：消息树 + 快照

- `messages: Message[]`、`pendingToolCalls: Map<toolCallId, ToolCall>`；
- `applyPart(part)` 对应 5.1 / 5.2 的落盘规则；
- `snapshot() / restore()` 深拷贝两者；
- `stepFinish` 记录回滚水位；
- tool 消息按 5.4 插入。

### P2 Loop：把当前 `runAgent` 改成「事件驱动 + 快照重试」

- 外层：`send(userMessage)` → 追加 user 消息 → `runLoop()`；
- `runLoop`：`request → consume(parts) → 若 pendingToolCalls 非空则执行 → 再 request`；
- 工具执行结果写回 `role:"tool"` 消息（**不要**再把错误拼成 user 消息）；
- 终止条件：`pendingToolCalls` 为空 / `prompt-outcome ∈ {success,error,interrupted}`；
- 重试只包在网络异常上，且必须 `restore()` 后重发。

### P3 断线、取消、插话

- `AbortController` 贯穿 transport → 工具执行；
- 取消后保留已渲染内容，状态置 `interrupted`；
- 需要「生成中追加指令」时，走独立 `steer` 接口 + `clientId` 幂等 + `user-input` 事件回填。

### P4 体验与观测

- `tool-call-delta` 流式渲染参数预览 + `isPartiallyStreamed` 标记；
- `step-finish / step-rollback` 驱动步骤条；
- TTFT（首模型输出/首字/首思考）、首工具调用耗时、`turnActivity` 打点；
- `usage-info.contextUsageRatio` 做上下文占用提示，为 `compressionStart` 做 UI 准备。

### 建议的模块划分（对应现状）

```
src/ui/services/agent/
  transport.ts      // fetch + SSE + 错误信封
  protocol.ts       // StreamPart / Message / Part 类型 + zod 校验
  threadBuilder.ts  // 消息树、tool-call 累积、快照/回滚
  loop.ts           // runAgentLoop（替代 agent.service 里的双层 for）
  tools/            // toolName → executor 注册表（复用现有 capabilities）
```

改造后，现有 `llm.service.ts` 退化为「transport 的一个 provider 实现」（OpenAI 兼容 → 转换为统一的 `StreamPart`），UI 只消费 `StreamPart`，不再直接解析 `choices[].delta`。

---

## 10. 复刻时的坑位清单

1. **不要把 tool 错误拼成 user 消息**。回滚 + 重发同一个请求，语义才干净；否则模型会看到一条「人类在纠正它」的假消息，行为会漂移。
2. **重试必须整体回滚**，包括 `pendingToolCalls`；只回滚文本会导致下一轮重复执行工具。
3. **`step-finish` 是回滚水位**，不是「这一轮结束」；两者别混。
4. **未知事件要丢弃**，不要 passthrough 到消息树，否则 UI 的 `switch` 会炸。
5. **tool-result 的插入位置**要保证「assistant(tool-call) → tool(result)」相邻。
6. **参数流式解析失败**要有兜底（最长可解析前缀），否则一个截断的 JSON 会让整轮工具调用失败。
7. **首包打点要区分 tool / skill**，否则「首字时间」指标会被工具回合污染。
8. **压缩状态必须在 finally 复位**，否则网络中断会永久卡在「压缩中」。

---

## 附录 A：如何自己复核/再抓一份

1. 从 DevTools 的 Network 里复制 chunk URL（形如 `https://www.figma.com/webpack-artifacts/assets/<chunk>-<hash>.min.js.br`）；
2. 直接 `curl` 下载（实测 CDN 会返回未压缩内容，或带 `Content-Encoding: br`）；
3. 若是 brotli：`node -e "const z=require('zlib');process.stdout.write(z.brotliDecompressSync(require('fs').readFileSync('x.js.br')))" > x.js`；
4. 用模块号搜索：minified 产物里模块形如 `70742(e,t,r){`，配合字符串（`processResponseStreamFromAgent` / `buildRequest` / `isClientSideRetryableError`）定位；
5. 想直接看线上真实流量：在 DevTools 里过滤 `assistant/chat`，看 Request Payload 与 EventStream 的 `data:` 帧即可验证第 2、3 节。

## 附录 B：本文对应的关键符号速查

| 符号 | 含义 |
| --- | --- |
| `ZV` | 首包事件集合（TTFT 判定） |
| `Uv` | 流事件联合 schema |
| `Bq` | `/assistant/chat` 请求 schema |
| `U$` / `Wh` | `steer` 请求 / 响应 schema |
| `Eb` | Figma 版 Agent 类 |
| `g` | Agent 基类 |
| `vu` / `cL` | ThreadBuilder 基类 / 子类 |
| `Eb.buildRequest` | 只透传 messages + serverSideChatParams + agent 配置 |
| `isClientSideRetryableError` | 仅 `OfflineError/NetworkError` 或 502/504 返回 true |
