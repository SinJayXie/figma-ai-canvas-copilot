# AI Canvas Copilot

[English](README.md) | 中文 | [GitHub](https://github.com/SinJayXie/figma-ai-canvas-copilot)

AI Canvas Copilot 是一个 Figma 插件：用自然语言对话驱动 AI，在画布上直接生成和修改**原生、可继续编辑**的图层。它不生成图片，而是输出 Figma 的 Frame、Text、Component、Style、Variable 等真实节点，生成结果与手工设计稿一样可以继续编辑、复用和交付。

- 版本：v1.1.0
- 运行环境：Figma Design（`editorType: figma`）
- 形态：纯前端插件，无自建后端，模型 API 由使用者自行配置

---

## 功能特性

### 对话即设计

- 自然语言生成页面、组件、样式、变量、原型交互等，输出可编辑图层而非截图
- 选中图层时优先围绕选区工作；未选中时基于当前页面上下文
- 画布操作先预览后应用，也可开启「生成后自动应用」
- 流式输出、随时停止、重新生成、按轮删除消息
- 画布选中、页面切换、文档变更实时同步到插件

### 设计系统感知

- 每轮自动读取当前页/选区的紧凑设计上下文，并按约 7k token 估算预算做结构化裁剪
- 汇总本地组件、样式、变量作为「设计系统摘要」，优先复用已有资产而不是从零绘制（60s 缓存）
- 轻量设计规范检查：8pt 网格、字号阶梯、触控高度、WCAG AA 对比度，结果作为提示展示，不阻塞应用

### 任务模式（分步生成）

- 模型先拆分任务列表，首步应用确认后自动续跑后续步骤
- 任务面板实时展示进度、当前步骤与完成情况
- 仅改动本任务创建的图层，降低大页面一次性生成的失控风险
- 工具调用轮数可按模型独立配置，自动重试次数可在通用设置中调整

### 多模型接入

- 支持任意 **OpenAI 兼容 `/chat/completions`** 服务，内置 13 个服务商预设：
  DeepSeek、OpenAI、Kimi / Moonshot、智谱 GLM、通义千问、硅基流动、OpenRouter、Groq、Mistral、xAI Grok、Google Gemini、Ollama（本地）、自定义
- 每个模型独立的 Base URL、API Key 与生成参数（上下文窗口、温度、Top-P、最大输出、思考模式/推理强度、额外请求体等）
- 模型连通性测试、多模型快速切换
- 支持图片附件（需模型支持图片输入），可粘贴图片后直接对话

> 重要：模型必须支持 **Tool Calls / Function Calling** 与 SSE 流式输出，才能驱动画布操作。

### 高效输入与交付

- `/` 快捷指令：内置 15 个模板（骨架、配色变体、线框模式、深色模式、表单、卡片、导航栏、按钮组、空状态、弹窗、表格、栅格、整理图层、提取组件、规范检查）
- 自定义快捷指令（最多 20 条，同名覆盖内置）与自定义追加系统提示词
- Token 用量与上下文占用提示，Enter / Ctrl+Enter 发送可切换
- 模型输出的 `html` 代码块可直接预览；可把画布中引用的图层导出为素材，连同 HTML 打包成 ZIP 下载

### 数据与会话

- 多会话历史，按 Figma 文件隔离（最多 20 个会话 × 每会话 50 条消息）
- 配置与历史保存在 Figma 本地 `clientStorage`
- 自动跟随 Figma 明暗主题，支持清空当前对话或全部数据
- 同一批次画布写入带 `batchId` 幂等，超时重试不会重复生成

---

## 快速开始

### 环境要求

- Node.js 18+
- pnpm（推荐，仓库包含 `pnpm-lock.yaml`；也可使用 npm / yarn）
- Figma 桌面端（推荐）或网页版

### 克隆仓库

```bash
git clone https://github.com/SinJayXie/figma-ai-canvas-copilot.git
cd figma-ai-canvas-copilot
```

### 安装依赖

```bash
pnpm install
```

### 开发

同时监听 UI 与沙箱两份构建：

```bash
pnpm dev
```

### 构建

```bash
pnpm build
```

产物：

- `dist/ui.html`：插件 UI，单文件内联 JS/CSS
- `dist/code.js`：Figma 沙箱脚本，IIFE 单文件

### 打包发布

```bash
pnpm package
```

输出 `release/ai-canvas-copilot-v{version}.zip`，内含 `manifest.json`、`dist/` 与 `icon.png`。

### 自动发布 Releases

推送到 `main` / `master` 后，GitHub Actions 会读取 `package.json` 中的 `version`：

- `v{version}` 标签不存在：自动安装依赖、构建、打包并创建 GitHub Release
- `v{version}` 标签已存在：跳过发布，不会重复创建同一版本

发布新版本或补丁版本时，只需修改 `package.json` 的 `version` 并提交即可；也可在 Actions 页面手动触发工作流补发当前版本。

### 在 Figma 中加载

1. 先执行 `pnpm build`（`manifest.json` 的 `main` / `ui` 指向 `dist/`）
2. 打开 Figma，进入任意 Design 文件
3. 菜单 **Plugins → Development → Import plugin from manifest…**
4. 选择项目根目录的 `manifest.json`
5. 之后从 **Plugins → Development** 运行 **AI Canvas Copilot**
6. 首次使用会引导进入设置页，填写模型与 API Key

> `manifest.json` 中的 `id` 为开发用 `ai-canvas-copilot-dev`。若要发布到 Figma 社区，请替换为你在 Figma 后台创建的插件 ID。

---

## 使用方式

1. **配置模型**：设置 → 模型，选择服务商预设或填写任意 OpenAI 兼容地址，填入 API Key 并测试连通性
2. **提供上下文（可选）**：选中要参考或修改的图层；不选则使用当前页面
3. **描述需求**：直接输入，或用 `/` 选择快捷指令
4. **预览并应用**：检查操作预览卡片，点击应用；开启「自动应用」则直接写入画布
5. **按需开启任务模式**：适合整页生成、批量改造等复杂需求

示例需求：

- 把选中的卡片改成深色模式，保持 WCAG AA 对比度
- 在当前页生成一个登录页：邮箱输入框、密码输入框、登录按钮
- 整理当前页图层命名，统一 8pt 间距，不要删除内容
- 用现有组件库搭建设置页，优先复用已有样式和变量

---

## 工作原理

```text
┌──────────────────── Figma 插件 UI（Vue 3） ────────────────────┐
│ 对话 / 设置 / 任务面板 / 操作预览                               │
│                                                                │
│ agent.service   编排工具循环、应用 ops、自动重试                │
│ llm.service     OpenAI 兼容 SSE 流式请求与 tool_calls 累积      │
│ promptBuilder   分层系统提示词 + 历史裁剪                       │
│ canvasContext   选区/页面上下文 + 设计系统摘要（带预算裁剪）     │
│ toolCallParser  工具调用解析、参数校验、节点 id 映射            │
└───────────────────────────┬────────────────────────────────────┘
                            │ postMessage：请求-响应 + 事件推送
┌───────────────────────────▼────────────────────────────────────┐
│ Figma 沙箱（code.js，无 DOM）                                   │
│ 串行请求队列 · ops batchId 幂等 · 能力读写分离                  │
│ capabilities：34 项读能力 / 106 项写能力                        │
│ renderer：NodeOp → 原生图层创建与更新                           │
│ serializer：画布/选区 → 结构化上下文                            │
│ storage：clientStorage 配置与按 fileKey 隔离的历史              │
└────────────────────────────────────────────────────────────────┘
```

一次生成的主要流程：

1. 组装系统提示词、历史消息、当前画布上下文与设计系统摘要
2. 以 OpenAI `tools` 协议请求模型，流式接收文本与 `tool_calls`
3. `create_ops` / `update_ops` 经解析、校验、设计 lint 后进入预览；应用时按 action 分批写入
4. `figma_call` 直接调用读写能力；删除、解绑实例等破坏性操作需要二次确认
5. 工具结果回填模型，进入下一轮，直到模型给出最终答复或达到轮数上限

关键实现细节：

- UI 与沙箱完全隔离，所有 Figma API 调用经消息桥转发；沙箱内请求串行执行，保证写操作顺序稳定
- `ops:create` / `ops:update` 按 `batchId` 幂等，网络超时重试不会重复创建
- 部分单节点写能力支持传入多个 `nodeIds` 逐节点执行，单个节点失败不影响其它节点
- 工具结果回填有字符上限，避免大 JSON 撑爆上下文
- 上下文超预算时按「设计系统 → 节点数量 → 仅页面摘要」顺序降级，绝不截断 JSON 字符串

---

## 目录结构

```text
.
├─ manifest.json                  # Figma 插件清单（main/ui 指向 dist）
├─ src/
│  ├─ code/                       # Figma 沙箱（无 DOM）
│  │  ├─ index.ts                 # 消息分发、串行队列、事件推送
│  │  ├─ capabilities/            # 34 项读能力 + 106 项写能力
│  │  ├─ renderer/                # NodeOp → 原生图层
│  │  ├─ serializer/              # 画布/选区 → 模型上下文
│  │  └─ storage/                 # clientStorage 封装
│  └─ ui/                         # 插件 UI（Vue 3）
│     ├─ services/                # agent / llm / bridge / 上下文 / HTML 素材
│     ├─ components/              # 对话、输入、操作预览、任务面板等
│     ├─ views/                   # 对话页与设置页
│     ├─ store/                   # Pinia：会话 / 画布 / 配置
│     └─ utils/                   # 提示词、工具解析、设计 lint、ZIP 等
├─ types/                         # 跨层共享类型（配置 / 消息 / 节点 / LLM）
├─ docs/figma-agent-protocol.md   # Figma 官方 Agent 协议拆解（研究资料）
├─ scripts/package.mjs            # 纯 Node ZIP 打包脚本
├─ vite.config.ts                 # UI 单文件构建
├─ vite.config.code.ts            # 沙箱 IIFE 构建
└─ dist/                          # 构建产物（ui.html / code.js）
```

### 可用能力

- **读能力（34）**：文档、页面、选区、节点详情、设计上下文、元数据、视口、字体、文本扫描、节点搜索、样式、变量库、组件、批注、导出 Token、截图、PDF 导出、CSS、图片字节、当前用户等
- **写能力（106）**：创建图层/文本/组件/页面/切片、修改填充描边、自动布局、约束与对齐、布尔运算、SVG 与图片导入、样式与变量管理、实例与变体、原型交互、批注、导出设置、文件缩略图与版本等
- **破坏性能力**：`delete_nodes`、`delete_page`、`delete_style`、`delete_variable`、`delete_variable_collection`、`detach_instance`、`reset_instance_overrides`（以及任何 `delete_*`）执行前必须由用户确认

---

## 测试

```bash
pnpm test
```

Vitest 单元测试覆盖：

- 配置归一化与模型校验（`types/__tests__`）
- 渲染层外观与布局映射（`src/code/renderer/__tests__`）
- 写能力辅助函数（`src/code/capabilities/__tests__`）
- 工具调用解析、提示词构建、设计 lint、HTML 素材、Markdown、日期工具（`src/ui/utils/__tests__`）

---

## 技术栈

- **UI**：Vue 3、TypeScript、Pinia、Tailwind CSS 3
- **构建**：Vite 5、`vite-plugin-singlefile`、IIFE lib 构建
- **模型协议**：OpenAI 兼容 Chat Completions（SSE + Tool Calls）
- **校验与工具**：Zod、marked、tokenx、@mdi/js
- **测试**：Vitest

---

## 配置与隐私

- 插件配置与对话历史仅保存在 Figma 本地 `clientStorage`，不会上传到插件作者的服务器
- 模型请求直接发往你配置的 Base URL；插件本身没有中转后端
- API Key 以明文形式保存在 Figma 本地存储中，请避免在共享设备上保存敏感 Key
- `manifest.json` 声明了 `networkAccess.allowedDomains: ["*"]`，用于支持任意自定义模型地址（含本地 Ollama）；插件只会访问你配置的模型服务

---

## 已知限制

- 仅支持 Figma Design，不支持 FigJam / Slides
- 模型必须支持 Tool Calls；不支持时只能进行纯文本对话，无法驱动画布
- 插件界面目前为中文
- 单文件对话历史上限为 20 个会话 × 50 条消息；为控制存储体积，历史中的画布操作只保留数量摘要
- 复杂页面的生成质量依赖模型能力与上下文，建议配合任务模式使用
- 发布到 Figma 社区前需要替换开发用插件 ID

---

## 相关文档

- [docs/figma-agent-protocol.md](docs/figma-agent-protocol.md)：Figma 官方 Agent 请求体、SSE 事件流与工具循环的逆向拆解，包含与当前实现的差异对照和复刻路线。属于研究资料，不影响插件运行。

---

## 许可证

本项目基于 [MIT License](LICENSE) 开源。
