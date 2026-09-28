import { act, render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { CodeBlock } from "./CodeBlock";

describe("CodeBlock", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("renders the wrapper with a single real pre inside and no nested pre", async () => {
    const { container } = render(<CodeBlock code="const x = 1;" />);
    // 让按需加载的高亮语言包在 act 内完成，避免 act(...) 警告
    await act(async () => {});
    expect(container.querySelector(".code-block")).toBeInTheDocument();
    const pres = container.querySelectorAll("pre");
    expect(pres).toHaveLength(1);
    expect(container.querySelector(".code-block pre")).toBeInTheDocument();
    expect(pres[0]).toHaveTextContent("const x = 1;");
  });

  it("renders the code with a copy button and optional language label", () => {
    render(<CodeBlock code="const x = 1;" language="ts" />);
    expect(screen.getByRole("code")).toHaveTextContent("const x = 1;");
    expect(screen.getByRole("button", { name: "复制" })).toBeInTheDocument();
    expect(screen.getByText("ts")).toBeInTheDocument();
  });

  it("renders without a language label when language is empty", () => {
    render(<CodeBlock code="plain text" />);
    expect(screen.getByRole("button", { name: "复制" })).toBeInTheDocument();
    expect(screen.queryByText("plain")).not.toBeInTheDocument();
  });

  it("emits a semantic pre > code pair with a language class", () => {
    const { container } = render(<CodeBlock code="const x = 1;" language="ts" />);
    const pres = container.querySelectorAll(".code-block pre");
    expect(pres).toHaveLength(1);
    const code = pres[0].querySelector(":scope > code");
    expect(code).toBeInTheDocument();
    // ts 是常见别名，会映射到按需加载的规范名 typescript
    expect(code).toHaveClass("language-typescript");
  });

  it("高亮样式不写字面量等宽栈：pre/code 的 fontFamily 指 --mono 槽位变量", async () => {
    // 回归：oneLight 的 "Fira Code..." 字面量以**内联 style** 落在 pre/code 上，
    // 优先级压过 `.code-block { font-family: var(--mono) }`——改代码字体整块不动。
    const { container } = render(<CodeBlock code="const x = 1;" language="ts" />);
    await act(async () => {});
    const pre = container.querySelector(".code-block pre") as HTMLElement;
    const code = pre.querySelector("code") as HTMLElement;
    for (const el of [pre, code]) {
      const family = el.style.fontFamily;
      expect(family).not.toContain("Fira Code");
      expect(family).not.toContain("Menlo");
      expect(family).toBe("var(--mono)");
    }
  });

  it("copies the exact raw code string on click", async () => {
    const writeText = vi.fn().mockResolvedValueOnce(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    render(<CodeBlock code={`  indented
  code`} language="ts" />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "复制" }));
    });
    expect(writeText).toHaveBeenCalledWith(`  indented
  code`);
  });

  it("shows copied feedback for 1.5s then returns to idle", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockResolvedValueOnce(undefined) } });
    render(<CodeBlock code="x" />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "复制" }));
    });
    expect(screen.getByRole("status")).toHaveTextContent("已复制");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(screen.getByRole("status")).toHaveTextContent("");
  });

  it("shows error feedback when clipboard fails", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockRejectedValueOnce(new Error("denied")) } });
    render(<CodeBlock code="x" />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "复制" }));
    });
    expect(screen.getByRole("status")).toHaveTextContent("复制失败");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(screen.getByRole("status")).toHaveTextContent("");
  });

  function createDeferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  it("does not update status or schedule a timer after unmount if the clipboard promise resolves late", async () => {
    const { promise, resolve } = createDeferred<void>();
    const writeText = vi.fn().mockReturnValueOnce(promise);
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    const { unmount } = render(<CodeBlock code="x" />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "复制" }));
    });

    unmount();
    expect(vi.getTimerCount()).toBe(0);

    await act(async () => {
      resolve();
    });

    expect(vi.getTimerCount()).toBe(0);
  });

  it("ignores stale clipboard results when a newer click starts", async () => {
    const first = createDeferred<void>();
    const second = createDeferred<void>();
    const writeText = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    render(<CodeBlock code="x" />);
    const button = screen.getByRole("button", { name: "复制" });

    await act(async () => {
      fireEvent.click(button);
    });
    await act(async () => {
      fireEvent.click(button);
    });

    await act(async () => {
      first.resolve();
    });
    expect(screen.getByRole("status")).toHaveTextContent("");

    await act(async () => {
      second.resolve();
    });
    expect(screen.getByRole("status")).toHaveTextContent("已复制");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(screen.getByRole("status")).toHaveTextContent("");
  });
});
