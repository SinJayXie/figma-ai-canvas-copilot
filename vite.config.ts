import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import vue from '@vitejs/plugin-vue'
import { viteSingleFile } from 'vite-plugin-singlefile'
import { defineConfig, type Plugin } from 'vite'

/** 插件版本号：与 package.json 保持一致，运行时通过 __APP_VERSION__ 注入 UI */
const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8')) as {
  version?: string
}
const appVersion = pkg.version ?? '0.0.0'

/**
 * Figma 插件 UI 构建（与 e:/figma-countdown/plugin/vite.config.ts 同方案）：
 * - vite-plugin-singlefile 将 JS/CSS 全部内联进 HTML（Figma 要求 ui.html 自包含，
 *   其内部 inlineDynamicImports 消除共享 chunk，避免残留无法解析的 import 语句）
 * - 自定义插件仅负责把 HTML 产物重命名为 dist/ui.html
 * 注：沙箱 code.js 由 vite.config.code.ts 以 lib/IIFE 模式单独构建（单文件、无 ESM）
 */
function figmaRenameHtml(): Plugin {
  return {
    name: 'figma-rename-html',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const html = Object.keys(bundle)
        .map((name) => ({ name, file: bundle[name] }))
        .find(
          ({ name, file }) =>
            file.type === 'asset' && name.endsWith('.html') && name !== 'ui.html',
        )
      if (html) {
        delete bundle[html.name]
          ; (html.file as { fileName: string }).fileName = 'ui.html'
        bundle['ui.html'] = html.file
      }
    },
  }
}

export default defineConfig({
  plugins: [vue(), viteSingleFile(), figmaRenameHtml()],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@types': resolve(__dirname, 'types'),
    },
  },
  build: {
    // Figma 沙箱 JS 引擎不支持 ES2020 语法（?. / ??），必须降级
    target: 'es2017',
    cssCodeSplit: false,
    assetsInlineLimit: 1024 * 10,
    outDir: 'dist',
    rollupOptions: {
      input: {
        ui: resolve(__dirname, 'src/ui/index.html'),
      },
      output: {
        inlineDynamicImports: true,
      },
    },
  },
})
