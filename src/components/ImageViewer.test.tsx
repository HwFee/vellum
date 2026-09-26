import { render, screen, fireEvent } from "@testing-library/react";
import { MarkdownImage } from "./MarkdownImage";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

// 远程 src 不经 resolve_asset IPC，直接渲染（本地解析路径上面已有用例覆盖）
const SRC = "https://example.com/demo.gif";

function viewerImage() {
  return screen.getByRole("dialog").querySelector<HTMLElement>(".image-viewer__img")!;
}

test("点击已解析的图片打开图片查看器：dialog 经 portal 挂在 document.body 上", () => {
  render(<MarkdownImage src={SRC} alt="demo" />);
  fireEvent.click(screen.getByAltText("demo"));

  const dialog = screen.getByRole("dialog", { name: "demo" });
  expect(dialog.parentElement).toBe(document.body);
  // 打开即接管焦点（Esc / 滚轮的焦点语义挂在这棵树上）
  expect(dialog).toHaveFocus();
  expect(viewerImage()).toHaveAttribute("src", SRC);
  expect(viewerImage()).toHaveAttribute("draggable", "false");
});

test("Escape 关闭查看器：捕获段拦截，同层 window 冒泡监听（窄屏关侧栏那类）不被触发", () => {
  render(<MarkdownImage src={SRC} alt="demo" />);
  fireEvent.click(screen.getByAltText("demo"));
  const dialog = screen.getByRole("dialog", { name: "demo" });

  const bubbleListener = vi.fn();
  window.addEventListener("keydown", bubbleListener);
  try {
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(bubbleListener).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  } finally {
    window.removeEventListener("keydown", bubbleListener);
  }
});

test("点纸面背底关闭，点图片本身不关闭", () => {
  render(<MarkdownImage src={SRC} alt="demo" />);
  fireEvent.click(screen.getByAltText("demo"));
  const dialog = screen.getByRole("dialog", { name: "demo" });

  // 点看图中的图片：target 是 img，不是背底——不关闭
  fireEvent.click(viewerImage());
  expect(dialog).toBeInTheDocument();

  // 点背底本身（target === currentTarget）：关闭
  fireEvent.click(dialog);
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("链接包裹的图片不打开查看器：点击让位给链接", () => {
  render(
    <a href="https://example.com">
      <MarkdownImage src={SRC} alt="linked" />
    </a>
  );

  fireEvent.click(screen.getByAltText("linked"));
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("编辑视图祖先里的图片不打开查看器：点击归块激活", () => {
  render(
    <div className="document-scroll__content document-scroll__content--editing">
      <div className="markdown-body">
        <MarkdownImage src={SRC} alt="editing" />
      </div>
    </div>
  );

  fireEvent.click(screen.getByAltText("editing"));
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("滚轮放大：deltaY<0 时 transform 的 scale 越过 1，事件被吞（正文不跟着滚）", () => {
  render(<MarkdownImage src={SRC} alt="demo" />);
  fireEvent.click(screen.getByAltText("demo"));
  const dialog = screen.getByRole("dialog", { name: "demo" });

  expect(fireEvent.wheel(dialog, { deltaY: -120 })).toBe(false);
  expect(viewerImage().style.transform).toMatch(/scale\(1\.15/);
});
