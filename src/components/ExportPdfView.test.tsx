import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ExportPdfView } from "./ExportPdfView";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: vi.fn() }));

const BODY_HTML = "<h2>第一节</h2><p>正文一段。</p><pre><code>const a = 1;</code></pre>";

beforeEach(() => {
  vi.mocked(invoke).mockReset();
  vi.mocked(save).mockReset();
});

test("渲染纸张舞台：规格小字、文件名默认「文档题.pdf」、打印底稿与测量容器就位", () => {
  const { container } = render(
    <ExportPdfView title="我的笔记" ownTitle={null} bodyHtml={BODY_HTML} onExit={() => {}} />
  );

  expect(screen.getByText("A4 · 边距 20/22mm · 宣纸")).toBeInTheDocument();
  expect(screen.getByLabelText("文件名")).toHaveValue("我的笔记.pdf");
  // 底稿（.export-sheet）与测量容器（.export-measure）共用同一份消毒 HTML
  expect(container.querySelector(".export-sheet .markdown-body")?.innerHTML).toBe(BODY_HTML);
  expect(container.querySelector(".export-sheet .document-title")?.textContent).toBe("我的笔记");
  expect(container.querySelector(".export-measure .markdown-body")?.innerHTML).toBe(BODY_HTML);
});

test("Esc 与「‹ 返回阅读」都退出", () => {
  const onExit = vi.fn();
  render(<ExportPdfView title="我的笔记" ownTitle={null} bodyHtml={BODY_HTML} onExit={onExit} />);

  fireEvent.keyDown(window, { key: "Escape" });
  expect(onExit).toHaveBeenCalledTimes(1);

  fireEvent.click(screen.getByRole("button", { name: "‹ 返回阅读" }));
  expect(onExit).toHaveBeenCalledTimes(2);
});

test("导出：保存对话框选定路径后调后端 export_pdf，状态行回报落盘位置", async () => {
  vi.mocked(save).mockResolvedValue("C:/notes/out.pdf");
  vi.mocked(invoke).mockResolvedValue(undefined);
  render(<ExportPdfView title="我的笔记" ownTitle={null} bodyHtml={BODY_HTML} onExit={() => {}} />);

  fireEvent.click(screen.getByRole("button", { name: "导出为 PDF" }));

  await waitFor(() => {
    expect(save).toHaveBeenCalledWith({
      defaultPath: "我的笔记.pdf",
      filters: [{ name: "PDF 文档", extensions: ["pdf"] }],
    });
    expect(invoke).toHaveBeenCalledWith("export_pdf", { path: "C:/notes/out.pdf" });
  });
  expect(await screen.findByText("已导出 · C:/notes/out.pdf")).toBeInTheDocument();
});

test("保存对话框取消：不调后端、状态行不复位为成功", async () => {
  vi.mocked(save).mockResolvedValue(null);
  render(<ExportPdfView title="我的笔记" ownTitle={null} bodyHtml={BODY_HTML} onExit={() => {}} />);

  fireEvent.click(screen.getByRole("button", { name: "导出为 PDF" }));

  await waitFor(() => expect(save).toHaveBeenCalled());
  expect(invoke).not.toHaveBeenCalled();
});

test("后端报错：状态行给出失败原因", async () => {
  vi.mocked(save).mockResolvedValue("C:/notes/out.pdf");
  vi.mocked(invoke).mockRejectedValue(new Error("printToPDF timed out"));
  render(<ExportPdfView title="我的笔记" ownTitle={null} bodyHtml={BODY_HTML} onExit={() => {}} />);

  fireEvent.click(screen.getByRole("button", { name: "导出为 PDF" }));

  expect(await screen.findByText(/导出失败 · printToPDF timed out/)).toBeInTheDocument();
});

test("@page 边盒规则随挂载注入、随卸载移除（页眉页脚的文档题是运行时值）", () => {
  const { unmount } = render(
    <ExportPdfView title="我的笔记" ownTitle={null} bodyHtml={BODY_HTML} onExit={() => {}} />
  );

  const injected = document.head.querySelector("style[data-vellum-export-page]");
  expect(injected?.textContent).toContain("@page:first");
  expect(injected?.textContent).toContain("我的笔记 · 素笺");

  unmount();
  expect(document.head.querySelector("style[data-vellum-export-page]")).toBeNull();
});

const DOC_WITH_OWN_TITLE = "<h1>Kimi K3 技术报告通俗解读</h1><p>正文一段。</p>";

test("题目样式默认「原文」：工具条分段选择器就位，原文按下", () => {
  render(<ExportPdfView title="我的笔记" ownTitle={null} bodyHtml={BODY_HTML} onExit={() => {}} />);

  const group = screen.getByRole("group", { name: "题目样式" });
  const original = screen.getByRole("button", { name: "原文" });
  const center = screen.getByRole("button", { name: "居中" });
  expect(group).toContainElement(original);
  expect(group).toContainElement(center);
  expect(original).toHaveAttribute("aria-pressed", "true");
  expect(center).toHaveAttribute("aria-pressed", "false");
});

test("原文样式 + 正文自带头题：底稿不再注入题目，正文那枚 h1 原样排印", () => {
  const { container } = render(
    <ExportPdfView
      title="Kimi-K3技术报告通俗解读"
      ownTitle="Kimi K3 技术报告通俗解读"
      bodyHtml={DOC_WITH_OWN_TITLE}
      onExit={() => {}}
    />
  );

  // 底稿与测量容器都没有注入题目（h1.document-title 不存在）……
  expect(container.querySelector(".export-sheet .document-title")).toBeNull();
  expect(container.querySelector(".export-measure .document-title")).toBeNull();
  // ……正文里的 h1 原样保留，且只有这一枚
  expect(container.querySelectorAll(".export-sheet h1")).toHaveLength(1);
  expect(container.querySelector(".export-sheet .markdown-body")?.innerHTML).toBe(
    DOC_WITH_OWN_TITLE
  );
});

test("切到「居中」：注入居中题目（用头题原文文本），正文同款 h1 摘除不重复", () => {
  const { container } = render(
    <ExportPdfView
      title="Kimi-K3技术报告通俗解读"
      ownTitle="Kimi K3 技术报告通俗解读"
      bodyHtml={DOC_WITH_OWN_TITLE}
      onExit={() => {}}
    />
  );

  fireEvent.click(screen.getByRole("button", { name: "居中" }));

  const titleEl = container.querySelector(".export-sheet .document-title");
  expect(titleEl?.textContent).toBe("Kimi K3 技术报告通俗解读");
  expect(titleEl?.className).toContain("export-title--center");
  // 正文里那枚同款 h1 被摘除——整份底稿只剩一枚题目
  expect(container.querySelectorAll(".export-sheet h1")).toHaveLength(1);
  expect(container.querySelector(".export-sheet .markdown-body")?.innerHTML).toBe(
    "<p>正文一段。</p>"
  );
  // 测量容器与底稿同构（分页才不错位）
  expect(container.querySelector(".export-measure .document-title")?.className).toContain(
    "export-title--center"
  );
});

test("无自带头题时切「居中」：注入题目用文档题文本，正文不动", () => {
  const { container } = render(
    <ExportPdfView title="我的笔记" ownTitle={null} bodyHtml={BODY_HTML} onExit={() => {}} />
  );

  fireEvent.click(screen.getByRole("button", { name: "居中" }));

  const titleEl = container.querySelector(".export-sheet .document-title");
  expect(titleEl?.textContent).toBe("我的笔记");
  expect(titleEl?.className).toContain("export-title--center");
  expect(container.querySelector(".export-sheet .markdown-body")?.innerHTML).toBe(BODY_HTML);
});
