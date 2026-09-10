import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useDocumentEditor } from "./useDocumentEditor";

const markdown = "# 标题\n\n第一段。\n\n第二段。\n";

function setup(overrides: Partial<Parameters<typeof useDocumentEditor>[0]> = {}) {
  const onMarkdownChange = vi.fn();
  const save = vi.fn(() => Promise.resolve());
  const view = renderHook(() =>
    useDocumentEditor({ markdown, mdlogActive: false, onMarkdownChange, save, ...overrides })
  );
  return { ...view, onMarkdownChange, save };
}

describe("useDocumentEditor", () => {
  it("从 markdown 切出块单元", () => {
    const { result } = setup();
    expect(result.current.units).toHaveLength(3);
    expect(result.current.viewMode).toBe("reading");
  });

  it("mdlog 记录中拒绝进入编辑视图并提示", async () => {
    const { result } = setup({ mdlogActive: true });
    await act(async () => {
      await result.current.toggleView();
    });
    expect(result.current.viewMode).toBe("reading");
    expect(result.current.toast?.message).toContain("记录中");
  });

  it("激活块后草稿是该块源码，提交时拼回全文并落盘", async () => {
    const { result, onMarkdownChange, save } = setup();
    act(() => {
      result.current.toggleView();
    });
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      result.current.activateUnit(1, 0);
    });
    expect(result.current.draft).toBe("第一段。");

    act(() => {
      result.current.updateDraft("改过的第一段。");
    });
    await act(async () => {
      await result.current.commitActive();
    });

    expect(onMarkdownChange).toHaveBeenCalledWith("# 标题\n\n改过的第一段。\n\n第二段。\n");
    expect(save).toHaveBeenCalledWith("# 标题\n\n改过的第一段。\n\n第二段。\n");
    expect(result.current.activeUnit).toBeNull();
  });

  it("草稿与原文相同时不提交、不落盘", async () => {
    const { result, onMarkdownChange, save } = setup();
    act(() => {
      result.current.activateUnit(1, 0);
    });
    await act(async () => {
      await result.current.commitActive();
    });
    expect(onMarkdownChange).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it("提交耗时超过阈值时挂出「文档较重」标记", async () => {
    const { result } = setup({ heavyCommitMs: 0 });
    act(() => {
      result.current.activateUnit(1, 0);
    });
    act(() => {
      result.current.updateDraft("改过的第一段。");
    });
    await act(async () => {
      await result.current.commitActive();
    });
    expect(result.current.heavyDoc).toBe(true);
  });

  it("只读块点击给出原因文案", () => {
    const { result } = setup();
    act(() => {
      result.current.notifyLocked("html");
    });
    expect(result.current.toast?.message).toContain("HTML");
  });

  it("编辑中被外部改写：取消编辑并提示", async () => {
    const { result } = setup();
    act(() => {
      result.current.activateUnit(1, 0);
    });
    act(() => {
      result.current.notifyInterrupted("文件已被外部修改 · 编辑已取消");
    });
    expect(result.current.activeUnit).toBeNull();
    expect(result.current.toast?.message).toContain("外部修改");
  });

  it("保存失败时把草稿留在框里并提示", async () => {
    const save = vi.fn(() => Promise.reject(new Error("拒绝写入")));
    const onMarkdownChange = vi.fn();
    const { result } = renderHook(() =>
      useDocumentEditor({ markdown, mdlogActive: false, onMarkdownChange, save })
    );

    act(() => {
      result.current.activateUnit(1, 0);
    });
    act(() => {
      result.current.updateDraft("改过的第一段。");
    });
    await act(async () => {
      await result.current.commitActive();
    });

    expect(result.current.toast?.message).toContain("保存失败");
    expect(result.current.draft).toBe("改过的第一段。");
  });

  // 跨任务一致性（裁定 F9b/F14）：上游 MD 点击回调按 LF 归一后的文本算 caret，
  // 本 hook 取草稿必须同样归一，否则多行 CRLF 块的光标落点会系统性偏移。
  it("CRLF 文档的草稿按 LF 归一，且未改动时不误提交", async () => {
    const crlf = "# 标题\r\n\r\n第一段。\r\n第二行。\r\n";
    const onMarkdownChange = vi.fn();
    const save = vi.fn(() => Promise.resolve());
    const { result } = renderHook(() =>
      useDocumentEditor({ markdown: crlf, mdlogActive: false, onMarkdownChange, save })
    );

    act(() => {
      result.current.activateUnit(1, 4);
    });
    expect(result.current.draft).toBe("第一段。\n第二行。");
    expect(result.current.draft).not.toContain("\r");

    await act(async () => {
      await result.current.commitActive();
    });
    expect(onMarkdownChange).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });
});
