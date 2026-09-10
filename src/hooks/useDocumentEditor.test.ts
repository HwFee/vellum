import { act, renderHook } from "@testing-library/react";
import { useCallback, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { useDocumentEditor } from "./useDocumentEditor";

const markdown = "# 标题\n\n第一段。\n\n第二段。\n";

/// 可控父级：onMarkdownChange 真的改写喂回 hook 的 markdown 并触发重渲染，
/// 复现真机接线（T6）下「flushSync 让父级同步吸收新 markdown」的语义 ——
/// 审查 C1 的两个故障分支（结构变化时重复落盘 / 同内容时静默永不落盘）
/// 只在父级 markdown 真的前进时出现，固定 prop 的 harness 看不见。
function useControlledEditor(
  initialMarkdown: string,
  save: (next: string) => Promise<void>,
  onChange?: (next: string) => void
) {
  const [markdownText, setMarkdownText] = useState(initialMarkdown);
  const [mdlogActive, setMdlogActive] = useState(false);
  const handleMarkdownChange = useCallback(
    (next: string) => {
      onChange?.(next);
      setMarkdownText(next);
    },
    [onChange]
  );
  const editor = useDocumentEditor({
    markdown: markdownText,
    mdlogActive,
    onMarkdownChange: handleMarkdownChange,
    save,
  });
  return { editor, markdown: markdownText, setMdlogActive };
}

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

  // 裁定 F24（审查 C1）：失败路径必须先回退父级内存，再重激活同块并保留草稿与 caret（M8）
  it("保存失败：先把父级 markdown 回退，再保留草稿与 caret", async () => {
    const save = vi.fn(async (_next: string) => {}).mockRejectedValueOnce(new Error("拒绝写入"));
    const onChange = vi.fn();
    const changed = "# 标题\n\n改过的第一段。\n\n第二段。\n";

    const { result } = renderHook(() => useControlledEditor(markdown, save, onChange));

    act(() => {
      result.current.editor.activateUnit(1, 5);
    });
    act(() => {
      result.current.editor.updateDraft("改过的第一段。");
    });
    await act(async () => {
      await result.current.editor.commitActive();
    });

    // 提交即落盘：内存先行到 next；落盘失败即回退 —— 且顺序必须是「先 next 再原 markdown」
    expect(onChange.mock.calls.map((call) => call[0])).toEqual([changed, markdown]);
    // 内存不长期领先磁盘
    expect(result.current.markdown).toBe(markdown);
    // 重新激活同一块，草稿仍是用户的修改文本（不是原文）
    expect(result.current.editor.activeUnit?.index).toBe(1);
    expect(result.current.editor.draft).toBe("改过的第一段。");
    expect(result.current.editor.initialCaret).toBe(5);
    expect(result.current.editor.toast?.message).toContain("保存失败");
  });

  it("保存失败后再次提交：只落盘一次且内容不重复", async () => {
    const save = vi.fn(async (_next: string) => {}).mockRejectedValueOnce(new Error("拒绝写入"));
    const firstCommit = "# 标题\n\n改过的第一段。\n\n新段。\n\n第二段。\n";

    const { result } = renderHook(() => useControlledEditor(markdown, save));

    act(() => {
      result.current.editor.activateUnit(1, 0);
    });
    act(() => {
      // 草稿改变了块结构（多出一个段落）—— 重试若按「新文本的同名索引」切片会重复写入
      result.current.editor.updateDraft("改过的第一段。\n\n新段。");
    });
    await act(async () => {
      await result.current.editor.commitActive();
    });
    expect(save).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.editor.commitActive();
    });

    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1][0]).toBe(firstCommit);
    expect(save.mock.calls[1][0]).not.toContain("新段。\n\n新段。");
    expect(result.current.editor.activeUnit).toBeNull();
    expect(result.current.markdown).toBe(firstCommit);
  });

  it("保存失败后同内容重试仍会重新落盘，不静默吞掉", async () => {
    const save = vi.fn(async (_next: string) => {}).mockRejectedValueOnce(new Error("拒绝写入"));
    const changed = "# 标题\n\n改过的第一段。\n\n第二段。\n";

    const { result } = renderHook(() => useControlledEditor(markdown, save));

    act(() => {
      result.current.editor.activateUnit(1, 0);
    });
    act(() => {
      result.current.editor.updateDraft("改过的第一段。");
    });
    await act(async () => {
      await result.current.editor.commitActive();
    });
    expect(save).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.editor.commitActive();
    });

    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1][0]).toBe(changed);
    expect(result.current.editor.activeUnit).toBeNull();
  });

  // 裁定 F25（审查 I2）：mdlog 门禁必须落在提交口，而不只是 activateUnit / toggleView 入口
  it("记录建立后提交被拦截：不落盘并取消编辑", async () => {
    const save = vi.fn(async (_next: string) => {});
    const onChange = vi.fn();

    const { result } = renderHook(() => useControlledEditor(markdown, save, onChange));

    act(() => {
      result.current.editor.activateUnit(1, 0);
    });
    act(() => {
      result.current.editor.updateDraft("改过的第一段。");
    });
    act(() => {
      result.current.setMdlogActive(true);
    });
    await act(async () => {
      await result.current.editor.commitActive();
    });

    expect(save).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
    expect(result.current.editor.activeUnit).toBeNull();
    expect(result.current.editor.toast?.message).toContain("记录已开始");
  });

  // 裁定 F31（审查 I2）：提示条是 position: fixed 的覆盖层，必须有自动消失路径，
  // 否则「保存失败 / 记录中禁用 / HTML 只读」会一直压在正文上，直到下一条提示顶掉。
  it("提示条 2.4 秒后自动消失", () => {
    vi.useFakeTimers();
    try {
      const { result } = setup();
      act(() => {
        result.current.notifyLocked("html");
      });
      expect(result.current.toast?.message).toContain("HTML");

      act(() => {
        vi.advanceTimersByTime(2399);
      });
      expect(result.current.toast).not.toBeNull();

      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(result.current.toast).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("新提示重置计时：每条提示都看满 2.4 秒", () => {
    vi.useFakeTimers();
    try {
      const { result } = setup();
      act(() => {
        result.current.notifyLocked("html");
      });
      act(() => {
        vi.advanceTimersByTime(2000);
      });
      act(() => {
        result.current.notifyLocked("widget");
      });
      act(() => {
        vi.advanceTimersByTime(2000);
      });
      // 距第二条提示仅 2000ms：不得被上一条的计时器提前清掉
      expect(result.current.toast?.message).toContain("交互块");

      act(() => {
        vi.advanceTimersByTime(400);
      });
      expect(result.current.toast).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("dismissToast 立即清掉提示", () => {
    const { result } = setup();
    act(() => {
      result.current.notifyLocked("html");
    });
    expect(result.current.toast).not.toBeNull();
    act(() => {
      result.current.dismissToast();
    });
    expect(result.current.toast).toBeNull();
  });

  // 审查 Minor 2：全局 Ctrl+S 兜底（F6）让 commitActive 在阅读态可达，
  // 门禁不能对「本来就没有活动块」的提交弹「编辑已取消」——用户从未进入编辑态。
  it("记录中且无活动块时提交是 no-op，不弹提示", async () => {
    const { result, save } = setup({ mdlogActive: true });
    await act(async () => {
      await result.current.commitActive();
    });
    expect(save).not.toHaveBeenCalled();
    expect(result.current.toast).toBeNull();
  });

  // 审查 Minor 1：空态/加载态没有块单元，Ctrl+E 不得进入编辑视图
  //（否则顶栏呈按下态、宿主还会挂上 T7 会加 position: relative 的 --editing 类）。
  it("无块单元时不进入编辑视图", async () => {
    const { result } = setup({ markdown: "" });
    expect(result.current.units).toHaveLength(0);
    await act(async () => {
      await result.current.toggleView();
    });
    expect(result.current.viewMode).toBe("reading");
    expect(result.current.toast).toBeNull();
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
