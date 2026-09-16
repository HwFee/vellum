import react from "@vitejs/plugin-react";
import { defineConfig, defaultExclude } from "vitest/config";
import { visualizer } from "rollup-plugin-visualizer";
import type { Plugin } from "vite";

// KaTeX 官方 CSS 为兼容老浏览器同时引用 woff2/woff/ttf 三种字体格式（共 60 个文件 ~1.2MB）。
// WebView2 是 Chromium 内核，只需要 woff2。构建前在源码层裁掉 woff/ttf 引用，
// Vite 就只会解析并产出 20 个 woff2 文件（~350KB）。
const KATEX_LEGACY_FONT_RE = /,url\([^)]*?\.(?:woff|ttf)\)\s*format\("(?:woff|truetype)"\)/g;

function katexWoff2Only(): Plugin {
  return {
    name: "katex-woff2-only",
    enforce: "pre",
    transform(code, id) {
      if (id.includes("katex") && id.endsWith(".css")) {
        return { code: code.replace(KATEX_LEGACY_FONT_RE, ""), map: null };
      }
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    katexWoff2Only(),
    // 生成 bundle 分析报告 dist/stats.html，仅供分析使用
    visualizer({
      filename: "dist/stats.html",
      gzipSize: true,
      brotliSize: true,
      open: false,
    }),
  ],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    target: "es2022",
    minify: !process.env.TAURI_DEBUG,
    sourcemap: !!process.env.TAURI_DEBUG,
    // WebView2 是 Chromium 内核，原生支持动态 import，无需 modulepreload polyfill
    modulePreload: { polyfill: false },
    rollupOptions: {
      output: {
        manualChunks(id) {
          // 将 react-syntax-highlighter 及其所有语言文件合并为一个 chunk
          if (id.includes("node_modules/react-syntax-highlighter")) {
            return "syntax-highlighter";
          }
          // katex 体积大（~277KB min）且只有 MarkdownDocument 用到，单独拆 chunk
          // 与懒加载的 MarkdownDocument 并行下载，也利于长期缓存
          if (id.includes("node_modules/katex/")) {
            return "katex";
          }
          // 将 React 核心单独拆出，利于浏览器缓存
          if (
            id.includes("node_modules/react/") ||
            id.includes("node_modules/react-dom/") ||
            id.includes("node_modules/scheduler/")
          ) {
            return "vendor-react";
          }
        },
      },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./src/test/setup.ts",
    // 审核探针/草稿测试（包括其他 Agent 暂时放在 outputs/ 的验证文件）不得被全量跑拾取
    // extensions/ 是 pi 扩展（node:test 用例、另一套 tsconfig），不属于前端测试面
    exclude: [...defaultExclude, "outputs/**", "dist/**", "extensions/**"],
  },
});
