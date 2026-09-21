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
    <ExportPdfView title="我的笔记" bodyHtml={BODY_HTML} onExit={() => {}} />
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
  render(<ExportPdfView title="我的笔记" bodyHtml={BODY_HTML} onExit={onExit} />);

  fireEvent.keyDown(window, { key: "Escape" });
  expect(onExit).toHaveBeenCalledTimes(1);

  fireEvent.click(screen.getByRole("button", { name: "‹ 返回阅读" }));
  expect(onExit).toHaveBeenCalledTimes(2);
});

test("导出：保存对话框选定路径后调后端 export_pdf，状态行回报落盘位置", async () => {
  vi.mocked(save).mockResolvedValue("C:/notes/out.pdf");
  vi.mocked(invoke).mockResolvedValue(undefined);
  render(<ExportPdfView title="我的笔记" bodyHtml={BODY_HTML} onExit={() => {}} />);

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
  render(<ExportPdfView title="我的笔记" bodyHtml={BODY_HTML} onExit={() => {}} />);

  fireEvent.click(screen.getByRole("button", { name: "导出为 PDF" }));

  await waitFor(() => expect(save).toHaveBeenCalled());
  expect(invoke).not.toHaveBeenCalled();
});

test("后端报错：状态行给出失败原因", async () => {
  vi.mocked(save).mockResolvedValue("C:/notes/out.pdf");
  vi.mocked(invoke).mockRejectedValue(new Error("printToPDF timed out"));
  render(<ExportPdfView title="我的笔记" bodyHtml={BODY_HTML} onExit={() => {}} />);

  fireEvent.click(screen.getByRole("button", { name: "导出为 PDF" }));

  expect(await screen.findByText(/导出失败 · printToPDF timed out/)).toBeInTheDocument();
});

test("@page 边盒规则随挂载注入、随卸载移除（页眉页脚的文档题是运行时值）", () => {
  const { unmount } = render(
    <ExportPdfView title="我的笔记" bodyHtml={BODY_HTML} onExit={() => {}} />
  );

  const injected = document.head.querySelector("style[data-vellum-export-page]");
  expect(injected?.textContent).toContain("@page:first");
  expect(injected?.textContent).toContain("我的笔记 · 素笺");

  unmount();
  expect(document.head.querySelector("style[data-vellum-export-page]")).toBeNull();
});
