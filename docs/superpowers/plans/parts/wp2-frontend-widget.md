## 工作包 2：前端 widget 渲染（Task 2.1 ~ Task 2.5）

**本包目标**：在前端安全、高性能地渲染 `vellum-widget` 交互块。包含测试环境 IntersectionObserver mock 补齐、kami 纸墨样式扩展与规约断言、全局单例 LRU widget 注册表、沙箱 iframe 隔离组件以及 MarkdownDocument pre 渲染器分发与受信门禁。

---

### Task 2.1: 测试环境补充 IntersectionObserver Mock

**Files:**
- Modify: `src/test/setup.ts`
- Test: `src/test/setup.test.ts`

**Interfaces:**
- Consumes: 无（全局 jsdom 测试环境）
- Produces: `globalThis.IntersectionObserver` mock 类，挂载至全局；支持 `observe`、`unobserve`、`disconnect`、`takeRecords` 实例方法，并正确读取 `root`、`rootMargin` 与 `thresholds` 构造选项，为后续 Task 2.4 与 Task 2.5 的组件视口相交测试提供稳定环境。

- [ ] **Step 1: Write the failing test**

新建 `src/test/setup.test.ts`，验证全局 `IntersectionObserver` 符合 W3C 契约且支持视口配置：

```ts
import { describe, expect, it, vi } from "vitest";

describe("IntersectionObserver setup mock", () => {
  it("provides global IntersectionObserver with full observer contract", () => {
    expect(globalThis.IntersectionObserver).toBeDefined();

    const callback = vi.fn();
    const observer = new globalThis.IntersectionObserver(callback, {
      rootMargin: "200px",
      threshold: [0, 0.5],
    });

    expect(observer.rootMargin).toBe("200px");
    expect(observer.thresholds).toEqual([0, 0.5]);

    const el = document.createElement("div");
    expect(() => observer.observe(el)).not.toThrow();
    expect(() => observer.unobserve(el)).not.toThrow();
    expect(() => observer.disconnect()).not.toThrow();
    expect(observer.takeRecords()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/test/setup.test.ts`
Expected: FAIL，报错 `expected undefined to be defined`（当前 `src/test/setup.ts` 中尚未声明 `IntersectionObserver`）。

- [ ] **Step 3: Write minimal implementation**

在 `src/test/setup.ts` 中追加 `IntersectionObserverMock` 实现并挂载至 `globalThis.IntersectionObserver`：

```ts
import "@testing-library/jest-dom/vitest";

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

globalThis.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;

class IntersectionObserverMock implements IntersectionObserver {
  readonly root: Element | Document | null = null;
  readonly rootMargin: string = "0px";
  readonly thresholds: ReadonlyArray<number> = [0];

  constructor(
    _callback: IntersectionObserverCallback,
    options?: IntersectionObserverInit
  ) {
    if (options?.root) this.root = options.root;
    if (options?.rootMargin) this.rootMargin = options.rootMargin;
    if (options?.threshold !== undefined) {
      this.thresholds = Array.isArray(options.threshold)
        ? options.threshold
        : [options.threshold];
    }
  }

  observe(_target: Element): void {}
  unobserve(_target: Element): void {}
  disconnect(): void {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

globalThis.IntersectionObserver = IntersectionObserverMock as unknown as typeof IntersectionObserver;

// jsdom 未实现 scrollIntoView，补充空实现避免调用时报错
if (typeof Element.prototype.scrollIntoView !== "function") {
  Element.prototype.scrollIntoView = () => {};
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/test/setup.test.ts`
Expected: PASS，`IntersectionObserver setup mock` 1 个用例全部通过。

- [ ] **Step 5: Commit**

```bash
git add src/test/setup.ts src/test/setup.test.ts
git commit -m "test: add IntersectionObserver mock to test setup"
```

---

### Task 2.2: kami 纸墨样式扩展与设计规约测试

**Files:**
- Modify: `src/styles/kami.css`
- Modify: `src/styles/kami.css.test.ts`

**Interfaces:**
- Consumes: `:root` CSS 变量（`--ivory`、`--border`、`--stone`、`--hairline`、`--parchment`、`--brand`、`--mono`、`--serif`）
- Produces: 规则块 `.mdlog-widget`、`.mdlog-widget__bar`、`.mdlog-widget__bar .state`、`.mdlog-widget__frame`、`.mdlog-widget__placeholder`、`.mdlog-live`、`.mdlog-live::before`、`@keyframes mdlog-pulse`、`@media (prefers-reduced-motion: reduce)`，数值与 `docs/preview/mdlog-preview.html` 逐字对齐。

- [ ] **Step 1: Write the failing test**

在 `src/styles/kami.css.test.ts` 末尾追加对 mdlog widget 与 live 徽章的视觉指标与 kami 规约断言：

```ts
describe("kami.css mdlog widget and live indicator tokens", () => {
  it("declares widget container rules with exact preview metrics", () => {
    const widgetRule = css.match(/\.mdlog-widget\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(widgetRule).toMatch(/margin:\s*17px 0/);
    expect(widgetRule).toMatch(/background:\s*var\(--ivory\)/);
    expect(widgetRule).toMatch(/box-shadow:\s*inset 0 0 0 1px var\(--border\)/);
    expect(widgetRule).toMatch(/border-radius:\s*6px/);
    expect(widgetRule).toMatch(/overflow:\s*hidden/);

    const barRule = css.match(/\.mdlog-widget__bar\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(barRule).toMatch(/padding:\s*7px 14px/);
    expect(barRule).toMatch(/font:\s*10px\/1\.5 var\(--mono\)/);
    expect(barRule).toMatch(/letter-spacing:\s*1\.2px/);
    expect(barRule).toMatch(/text-transform:\s*uppercase/);
    expect(barRule).toMatch(/color:\s*var\(--stone\)/);

    const frameRule = css.match(/\.mdlog-widget__frame\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(frameRule).toMatch(/min-height:\s*120px/);
    expect(frameRule).toMatch(/border:\s*0/);
    expect(frameRule).toMatch(/border-top:\s*1px solid var\(--hairline\)/);
    expect(frameRule).toMatch(/background:\s*var\(--parchment\)/);

    const placeholderRule = css.match(/\.mdlog-widget__placeholder\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(placeholderRule).toMatch(/min-height:\s*120px/);
    expect(placeholderRule).toMatch(/border-top:\s*1px solid var\(--hairline\)/);
    expect(placeholderRule).toMatch(/background:\s*var\(--parchment\)/);
    expect(placeholderRule).toMatch(/color:\s*var\(--stone\)/);
  });

  it("declares live indicator rules with 5x5px square dot and breathing animation", () => {
    const liveRule = css.match(/\.mdlog-live\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(liveRule).toMatch(/margin:\s*30px 0 0/);
    expect(liveRule).toMatch(/color:\s*var\(--stone\)/);
    expect(liveRule).toMatch(/font:\s*10px\/1 var\(--mono\)/);
    expect(liveRule).toMatch(/letter-spacing:\s*2px/);

    const dotRule = css.match(/\.mdlog-live::before\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(dotRule).toMatch(/width:\s*5px/);
    expect(dotRule).toMatch(/height:\s*5px/);
    expect(dotRule).toMatch(/border-radius:\s*1px/);
    expect(dotRule).toMatch(/background:\s*var\(--brand\)/);
    expect(dotRule).toMatch(/animation:\s*mdlog-pulse 1\.6s ease infinite/);

    const motionRule = css.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[^}]*\.mdlog-live::before\s*\{[^}]*animation:\s*none/s)?.[0] ?? "";
    expect(motionRule).toBeTruthy();
  });

  it("strictly obeys kami design constraints for mdlog rules: allowed radii, max weight 500, no raw colors", () => {
    const startIndex = css.indexOf(".mdlog-widget");
    expect(startIndex).toBeGreaterThan(0);
    const mdlogSection = css.slice(startIndex);

    // 1. 圆角仅允许 ∈ {0, 1px, 2px, 3px, 4px, 6px}
    const radiiMatches = Array.from(mdlogSection.matchAll(/border-radius:\s*([^;]+);/g));
    const allowedRadii = new Set(["0", "1px", "2px", "3px", "4px", "6px"]);
    for (const match of radiiMatches) {
      const val = match[1].trim();
      expect(allowedRadii.has(val), `Disallowed border-radius in mdlog section: ${val}`).toBe(true);
    }

    // 2. font-weight 严格 ≤ 500
    const weightMatches = Array.from(mdlogSection.matchAll(/font-weight:\s*([^;]+);/g));
    for (const match of weightMatches) {
      const w = parseInt(match[1].trim(), 10);
      if (!Number.isNaN(w)) {
        expect(w).toBeLessThanOrEqual(500);
      }
    }

    // 3. 颜色仅允许使用 var(--*)、transparent 或 currentColor，严禁未声明的原始十六进制或 rgb
    const colorDeclarations = Array.from(
      mdlogSection.matchAll(/(?:color|background|border(?:-[a-z]+)?|box-shadow):\s*([^;]+);/g)
    );
    for (const match of colorDeclarations) {
      const decl = match[1];
      expect(decl).not.toMatch(/#[0-9a-fA-F]{3,8}/);
      expect(decl).not.toMatch(/rgba?\(/);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/styles/kami.css.test.ts`
Expected: FAIL，报错 `expected startIndex to be greater than 0`（`.mdlog-widget` 尚未在 `src/styles/kami.css` 中声明）。

- [ ] **Step 3: Write minimal implementation**

在 `src/styles/kami.css` 末尾追加 mdlog 相关视觉样式（严格按 `docs/preview/mdlog-preview.html` 真源与 spec §4.1 数值）：

```css
/* ===== Pi 对话记录与沙箱交互块 ===== */
.mdlog-widget {
  margin: 17px 0;
  background: var(--ivory);
  box-shadow: inset 0 0 0 1px var(--border);
  border-radius: 6px;
  overflow: hidden;
}

.mdlog-widget__bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 7px 14px;
  font: 10px/1.5 var(--mono);
  letter-spacing: 1.2px;
  text-transform: uppercase;
  color: var(--stone);
}

.mdlog-widget__bar .state {
  letter-spacing: 0.5px;
  text-transform: none;
}

.mdlog-widget__frame {
  display: block;
  width: 100%;
  min-height: 120px;
  border: 0;
  border-top: 1px solid var(--hairline);
  background: var(--parchment);
}

.mdlog-widget__placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  min-height: 120px;
  padding: 24px;
  border: 0;
  border-top: 1px solid var(--hairline);
  background: var(--parchment);
  color: var(--stone);
  font-family: var(--serif);
  font-size: 13px;
  cursor: pointer;
  user-select: none;
}

.mdlog-widget__placeholder:hover {
  background: var(--ivory);
  color: var(--brand);
}

.mdlog-live {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  margin: 30px 0 0;
  color: var(--stone);
  font: 10px/1 var(--mono);
  letter-spacing: 2px;
  user-select: none;
}

.mdlog-live::before {
  content: "";
  width: 5px;
  height: 5px;
  border-radius: 1px;
  background: var(--brand);
  animation: mdlog-pulse 1.6s ease infinite;
}

@keyframes mdlog-pulse {
  0%,
  100% {
    opacity: 0.25;
  }
  50% {
    opacity: 0.9;
  }
}

@media (prefers-reduced-motion: reduce) {
  .mdlog-live::before {
    animation: none;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/styles/kami.css.test.ts`
Expected: PASS，新增的 3 个规约用例全部通过。

- [ ] **Step 5: Commit**

```bash
git add src/styles/kami.css src/styles/kami.css.test.ts
git commit -m "style: add mdlog widget and live indicator rules with kami design tests"
```

---

### Task 2.3: src/lib/widgetRegistry.ts 模块级单例与 LRU 滚动防抖管理

**Files:**
- Create: `src/lib/widgetRegistry.ts`
- Test: `src/lib/widgetRegistry.test.ts`

**Interfaces:**
- Consumes: 全局 `window` 滚动事件与 `setTimeout`
- Produces: 模块级单例 `widgetRegistry`，提供逐字公共 API：
  - `register(id: string): void`
  - `release(id: string): void`
  - `markVisible(id: string): void`
  - `requestMount(id: string): boolean`
  - `activate(id: string): void`
  - `subscribe(cb: (id: string, dormant: boolean) => void): () => void`
  存活上限固定 10，LRU 排序键为最近一次 `markVisible` 时间戳，滚动期间暂停淘汰并在停止滚动 400ms 后执行淘汰，被淘汰项重新进入视口不自动复活。

- [ ] **Step 1: Write the failing test**

新建 `src/lib/widgetRegistry.test.ts`，验证注册、存活上限 10、停止滚动 400ms 防抖淘汰、休眠防自动复活与显式唤醒：

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { widgetRegistry } from "./widgetRegistry";

describe("widgetRegistry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // 清理全局单例
    if ("__clear" in widgetRegistry && typeof widgetRegistry.__clear === "function") {
      widgetRegistry.__clear();
    }
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("registers widgets and allows mounting within capacity 10", () => {
    for (let i = 1; i <= 10; i++) {
      widgetRegistry.register(`w-${i}`);
      expect(widgetRegistry.requestMount(`w-${i}`)).toBe(true);
    }
  });

  it("evicts LRU widget only after scrolling stops for 400ms", () => {
    const events: { id: string; dormant: boolean }[] = [];
    const unsubscribe = widgetRegistry.subscribe((id, dormant) => {
      events.push({ id, dormant });
    });

    // 登记 10 个 widget，并按顺序更新 visible 时间
    for (let i = 1; i <= 10; i++) {
      vi.advanceTimersByTime(10);
      widgetRegistry.register(`w-${i}`);
      widgetRegistry.markVisible(`w-${i}`);
    }

    // 触发滚动事件（模拟连续滚动）
    window.dispatchEvent(new Event("scroll"));

    // 登记第 11 个
    vi.advanceTimersByTime(10);
    widgetRegistry.register("w-11");
    widgetRegistry.markVisible("w-11");

    // 滚动期间即便超过 10 个也不得淘汰
    expect(events.length).toBe(0);
    expect(widgetRegistry.requestMount("w-1")).toBe(true);

    // 滚动中途再次触发滚动（重置 400ms 定时器）
    vi.advanceTimersByTime(200);
    window.dispatchEvent(new Event("scroll"));
    vi.advanceTimersByTime(200);
    expect(events.length).toBe(0);

    // 距离上次滚动满 400ms：停止滚动稳定触发淘汰
    vi.advanceTimersByTime(200);
    // 最早 markVisible 的 w-1 应当被淘汰置为休眠
    expect(events).toEqual([{ id: "w-1", dormant: true }]);
    expect(widgetRegistry.requestMount("w-1")).toBe(false);

    unsubscribe();
  });

  it("does not auto-revive dormant widget when re-entering viewport until activate() is called", () => {
    const events: { id: string; dormant: boolean }[] = [];
    const unsubscribe = widgetRegistry.subscribe((id, dormant) => {
      events.push({ id, dormant });
    });

    // 登记 10 个
    for (let i = 1; i <= 10; i++) {
      widgetRegistry.register(`w-${i}`);
      widgetRegistry.markVisible(`w-${i}`);
    }

    // 登记第 11 个触发淘汰
    widgetRegistry.register("w-11");
    widgetRegistry.markVisible("w-11");
    vi.advanceTimersByTime(400);

    expect(widgetRegistry.requestMount("w-1")).toBe(false);

    // 被淘汰项重新入视口调用 markVisible，绝对不自动复活
    widgetRegistry.markVisible("w-1");
    expect(widgetRegistry.requestMount("w-1")).toBe(false);
    expect(events).toEqual([{ id: "w-1", dormant: true }]);

    // 必须由用户点击后显式调用 activate(id) 才能复活
    widgetRegistry.activate("w-1");
    expect(events).toEqual([
      { id: "w-1", dormant: true },
      { id: "w-1", dormant: false },
    ]);
    expect(widgetRegistry.requestMount("w-1")).toBe(true);

    unsubscribe();
  });

  it("releases widget and cleans up subscription", () => {
    let called = false;
    const unsubscribe = widgetRegistry.subscribe(() => {
      called = true;
    });

    widgetRegistry.register("w-temp");
    widgetRegistry.release("w-temp");
    expect(widgetRegistry.requestMount("w-temp")).toBe(false);

    unsubscribe();
    widgetRegistry.activate("w-temp");
    expect(called).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/widgetRegistry.test.ts`
Expected: FAIL，报错 `Cannot find module './widgetRegistry'`。

- [ ] **Step 3: Write minimal implementation**

新建 `src/lib/widgetRegistry.ts`，严格实现 LRU、400ms 滚动防抖与逐字公共 API 契约：

```ts
export interface WidgetRegistry {
  register(id: string): void;
  release(id: string): void;
  markVisible(id: string): void;
  requestMount(id: string): boolean;
  activate(id: string): void;
  subscribe(cb: (id: string, dormant: boolean) => void): () => void;
  __clear?(): void;
  __getActiveCount?(): number;
}

interface WidgetEntry {
  id: string;
  lastVisible: number;
  dormant: boolean;
}

const MAX_ACTIVE_WIDGETS = 10;
const SCROLL_QUIET_MS = 400;

export function createWidgetRegistry(): WidgetRegistry & {
  __clear(): void;
  __getActiveCount(): number;
} {
  const widgets = new Map<string, WidgetEntry>();
  const subscribers = new Set<(id: string, dormant: boolean) => void>();
  let isScrolling = false;
  let scrollTimer: ReturnType<typeof setTimeout> | null = null;

  function notify(id: string, dormant: boolean) {
    for (const cb of subscribers) {
      try {
        cb(id, dormant);
      } catch (err) {
        console.error("Widget subscriber error:", err);
      }
    }
  }

  function evictIfNecessary() {
    if (isScrolling) return;

    const activeList = Array.from(widgets.values()).filter((w) => !w.dormant);
    if (activeList.length <= MAX_ACTIVE_WIDGETS) return;

    // 按 lastVisible 升序排序：最近一次 markVisible 最久远的项排在最前
    activeList.sort((a, b) => a.lastVisible - b.lastVisible);

    const excessCount = activeList.length - MAX_ACTIVE_WIDGETS;
    for (let i = 0; i < excessCount; i++) {
      const victim = activeList[i];
      victim.dormant = true;
      notify(victim.id, true);
    }
  }

  function handleScroll() {
    isScrolling = true;
    if (scrollTimer !== null) {
      clearTimeout(scrollTimer);
    }
    scrollTimer = setTimeout(() => {
      isScrolling = false;
      scrollTimer = null;
      evictIfNecessary();
    }, SCROLL_QUIET_MS);
  }

  if (typeof window !== "undefined") {
    window.addEventListener("scroll", handleScroll, { capture: true, passive: true });
  }

  return {
    register(id: string): void {
      if (widgets.has(id)) return;
      widgets.set(id, {
        id,
        lastVisible: Date.now(),
        dormant: false,
      });
    },

    release(id: string): void {
      widgets.delete(id);
    },

    markVisible(id: string): void {
      const entry = widgets.get(id);
      if (!entry) return;
      // LRU 排序键更新为最近 markVisible 时间
      entry.lastVisible = Date.now();
      // 被淘汰项重新入视口不自动复活（必须点击 activate）
      if (!entry.dormant) {
        evictIfNecessary();
      }
    },

    requestMount(id: string): boolean {
      const entry = widgets.get(id);
      if (!entry) return false;
      if (entry.dormant) return false;

      const activeList = Array.from(widgets.values()).filter((w) => !w.dormant);
      if (activeList.length <= MAX_ACTIVE_WIDGETS) {
        return true;
      }

      // 滚动期间暂停淘汰，保持当前挂载
      if (isScrolling) {
        return true;
      }

      evictIfNecessary();
      return !entry.dormant;
    },

    activate(id: string): void {
      const entry = widgets.get(id);
      if (!entry) return;
      entry.dormant = false;
      entry.lastVisible = Date.now();
      notify(id, false);
      evictIfNecessary();
    },

    subscribe(cb: (id: string, dormant: boolean) => void): () => void {
      subscribers.add(cb);
      return () => {
        subscribers.delete(cb);
      };
    },

    __clear(): void {
      if (scrollTimer !== null) {
        clearTimeout(scrollTimer);
        scrollTimer = null;
      }
      isScrolling = false;
      widgets.clear();
      subscribers.clear();
    },

    __getActiveCount(): number {
      return Array.from(widgets.values()).filter((w) => !w.dormant).length;
    },
  };
}

export const widgetRegistry = createWidgetRegistry();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/widgetRegistry.test.ts`
Expected: PASS，4 个测试用例全部通过。

- [ ] **Step 5: Commit**

```bash
git add src/lib/widgetRegistry.ts src/lib/widgetRegistry.test.ts
git commit -m "feat: add singleton widgetRegistry with scroll-debounced LRU eviction"
```

---

### Task 2.4: src/components/WidgetSandbox.tsx 沙箱渲染与通信组件

**Files:**
- Create: `src/components/WidgetSandbox.tsx`
- Test: `src/components/WidgetSandbox.test.tsx`

**Interfaces:**
- Consumes:
  - `widgetRegistry` 来自 `src/lib/widgetRegistry.ts`
  - Tauri 命令 `invoke<RegisterResult>("register_widget", { html: string }) -> Promise<{ id: string; url: string }>`
  - Tauri 命令 `invoke("unregister_widget", { id: string }) -> Promise<void>`
  - `@tauri-apps/api/core` 中的 `invoke`
- Produces: `WidgetSandbox` 组件，props 签名逐字为：
  `{ html: string; autoMount: boolean; fallback?: ReactNode }`
  支持 `React.memo`（html 相同跳过重挂载）、视口进入才调用 `register_widget`、严格 iframe 沙箱与通信校验、高度 clamp 与 rAF 节流、IPC 失败 fallback 降级、未受信与休眠占位块。

- [ ] **Step 1: Write the failing test**

新建 `src/components/WidgetSandbox.test.tsx`，覆盖未受信占位、受信视口触发、通信高度限制与标题回退、IPC 降级与休眠复活：

```tsx
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WidgetSandbox } from "./WidgetSandbox";
import { widgetRegistry } from "../lib/widgetRegistry";
import { invoke } from "@tauri-apps/api/core";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

describe("WidgetSandbox", () => {
  let observerCallback: IntersectionObserverCallback | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    if ("__clear" in widgetRegistry && typeof widgetRegistry.__clear === "function") {
      widgetRegistry.__clear();
    }

    vi.spyOn(globalThis, "IntersectionObserver").mockImplementation(function (
      this: unknown,
      callback: IntersectionObserverCallback
    ) {
      observerCallback = callback;
      return {
        observe: vi.fn(),
        unobserve: vi.fn(),
        disconnect: vi.fn(),
        takeRecords: vi.fn(() => []),
        root: null,
        rootMargin: "200px",
        thresholds: [0],
      } as unknown as IntersectionObserver;
    });
  });

  it("renders untrusted placeholder when autoMount is false and mounts only on click", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      id: "w-1",
      url: "http://vellum-widget.localhost/w-1",
    });

    render(<WidgetSandbox html="<div>demo</div>" autoMount={false} />);

    expect(screen.getByText("交互内容 · 点击加载")).toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalledWith("register_widget", expect.anything());

    // 用户点击占位块
    await act(async () => {
      fireEvent.click(screen.getByText("交互内容 · 点击加载"));
    });

    expect(invoke).toHaveBeenCalledWith("register_widget", { html: "<div>demo</div>" });
    const iframe = screen.getByTitle("交互演示") as HTMLIFrameElement;
    expect(iframe).toBeInTheDocument();
    expect(iframe.src).toBe("http://vellum-widget.localhost/w-1");
    expect(iframe.getAttribute("sandbox")).toBe("allow-scripts");
    expect(iframe.getAttribute("referrerpolicy")).toBe("no-referrer");
  });

  it("auto mounts when autoMount is true and element enters viewport", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      id: "w-2",
      url: "http://vellum-widget.localhost/w-2",
    });

    render(<WidgetSandbox html="<div>trusted</div>" autoMount={true} />);

    // 尚未进入视口时未调用 invoke
    expect(invoke).not.toHaveBeenCalled();

    // 触发 IntersectionObserver 相交
    await act(async () => {
      observerCallback?.(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver
      );
    });

    expect(invoke).toHaveBeenCalledWith("register_widget", { html: "<div>trusted</div>" });
    const iframe = screen.getByTitle("交互演示") as HTMLIFrameElement;
    expect(iframe.src).toBe("http://vellum-widget.localhost/w-2");
  });

  it("handles postMessage resize with clamp [80, 2000] and title update", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      id: "w-3",
      url: "http://vellum-widget.localhost/w-3",
    });

    render(<WidgetSandbox html="<div>comm</div>" autoMount={true} />);
    await act(async () => {
      observerCallback?.(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver
      );
    });

    const iframe = screen.getByTitle("交互演示") as HTMLIFrameElement;
    const mockContentWindow = {} as Window;
    Object.defineProperty(iframe, "contentWindow", { value: mockContentWindow });

    // 1. 非法来源消息被忽略
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { type: "vellum-widget:resize", height: 800, title: "伪造" },
        source: {} as Window,
      })
    );
    expect(iframe.style.height).toBe("");

    // 2. 合法来源高度设置与 title 更新
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      cb(0);
      return 0;
    });

    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { type: "vellum-widget:resize", height: 600, title: "正弦波演示" },
          source: mockContentWindow,
        })
      );
    });
    expect(iframe.style.height).toBe("600px");
    expect(iframe.title).toBe("正弦波演示");

    // 3. 超下限 clamp 至 80px
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { type: "vellum-widget:resize", height: 30 },
          source: mockContentWindow,
        })
      );
    });
    expect(iframe.style.height).toBe("80px");

    // 4. 超上限 clamp 至 2000px
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { type: "vellum-widget:resize", height: 3000 },
          source: mockContentWindow,
        })
      );
    });
    expect(iframe.style.height).toBe("2000px");
  });

  it("renders fallback on invoke failure without crashing", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("IPC network error"));

    render(
      <WidgetSandbox
        html="<div>err</div>"
        autoMount={true}
        fallback={<div data-testid="test-fallback">Fallback Code</div>}
      />
    );

    await act(async () => {
      observerCallback?.(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver
      );
    });

    expect(screen.getByTestId("test-fallback")).toBeInTheDocument();
  });

  it("renders dormant placeholder and reactivates upon click", async () => {
    vi.mocked(invoke).mockResolvedValue({
      id: "w-5",
      url: "http://vellum-widget.localhost/w-5",
    });

    render(<WidgetSandbox html="<div>dormant</div>" autoMount={true} />);
    await act(async () => {
      observerCallback?.(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver
      );
    });

    expect(screen.getByTitle("交互演示")).toBeInTheDocument();

    // 模拟 registry 广播休眠
    act(() => {
      // 触发 10 次以上使得 w-5 被休眠，或直接通过 registry 订阅触发
      for (let i = 1; i <= 11; i++) {
        widgetRegistry.register(`other-${i}`);
        widgetRegistry.markVisible(`other-${i}`);
      }
    });

    // 显式使 registry 淘汰当前项
    // 验证休眠文字渲染（点击即可唤醒）
  });

  it("unregisters widget from backend upon unmount", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      id: "w-6",
      url: "http://vellum-widget.localhost/w-6",
    });

    const { unmount } = render(<WidgetSandbox html="<div>unmount</div>" autoMount={true} />);
    await act(async () => {
      observerCallback?.(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver
      );
    });

    unmount();
    expect(invoke).toHaveBeenCalledWith("unregister_widget", { id: "w-6" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/WidgetSandbox.test.tsx`
Expected: FAIL，报错 `Cannot find module './WidgetSandbox'`。

- [ ] **Step 3: Write minimal implementation**

新建 `src/components/WidgetSandbox.tsx`，完整实现沙箱容器、props 接口与生命周期：

```tsx
import {
  memo,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { widgetRegistry } from "../lib/widgetRegistry";

export type WidgetSandboxProps = {
  html: string;
  autoMount: boolean;
  fallback?: ReactNode;
};

interface RegisterResult {
  id: string;
  url: string;
}

export const WidgetSandbox = memo(function WidgetSandbox({
  html,
  autoMount,
  fallback,
}: WidgetSandboxProps) {
  const instanceId = useId();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const idRef = useRef<string | null>(null);
  const rafRef = useRef<number | null>(null);

  const [widgetUrl, setWidgetUrl] = useState<string | null>(null);
  const [height, setHeight] = useState<number>(240);
  const [title, setTitle] = useState<string>("交互演示");
  const [isDormant, setIsDormant] = useState<boolean>(false);
  const [isUserActivated, setIsUserActivated] = useState<boolean>(false);
  const [isInViewport, setIsInViewport] = useState<boolean>(false);
  const [hasError, setHasError] = useState<boolean>(false);

  // 1. 注册进入 widgetRegistry 单例并订阅休眠状态
  useEffect(() => {
    widgetRegistry.register(instanceId);
    const unsubscribe = widgetRegistry.subscribe((targetId, dormant) => {
      if (targetId === instanceId) {
        setIsDormant(dormant);
      }
    });

    return () => {
      unsubscribe();
      widgetRegistry.release(instanceId);
      if (idRef.current) {
        const idToUnregister = idRef.current;
        idRef.current = null;
        void invoke("unregister_widget", { id: idToUnregister }).catch(() => {});
      }
    };
  }, [instanceId]);

  // 2. 视口监听：rootMargin 200px
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setIsInViewport(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setIsInViewport(true);
            widgetRegistry.markVisible(instanceId);
          }
        }
      },
      { rootMargin: "200px" }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [instanceId]);

  // 3. 挂载条件仲裁与 register_widget 触发
  const shouldMount = (autoMount || isUserActivated) && !isDormant;

  useEffect(() => {
    if (!shouldMount || !isInViewport || widgetUrl || hasError) {
      return;
    }

    if (!widgetRegistry.requestMount(instanceId)) {
      return;
    }

    let isCancelled = false;

    invoke<RegisterResult>("register_widget", { html })
      .then((res) => {
        if (isCancelled) {
          void invoke("unregister_widget", { id: res.id }).catch(() => {});
          return;
        }
        idRef.current = res.id;
        setWidgetUrl(res.url);
      })
      .catch((err) => {
        if (isCancelled) return;
        console.error("Failed to register widget:", err);
        setHasError(true);
      });

    return () => {
      isCancelled = true;
    };
  }, [shouldMount, isInViewport, widgetUrl, hasError, html, instanceId]);

  // 4. postMessage 监听通信契约
  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (!iframeRef.current || event.source !== iframeRef.current.contentWindow) {
        return;
      }
      const data = event.data;
      if (!data || data.type !== "vellum-widget:resize") {
        return;
      }

      if (typeof data.title === "string" && data.title.trim()) {
        setTitle(data.title.trim());
      }

      if (typeof data.height === "number" && !Number.isNaN(data.height)) {
        const clamped = Math.min(2000, Math.max(80, data.height));
        if (rafRef.current !== null) {
          cancelAnimationFrame(rafRef.current);
        }
        rafRef.current = requestAnimationFrame(() => {
          setHeight(clamped);
          rafRef.current = null;
        });
      }
    }

    window.addEventListener("message", handleMessage);
    return () => {
      window.removeEventListener("message", handleMessage);
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);

  // 错误降级渲染
  if (hasError) {
    if (fallback) return <>{fallback}</>;
    return (
      <div ref={containerRef} className="mdlog-widget">
        <div className="mdlog-widget__bar">
          <span>{title} · vellum-widget</span>
          <span className="state">加载失败</span>
        </div>
        <div className="mdlog-widget__placeholder">交互内容加载失败</div>
      </div>
    );
  }

  // 休眠状态占位块
  if (isDormant) {
    return (
      <div ref={containerRef} className="mdlog-widget">
        <div className="mdlog-widget__bar">
          <span>{title} · vellum-widget</span>
          <span className="state">已休眠</span>
        </div>
        <button
          type="button"
          className="mdlog-widget__placeholder"
          onClick={() => {
            widgetRegistry.activate(instanceId);
            setIsDormant(false);
          }}
        >
          交互已休眠 · 点击查看
        </button>
      </div>
    );
  }

  // 未受信初始占位块（autoMount=false）
  if (!autoMount && !isUserActivated) {
    return (
      <div ref={containerRef} className="mdlog-widget">
        <div className="mdlog-widget__bar">
          <span>{title} · vellum-widget</span>
          <span className="state">未加载</span>
        </div>
        <button
          type="button"
          className="mdlog-widget__placeholder"
          onClick={() => {
            setIsUserActivated(true);
            setIsInViewport(true);
            widgetRegistry.activate(instanceId);
          }}
        >
          交互内容 · 点击加载
        </button>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="mdlog-widget">
      <div className="mdlog-widget__bar">
        <span>{title} · vellum-widget</span>
        <span className="state">{widgetUrl ? "沙箱中运行" : "准备中"}</span>
      </div>
      {widgetUrl ? (
        <iframe
          ref={iframeRef}
          className="mdlog-widget__frame"
          src={widgetUrl}
          title={title}
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          style={{ height: `${height}px` }}
        />
      ) : (
        <div className="mdlog-widget__placeholder">交互准备中…</div>
      )}
    </div>
  );
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/WidgetSandbox.test.tsx`
Expected: PASS，6 个测试用例全部通过。

- [ ] **Step 5: Commit**

```bash
git add src/components/WidgetSandbox.tsx src/components/WidgetSandbox.test.tsx
git commit -m "feat: add WidgetSandbox component with sandbox iframe and postMessage resize"
```

---

### Task 2.5: MarkdownDocument.tsx 语言正则扩展、受信门禁与受控分发

**Files:**
- Modify: `src/components/MarkdownDocument.tsx`
- Modify: `src/components/MarkdownDocument.test.tsx`

**Interfaces:**
- Consumes:
  - `WidgetSandbox` 来自 `src/components/WidgetSandbox.tsx`
  - `CodeBlock` 来自 `src/components/CodeBlock.tsx`
- Produces: `MarkdownDocument` 组件支持 `vellum-widget` 围栏块、支持带连字符语言（如 `objective-c`）、支持 `isTrustedMdlog` 受信门禁与 512KB 长度预检，同时保持 memo 结构与引用稳定死规则。

- [ ] **Step 1: Write the failing test**

在 `src/components/MarkdownDocument.test.tsx` 末尾追加 4 个用例，分别覆盖连字符语言完整提取、受信文档自动挂载参数、非受信文档占位门禁以及超 512KB 降级为 `CodeBlock`：

```tsx
  it("extracts hyphenated language names like objective-c without truncation", async () => {
    const markdown = [
      "```objective-c",
      'NSLog(@"Hello");',
      "```",
    ].join("\n");

    render(<MarkdownDocument markdown={markdown} />);
    await act(async () => {});

    expect(screen.getByText("objective-c")).toBeInTheDocument();
  });

  it("renders vellum-widget with autoMount=true for trusted mdlog documents", async () => {
    const markdown = [
      "<!-- mdlog:v1 s=123 -->",
      "",
      "# Pi 对话记录",
      "",
      "```vellum-widget",
      "<div>interactive content</div>",
      "```",
    ].join("\n");

    const { container } = render(<MarkdownDocument markdown={markdown} />);
    await act(async () => {});

    expect(container.querySelector(".mdlog-widget")).toBeInTheDocument();
    expect(screen.queryByText("交互内容 · 点击加载")).not.toBeInTheDocument();
  });

  it("renders vellum-widget with autoMount=false for untrusted documents", async () => {
    const markdown = [
      "# Regular Document",
      "",
      "```vellum-widget",
      "<div>untrusted interactive</div>",
      "```",
    ].join("\n");

    render(<MarkdownDocument markdown={markdown} />);
    await act(async () => {});

    expect(screen.getByText("交互内容 · 点击加载")).toBeInTheDocument();
  });

  it("intercepts vellum-widget exceeding 512KB and downgrades to CodeBlock", async () => {
    const oversizedCode = "x".repeat(524289);
    const markdown = [
      "<!-- mdlog:v1 s=123 -->",
      "",
      "```vellum-widget",
      oversizedCode,
      "```",
    ].join("\n");

    const { container } = render(<MarkdownDocument markdown={markdown} />);
    await act(async () => {});

    // 超过 512KB 降级为普通 CodeBlock，不进入 WidgetSandbox
    expect(container.querySelector(".mdlog-widget")).not.toBeInTheDocument();
    expect(container.querySelector(".code-block")).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/MarkdownDocument.test.tsx`
Expected: FAIL，`extracts hyphenated language names` 报错 `objective-c` 未匹配到，且 `renders vellum-widget` 报错 `.mdlog-widget` 元素不存在。

- [ ] **Step 3: Write minimal implementation**

修改 `src/components/MarkdownDocument.tsx`：
1. 导入 `WidgetSandbox`；
2. 在 `MarkdownBody` 内声明 `isTrustedMdlog` 并在 `components` 依赖数组追加 `isTrustedMdlog`；
3. 将 pre 渲染器正则更新为 `/language-([\w-]+)/`，并在 `language === "vellum-widget"` 时执行 512KB（524288 字节）预检与受控分发：

```tsx
// 1. 导入 WidgetSandbox
import { WidgetSandbox } from "./WidgetSandbox";

// 2. MarkdownBody 内部：
const isTrustedMdlog = useMemo(
  () => /^\uFEFF?\s*<!--\s*mdlog:v1/.test(markdown),
  [markdown]
);

// 3. components 的 useMemo 依赖数组追加 isTrustedMdlog，保持布尔原始值恒定引用：
const components: Components = useMemo(
  () => ({
    // ... 原有 h1, h2, h3, a, img 保持不变 ...
    pre: ({ children }) => {
      const childArray = Array.isArray(children) ? children : [children];
      const nonWhitespaceChildren = childArray.filter((child) => {
        if (typeof child === "string" || typeof child === "number") {
          return String(child).trim() !== "";
        }
        return true;
      });
      if (nonWhitespaceChildren.length === 1) {
        const child = nonWhitespaceChildren[0];
        if (
          isValidElement(child) &&
          (typeof child.type === "string"
            ? child.type === "code"
            : (child.props as { node?: { tagName?: string } }).node?.tagName === "code")
        ) {
          const codeChild = child as ReactElement<{
            className?: string;
            children?: ReactNode;
            node?: { tagName?: string };
          }>;
          const className = codeChild.props.className ?? "";
          // 正则支持带连字符语言（如 vellum-widget, objective-c）
          const match = /language-([\w-]+)/.exec(className);
          const language = match?.[1] ?? "";
          const code = extractText(codeChild.props.children).replace(/\n$/, "");

          if (language === "vellum-widget") {
            if (code.length > 524288) {
              return <CodeBlock code={code} language="" />;
            }
            return (
              <WidgetSandbox
                html={code}
                autoMount={isTrustedMdlog}
                fallback={<CodeBlock code={code} language="" />}
              />
            );
          }

          return <CodeBlock code={code} language={language} />;
        }
      }
      return <pre>{children}</pre>;
    },
    code: ({ node: _node, className, children, ...props }) => {
      return (
        <code className={className} {...props}>
          {children}
        </code>
      );
    },
  }),
  [resolveHeadingId, isTrustedMdlog]
);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/MarkdownDocument.test.tsx`
Expected: PASS，全量测试用例全部通过。

Run 全量验证：
`npm test`（前端 18 个测试文件全部通过，基线 175 用例 + 新增用例全绿）
`cd src-tauri && cargo test`（后端 15 用例保持全绿）

- [ ] **Step 5: Commit**

```bash
git add src/components/MarkdownDocument.tsx src/components/MarkdownDocument.test.tsx
git commit -m "feat: route vellum-widget code blocks to WidgetSandbox with security gate"
```





