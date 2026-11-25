# AI Canvas Copilot

English | [中文](README_zh-cn.md) | [GitHub](https://github.com/SinJayXie/figma-ai-canvas-copilot)

AI Canvas Copilot is a Figma plugin that turns natural-language chat into real, editable canvas work. Instead of generating images, it creates and modifies native Figma layers — frames, text, components, styles, variables, and prototype interactions — so the result remains as editable and reusable as a hand-made design.

- Version: v1.1.0
- Runtime: Figma Design (`editorType: figma`)
- Architecture: front-end only, no self-hosted backend, bring your own model API

---

## Features

### Design through conversation

- Generate pages, components, styles, variables, and prototype interactions as editable layers, not screenshots
- Uses the current selection as context when available; otherwise works from the current page
- Preview canvas operations before applying, or enable auto-apply
- Streaming output, stop at any time, regenerate, and delete a whole turn
- Live sync of selection changes, page switches, and document updates

### Design-system aware

- Reads a compact design context for the current page or selection on every turn, with a structured budget of roughly 7k tokens
- Summarizes local components, styles, and variables as a design-system snapshot and prefers reusing existing assets (60s cache)
- Lightweight design lint: 8pt grid, type scale, touch target height, and WCAG AA contrast — reported as hints without blocking application

### Task mode (step-by-step generation)

- The model breaks work into a task list and continues automatically after the first step is approved
- A task panel shows progress, the current step, and completion state
- Changes are limited to layers created by the current task, reducing the risk of large uncontrolled rewrites
- Tool-call rounds are configurable per model; the automatic retry count is set in General settings

### Model integration

- Works with any **OpenAI-compatible `/chat/completions`** service, with 13 built-in presets:
  DeepSeek, OpenAI, Kimi / Moonshot, Zhipu GLM, Qwen, SiliconFlow, OpenRouter, Groq, Mistral, xAI Grok, Google Gemini, Ollama (local), and Custom
- Per-model Base URL, API key, and generation parameters (context window, temperature, Top-P, max output, thinking mode / reasoning effort, extra request body, and more)
- Connectivity test and quick model switching
- Image attachments for vision-capable models, including pasted images

> Important: the model must support **Tool Calls / Function Calling** and SSE streaming to drive canvas operations.

### Efficient input and delivery

- `/` quick commands: 15 built-in templates (skeleton, color variants, wireframe, dark mode, form, card, navbar, button group, empty state, modal, table, grid, organize layers, extract component, design audit)
- Custom quick commands (up to 20, overriding built-ins by name) and an extra system prompt
- Token usage and context usage indicators; switch between Enter and Ctrl+Enter to send
- `html` code blocks from the model can be previewed directly; referenced canvas layers can be exported as assets and downloaded together with the HTML as a ZIP

### Data and conversations

- Multiple conversations isolated per Figma file (up to 20 conversations × 50 messages each)
- Configuration and history stored in Figma's local `clientStorage`
- Follows Figma light/dark theme; clear the current conversation or all data
- Canvas writes are idempotent per `batchId`, so timeout retries never create duplicates

---

## Getting Started

### Requirements

- Node.js 18+
- pnpm (recommended; the repo includes `pnpm-lock.yaml` — npm or yarn also works)
- Figma desktop app (recommended) or web app

### Clone the repository

```bash
git clone https://github.com/SinJayXie/figma-ai-canvas-copilot.git
cd figma-ai-canvas-copilot
```

### Install dependencies

```bash
pnpm install
```

### Development

Watch both the UI and sandbox builds:

```bash
pnpm dev
```

### Build

```bash
pnpm build
```

Outputs:

- `dist/ui.html` — plugin UI with JS/CSS inlined into a single file
- `dist/code.js` — Figma sandbox script, bundled as a single IIFE file

### Package a release

```bash
pnpm package
```

Produces `release/ai-canvas-copilot-v{version}.zip` containing `manifest.json`, `dist/`, and `icon.png`.

### Automated releases

After a push to `main` / `master`, GitHub Actions reads the `version` in `package.json`:

- If tag `v{version}` does not exist: install dependencies, build, package, and create a GitHub Release
- If tag `v{version}` already exists: skip publishing, so the same version is never released twice

To publish a new or patch version, bump `version` in `package.json` and commit; you can also run the workflow manually from the Actions page to re-publish the current version.

### Load into Figma

1. Run `pnpm build` first (the `main` / `ui` entries in `manifest.json` point to `dist/`)
2. Open Figma and enter any Design file
3. Go to **Plugins → Development → Import plugin from manifest…**
4. Select `manifest.json` in the project root
5. Run **AI Canvas Copilot** from **Plugins → Development**
6. On first use, the plugin opens Settings — enter your model and API key

> The `id` in `manifest.json` is the development ID `ai-canvas-copilot-dev`. Replace it with the plugin ID you create in the Figma dashboard before publishing to the Figma Community.

---

## Usage

1. **Configure a model**: Settings → Models, pick a provider preset or enter any OpenAI-compatible Base URL, add the API key, and run the connectivity test
2. **Provide context (optional)**: select the layers to reference or modify; otherwise the current page is used
3. **Describe the work**: type your request, or press `/` to choose a quick command
4. **Preview and apply**: review the operation preview card and apply, or enable auto-apply
5. **Enable task mode when useful**: recommended for full-page generation and large refactors

Example requests:

- Turn the selected card into a dark theme while keeping WCAG AA contrast
- Create a login page on the current page: email input, password input, sign-in button
- Clean up layer names on this page and align spacing to an 8pt grid without deleting anything
- Build a settings page using the existing component library, preferring existing styles and variables

---

## How It Works

```text
┌──────────────────── Figma plugin UI (Vue 3) ────────────────────┐
│ Chat / Settings / Task panel / Operation preview                │
│                                                                 │
│ agent.service   orchestrates tool rounds, applies ops, retries   │
│ llm.service     OpenAI-compatible SSE streaming + tool_calls     │
│ promptBuilder   layered system prompt + history trimming         │
│ canvasContext   selection/page context + design system snapshot  │
│ toolCallParser  tool-call parsing, validation, node id mapping   │
└───────────────────────────┬─────────────────────────────────────┘
                            │ postMessage: request/response + events
┌───────────────────────────▼─────────────────────────────────────┐
│ Figma sandbox (code.js, no DOM)                                 │
│ Serial request queue · idempotent ops batches · read/write split │
│ capabilities: 34 read / 106 write operations                    │
│ renderer: NodeOp → native Figma nodes                           │
│ serializer: canvas/selection → structured context               │
│ storage: clientStorage config + per-fileKey history             │
└─────────────────────────────────────────────────────────────────┘
```

A typical turn:

1. Assemble the system prompt, conversation history, canvas context, and design-system snapshot
2. Request the model using the OpenAI `tools` protocol and stream text and `tool_calls`
3. `create_ops` / `update_ops` go through parsing, validation, and design lint before preview; applying writes them in batches by action
4. `figma_call` invokes read/write capabilities directly; destructive operations such as deletion or instance detaching require confirmation
5. Feed tool results back to the model and continue until it produces a final answer or reaches the round limit

Implementation notes:

- The UI and sandbox are fully isolated; every Figma API call goes through the message bridge. Requests inside the sandbox run serially so writes stay ordered
- `ops:create` / `ops:update` are idempotent per `batchId`; network retries never create duplicates
- Some single-node write capabilities accept multiple `nodeIds` and run per node, so one failure does not block the others
- Tool results are capped in length to keep large JSON from flooding the context
- When the context exceeds its budget, it degrades in order — design system, then node count, then page summary only — and never truncates JSON strings

---

## Project Layout

```text
.
├─ manifest.json                  # Figma plugin manifest (main/ui point to dist)
├─ src/
│  ├─ code/                       # Figma sandbox (no DOM)
│  │  ├─ index.ts                 # message dispatch, serial queue, events
│  │  ├─ capabilities/            # 34 read + 106 write capabilities
│  │  ├─ renderer/                # NodeOp → native nodes
│  │  ├─ serializer/              # canvas/selection → model context
│  │  └─ storage/                 # clientStorage wrapper
│  └─ ui/                         # Plugin UI (Vue 3)
│     ├─ services/                # agent / llm / bridge / context / HTML assets
│     ├─ components/              # chat, input, operation preview, task panel
│     ├─ views/                   # chat page and settings page
│     ├─ store/                   # Pinia: conversations / canvas / config
│     └─ utils/                   # prompt, tool parsing, lint, ZIP, etc.
├─ types/                         # Shared types (config / messages / nodes / LLM)
├─ docs/figma-agent-protocol.md   # Reverse-engineering notes on Figma's agent protocol
├─ scripts/package.mjs            # Pure Node ZIP packaging script
├─ vite.config.ts                 # Single-file UI build
├─ vite.config.code.ts            # IIFE sandbox build
└─ dist/                          # Build output (ui.html / code.js)
```

### Capabilities

- **Read (34)**: document, pages, selection, node details, design context, metadata, viewport, fonts, text scanning, node search, styles, variable libraries, components, annotations, token export, screenshots, PDF export, CSS, image bytes, current user, and more
- **Write (106)**: create frames/text/components/pages/slices, fills and strokes, auto layout, constraints and alignment, boolean operations, SVG and image import, styles and variables, instances and variants, prototype interactions, annotations, export settings, file thumbnail and versions, and more
- **Destructive operations**: `delete_nodes`, `delete_page`, `delete_style`, `delete_variable`, `delete_variable_collection`, `detach_instance`, `reset_instance_overrides` (and any `delete_*`) always require explicit user confirmation

---

## Testing

```bash
pnpm test
```

Vitest unit tests cover:

- Config normalization and model validation (`types/__tests__`)
- Renderer appearance and layout mapping (`src/code/renderer/__tests__`)
- Write-capability helpers (`src/code/capabilities/__tests__`)
- Tool-call parsing, prompt building, design lint, HTML assets, Markdown, and date tools (`src/ui/utils/__tests__`)

---

## Tech Stack

- **UI**: Vue 3, TypeScript, Pinia, Tailwind CSS 3
- **Build**: Vite 5, `vite-plugin-singlefile`, IIFE library build
- **Model protocol**: OpenAI-compatible Chat Completions (SSE + Tool Calls)
- **Validation and utilities**: Zod, marked, tokenx, @mdi/js
- **Testing**: Vitest

---

## Configuration and Privacy

- Plugin configuration and conversation history stay in Figma's local `clientStorage`; nothing is uploaded to the plugin author's servers
- Model requests go directly to the Base URL you configure; the plugin has no relay backend
- API keys are stored as plaintext in local Figma storage — avoid saving sensitive keys on shared machines
- `manifest.json` declares `networkAccess.allowedDomains: ["*"]` to support arbitrary custom model endpoints (including local Ollama); the plugin only contacts the model service you configure

---

## Known Limitations

- Supports Figma Design only — not FigJam or Slides
- The model must support Tool Calls; without it, only plain-text chat is possible
- The plugin UI is currently in Chinese
- Conversation history is capped at 20 conversations × 50 messages per file; for storage size, persisted canvas operations keep only a count summary
- Generation quality depends on the model and available context; task mode is recommended for complex pages
- Replace the development plugin ID before publishing to the Figma Community

---

## Further Reading

- [docs/figma-agent-protocol.md](docs/figma-agent-protocol.md): a static analysis of Figma's official agent request body, SSE event stream, and tool loop, including differences from this implementation and a reproduction roadmap. It is research material and does not affect the plugin at runtime.

---

## License

This project is licensed under the [MIT License](LICENSE).
