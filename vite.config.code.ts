import { resolve } from 'node:path'
import { defineConfig } from 'vite'

/**
 * 沙箱脚本（code.js）独立构建（与 e:/figma-countdown/plugin/vite.config.main.ts 同方案）：
 * - lib/IIFE 模式将所有依赖打进单文件，产物不含 import/export（Figma 沙箱不支持 ESM）
 * - 与 UI 构建（vite.config.ts）分离，避免双入口共享 chunk 拆包问题
 */
export default defineConfig({
  build: {
    target: 'es2015', // Figma 沙箱不支持 ES2020 语法（?. / ??）
    lib: {
      entry: resolve(__dirname, 'src/code/index.ts'),
      formats: ['iife'],
      name: 'code',
      fileName: () => 'code.js',
    },
    outDir: 'dist',
    emptyOutDir: false, // dist 由 UI 构建负责清空
    minify: false,
  },
})
