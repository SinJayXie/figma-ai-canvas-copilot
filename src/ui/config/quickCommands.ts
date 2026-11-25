/**
 * 内置快捷指令配置
 * 输入框输入 / 时展示；用户自定义指令（config.customCommands）会合并进来，同名覆盖内置。
 * 指令名、说明与提示词均随界面语言切换。
 */
import type { QuickCommandConfig } from '../../../types/config.types'
import type { Locale } from '../i18n'

const ZH_CN: readonly QuickCommandConfig[] = [
  {
    label: '/骨架',
    description: '快速搭建页面结构框架',
    prompt: `画一个页面骨架：
- 目标设备未指定时按手机 375 宽处理
- 按从上到下的顺序生成主要区块，先用占位框表示，不写真实文案
- 使用 auto layout 组织，图层命名用中文，间距遵循 8pt 网格
补充说明：`
  },
  {
    label: '/配色变体',
    description: '基于选区输出 3 套配色方案',
    prompt: `给当前选中区域生成 3 种配色变体：
- 变体 1：强化品牌主色；变体 2：中性低饱和；变体 3：高对比强调
- 只改颜色，保持布局、尺寸与层级不变
- 每套配色满足 WCAG AA 对比度，并列出主色 / 辅助色 / 文字色
补充说明：`
  },
  {
    label: '/线框模式',
    description: '把选中内容重绘为线框稿',
    prompt: `用线框风格重绘当前选中区域：
- 使用 #E5E7EB 描边与 #F9FAFB 填充，去掉阴影与渐变
- 保留原有布局、层级和文字内容，不改尺寸与位置
- 图层命名保持中文
补充说明：`
  },
  {
    label: '/深色模式',
    description: '自动适配深色配色与对比度',
    prompt: `为当前选中区域生成深色模式版本：
- 背景 #1C1C1E，卡片 #2C2C2E，分隔线 #3A3A3C
- 主文字 #FFFFFF，次要文字使用 60% 透明白
- 保留品牌强调色，保证 WCAG AA 对比度
- 与浅色版本并排摆放，便于对比
补充说明：`
  },
  {
    label: '/表单',
    description: '生成带标签和输入框的表单',
    prompt: `在当前画板生成一个表单：
- 每个字段包含中文标签和输入框，输入框高度 48、圆角 8
- 主按钮撑满宽度、高度 48，包含默认与禁用状态
- 容器使用 auto layout，字段间距 16、内边距 24
- 未指定字段时按「邮箱 + 密码 + 登录按钮」生成
补充说明：`
  },
  {
    label: '/卡片',
    description: '生成可复用卡片布局',
    prompt: `生成一个信息卡片：
- 包含标题、描述、缩略图或图标、操作按钮
- 宽度 320，圆角 16，内边距 24，元素间距 16
- 使用 auto layout，图层命名用中文
补充说明：`
  },
  {
    label: '/导航栏',
    description: '生成顶部导航与操作区',
    prompt: `为当前页面添加顶部导航栏：
- 高度 56，左右内边距 24，使用横向 auto layout
- 左侧 Logo 或标题，中间导航项，右侧操作按钮
- 选中项使用品牌色，未选中使用次要文字色
补充说明：`
  },
  {
    label: '/按钮组',
    description: '生成按钮样式与状态组',
    prompt: `生成一组按钮：
- 主按钮：品牌色填充 + 白色文字
- 次按钮：描边 + 品牌色文字
- 文字按钮：无背景，仅文字
- 统一高度 44、圆角 8、水平内边距 16，横向排列间距 12
补充说明：`
  },
  {
    label: '/空状态',
    description: '生成空状态占位区块',
    prompt: `生成一个空状态区块：
- 居中图标或插画、标题、说明文字、主操作按钮
- 宽度 320，上下留白 48，文字居中
- 风格与当前页面保持一致
补充说明：`
  },
  {
    label: '/弹窗',
    description: '生成模态弹窗与遮罩',
    prompt: `生成一个模态弹窗：
- 宽度 400，圆角 16，内边距 24
- 标题 + 描述 + 底部操作区（取消 / 确认）
- 附带半透明遮罩 #00000066，弹窗在遮罩上方居中
补充说明：`
  },
  {
    label: '/表格',
    description: '生成数据表格布局',
    prompt: `生成一个数据表格：
- 表头 + 数据行，行高 48，斑马纹 #F9FAFB，分隔线 #E5E7EB
- 首列左对齐，数字列右对齐，操作列居中
- 使用纵向 auto layout，宽度撑满容器
- 未指定字段时按「名称 / 状态 / 更新时间 / 操作」生成
补充说明：`
  },
  {
    label: '/栅格',
    description: '为选区应用 12 列栅格',
    prompt: `为当前选中的 frame 应用 12 列栅格：
- 列间距 24，左右边距 24，栅格颜色使用品牌色 10% 透明度
- 主要区块按栅格对齐，保持 8pt 网格
补充说明：`
  },
  {
    label: '/整理图层',
    description: '规范化命名与图层结构',
    prompt: `整理当前页面：
- 统一图层命名（中文、语义化，如「登录卡片 / 邮箱输入框」）
- 按区块分组，相关元素放进同一 frame
- 为容器应用 auto layout，统一 8pt 间距
- 不删除任何内容，只调整结构与命名
补充说明：`
  },
  {
    label: '/提取组件',
    description: '选中内容转为组件并复用',
    prompt: `把当前选中的元素提取为组件，并在原位置放回实例：
- 保留原有尺寸、样式与层级
- 组件命名用中文，语义清晰
- 如有多个相似元素，合并为同一组件的不同变体
补充说明：`
  },
  {
    label: '/规范检查',
    description: '扫描并修复设计规范问题',
    prompt: `检查当前页面的设计规范并修复：
- 8pt 网格：间距、内边距、尺寸、圆角
- 字号阶梯：12/14/16/20/24/32/48，字重 400/500/600/700
- 文字对比度不低于 4.5:1
- 按钮与输入框触控高度不低于 44
先列出问题清单，再逐项修复并说明改动
补充说明：`
  }
]

const ZH_TW: readonly QuickCommandConfig[] = [
  {
    label: '/骨架',
    description: '快速建立頁面結構框架',
    prompt: `畫一個頁面骨架：
- 未指定目標裝置時，以手機 375 寬處理
- 由上到下產生主要區塊，先用佔位框表示，不寫真實文案
- 使用 auto layout 組織，圖層命名使用繁體中文，間距遵循 8pt 網格
補充說明：`
  },
  {
    label: '/配色變體',
    description: '依選取範圍輸出 3 套配色方案',
    prompt: `為目前選取範圍產生 3 種配色變體：
- 變體 1：強化品牌主色；變體 2：中性低飽和；變體 3：高對比強調
- 只改顏色，維持版面、尺寸與層級不變
- 每套配色需符合 WCAG AA 對比度，並列出主色 / 輔助色 / 文字色
補充說明：`
  },
  {
    label: '/線框模式',
    description: '將選取內容重繪為線框稿',
    prompt: `用線框風格重繪目前選取範圍：
- 使用 #E5E7EB 描邊與 #F9FAFB 填色，移除陰影與漸層
- 保留原有版面、層級和文字內容，不改尺寸與位置
- 圖層命名維持繁體中文
補充說明：`
  },
  {
    label: '/深色模式',
    description: '自動適配深色配色與對比度',
    prompt: `為目前選取範圍產生深色模式版本：
- 背景 #1C1C1E，卡片 #2C2C2E，分隔線 #3A3A3C
- 主文字 #FFFFFF，次要文字使用 60% 透明白
- 保留品牌強調色，確保 WCAG AA 對比度
- 與淺色版本並排擺放，方便對照
補充說明：`
  },
  {
    label: '/表單',
    description: '產生含標籤與輸入框的表單',
    prompt: `在目前畫板產生一個表單：
- 每個欄位包含繁體中文標籤和輸入框，輸入框高度 48、圓角 8
- 主按鈕撐滿寬度、高度 48，包含預設與停用狀態
- 容器使用 auto layout，欄位間距 16、內距 24
- 未指定欄位時，依「電子郵件 + 密碼 + 登入按鈕」產生
補充說明：`
  },
  {
    label: '/卡片',
    description: '產生可重複使用的卡片版面',
    prompt: `產生一個資訊卡片：
- 包含標題、描述、縮圖或圖示、操作按鈕
- 寬度 320，圓角 16，內距 24，元素間距 16
- 使用 auto layout，圖層命名使用繁體中文
補充說明：`
  },
  {
    label: '/導覽列',
    description: '產生頂部導覽與操作區',
    prompt: `為目前頁面加入頂部導覽列：
- 高度 56，左右內距 24，使用橫向 auto layout
- 左側 Logo 或標題，中間導覽項目，右側操作按鈕
- 選取項目使用品牌色，未選取使用次要文字色
補充說明：`
  },
  {
    label: '/按鈕組',
    description: '產生按鈕樣式與狀態組',
    prompt: `產生一組按鈕：
- 主按鈕：品牌色填色 + 白色文字
- 次按鈕：描邊 + 品牌色文字
- 文字按鈕：無背景，僅文字
- 統一高度 44、圓角 8、水平內距 16，橫向排列間距 12
補充說明：`
  },
  {
    label: '/空狀態',
    description: '產生空狀態佔位區塊',
    prompt: `產生一個空狀態區塊：
- 置中圖示或插畫、標題、說明文字、主操作按鈕
- 寬度 320，上下留白 48，文字置中
- 風格與目前頁面保持一致
補充說明：`
  },
  {
    label: '/彈窗',
    description: '產生模態彈窗與遮罩',
    prompt: `產生一個模態彈窗：
- 寬度 400，圓角 16，內距 24
- 標題 + 描述 + 底部操作區（取消 / 確認）
- 附上半透明遮罩 #00000066，彈窗在遮罩上方置中
補充說明：`
  },
  {
    label: '/表格',
    description: '產生資料表格版面',
    prompt: `產生一個資料表格：
- 表頭 + 資料列，列高 48，斑馬紋 #F9FAFB，分隔線 #E5E7EB
- 首欄靠左對齊，數字欄靠右對齊，操作欄置中
- 使用縱向 auto layout，寬度撐滿容器
- 未指定欄位時，依「名稱 / 狀態 / 更新時間 / 操作」產生
補充說明：`
  },
  {
    label: '/柵格',
    description: '為選取範圍套用 12 欄柵格',
    prompt: `為目前選取的 frame 套用 12 欄柵格：
- 欄間距 24，左右邊距 24，柵格顏色使用品牌色 10% 透明度
- 主要區塊依柵格對齊，維持 8pt 網格
補充說明：`
  },
  {
    label: '/整理圖層',
    description: '規範化命名與圖層結構',
    prompt: `整理目前頁面：
- 統一圖層命名（繁體中文、語意化，例如「登入卡片 / 電子郵件輸入框」）
- 依區塊分組，相關元素放進同一個 frame
- 為容器套用 auto layout，統一 8pt 間距
- 不刪除任何內容，只調整結構與命名
補充說明：`
  },
  {
    label: '/提取元件',
    description: '將選取內容轉為元件並重複使用',
    prompt: `將目前選取的元素提取為元件，並在原位置放回實例：
- 保留原有尺寸、樣式與層級
- 元件命名使用繁體中文，語意清晰
- 若有多個相似元素，合併為同一元件的不同變體
補充說明：`
  },
  {
    label: '/規範檢查',
    description: '掃描並修正設計規範問題',
    prompt: `檢查目前頁面的設計規範並修正：
- 8pt 網格：間距、內距、尺寸、圓角
- 字級階梯：12/14/16/20/24/32/48，字重 400/500/600/700
- 文字對比度不低於 4.5:1
- 按鈕與輸入框觸控高度不低於 44
先列出問題清單，再逐項修正並說明變更
補充說明：`
  }
]

const EN_US: readonly QuickCommandConfig[] = [
  {
    label: '/skeleton',
    description: 'Lay out the page structure quickly',
    prompt: `Create a page skeleton:
- If no target device is specified, use a 375-wide mobile frame
- Build the main sections top to bottom as placeholder blocks without real copy
- Use auto layout, name layers in English, and follow an 8pt spacing grid
Additional notes:`
  },
  {
    label: '/palette',
    description: 'Generate 3 color variants for the selection',
    prompt: `Generate 3 color variants for the current selection:
- Variant 1: emphasize the brand color; Variant 2: neutral and low saturation; Variant 3: high-contrast accent
- Change colors only; keep layout, size and hierarchy unchanged
- Each variant must meet WCAG AA contrast and list primary / secondary / text colors
Additional notes:`
  },
  {
    label: '/wireframe',
    description: 'Redraw the selection as a wireframe',
    prompt: `Redraw the current selection in wireframe style:
- Use #E5E7EB strokes and #F9FAFB fills, remove shadows and gradients
- Keep the existing layout, hierarchy and text; do not change size or position
- Keep layer names in English
Additional notes:`
  },
  {
    label: '/dark-mode',
    description: 'Adapt the selection to dark mode',
    prompt: `Create a dark-mode version of the current selection:
- Background #1C1C1E, cards #2C2C2E, dividers #3A3A3C
- Primary text #FFFFFF, secondary text at 60% white
- Keep the brand accent and meet WCAG AA contrast
- Place it next to the light version for comparison
Additional notes:`
  },
  {
    label: '/form',
    description: 'Generate a form with labels and inputs',
    prompt: `Create a form on the current frame:
- Each field has an English label and an input; inputs are 48 high with 8 radius
- The primary button spans the full width and is 48 high, with default and disabled states
- Use auto layout with 16 gap and 24 padding
- If no fields are specified, use "email + password + sign-in button"
Additional notes:`
  },
  {
    label: '/card',
    description: 'Generate a reusable card layout',
    prompt: `Create an information card:
- Title, description, thumbnail or icon, and action button
- 320 wide, 16 radius, 24 padding, 16 gap
- Use auto layout and name layers in English
Additional notes:`
  },
  {
    label: '/navbar',
    description: 'Generate a top navigation and action bar',
    prompt: `Add a top navigation bar to the current page:
- 56 high, 24 horizontal padding, horizontal auto layout
- Logo or title on the left, nav items in the middle, action buttons on the right
- Use the brand color for the active item and secondary text color for the rest
Additional notes:`
  },
  {
    label: '/buttons',
    description: 'Generate button styles and states',
    prompt: `Create a button set:
- Primary: brand fill with white text
- Secondary: outline with brand-colored text
- Text button: no background, text only
- All 44 high, 8 radius, 16 horizontal padding, 12 gap in a row
Additional notes:`
  },
  {
    label: '/empty-state',
    description: 'Generate an empty-state block',
    prompt: `Create an empty state block:
- Centered icon or illustration, title, description and a primary action button
- 320 wide, 48 vertical padding, centered text
- Match the style of the current page
Additional notes:`
  },
  {
    label: '/modal',
    description: 'Generate a modal and overlay',
    prompt: `Create a modal:
- 400 wide, 16 radius, 24 padding
- Title + description + bottom action area (cancel / confirm)
- Add a #00000066 overlay with the modal centered above it
Additional notes:`
  },
  {
    label: '/table',
    description: 'Generate a data table layout',
    prompt: `Create a data table:
- Header + rows, row height 48, zebra stripes #F9FAFB, dividers #E5E7EB
- First column left-aligned, numeric columns right-aligned, actions centered
- Use vertical auto layout and fill the container width
- If no fields are specified, use "name / status / updated at / actions"
Additional notes:`
  },
  {
    label: '/grid',
    description: 'Apply a 12-column grid to the selection',
    prompt: `Apply a 12-column grid to the selected frame:
- 24 gutter and 24 side margins; use the brand color at 10% opacity
- Align the main sections to the grid and keep the 8pt grid
Additional notes:`
  },
  {
    label: '/organize',
    description: 'Normalize layer names and structure',
    prompt: `Organize the current page:
- Use consistent, semantic layer names (e.g. "Login card / Email input")
- Group related elements into the same frame by section
- Apply auto layout to containers and use an 8pt spacing scale
- Do not delete anything; only adjust structure and names
Additional notes:`
  },
  {
    label: '/extract-component',
    description: 'Turn the selection into a component',
    prompt: `Extract the current selection into a component and place an instance back in place:
- Keep the existing size, styles and hierarchy
- Name the component clearly in English
- If several similar elements exist, merge them into variants of the same component
Additional notes:`
  },
  {
    label: '/audit',
    description: 'Scan and fix design-system issues',
    prompt: `Audit the current page for design-system issues and fix them:
- 8pt grid: spacing, padding, sizes, radii
- Type scale: 12/14/16/20/24/32/48, weights 400/500/600/700
- Text contrast at least 4.5:1
- Touch targets at least 44 high
List the issues first, then fix each one and explain the change
Additional notes:`
  }
]

const COMMANDS_BY_LOCALE: Record<Locale, readonly QuickCommandConfig[]> = {
  'zh-CN': ZH_CN,
  'zh-TW': ZH_TW,
  'en-US': EN_US,
}

/** 按界面语言返回内置快捷指令 */
export function getDefaultQuickCommands(locale: Locale): readonly QuickCommandConfig[] {
  return COMMANDS_BY_LOCALE[locale] ?? ZH_CN
}

/**
 * 所有语言的「指令名 → 稳定 id」映射。
 * 自定义指令用任意语言的同名指令名都能覆盖同一个内置指令，
 * 避免切换语言后 /骨架 与 /skeleton 变成两条独立指令。
 */
const BUILTIN_LABEL_TO_ID = new Map<string, string>()
for (const list of Object.values(COMMANDS_BY_LOCALE)) {
  list.forEach((command, index) => {
    if (!BUILTIN_LABEL_TO_ID.has(command.label)) {
      BUILTIN_LABEL_TO_ID.set(command.label, `builtin:${index}`)
    }
  })
}

/** 查找指令名对应的内置稳定 id（自定义指令覆盖判断用） */
export function getBuiltinCommandId(label: string): string | undefined {
  return BUILTIN_LABEL_TO_ID.get(label)
}

/** 兼容旧引用：默认返回简体中文指令 */
export const DEFAULT_QUICK_COMMANDS = ZH_CN
