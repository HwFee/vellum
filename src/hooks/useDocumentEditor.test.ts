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
  onChange?: (next: string) => void,
  documentGeneration = 0
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
    documentGeneration,
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

  it("提交在途时的重复调用直接返回：不重复 splice、不二次落盘（裁定 F38-B）", async () => {
    let release!: () => void;
    const save = vi.fn(
      (_next: string) =>
        new Promise<void>((resolve) => {
          release = () => resolve();
        })
    );
    const onChange = vi.fn();

    const { result } = renderHook(() => useControlledEditor(markdown, save, onChange));

    act(() => {
      result.current.editor.activateUnit(1, 0);
    });
    act(() => {
      // 草稿改变块结构：第二次提交拿「新 markdown 的同索引单元」当原文时比对不相等，
      // 才会走到「再拼一遍、再落盘一次」那条路（否则会被前台的同文本短路掩盖）。
      result.current.editor.updateDraft("改过的第一段。\n\n新段。");
    });

    let first!: Promise<boolean>;
    let second!: Promise<boolean>;
    // 两次调用必须在**同一次同步派发**里（真机双通道的真实时序）：第一次提交内部的
    // flushSync 只把父级 markdown 推前、resetSession 的 setState 尚未提交，
    // 第二次调用因此仍看得到活动块 —— 这正是 C2 的前提。
    act(() => {
      first = result.current.editor.commitActive();
      // 在途重入（第二条 Ctrl+S 通道）：必须直接返回，不得再拼一遍、再落盘一次
      second = result.current.editor.commitActive();
    });
    expect(save).toHaveBeenCalledTimes(1);

    await act(async () => {
      await expect(second).resolves.toBe(true);
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledTimes(1);

    await act(async () => {
      release();
      await first;
    });
    expect(save).toHaveBeenCalledTimes(1);
    const saved = save.mock.calls[0][0];
    expect(saved).toBe("# 标题\n\n改过的第一段。\n\n新段。\n\n第二段。\n");
    expect(saved.match(/新段。/g)).toHaveLength(1);
  });

  it("resetSession 清空活动块、草稿与 caret（裁定 F39）", () => {
    const { result } = setup();
    act(() => {
      result.current.activateUnit(1, 5);
    });
    act(() => {
      result.current.updateDraft("改过的第一段。");
    });
    expect(result.current.activeUnit).not.toBeNull();

    act(() => {
      result.current.resetSession();
    });

    expect(result.current.activeUnit).toBeNull();
    expect(result.current.draft).toBe("");
    expect(result.current.initialCaret).toBe(0);
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
        result.current.notifyInterrupted("记录已开始，编辑已取消");
      });
      expect(result.current.toast?.message).toContain("记录已开始");

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
        result.current.notifyInterrupted("记录已开始，编辑已取消");
      });
      act(() => {
        vi.advanceTimersByTime(2000);
      });
      act(() => {
        result.current.notifyInterrupted("文件已被外部修改 · 编辑已取消");
      });
      act(() => {
        vi.advanceTimersByTime(2000);
      });
      // 距第二条提示仅 2000ms：不得被上一条的计时器提前清掉
      expect(result.current.toast?.message).toContain("外部修改");

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
      result.current.notifyInterrupted("记录已开始，编辑已取消");
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

/// 任务列表勾选（reader-polish task-8）：阅读视图里点复选框直接回写源码。
/// 与块编辑是两条路——不进入编辑会话、不碰草稿，但门禁与失败回滚同款。
describe("useDocumentEditor · 任务列表勾选", () => {
  it("阅读视图点复选框：先推新源码给父级（乐观更新）再落盘，且不进入编辑会话", async () => {
    const markdown = "# 标题\n\n- [ ] a\n- [x] b\n";
    const save = vi.fn(async (_next: string) => {});
    const onChange = vi.fn();
    const { result } = renderHook(() => useControlledEditor(markdown, save, onChange));

    await act(async () => {
      await result.current.editor.toggleTask(markdown.indexOf("- [x] b"));
    });

    const next = "# 标题\n\n- [ ] a\n- [ ] b\n";
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(next);
    expect(save).toHaveBeenCalledWith(next);
    expect(result.current.markdown).toBe(next);
    // 勾选不是编辑：没有活动块、没有草稿、视图仍是阅读
    expect(result.current.editor.activeUnit).toBeNull();
    expect(result.current.editor.viewMode).toBe("reading");
    expect(result.current.editor.draft).toBe("");
  });

  it("连续两次勾选：第二次基于第一次的结果，往返回到原文", async () => {
    const markdown = "- [ ] a\n";
    const save = vi.fn(async (_next: string) => {});
    const { result } = renderHook(() => useControlledEditor(markdown, save));

    await act(async () => {
      await result.current.editor.toggleTask(0);
    });
    expect(result.current.markdown).toBe("- [x] a\n");

    await act(async () => {
      await result.current.editor.toggleTask(0);
    });
    expect(result.current.markdown).toBe(markdown);
    expect(save.mock.calls.map((call) => call[0])).toEqual(["- [x] a\n", markdown]);
  });

  it("落盘失败：回滚乐观更新（先 next 再原 markdown）并提示「写入失败」", async () => {
    const markdown = "- [ ] a\n";
    const save = vi.fn(async () => {
      throw new Error("磁盘只读");
    });
    const onChange = vi.fn();
    const { result } = renderHook(() => useControlledEditor(markdown, save, onChange));

    await act(async () => {
      await result.current.editor.toggleTask(0);
    });

    expect(onChange.mock.calls.map((call) => call[0])).toEqual(["- [x] a\n", markdown]);
    expect(result.current.markdown).toBe(markdown);
    expect(result.current.editor.toast?.message).toContain("写入失败");
  });

  // 约束 14 / 裁定 F25：记录中一切写盘入口都必须拦在写盘口，勾选不是例外
  it("mdlog 记录中：不落盘、不改内存，提示勾选已禁用", async () => {
    const markdown = "- [ ] a\n";
    const { result, save, onMarkdownChange } = setup({ markdown, mdlogActive: true });

    await act(async () => {
      await result.current.toggleTask(0);
    });

    expect(save).not.toHaveBeenCalled();
    expect(onMarkdownChange).not.toHaveBeenCalled();
    expect(result.current.toast?.message).toContain("记录中");
  });

  it("只读块（列表项里有块级 HTML）里的任务列表不可点：不落盘、不提示", async () => {
    const markdown = "- [ ] a\n  <div>x</div>\n";
    const { result, save, onMarkdownChange } = setup({ markdown });
    expect(result.current.units[0].editable).toBe(false);

    await act(async () => {
      await result.current.toggleTask(0);
    });

    expect(save).not.toHaveBeenCalled();
    expect(onMarkdownChange).not.toHaveBeenCalled();
    expect(result.current.toast).toBeNull();
  });

  it("点普通列表项 / 源码位置对不上：静默 no-op", async () => {
    const markdown = "- a\n- b\n";
    const { result, save, onMarkdownChange } = setup({ markdown });

    await act(async () => {
      await result.current.toggleTask(markdown.indexOf("- b"));
    });
    await act(async () => {
      await result.current.toggleTask(9999);
    });

    expect(save).not.toHaveBeenCalled();
    expect(onMarkdownChange).not.toHaveBeenCalled();
    expect(result.current.toast).toBeNull();
  });

  // 审查 Important #1：回滚必须按「文档代际」守卫——换文档 / 热重载后磁盘上已是另一份
  // 内容，把点击时的旧 markdown 写回内存会把新文档的正文整篇换掉
  it("代际变化（换文档 / 热重载）后的落盘失败不回滚，只报失败", async () => {
    const markdown = "- [ ] a\n";
    let rejectSave!: (reason: unknown) => void;
    const save = vi.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectSave = reject;
        })
    );
    const onChange = vi.fn();

    // 受控父级：乐观写入真的推进 markdown。必须这样，否则「内存仍是我写的那份」这条
    // 次生守卫会先兜住，代际守卫的语义就测不出来了（两条守卫都要各自被钉住）
    const { result, rerender } = renderHook(
      ({ generation }: { generation: number }) =>
        useControlledEditor(markdown, save, onChange, generation),
      { initialProps: { generation: 1 } }
    );

    let pending!: Promise<void>;
    await act(async () => {
      pending = result.current.editor.toggleTask(0);
      // 在途链：本次勾选排在微任务上，让出一拍它才真正开跑（乐观写入 + 落盘）
      await Promise.resolve();
    });
    expect(result.current.markdown).toBe("- [x] a\n");

    // 落盘在途期间换代（换文档 / 热重载）：此刻内存仍是本次乐观写入的那份内容
    rerender({ generation: 2 });

    await act(async () => {
      rejectSave(new Error("磁盘只读"));
      await pending;
    });

    // 只有乐观那一次写入；回滚被代际守卫拦下（内存里是另一篇文档，不该被旧内容覆盖）
    expect(onChange.mock.calls.map((call) => call[0])).toEqual(["- [x] a\n"]);
    expect(result.current.markdown).toBe("- [x] a\n");
    expect(result.current.editor.toast?.message).toContain("写入失败");
  });

  // 同款守卫的第二条：内存已被别的写路径顶掉（块提交 / 外部重载）时，那份更新的状态
  // 才是磁盘的未来，回滚只会让它倒退
  it("内存已被别的写路径顶掉（不再是我写的那份）时，落盘失败不回滚", async () => {
    const markdown = "- [ ] a\n";
    let rejectSave!: (reason: unknown) => void;
    const save = vi.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectSave = reject;
        })
    );
    const onMarkdownChange = vi.fn();
    const { result, rerender } = renderHook(
      ({ text }: { text: string }) =>
        useDocumentEditor({ markdown: text, mdlogActive: false, onMarkdownChange, save }),
      { initialProps: { text: markdown } }
    );

    let pending!: Promise<void>;
    await act(async () => {
      pending = result.current.toggleTask(0);
      await Promise.resolve();
    });

    // 另一条写路径在这期间改写了内存（内容不再是本次乐观写入的那份）
    rerender({ text: "# 别的写入\n" });

    await act(async () => {
      rejectSave(new Error("磁盘只读"));
      await pending;
    });

    expect(onMarkdownChange).toHaveBeenCalledTimes(1);
    expect(onMarkdownChange).toHaveBeenCalledWith("- [x] a\n");
  });

  // 审查 Important #2：两次并发勾选会让后一次以「前一次的乐观结果」为基准，
  // 前一次失败回滚就把后一次一起抹掉 → 内存与磁盘不一致 → 回声被判成外部变更
  it("双击 + 首次落盘失败：后一次基于回滚后的真实源码，最终内存与磁盘一致", async () => {
    const markdown = "- [ ] a\n";
    const save = vi.fn(async (_next: string) => {
      throw new Error("磁盘只读");
    });
    const { result } = renderHook(() => useControlledEditor(markdown, save));

    await act(async () => {
      // 同一次同步派发里连点两次（第二次发生在第一次落盘在途时）
      const first = result.current.editor.toggleTask(0);
      const second = result.current.editor.toggleTask(0);
      await Promise.all([first, second]);
    });

    // 两次都以「未勾选」为基准（第一次回滚后的真实源码）⇒ 两次写同一份内容，
    // 而不是「翻过去又翻回来」（后者会让第二次的基准变成已被回滚掉的乐观结果）
    expect(save.mock.calls.map((call) => call[0])).toEqual(["- [x] a\n", "- [x] a\n"]);
    // 落盘全败 ⇒ 内存 = 磁盘 = 原文（不长期领先磁盘，watcher 回声不会被判成外部变更）
    expect(result.current.markdown).toBe(markdown);
  });

  it("编辑视图里勾选被纵深防御拦下（组件侧本就不挂覆盖渲染）", async () => {
    const markdown = "- [ ] a\n";
    const { result, save, onMarkdownChange } = setup({ markdown });

    act(() => {
      void result.current.toggleView();
    });
    expect(result.current.viewMode).toBe("editing");

    await act(async () => {
      await result.current.toggleTask(0);
    });

    expect(save).not.toHaveBeenCalled();
    expect(onMarkdownChange).not.toHaveBeenCalled();
    expect(result.current.toast).toBeNull();
  });
});
