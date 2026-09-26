import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useRef } from "react";
import HoverPreviewLayer, { type NotePreview } from "./HoverPreviewLayer";

const invokeMock = vi.mocked(invoke);
const openUrlMock = vi.mocked(openUrl);

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(),
}));

const WIKILINKS = new Map<string, string | null>([
  ["纸的历史", "D:/wisdom/读书/纸的历史.md"],
  ["墨的制作", "D:/wisdom/读书/墨的制作.md"],
]);

const PREVIEW_A: NotePreview = {
  path: "D:/wisdom/读书/纸的历史.md",
  fileName: "纸的历史.md",
  markdown: "---\ntitle: 不应显示\n---\n# 从抄本到刻本\n\n纸让抄书成为可能，[[墨的制作|墨]]是另一篇。\n",
  truncated: false,
};

const PREVIEW_B: NotePreview = {
  path: "D:/wisdom/读书/墨的制作.md",
  fileName: "墨的制作.md",
  markdown: "烟是墨的骨，胶是墨的肉。",
  truncated: false,
};

function Host({
  enabled = true,
  onOpenWikilink = vi.fn(),
}: {
  enabled?: boolean;
  onOpenWikilink?: (path: string, target: string, fragment?: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  return (
    <>
      <div ref={containerRef} data-testid="scroll">
        <div ref={contentRef}>
          <p>
            字落到纸上就不再是字
            <sup>
              <a href="#user-content-fn-1" id="user-content-fnref-1" data-footnote-ref>
                1
              </a>
            </sup>
            。
          </p>
          <p>
            详见{" "}
            <a className="wikilink" href="wikilink:纸的历史" data-wikilink="纸的历史">
              纸的历史
            </a>
            与{" "}
            <a
              className="wikilink"
              href="wikilink:墨的制作"
              data-wikilink="墨的制作"
              data-wikilink-fragment="松烟"
            >
              墨的制作
            </a>
            ；
            <span className="wikilink wikilink--missing" data-wikilink="未名斋札记">
              未名斋札记
            </span>{" "}
            则没有解析。
          </p>
          <section data-footnotes className="footnotes">
            <ol>
              <li id="user-content-fn-1">
                <p>
                  「纸寿千年」语出《历代名画记》论装裱一节，<em>姑妄听之</em>。参{" "}
                  <a href="https://example.com/paper" target="_blank" rel="noreferrer">
                    外链
                  </a>
                  、{" "}
                  <a
                    className="wikilink"
                    href="wikilink:墨的制作"
                    data-wikilink="墨的制作"
                    data-wikilink-fragment="松烟"
                  >
                    墨的制作
                  </a>{" "}
                  与 <a href="#本页其他">本页其他</a>。{" "}
                  <a href="#user-content-fnref-1" data-footnote-backref>
                    ↩
                  </a>
                </p>
              </li>
            </ol>
          </section>
        </div>
      </div>
      <HoverPreviewLayer
        containerRef={containerRef}
        contentRef={contentRef}
        enabled={enabled}
        wikilinks={WIKILINKS}
        documentPath="D:/docs/a.md"
        onOpenWikilink={onOpenWikilink}
      />
    </>
  );
}

function footnoteRef() {
  return document.querySelector<HTMLElement>("a[data-footnote-ref]")!;
}
function wikilinkA() {
  return document.querySelector<HTMLElement>('a[data-wikilink="纸的历史"]')!;
}
function wikilinkB() {
  return document.querySelector<HTMLElement>('a[data-wikilink="墨的制作"]')!;
}
function missingLink() {
  return document.querySelector<HTMLElement>(".wikilink--missing")!;
}
function scrollHost() {
  return screen.getByTestId("scroll");
}
function tooltip() {
  return document.querySelector<HTMLElement>('[role="tooltip"]');
}

beforeEach(() => {
  vi.useFakeTimers();
  invokeMock.mockReset();
  openUrlMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("脚注浮笺（A1）", () => {
  it("悬停 200ms 出「注 1」小卡：克隆脚注正文、剥掉回链与重复 id", () => {
    render(<Host />);

    fireEvent.pointerOver(footnoteRef());
    act(() => void vi.advanceTimersByTime(150));
    expect(tooltip()).toBeNull();

    act(() => void vi.advanceTimersByTime(60));
    const card = tooltip();
    expect(card).not.toBeNull();
    expect(card!.textContent).toContain("注 1");
    expect(card!.textContent).toContain("语出《历代名画记》");
    expect(card!.textContent).not.toContain("↩");
    // 克隆体不带 id：正文里那枚 id 仍是唯一一份
    expect(card!.querySelector("[id]")).toBeNull();
    expect(document.querySelectorAll('[id="user-content-fn-1"]')).toHaveLength(1);
  });

  it("离开上标 150ms 宽限后收卡", () => {
    render(<Host />);
    fireEvent.pointerOver(footnoteRef());
    act(() => void vi.advanceTimersByTime(220));
    expect(tooltip()).not.toBeNull();

    fireEvent.pointerOut(footnoteRef());
    act(() => void vi.advanceTimersByTime(140));
    expect(tooltip()).not.toBeNull();
    act(() => void vi.advanceTimersByTime(20));
    expect(tooltip()).toBeNull();
  });

  it("指针移进卡片不收卡，离开卡片 150ms 后才收", () => {
    render(<Host />);
    fireEvent.pointerOver(footnoteRef());
    act(() => void vi.advanceTimersByTime(220));
    const card = tooltip()!;

    fireEvent.pointerOut(footnoteRef(), { relatedTarget: card });
    fireEvent.pointerOver(card);
    act(() => void vi.advanceTimersByTime(400));
    expect(tooltip()).not.toBeNull();

    fireEvent.pointerOut(card, { relatedTarget: scrollHost() });
    act(() => void vi.advanceTimersByTime(160));
    expect(tooltip()).toBeNull();
  });

  it("滚动容器立即收卡；enabled=false 时悬停什么都不出", () => {
    render(<Host />);
    fireEvent.pointerOver(footnoteRef());
    act(() => void vi.advanceTimersByTime(220));
    expect(tooltip()).not.toBeNull();
    fireEvent.scroll(scrollHost());
    expect(tooltip()).toBeNull();
  });

  it("浮笺里的克隆链接被统一拦下：外链走 openUrl、wikilink 走 onOpenWikilink、# 链接吞掉", () => {
    const onOpen = vi.fn();
    render(<Host onOpenWikilink={onOpen} />);
    fireEvent.pointerOver(footnoteRef());
    act(() => void vi.advanceTimersByTime(220));
    const card = tooltip()!;

    // 外链：preventDefault（WebView2 不得原地导航）+ openUrl + 收卡
    const external = card.querySelector('a[href="https://example.com/paper"]')!;
    expect(fireEvent.click(external)).toBe(false);
    expect(openUrlMock).toHaveBeenCalledWith("https://example.com/paper");
    expect(onOpen).not.toHaveBeenCalled();
    expect(tooltip()).toBeNull();

    // wikilink：与正文链接同一组参数（有片段三参）+ 收卡
    fireEvent.pointerOver(footnoteRef());
    act(() => void vi.advanceTimersByTime(220));
    const wikilinkInCard = tooltip()!.querySelector('a[data-wikilink="墨的制作"]')!;
    expect(fireEvent.click(wikilinkInCard)).toBe(false);
    expect(onOpen).toHaveBeenCalledWith("D:/wisdom/读书/墨的制作.md", "墨的制作", "松烟");
    expect(openUrlMock).toHaveBeenCalledTimes(1);
    expect(tooltip()).toBeNull();

    // # 锚链接：拦下但什么都不做（卡也不收）
    fireEvent.pointerOver(footnoteRef());
    act(() => void vi.advanceTimersByTime(220));
    const anchorInCard = tooltip()!.querySelector('a[href="#本页其他"]')!;
    expect(fireEvent.click(anchorInCard)).toBe(false);
    expect(openUrlMock).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(tooltip()).not.toBeNull();
  });

  it("离卡回到原锚点不收卡（同一张卡认得自己的锚）", () => {
    render(<Host />);
    fireEvent.pointerOver(footnoteRef());
    act(() => void vi.advanceTimersByTime(220));
    const card = tooltip()!;

    // 移入卡 → 离开卡回到上标：卡仍可见
    fireEvent.pointerOut(footnoteRef(), { relatedTarget: card });
    fireEvent.pointerOver(card);
    fireEvent.pointerOut(card, { relatedTarget: footnoteRef() });
    fireEvent.pointerOver(footnoteRef(), { relatedTarget: card });
    act(() => void vi.advanceTimersByTime(300));
    expect(tooltip()).toBe(card);
  });

  it("enabled=false 时悬停不出卡", () => {
    render(<Host enabled={false} />);
    fireEvent.pointerOver(footnoteRef());
    act(() => void vi.advanceTimersByTime(500));
    expect(tooltip()).toBeNull();
  });
});

describe("wikilink 笺页卡（B1）", () => {
  it("悬停 350ms 后调 read_note_preview 并展示标题与正文（frontmatter 已剥、wikilink 换成标签）", async () => {
    invokeMock.mockResolvedValue(PREVIEW_A);
    render(<Host />);

    fireEvent.pointerOver(wikilinkA());
    act(() => void vi.advanceTimersByTime(300));
    expect(invokeMock).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(60);
      await Promise.resolve();
    });
    expect(invokeMock).toHaveBeenCalledWith("read_note_preview", {
      path: "D:/wisdom/读书/纸的历史.md",
    });

    const card = tooltip()!;
    expect(card.querySelector(".hover-preview__title")!.textContent).toBe("纸的历史");
    expect(card.querySelector(".hover-preview__path")!.textContent).toBe(
      "D:/wisdom/读书/纸的历史.md"
    );
    // frontmatter 不进预览；wikilink 语法在卡里渲染成显示标签
    expect(card.textContent).toContain("纸让抄书成为可能");
    expect(card.textContent).not.toContain("不应显示");
    expect(card.textContent).not.toContain("[[墨的制作");
  });

  it("未解析的 wikilink（span.wikilink--missing）不出卡也不发 invoke", () => {
    render(<Host />);
    fireEvent.pointerOver(missingLink());
    act(() => void vi.advanceTimersByTime(600));
    expect(invokeMock).not.toHaveBeenCalled();
    expect(tooltip()).toBeNull();
  });

  it("点笺页卡 = 点链接本身：无片段两参、有片段三参", async () => {
    const onOpen = vi.fn();
    invokeMock.mockImplementation(async (_cmd: string, args?: unknown) => {
      const path = (args as { path: string }).path;
      return path.includes("墨") ? PREVIEW_B : PREVIEW_A;
    });
    render(<Host onOpenWikilink={onOpen} />);

    fireEvent.pointerOver(wikilinkB());
    await act(async () => {
      vi.advanceTimersByTime(400);
      await Promise.resolve();
    });
    fireEvent.click(tooltip()!);
    expect(onOpen).toHaveBeenCalledWith("D:/wisdom/读书/墨的制作.md", "墨的制作", "松烟");

    fireEvent.pointerOver(wikilinkA());
    await act(async () => {
      vi.advanceTimersByTime(400);
      await Promise.resolve();
    });
    fireEvent.click(tooltip()!);
    expect(onOpen).toHaveBeenCalledWith("D:/wisdom/读书/纸的历史.md", "纸的历史");
  });

  it("同一链接第二次悬停走缓存，不再发 invoke", async () => {
    invokeMock.mockResolvedValue(PREVIEW_A);
    render(<Host />);

    fireEvent.pointerOver(wikilinkA());
    await act(async () => {
      vi.advanceTimersByTime(400);
      await Promise.resolve();
    });
    expect(tooltip()!.textContent).toContain("纸让抄书成为可能");
    expect(invokeMock).toHaveBeenCalledTimes(1);

    // 离开收卡 → 再悬停同一条：卡片直接有正文（缓存命中），invoke 仍 1 次
    fireEvent.pointerOut(wikilinkA());
    act(() => void vi.advanceTimersByTime(200));
    expect(tooltip()).toBeNull();

    fireEvent.pointerOver(wikilinkA());
    await act(async () => {
      vi.advanceTimersByTime(400);
      await Promise.resolve();
    });
    expect(tooltip()!.textContent).toContain("纸让抄书成为可能");
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it("悬停目标已换时，上一个目标的迟到响应不进卡", async () => {
    let resolveA: (value: NotePreview) => void = () => {};
    invokeMock
      .mockImplementationOnce(() => new Promise<NotePreview>((r) => (resolveA = r)))
      .mockResolvedValue(PREVIEW_B);
    render(<Host />);

    fireEvent.pointerOver(wikilinkA());
    await act(async () => {
      vi.advanceTimersByTime(400);
      await Promise.resolve();
    });
    expect(invokeMock).toHaveBeenCalledTimes(1);

    // 卡片已出但正文未到 → 换到墨的制作上
    fireEvent.pointerOut(wikilinkA());
    fireEvent.pointerOver(wikilinkB());
    await act(async () => {
      vi.advanceTimersByTime(400);
      await Promise.resolve();
    });

    // A 的迟到响应此时才到：只许落缓存，不许顶掉 B 卡
    await act(async () => {
      resolveA(PREVIEW_A);
      await Promise.resolve();
    });
    expect(tooltip()!.querySelector(".hover-preview__title")!.textContent).toBe("墨的制作");
    expect(tooltip()!.textContent).toContain("烟是墨的骨");
    expect(tooltip()!.textContent).not.toContain("抄书");
  });
});
