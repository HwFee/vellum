/**
 * 基准（二）：块提交的「整篇解析 + React 元素树构建」成本 —— V8 纯计算读数。
 *
 * 运行：npx vitest bench --run scripts/bench-markdown-pipeline.bench.tsx
 *
 * 为什么这条更接近真机：unified 管线与 React 元素构建都是纯 JS，Node 与
 * WebView2 同为 V8，量级相当（真机另需加 DOM 提交与布局成本，见提交基准）。
 * 手法：react-dom/server 的 renderToStaticMarkup —— 跑真实生产管线（同一份
 * remark/rehype 配置、同一套 components），只跳过 DOM 节点创建与绘制；
 * 因此外层 jsdom 环境（测试 setup 依赖它）不影响读数。
 */
import { renderToStaticMarkup } from "react-dom/server";
import { bench, describe, vi } from "vitest";
import { MarkdownDocument } from "../src/components/MarkdownDocument";
import { extractOutline } from "../src/lib/outline";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => ({
    id: "w-bench",
    url: "http://vellum-widget.localhost/w-bench",
  })),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(),
}));

// SSR 下 useLayoutEffect 会刷警告，静音以免淹没读数
vi.spyOn(console, "error").mockImplementation(() => {});

function unit(index: number): string {
  const lines: string[] = [];

  if (index % 6 === 0) {
    lines.push(`## 小节 ${index}`, "");
  }

  lines.push(
    `第 ${index} 段正文，含**加粗**、\`inline code\` 与行内公式 $a_{${index}}+b$，`
      + "长度接近真实中文段落，测试解析、强调定界符贴 CJK、公式货币保护等路径。",
    ""
  );

  if (index % 5 === 2) {
    lines.push(`第 ${index} 段的补充说明，再写一句让段落长一点，逼近两到三行的自然段落长度。`, "");
  }

  if (index % 8 === 3) {
    lines.push("- 列表项一", "- 列表项二", "- 列表项三", "");
  }

  if (index % 12 === 5) {
    lines.push(`> 引用：第 ${index} 组的判断与结论。`, "");
  }

  if (index % 10 === 7) {
    lines.push(
      "```ts",
      `function render${index}(source: string) {`,
      "  // 中文注释",
      `  return source.trim() + "${index}";`,
      "}",
      "```",
      ""
    );
  }

  if (index % 12 === 9) {
    lines.push(
      "| 项目 | 状态 | 备注 |",
      "| --- | --- | --- |",
      `| Markdown | OK | 第 ${index} 组 |`,
      "",
    );
  }

  return lines.join("\n");
}

function widgetUnit(index: number): string {
  const bars = Array.from({ length: 140 }, (_, i) => {
    const x = 40 + i * 6;
    const h = 20 + ((i * 37 + index * 11) % 160);
    return `  <rect x="${x}" y="${260 - h}" width="4" height="${h}" fill="#4a5b8c" opacity="${(0.3 + (i % 7) / 10).toFixed(2)}"/>`;
  }).join("\n");

  const html = [
    '<div class="board" style="padding:16px">',
    `  <h3 style="font-size:14px">指标 ${index}</h3>`,
    '  <svg viewBox="0 0 900 300" width="100%" height="220" role="img" aria-label="柱状图">',
    bars,
    "  </svg>",
    "</div>",
    "<script>",
    "  (function () {",
    "    parent.postMessage({ source: 'vellum-widget', height: document.documentElement.scrollHeight }, '*');",
    "  })();",
    "</script>",
  ].join("\n");

  return ["```vellum-widget", html, "```", ""].join("\n");
}

function buildDocument(targetBytes: number, widgetEvery = 0): string {
  const parts: string[] = ["<!-- mdlog:v1 -->", "", "# 基准文档", ""];
  let size = parts.join("\n").length;
  let index = 1;

  while (size < targetBytes) {
    const text = unit(index);
    parts.push(text);
    size += text.length;

    if (widgetEvery > 0 && index % widgetEvery === 0) {
      const widget = widgetUnit(index);
      parts.push(widget);
      size += widget.length;
    }
    index += 1;
  }

  return parts.join("\n");
}

const KB = 1024;
// 大档（2MB / 1.5MB）会显著拉长基准耗时，需显式开启：BENCH_BIG=1
const cases: Array<{ name: string; bytes: number; widgetEvery: number }> = [
  { name: "散文 101KB", bytes: 101 * KB, widgetEvery: 0 },
  { name: "散文 301KB", bytes: 301 * KB, widgetEvery: 0 },
  { name: "散文 1MB", bytes: 1024 * KB, widgetEvery: 0 },
  { name: "widget 重度 512KB", bytes: 512 * KB, widgetEvery: 4 },
];

if (process.env.BENCH_BIG === "1") {
  cases.push(
    { name: "散文 2MB", bytes: 2048 * KB, widgetEvery: 0 },
    { name: "widget 重度 1.5MB", bytes: 1536 * KB, widgetEvery: 4 }
  );
}

describe("块提交：整篇解析 + React 元素树构建（Node/V8）", () => {
  for (const testCase of cases) {
    const markdown = buildDocument(testCase.bytes, testCase.widgetEvery);
    const headings = extractOutline(markdown);
    const actualKb = Math.round(markdown.length / KB);

    bench(
      `${testCase.name}（实测 ${actualKb}KB / ${headings.length} 标题）`,
      () => {
        renderToStaticMarkup(<MarkdownDocument markdown={markdown} headings={headings} />);
      },
      { iterations: 5, warmupIterations: 1, time: 0, warmupTime: 0 }
    );
  }
});
