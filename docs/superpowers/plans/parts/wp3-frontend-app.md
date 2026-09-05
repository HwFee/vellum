# 工作包 3：前端 App 实时行为

本工作包负责 `src/App.tsx` 中的实时会话交互行为、滚动仲裁与徽章生命周期调度。主要覆盖热重载底端智能跟随与 ResizeObserver 落位守护、记录态下副作用全面抑制（页边印章与落墨动画静音、阅读位置刷盘暂停并在断开时补写），以及「记录中」徽章的渲染、事件监听与定时自动复查机制。

---

### Task 3.1: 贴底跟随判定纯函数与单 Layout Effect 滚动仲裁

**Files:**
- Create: `src/lib/scrollStick.ts`
- Create: `src/lib/scrollStick.test.ts`
- Modify: `src/App.tsx:5-18, 30-45, 115-135, 335-350`
- Modify: `src/App.test.tsx:320-365`

**Interfaces:**
- Consumes:
  - `restoreScrollPosition(container: HTMLElement, contentEl: HTMLElement, record: ScrollPositionRecord, headings: OutlineHeading[]): () => void` from `src/lib/scrollRestore.ts`
- Produces:
  - `isNearBottom(scrollHeight: number, scrollTop: number, clientHeight: number, threshold?: number): boolean`
  - `isContainerNearBottom(container: HTMLElement, threshold?: number): boolean`
  - `shouldStickToBottomRef: React.MutableRefObject<boolean>` in `App.tsx`

**Hook 类型迁移说明与理由：**
- **现状**：`src/App.tsx:337-345` 当前使用 `useEffect` 恢复 `pendingScrollRef`：
  ```tsx
  useEffect(() => {
    if (pendingScrollRef.current !== null) {
      const container = scrollRef.current;
      if (container) {
        container.scrollTop = pendingScrollRef.current;
      }
      pendingScrollRef.current = null;
    }
  }, [activeDocument?.markdown]);
  ```
- **迁移为 `useLayoutEffect` 的理由**：
  1. `useEffect` 在浏览器完成布局与绘制（Paint）后异步触发。在实时追加写入场景中，新内容提交入 DOM 后若在 `useEffect` 中才更新 `scrollTop`，屏幕会先在上一帧以未定位位置渲染，紧接着突跳到底部，造成明显的画面闪烁与抖动（Flash of Unscrolled Content）。
  2. `useLayoutEffect` 在 React 完成 DOM 突变提交后、浏览器渲染前同步执行。将 `pendingScrollRef` 恢复与贴底跟随仲裁收敛在同一 `useLayoutEffect` 内，可确保 `scrollTop` 赋值以及 `restoreScrollPosition` 的 ResizeObserver 落位守护在首帧渲染前生效，用户视觉完全平滑。
  3. 原子仲裁：在同一个 hook 内，若 `shouldStickToBottomRef.current === true`，立即跳过 `pendingScrollRef` 恢复，重设 `scrollTop = container.scrollHeight` 并启动 ResizeObserver 落位守护；若为 `false`，则恢复重载前的原位置，两路互斥且无竞态。

- [ ] **Step 1: Write the failing test**

创建 `src/lib/scrollStick.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { isContainerNearBottom, isNearBottom } from "./scrollStick";

describe("isNearBottom", () => {
  it("returns true when precisely at the bottom", () => {
    expect(isNearBottom(1000, 700, 300, 80)).toBe(true);
  });

  it("returns true when within threshold (<= 80px)", () => {
    expect(isNearBottom(1000, 650, 300, 80)).toBe(true);
    expect(isNearBottom(1000, 620, 300, 80)).toBe(true);
  });

  it("returns false when distance to bottom exceeds threshold", () => {
    expect(isNearBottom(1000, 619, 300, 80)).toBe(false);
    expect(isNearBottom(1000, 0, 300, 80)).toBe(false);
  });

  it("returns true when content does not overflow (scrollHeight <= clientHeight)", () => {
    expect(isNearBottom(300, 0, 300, 80)).toBe(true);
    expect(isNearBottom(200, 0, 300, 80)).toBe(true);
  });

  it("defaults threshold to 80 when not specified", () => {
    expect(isNearBottom(1000, 620, 300)).toBe(true);
    expect(isNearBottom(1000, 619, 300)).toBe(false);
  });
});

describe("isContainerNearBottom", () => {
  it("computes bottom stickiness from DOM element properties", () => {
    const el = document.createElement("div");
    Object.defineProperty(el, "scrollHeight", { value: 1200, configurable: true });
    Object.defineProperty(el, "clientHeight", { value: 400, configurable: true });
    Object.defineProperty(el, "scrollTop", { value: 750, configurable: true });

    expect(isContainerNearBottom(el, 80)).toBe(true);

    Object.defineProperty(el, "scrollTop", { value: 600, configurable: true });
    expect(isContainerNearBottom(el, 80)).toBe(false);
  });
});
```

并在 `src/App.test.tsx` 现有 `preserves scroll position across a hot reload` 用例后新增针对贴底跟随的单测：

```tsx
test("sticks to bottom and launches settle guard when hot reload occurs near bottom", async () => {
  vi.mocked(listen).mockClear();

  vi.mocked(open).mockResolvedValueOnce("C:/notes/stick.md");
  backendInvoke.mockResolvedValueOnce({
    path: "C:/notes/stick.md",
    fileName: "stick.md",
    parentPath: "C:/notes",
    markdown: "# Stick Doc V1",
  });

  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "打开文件" }));
  await waitFor(() => expect(screen.getByRole("heading", { name: "Stick Doc V1" })).toBeInTheDocument());

  const scrollContainer = document.querySelector(".document-scroll") as HTMLElement;
  let scrollTop = 560;
  Object.defineProperty(scrollContainer, "scrollHeight", { value: 1000, configurable: true });
  Object.defineProperty(scrollContainer, "clientHeight", { value: 400, configurable: true });
  Object.defineProperty(scrollContainer, "scrollTop", {
    configurable: true,
    get: () => scrollTop,
    set: (value: number) => {
      scrollTop = value;
    },
  });

  // 1000 - 560 - 400 = 40 <= 80，判定为贴底
  await waitFor(() => {
    expect(vi.mocked(listen).mock.calls.some(([event]) => event === "file-changed")).toBe(true);
  });

  backendInvoke.mockResolvedValueOnce({
    path: "C:/notes/stick.md",
    fileName: "stick.md",
    parentPath: "C:/notes",
    markdown: "# Stick Doc V2\n\nAppended new lines.",
  });

  const fileChangedCall = vi.mocked(listen).mock.calls.find(
    ([event]) => event === "file-changed"
  );
  await act(async () => {
    (fileChangedCall![1] as (payload: unknown) => void)({ payload: {} });
  });

  await waitFor(() => expect(screen.getByText("Appended new lines.")).toBeInTheDocument());
  // 新内容渲染后 scrollTop 必须被设为最新的 scrollHeight (落底)
  expect(scrollContainer.scrollTop).toBe(scrollContainer.scrollHeight);
});
```

- [ ] **Step 2: Run test to verify it fails**

执行命令：
```bash
npx vitest run src/lib/scrollStick.test.ts src/App.test.tsx -t "isNearBottom|sticks to bottom"
```
预期输出：FAIL，找不到 `src/lib/scrollStick.ts`，以及 `App.test.tsx` 中 `scrollContainer.scrollTop` 未跳至最新底部。

- [ ] **Step 3: Write minimal implementation**

创建 `src/lib/scrollStick.ts`：

```ts
/**
 * 判定容器当前滚动位置是否处于视口底部附近（剩余未滚出距离 <= 阈值）。
 * @param scrollHeight 容器总滚动高度
 * @param scrollTop 容器当前滚动位移
 * @param clientHeight 容器可视高度
 * @param threshold 判定阈值像素，默认 80px
 */
export function isNearBottom(
  scrollHeight: number,
  scrollTop: number,
  clientHeight: number,
  threshold = 80
): boolean {
  return scrollHeight - scrollTop - clientHeight <= threshold;
}

/**
 * 判定 DOM 滚动容器是否处于底部附近。
 */
export function isContainerNearBottom(container: HTMLElement, threshold = 80): boolean {
  return isNearBottom(container.scrollHeight, container.scrollTop, container.clientHeight, threshold);
}
```

修改 `src/App.tsx`：
1. 从 `react` 引入 `useLayoutEffect`：
   ```tsx
   import { Suspense, lazy, useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
   ```
2. 引入 `isContainerNearBottom`：
   ```tsx
   import { isContainerNearBottom } from "./lib/scrollStick";
   ```
3. 在 `App` 组件内增加贴底标记 ref：
   ```tsx
   const shouldStickToBottomRef = useRef(false);
   ```
4. 在 `reloadCurrent` 中记录重载前是否处于底部：
   ```tsx
   async function reloadCurrent() {
     const path = currentPathRef.current;
     if (!path) return;
     const requestId = ++loadRequestRef.current;
     try {
       const document = await invoke<LoadedDocument>("load_document", { path });
       if (loadRequestRef.current !== requestId) return;
       const container = scrollRef.current;
       shouldStickToBottomRef.current = container
         ? isContainerNearBottom(container, 80)
         : false;
       pendingScrollRef.current = container ? container.scrollTop : 0;
       currentPathRef.current = document.path;
       setState({ status: "ready", document });
       setReloadTick((tick) => tick + 1);
       setShowReloadNote(true);
     } catch {
       // 重载失败时保留旧内容，不打扰用户
     }
   }
   ```
5. 在 `loadPath` 中将 `shouldStickToBottomRef.current` 置为 `false`（打开新文件不盲从底端）：
   ```tsx
   async function loadPath(path: string) {
     shouldStickToBottomRef.current = false;
     // ... 其余逻辑不变
   ```
6. 将原有 `useEffect` 滚动恢复迁移为 `useLayoutEffect` 单一仲裁：
   ```tsx
   // 热重载滚动仲裁：贴底跟随优先，非贴底保留原有滚动位置
   useLayoutEffect(() => {
     const container = scrollRef.current;
     if (!container) return;

     if (shouldStickToBottomRef.current) {
       shouldStickToBottomRef.current = false;
       pendingScrollRef.current = null;
       container.scrollTop = container.scrollHeight;

       const content = contentRef.current;
       if (content) {
         restoreCancelRef.current?.();
         restoreCancelRef.current = restoreScrollPosition(
           container,
           content,
           { ratio: 1 },
           headingsRef.current
         );
       }
       return;
     }

     if (pendingScrollRef.current !== null) {
       container.scrollTop = pendingScrollRef.current;
       pendingScrollRef.current = null;
     }
   }, [activeDocument?.markdown]);
   ```

- [ ] **Step 4: Run test to verify it passes**

执行命令：
```bash
npx vitest run src/lib/scrollStick.test.ts src/App.test.tsx
```
预期输出：所有用例 PASS。
并运行全量测试确认基线未被破坏：
```bash
npm test
```
预期输出：17 个测试文件全绿，测试用例数增加。

- [ ] **Step 5: Commit**

```bash
git add src/lib/scrollStick.ts src/lib/scrollStick.test.ts src/App.tsx src/App.test.tsx
git commit -m "feat(app): add hot reload bottom stickiness with layout effect and settle guard"
```

---

### Task 3.2: 记录态副作用抑制（Reload Note、Fresh Ink 与 ScrollMemory 刷盘暂停）

**Files:**
- Create: `src/lib/mdlogState.ts`
- Create: `src/lib/mdlogState.test.ts`
- Modify: `src/App.tsx:28-40, 100-140, 270-305, 345-365`
- Modify: `src/App.test.tsx`

**Interfaces:**
- Consumes:
  - `invoke<MdlogState | null>("read_mdlog_state")`
  - `listen("mdlog-state-changed", ...)`
  - `saveScrollPosition(path: string, record: ScrollPositionRecord): Promise<void>` from `src/lib/scrollMemory.ts`
- Produces:
  - `type MdlogState = { lastWriteAt: number; heartbeatAt: number; expiresAt: number }`
  - `computeRecheckDelay(expiresAt: number, now?: number): number`
  - `isMdlogActiveRef: React.MutableRefObject<boolean>`
  - 抑制机制：活跃态下热重载不显示「墨迹未干」印章、跳过 `fresh-ink` 动画类名、暂停滚轮 300ms 防抖刷盘，并在记录断开时补写一次阅读位置。

- [ ] **Step 1: Write the failing test**

创建 `src/lib/mdlogState.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { computeRecheckDelay } from "./mdlogState";

describe("computeRecheckDelay", () => {
  it("computes remaining milliseconds until expiration", () => {
    const now = 1_000_000;
    const expiresAt = 1_030_000;
    expect(computeRecheckDelay(expiresAt, now)).toBe(30_000);
  });

  it("returns 0 when expiresAt is in the past", () => {
    const now = 1_000_000;
    const expiresAt = 999_000;
    expect(computeRecheckDelay(expiresAt, now)).toBe(0);
  });

  it("returns 0 when expiresAt equals current time", () => {
    const now = 1_000_000;
    expect(computeRecheckDelay(now, now)).toBe(0);
  });
});
```

在 `src/App.test.tsx` 中新增针对副作用抑制与断开补写的测试：

```tsx
test("suppresses reload note and fresh-ink animation during hot reload when mdlog is active", async () => {
  vi.mocked(listen).mockClear();

  // 模拟当前文档存在存活的 sidecar
  backendInvoke.mockImplementation(async (cmd: string, args?: unknown) => {
    if (cmd === "load_document") {
      return {
        path: "C:/notes/live.md",
        fileName: "live.md",
        parentPath: "C:/notes",
        markdown: "# Live Doc V1",
      };
    }
    if (cmd === "read_mdlog_state") {
      return {
        lastWriteAt: Date.now(),
        heartbeatAt: Date.now(),
        expiresAt: Date.now() + 120_000,
      };
    }
    return undefined;
  });

  vi.mocked(open).mockResolvedValueOnce("C:/notes/live.md");
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "打开文件" }));

  await waitFor(() => expect(screen.getByRole("heading", { name: "Live Doc V1" })).toBeInTheDocument());

  // 触发 file-changed 热重载
  backendInvoke.mockImplementation(async (cmd: string) => {
    if (cmd === "load_document") {
      return {
        path: "C:/notes/live.md",
        fileName: "live.md",
        parentPath: "C:/notes",
        markdown: "# Live Doc V2",
      };
    }
    if (cmd === "read_mdlog_state") {
      return {
        lastWriteAt: Date.now(),
        heartbeatAt: Date.now(),
        expiresAt: Date.now() + 120_000,
      };
    }
    return undefined;
  });

  const fileChangedCall = vi.mocked(listen).mock.calls.find(
    ([event]) => event === "file-changed"
  );
  await act(async () => {
    (fileChangedCall![1] as (payload: unknown) => void)({ payload: {} });
  });

  await waitFor(() => expect(screen.getByRole("heading", { name: "Live Doc V2" })).toBeInTheDocument());

  // 印章组件不得挂载
  expect(screen.queryByText("墨迹未干")).not.toBeInTheDocument();
  // .document-content 上不得添加 fresh-ink 类名
  const docContent = document.querySelector(".document-content");
  expect(docContent).not.toHaveClass("fresh-ink");
});

test("pauses debounced scrollMemory saving during active mdlog and flushes once upon disconnection", async () => {
  vi.useFakeTimers();
  const saveSpy = vi.fn();
  const { Store } = await import("@tauri-apps/plugin-store");
  vi.mocked(Store.load).mockResolvedValue({
    get: vi.fn(() => Promise.resolve(undefined)),
    set: saveSpy,
    save: vi.fn(() => Promise.resolve()),
  } as unknown as InstanceType<typeof Store>);

  let activeState: { lastWriteAt: number; heartbeatAt: number; expiresAt: number } | null = {
    lastWriteAt: Date.now(),
    heartbeatAt: Date.now(),
    expiresAt: Date.now() + 120_000,
  };

  backendInvoke.mockImplementation(async (cmd: string) => {
    if (cmd === "load_document") {
      return {
        path: "C:/notes/scroll-live.md",
        fileName: "scroll-live.md",
        parentPath: "C:/notes",
        markdown: "# Scroll Live\n\nLong body content.",
      };
    }
    if (cmd === "read_mdlog_state") {
      return activeState;
    }
    return undefined;
  });

  vi.mocked(open).mockResolvedValueOnce("C:/notes/scroll-live.md");
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "打开文件" }));

  await waitFor(() => expect(screen.getByRole("heading", { name: "Scroll Live" })).toBeInTheDocument());

  const scrollContainer = document.querySelector(".document-scroll") as HTMLElement;
  saveSpy.mockClear();

  // 记录态下触发多次滚动事件
  fireEvent.scroll(scrollContainer);
  act(() => {
    vi.advanceTimersByTime(400);
  });
  // 必须被暂停，不写入 store
  expect(saveSpy).not.toHaveBeenCalled();

  // 模拟 sidecar 断开（mdlog-state-changed 返回 null）
  activeState = null;
  const stateChangedCall = vi.mocked(listen).mock.calls.find(
    ([event]) => event === "mdlog-state-changed"
  );
  await act(async () => {
    if (stateChangedCall) {
      (stateChangedCall[1] as (payload: unknown) => void)({ payload: {} });
    }
  });

  // 断开时集中补写一次当前滚动位置
  await waitFor(() => {
    expect(saveSpy).toHaveBeenCalledWith("C:/notes/scroll-live.md", expect.any(Object));
  });

  vi.useRealTimers();
});
```

- [ ] **Step 2: Run test to verify it fails**

执行命令：
```bash
npx vitest run src/lib/mdlogState.test.ts src/App.test.tsx -t "suppresses reload note|pauses debounced scrollMemory"
```
预期输出：FAIL，找不到 `src/lib/mdlogState.ts`，且 `墨迹未干` 印章与 `fresh-ink` 仍被触发。

- [ ] **Step 3: Write minimal implementation**

创建 `src/lib/mdlogState.ts`：

```ts
export type MdlogState = {
  lastWriteAt: number;
  heartbeatAt: number;
  expiresAt: number;
};

/**
 * 计算距离 expiresAt 设定的毫秒延迟。
 * 保证延时非负（若已过期则返回 0，立即复查）。
 */
export function computeRecheckDelay(expiresAt: number, now = Date.now()): number {
  return Math.max(0, expiresAt - now);
}
```

修改 `src/App.tsx`：
1. 引入 `MdlogState` 类型：
   ```tsx
   import type { MdlogState } from "./lib/mdlogState";
   ```
2. 在 `App` 内增加 `mdlogState` 与 `isMdlogActiveRef`：
   ```tsx
   const [mdlogState, setMdlogState] = useState<MdlogState | null>(null);
   const isMdlogActive = mdlogState !== null;
   const isMdlogActiveRef = useRef(false);
   isMdlogActiveRef.current = isMdlogActive;
   const prevIsMdlogActiveRef = useRef(false);
   ```
3. 在 `loadPath` 成功后查询当前文档的 `read_mdlog_state`：
   ```tsx
   currentPathRef.current = document.path;
   setState({ status: "ready", document });
   void saveLastOpened(document.path);

   try {
     const liveState = await invoke<MdlogState | null>("read_mdlog_state");
     if (loadRequestRef.current === requestId) {
       setMdlogState(liveState);
     }
   } catch {
     if (loadRequestRef.current === requestId) {
       setMdlogState(null);
     }
   }
   ```
4. 注册 `mdlog-state-changed` 监听器：
   ```tsx
   useEffect(() => {
     let cancelled = false;
     let unlisten: (() => void) | undefined;

     async function checkState() {
       if (!currentPathRef.current) return;
       try {
         const liveState = await invoke<MdlogState | null>("read_mdlog_state");
         if (!cancelled) {
           setMdlogState(liveState);
         }
       } catch {
         if (!cancelled) {
           setMdlogState(null);
         }
       }
     }

     async function bindState() {
       const unlistenFn = await listen("mdlog-state-changed", () => {
         void checkState();
       });
       if (cancelled) {
         unlistenFn();
       } else {
         unlisten = unlistenFn;
       }
     }

     void bindState();

     return () => {
       cancelled = true;
       unlisten?.();
     };
   }, []);
   ```
5. 在 `reloadCurrent` 中依据 `isMdlogActiveRef.current` 抑制印章显示：
   ```tsx
   setReloadTick((tick) => tick + 1);
   if (!isMdlogActiveRef.current) {
     setShowReloadNote(true);
   }
   ```
6. 修改 `fresh-ink` 的 `useEffect`，在 `isMdlogActive` 为 true 时跳过：
   ```tsx
   useEffect(() => {
     if (reloadTick === 0 || isMdlogActive) return;
     const el = documentContentRef.current;
     if (el) {
       el.classList.remove("fresh-ink");
       void el.offsetWidth;
       el.classList.add("fresh-ink");
     }
     const timer = setTimeout(() => setShowReloadNote(false), 2800);
     return () => clearTimeout(timer);
   }, [reloadTick, isMdlogActive]);
   ```
7. 修改滚动事件监听器中的 `handleScroll`，活跃态跳过防抖写盘：
   ```tsx
   const handleScroll = () => {
     if (isMdlogActiveRef.current) return;
     if (scrollSaveTimerRef.current !== null) {
       clearTimeout(scrollSaveTimerRef.current);
     }
     scrollSaveTimerRef.current = setTimeout(() => {
       scrollSaveTimerRef.current = null;
       persistCurrentScroll();
     }, 300);
   };
   ```
8. 添加断开连接时的集中补写 effect：
   ```tsx
   useEffect(() => {
     if (prevIsMdlogActiveRef.current && !isMdlogActive) {
       persistCurrentScroll();
     }
     prevIsMdlogActiveRef.current = isMdlogActive;
   }, [isMdlogActive]);
   ```

- [ ] **Step 4: Run test to verify it passes**

执行命令：
```bash
npx vitest run src/lib/mdlogState.test.ts src/App.test.tsx
```
预期输出：全部 PASS。
运行全量测试确认回归安全：
```bash
npm test
```
预期输出：17 个测试文件全部通过。

- [ ] **Step 5: Commit**

```bash
git add src/lib/mdlogState.ts src/lib/mdlogState.test.ts src/App.tsx src/App.test.tsx
git commit -m "feat(app): suppress reload note, fresh-ink animation, and debounce scrollMemory during active mdlog"
```

---

### Task 3.3: 「记录中」徽章渲染与自动复查调度器

**Files:**
- Modify: `src/App.tsx:30-50, 100-145, 230-265, 440-475`
- Modify: `src/App.test.tsx`

**Interfaces:**
- Consumes:
  - `read_mdlog_state() -> { lastWriteAt: number; heartbeatAt: number; expiresAt: number } | null`
  - `computeRecheckDelay(expiresAt: number, now?: number): number` from `src/lib/mdlogState.ts`
  - 事件 `mdlog-state-changed`
- Produces:
  - JSX 渲染：`<div className="mdlog-live">记录中 · PI</div>`（位于 `.document-content` 内部、`MarkdownDocument` 之后）
  - 定时调度器：`recheckTimerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>`
  - 到期自动复查与静默卸载：`expiresAt` 到期自动触发 `read_mdlog_state`；返回 `null` 时静默隐藏徽章并清空定时器；切换文档时彻底清理。

- [ ] **Step 1: Write the failing test**

在 `src/App.test.tsx` 中增加徽章渲染、定时复查卸载、200s 空闲判活以及切换文档清理的自动化测试：

```tsx
test("renders '记录中 · PI' badge when read_mdlog_state returns active state", async () => {
  backendInvoke.mockImplementation(async (cmd: string) => {
    if (cmd === "load_document") {
      return {
        path: "C:/notes/live-doc.md",
        fileName: "live-doc.md",
        parentPath: "C:/notes",
        markdown: "# Live Title",
      };
    }
    if (cmd === "read_mdlog_state") {
      return {
        lastWriteAt: 1_000_000,
        heartbeatAt: 1_000_000,
        expiresAt: 1_120_000,
      };
    }
    return undefined;
  });

  vi.mocked(open).mockResolvedValueOnce("C:/notes/live-doc.md");
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "打开文件" }));

  await waitFor(() => expect(screen.getByRole("heading", { name: "Live Title" })).toBeInTheDocument());

  const badge = await screen.findByText("记录中 · PI");
  expect(badge).toBeInTheDocument();
  expect(badge).toHaveClass("mdlog-live");
  // 断言徽章位于 .document-content 容器内部
  expect(badge.parentElement).toHaveClass("document-content");
});

test("silently hides badge when expiresAt arrives and sidecar expired (Z1)", async () => {
  vi.useFakeTimers();

  const now = Date.now();
  let stateResult: { lastWriteAt: number; heartbeatAt: number; expiresAt: number } | null = {
    lastWriteAt: now,
    heartbeatAt: now,
    expiresAt: now + 50_000,
  };

  backendInvoke.mockImplementation(async (cmd: string) => {
    if (cmd === "load_document") {
      return {
        path: "C:/notes/expire.md",
        fileName: "expire.md",
        parentPath: "C:/notes",
        markdown: "# Expire Test",
      };
    }
    if (cmd === "read_mdlog_state") {
      return stateResult;
    }
    return undefined;
  });

  vi.mocked(open).mockResolvedValueOnce("C:/notes/expire.md");
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "打开文件" }));

  await waitFor(() => expect(screen.getByRole("heading", { name: "Expire Test" })).toBeInTheDocument());
  expect(await screen.findByText("记录中 · PI")).toBeInTheDocument();

  // 模拟到期后 sidecar 判定失效（进程崩溃，无心跳）
  stateResult = null;

  // 快进 50_000ms 到达 expiresAt
  await act(async () => {
    vi.advanceTimersByTime(50_000);
  });

  await waitFor(() => {
    expect(screen.queryByText("记录中 · PI")).not.toBeInTheDocument();
  });

  vi.useRealTimers();
});

test("keeps badge alive across 200s idle time when heartbeat refreshes (Z1 spec §9.2)", async () => {
  vi.useFakeTimers();

  let currentTime = 1_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => currentTime);

  let stateResult = {
    lastWriteAt: 1_000_000,
    heartbeatAt: 1_000_000,
    expiresAt: 1_120_000, // +120s
  };

  backendInvoke.mockImplementation(async (cmd: string) => {
    if (cmd === "load_document") {
      return {
        path: "C:/notes/idle.md",
        fileName: "idle.md",
        parentPath: "C:/notes",
        markdown: "# Idle Session",
      };
    }
    if (cmd === "read_mdlog_state") {
      return stateResult;
    }
    return undefined;
  });

  vi.mocked(open).mockResolvedValueOnce("C:/notes/idle.md");
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "打开文件" }));

  await waitFor(() => expect(screen.getByRole("heading", { name: "Idle Session" })).toBeInTheDocument());
  expect(await screen.findByText("记录中 · PI")).toBeInTheDocument();

  // 模拟空闲期间每 30s 刷新一次心跳，持续至 200s（无内容写，但 heartbeatAt/expiresAt 递增）
  const stateChangedCall = vi.mocked(listen).mock.calls.find(
    ([event]) => event === "mdlog-state-changed"
  );

  for (let t = 30_000; t <= 200_000; t += 30_000) {
    currentTime = 1_000_000 + t;
    stateResult = {
      lastWriteAt: 1_000_000, // 内容未变
      heartbeatAt: currentTime,
      expiresAt: currentTime + 120_000,
    };
    await act(async () => {
      vi.advanceTimersByTime(30_000);
      if (stateChangedCall) {
        (stateChangedCall[1] as (payload: unknown) => void)({ payload: {} });
      }
    });
  }

  // 200s 后徽章依旧保持存活
  expect(screen.getByText("记录中 · PI")).toBeInTheDocument();

  vi.useRealTimers();
});

test("clears timer and unmounts badge when switching to a regular document", async () => {
  backendInvoke.mockImplementation(async (cmd: string, args?: unknown) => {
    if (cmd === "load_document") {
      const p = (args as { path: string }).path;
      return {
        path: p,
        fileName: p.endsWith("live.md") ? "live.md" : "plain.md",
        parentPath: "C:/notes",
        markdown: p.endsWith("live.md") ? "# Live" : "# Plain",
      };
    }
    if (cmd === "read_mdlog_state") {
      return {
        lastWriteAt: Date.now(),
        heartbeatAt: Date.now(),
        expiresAt: Date.now() + 120_000,
      };
    }
    return undefined;
  });

  vi.mocked(open).mockResolvedValueOnce("C:/notes/live.md");
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "打开文件" }));

  await waitFor(() => expect(screen.getByRole("heading", { name: "Live" })).toBeInTheDocument());
  expect(await screen.findByText("记录中 · PI")).toBeInTheDocument();

  // 切换到普通文档（read_mdlog_state 返回 null）
  backendInvoke.mockImplementation(async (cmd: string, args?: unknown) => {
    if (cmd === "load_document") {
      const p = (args as { path: string }).path;
      return {
        path: p,
        fileName: "plain.md",
        parentPath: "C:/notes",
        markdown: "# Plain",
      };
    }
    if (cmd === "read_mdlog_state") {
      return null;
    }
    return undefined;
  });

  vi.mocked(open).mockResolvedValueOnce("C:/notes/plain.md");
  fireEvent.click(screen.getByRole("button", { name: "打开文件" }));

  await waitFor(() => expect(screen.getByRole("heading", { name: "Plain" })).toBeInTheDocument());
  expect(screen.queryByText("记录中 · PI")).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

执行命令：
```bash
npx vitest run src/App.test.tsx -t "badge|hides badge|keeps badge alive"
```
预期输出：FAIL，找不到 `.mdlog-live` 徽章元素，或复查定时器未被调度。

- [ ] **Step 3: Write minimal implementation**

修改 `src/App.tsx`：
1. 引入 `computeRecheckDelay`：
   ```tsx
   import { computeRecheckDelay, type MdlogState } from "./lib/mdlogState";
   ```
2. 在 `App` 内增加 `recheckTimerRef`：
   ```tsx
   const recheckTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
   ```
3. 封装通用的复查调度函数 `scheduleRecheck`：
   ```tsx
   const scheduleRecheck = useCallback((state: MdlogState | null) => {
     if (recheckTimerRef.current !== null) {
       clearTimeout(recheckTimerRef.current);
       recheckTimerRef.current = null;
     }
     if (!state) return;

     const delay = computeRecheckDelay(state.expiresAt);
     recheckTimerRef.current = setTimeout(async () => {
       recheckTimerRef.current = null;
       const path = currentPathRef.current;
       if (!path) return;
       try {
         const latestState = await invoke<MdlogState | null>("read_mdlog_state");
         setMdlogState(latestState);
         scheduleRecheck(latestState);
       } catch {
         setMdlogState(null);
       }
     }, delay);
   }, []);
   ```
4. 在 `loadPath` 中切换文档时清理定时器，并在加载成功后建立调度：
   ```tsx
   async function loadPath(path: string) {
     persistCurrentScroll();
     restoreCancelRef.current?.();
     restoreCancelRef.current = null;
     if (recheckTimerRef.current !== null) {
       clearTimeout(recheckTimerRef.current);
       recheckTimerRef.current = null;
     }
     setMdlogState(null);
     // ...
     try {
       const document = await invoke<LoadedDocument>("load_document", { path });
       if (loadRequestRef.current !== requestId) return;
       currentPathRef.current = document.path;
       setState({ status: "ready", document });
       void saveLastOpened(document.path);

       try {
         const liveState = await invoke<MdlogState | null>("read_mdlog_state");
         if (loadRequestRef.current === requestId) {
           setMdlogState(liveState);
           scheduleRecheck(liveState);
         }
       } catch {
         if (loadRequestRef.current === requestId) {
           setMdlogState(null);
         }
       }
     } catch (error) { ... }
   }
   ```
5. 在 `mdlog-state-changed` 监听器中收到新事件时更新状态并重置定时器：
   ```tsx
   useEffect(() => {
     let cancelled = false;
     let unlisten: (() => void) | undefined;

     async function checkState() {
       if (!currentPathRef.current) return;
       try {
         const liveState = await invoke<MdlogState | null>("read_mdlog_state");
         if (!cancelled) {
           setMdlogState(liveState);
           scheduleRecheck(liveState);
         }
       } catch {
         if (!cancelled) {
           setMdlogState(null);
         }
       }
     }

     async function bindState() {
       const unlistenFn = await listen("mdlog-state-changed", () => {
         void checkState();
       });
       if (cancelled) {
         unlistenFn();
       } else {
         unlisten = unlistenFn;
       }
     }

     void bindState();

     return () => {
       cancelled = true;
       unlisten?.();
       if (recheckTimerRef.current !== null) {
         clearTimeout(recheckTimerRef.current);
         recheckTimerRef.current = null;
       }
     };
   }, [scheduleRecheck]);
   ```
6. 在 JSX 树的 `.document-content` 容器内渲染徽章（位于 `MarkdownDocument` 之后）：
   ```tsx
   <div ref={documentContentRef} className="document-content">
     {state.status === "empty" ? <EmptyState onOpen={handleOpen} /> : null}
     {state.status === "loading" ? (
       <section className="empty-state" role="status">
         加载中...
       </section>
     ) : null}
     {state.status === "error" ? <ErrorState message={state.message} path={state.path} /> : null}
     {state.status === "ready" ? (
       <>
         <Suspense fallback={null}>
           <MarkdownDocument
             markdown={state.document.markdown}
             headings={headings}
             onRendered={handleContentRendered}
             searchQuery={deferredSearchQuery}
             searchQueryPending={searchQueryPending}
             activeMatchIndex={activeMatchIndex}
             onMatchCountChange={handleMatchCountChange}
           />
         </Suspense>
         {mdlogState !== null && (
           <div className="mdlog-live">记录中 · PI</div>
         )}
       </>
     ) : null}
   </div>
   ```

- [ ] **Step 4: Run test to verify it passes**

执行命令：
```bash
npx vitest run src/App.test.tsx
```
预期输出：所有测试（含徽章显隐、200s 空闲、崩溃超时卸载等用例）全部 PASS。
运行全量测试确认基线全绿：
```bash
npm test
```
预期输出：17 个测试文件全部通过。

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx src/App.test.tsx
git commit -m "feat(app): add live mdlog badge with scheduled recheck and automatic expiration"
```

---

### Task 3.4: 完整场景端到端集成验证与全量回归

**Files:**
- Modify: `src/App.test.tsx`

**Interfaces:**
- Consumes:
  - Task 3.1（`scrollStick.ts` / 底部跟随与落位守护）
  - Task 3.2（副作用抑制 / 刷盘暂停 / 断开补写）
  - Task 3.3（`mdlogState.ts` / 徽章渲染 / 到期复查调度）
- Produces:
  - 全流程综合集成测试套件，验证贴底跟随、主动上滑打断、记录态静音、会话结束恢复普通热重载的完整生命周期。
  - 100% 保持既有 17 个前端测试文件与 175+ 用例全绿。

- [ ] **Step 1: Write the failing test**

在 `src/App.test.tsx` 中编写覆盖完整生命周期的端到端集成用例：

```tsx
test("end-to-end: live mdlog lifecycle from bottom stickiness to disconnection recovery", async () => {
  vi.useFakeTimers();

  const saveSpy = vi.fn();
  const { Store } = await import("@tauri-apps/plugin-store");
  vi.mocked(Store.load).mockResolvedValue({
    get: vi.fn(() => Promise.resolve(undefined)),
    set: saveSpy,
    save: vi.fn(() => Promise.resolve()),
  } as unknown as InstanceType<typeof Store>);

  let currentDocMarkdown = "# Session Log\n\nInitial message.";
  let liveState: { lastWriteAt: number; heartbeatAt: number; expiresAt: number } | null = {
    lastWriteAt: 1_000_000,
    heartbeatAt: 1_000_000,
    expiresAt: 1_120_000,
  };

  backendInvoke.mockImplementation(async (cmd: string) => {
    if (cmd === "load_document") {
      return {
        path: "C:/logs/pi.md",
        fileName: "pi.md",
        parentPath: "C:/logs",
        markdown: currentDocMarkdown,
      };
    }
    if (cmd === "read_mdlog_state") {
      return liveState;
    }
    return undefined;
  });

  vi.mocked(open).mockResolvedValueOnce("C:/logs/pi.md");
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "打开文件" }));

  await waitFor(() => expect(screen.getByRole("heading", { name: "Session Log" })).toBeInTheDocument());

  // 1. 验证徽章渲染且副作用抑制开启
  expect(screen.getByText("记录中 · PI")).toBeInTheDocument();
  expect(screen.queryByText("墨迹未干")).not.toBeInTheDocument();

  const scrollContainer = document.querySelector(".document-scroll") as HTMLElement;
  let scrollTop = 600;
  Object.defineProperty(scrollContainer, "scrollHeight", { value: 1000, configurable: true });
  Object.defineProperty(scrollContainer, "clientHeight", { value: 400, configurable: true });
  Object.defineProperty(scrollContainer, "scrollTop", {
    configurable: true,
    get: () => scrollTop,
    set: (v: number) => {
      scrollTop = v;
    },
  });

  // 2. 模拟热重载（贴底状态下追加对话）
  currentDocMarkdown = "# Session Log\n\nInitial message.\n\nNew AI response appended.";
  const fileChangedCall = vi.mocked(listen).mock.calls.find(
    ([event]) => event === "file-changed"
  );
  await act(async () => {
    (fileChangedCall![1] as (payload: unknown) => void)({ payload: {} });
  });

  await waitFor(() => expect(screen.getByText("New AI response appended.")).toBeInTheDocument());
  // 确认自动贴底且未挂载印章
  expect(scrollContainer.scrollTop).toBe(1000);
  expect(screen.queryByText("墨迹未干")).not.toBeInTheDocument();

  // 3. 用户主动上滑查看历史（滚至顶部 scrollTop = 100，距离底部 1000 - 100 - 400 = 500 > 80）
  scrollTop = 100;
  fireEvent.wheel(scrollContainer);

  // 再次发生热重载
  currentDocMarkdown = "# Session Log\n\nInitial message.\n\nNew AI response appended.\n\nAnother turn.";
  await act(async () => {
    (fileChangedCall![1] as (payload: unknown) => void)({ payload: {} });
  });

  await waitFor(() => expect(screen.getByText("Another turn.")).toBeInTheDocument());
  // 用户不在底部，滚动位置必须严格保持在 100，不得强制落底
  expect(scrollContainer.scrollTop).toBe(100);

  // 4. 会话结束断开（sidecar 删除或心跳超时，返回 null）
  saveSpy.mockClear();
  liveState = null;
  const stateChangedCall = vi.mocked(listen).mock.calls.find(
    ([event]) => event === "mdlog-state-changed"
  );
  await act(async () => {
    if (stateChangedCall) {
      (stateChangedCall[1] as (payload: unknown) => void)({ payload: {} });
    }
  });

  // 徽章静默隐藏，阅读位置集中补写一次
  await waitFor(() => expect(screen.queryByText("记录中 · PI")).not.toBeInTheDocument());
  expect(saveSpy).toHaveBeenCalledWith("C:/logs/pi.md", expect.any(Object));

  // 5. 断开后的普通热重载恢复印章显示
  currentDocMarkdown = "# Session Log\n\nManual edit by user.";
  await act(async () => {
    (fileChangedCall![1] as (payload: unknown) => void)({ payload: {} });
  });

  await waitFor(() => expect(screen.getByText("Manual edit by user.")).toBeInTheDocument());
  expect(screen.getByText("墨迹未干")).toBeInTheDocument();

  vi.useRealTimers();
});
```

- [ ] **Step 2: Run test to verify it fails**

执行命令：
```bash
npx vitest run src/App.test.tsx -t "end-to-end: live mdlog lifecycle"
```
预期输出：若前置任务各环节有任何未对齐的竞态或状态遗留，此综合用例将精准捕获并 FAIL。

- [ ] **Step 3: Write minimal implementation**

复查并确保 `src/App.tsx` 中的所有状态转移逻辑符合断言：
1. `reloadCurrent` 中 `isContainerNearBottom` 计算准确；
2. `useLayoutEffect` 中非贴底时 `pendingScrollRef` 正常恢复；
3. `isMdlogActiveRef.current` 在状态变化时同步更新；
4. `scheduleRecheck` 在断开与切换文档时正确清理；
5. `.mdlog-live` 在 `mdlogState !== null` 时精准渲染。

- [ ] **Step 4: Run test to verify it passes**

运行全量测试套件：
```bash
npm test
```
预期输出：
```
Test Files  18 passed (18)
     Tests  185 passed (185)
```
确认测试总数在既有 175 条基线上净增，无任何破损或跳过用例。

- [ ] **Step 5: Commit**

```bash
git add src/App.test.tsx
git commit -m "test(app): add comprehensive end-to-end test for mdlog live session lifecycle"
```




