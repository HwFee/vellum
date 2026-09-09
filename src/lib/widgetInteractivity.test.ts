import { describe, expect, it } from "vitest";
import { isWidgetInteractive } from "./widgetInteractivity";

// 契约 5 的通信 IIFE（逐字照抄的最小形态）
const COMM_IIFE = `<script>
  (function() {
    function report() {
      const h = Math.ceil(document.documentElement.getBoundingClientRect().height);
      window.parent.postMessage({
        type: "vellum-widget:resize",
        height: h,
        title: document.title
      }, "*");
    }
    window.addEventListener("load", report);
    if (window.ResizeObserver) {
      new ResizeObserver(report).observe(document.body);
    }
  })();
</script>`;

describe("isWidgetInteractive", () => {
  it("treats a static SVG figure with only the communication IIFE as non-interactive", () => {
    const html = `<!DOCTYPE html><html><head><title>图</title><style>body{margin:0}</style></head>
      <body><svg viewBox="0 0 400 200"><rect width="400" height="200"/><text x="200" y="100">hi</text></svg>
      ${COMM_IIFE}</body></html>`;
    expect(isWidgetInteractive(html)).toBe(false);
  });

  it("treats an IIFE-less static figure as non-interactive", () => {
    expect(isWidgetInteractive("<div><svg><rect/></svg></div>")).toBe(false);
  });

  it("detects scripts beyond the communication IIFE", () => {
    const html = `${COMM_IIFE}<script>document.querySelector("#s").addEventListener("input", draw);</script>`;
    expect(isWidgetInteractive(html)).toBe(true);
  });

  it("detects inline event handlers", () => {
    expect(isWidgetInteractive('<body onload="init()"><svg/></body>')).toBe(true);
    expect(isWidgetInteractive('<svg><rect onclick="zoom()"/></svg>')).toBe(true);
  });

  it("detects form controls and details", () => {
    expect(isWidgetInteractive('<button type="button">go</button>')).toBe(true);
    expect(isWidgetInteractive('<input type="range" min="0" max="10">')).toBe(true);
    expect(isWidgetInteractive('<select><option>a</option></select>')).toBe(true);
    expect(isWidgetInteractive('<details><summary>more</summary>x</details>')).toBe(true);
  });

  it("treats canvas as interactive (may have hover/drag)", () => {
    expect(isWidgetInteractive('<canvas id="c"></canvas>')).toBe(true);
  });

  it("detects hyperlinks", () => {
    expect(isWidgetInteractive('<svg><a href="https://example.com"><text>ref</text></a></svg>')).toBe(true);
  });

  it("keeps a script block that merely mentions the message type in a larger app", () => {
    // 同一块 <script> 里既有通信 IIFE 又有交互逻辑：整块保留，判定为交互
    const html = `<script>
      (function(){ window.parent.postMessage({ type: "vellum-widget:resize", height: 100 }, "*"); })();
      document.addEventListener("pointermove", () => {});
    </script>`;
    expect(isWidgetInteractive(html)).toBe(true);
  });
});
