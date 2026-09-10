/**
 * 基准（一）：块提交的「整篇重解析 + React 渲染提交」成本 —— jsdom 保守上限。
 *
 * 运行：npx vitest bench --run scripts/bench-markdown-commit.bench.tsx
 *
 * 为什么是上限：jsdom 的 DOM 创建比 WebView2(Chromium) 慢数倍，读到的绝对耗时
 * 只可用于横向比较（体积档之间），不可当作真机阈值。
 * 真机阈值需以 scripts/bench-markdown-pipeline.bench.tsx（Node/V8 纯管线）为主，
 * 再在真机用 CDP 复核一次。
 */
import { cleanup, render } from "@testing-library/react";
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

/** 真实配比的散文单元：多数是段落，偶尔列表/引用/代码/表格（避免标题与围栏过密） */
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

/** 约 24KB 的 vellum-widget 载体：内联 SVG + 通信脚本，逼近 mdlog 日志里的交互块 */
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
    "    function report() {",
    "      parent.postMessage({ source: 'vellum-widget', height: document.documentElement.scrollHeight }, '*');",
    "    }",
    "    report();",
    "    new ResizeObserver(report).observe(document.documentElement);",
    "  })();",
    "</script>",
  ].join("\n");

  return ["```vellum-widget", html, "```", ""].join("\n");
}

/** 按目标体积拼装；widgetEvery 表示每 N 个散文单元插入 1 个 widget 块 */
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
const cases: Array<{ name: string; bytes: number; widgetEvery: number }> = [
  { name: "散文 101KB", bytes: 101 * KB, widgetEvery: 0 },
  { name: "散文 301KB", bytes: 301 * KB, widgetEvery: 0 },
  { name: "散文 1MB", bytes: 1024 * KB, widgetEvery: 0 },
  { name: "widget 重度 512KB", bytes: 512 * KB, widgetEvery: 4 },
];

describe("块提交：整篇重解析 + React 提交（jsdom 上限）", () => {
  for (const testCase of cases) {
    const markdown = buildDocument(testCase.bytes, testCase.widgetEvery);
    const headings = extractOutline(markdown);
    const actualKb = Math.round(markdown.length / KB);

    bench(
      `${testCase.name}（实测 ${actualKb}KB / ${headings.length} 标题）`,
      () => {
        render(<MarkdownDocument markdown={markdown} headings={headings} />);
        cleanup();
      },
      { iterations: 2, warmupIterations: 0, time: 0, warmupTime: 0 }
    );
  }
});
