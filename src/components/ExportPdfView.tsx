import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useRef, useState } from "react";
import { buildExportPageStyle } from "../lib/exportDocument";
import {
  EXPORT_CONTENT_HEIGHT_PX,
  EXPORT_CONTENT_WIDTH_PX,
  EXPORT_PAGE,
} from "../lib/exportLayout";
import { paginatePreview, trimCloneToChars } from "../lib/exportPagination";

/**
 * 导出为 PDF（2026-09-21）：Ctrl+P 与顶栏按钮打开，整页替换正文区（与设置视图同一动线）。
 * 「纸张舞台」形态：纸面铺满窗口，底部一条浮动工具条——页面规格（A4 / 边距 20/22mm / 宣纸）
 * 是模板常量、以一行小字陈列，不是选项（对齐上游 kami 的 WeasyPrint 模板，tw93/kami
 * references/production.md）。
 *
 * 预览即所得的实现：预览纸页、测量容器、打印底稿共用同一份消毒后的正文 HTML
 * （buildExportDocument）。打印底稿屏幕态 display:none，@media print 下独占纸面，
 * 导出由后端对当前 WebView2 调 CDP Page.printToPDF 完成——同一页面上演，不另起窗口。
 */

type ExportPdfViewProps = {
  /** 文档题（h1.document-title 文本）：页脚文案与默认文件名的来源 */
  title: string;
  /** 消毒后的正文 HTML（markdown-body 内部） */
  bodyHtml: string;
  onExit: () => void;
};

const SCALE_MIN = 0.35;
const SCALE_MAX = 0.92;
const STAGE_PADDING_X = 24;

export function ExportPdfView({ title, bodyHtml, onExit }: ExportPdfViewProps) {
  const [fileName, setFileName] = useState(title + ".pdf");
  const [exporting, setExporting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [scale, setScale] = useState(0.6);
  const stageRef = useRef<HTMLDivElement>(null);
  const measureBodyRef = useRef<HTMLDivElement>(null);
  const pagesRef = useRef<HTMLDivElement>(null);
  // 分页重建在 rAF 里跑、读 scale 的最新值（重建不该因缩放变化而重排内容）
  const scaleRef = useRef(scale);
  scaleRef.current = scale;

  // Esc 退出（与设置视图同一约定；输入框里的 Esc 不额外消费，冒到这里同样退出）
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onExit();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onExit]);

  // 页眉页脚的 @page 边盒随视图挂载注入、卸载移除（文档题是运行时值，
  // 规则文本见 buildExportPageStyle；旧运行时静默降级为无页眉页脚）
  useEffect(() => {
    const style = document.createElement("style");
    style.setAttribute("data-vellum-export-page", "");
    style.textContent = buildExportPageStyle(title);
    document.head.appendChild(style);
    return () => {
      style.remove();
    };
  }, [title]);

  // 舞台宽度驱动缩放：纸面始终是 A4（794px），zoom 只动显示、不动排版
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const update = () => {
      const next = Math.min(
        SCALE_MAX,
        Math.max(SCALE_MIN, (stage.clientWidth - STAGE_PADDING_X * 2) / EXPORT_PAGE.widthPx)
      );
      setScale((prev) => (Math.abs(prev - next) < 0.005 ? prev : next));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  // 预览分页：正文克隆进屏外测量容器（版心宽 166mm），按块切成页——
  // 块不跨页（与 kami.css 打印段的分页保护同一语义），比页高的孤块独占一页
  useEffect(() => {
    const measureBody = measureBodyRef.current;
    const pages = pagesRef.current;
    if (!measureBody || !pages) return;
    let raf = 0;

    const rebuild = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        // 展平一层取块：.markdown-body 包裹的块在它的孩子里；display:contents 的
        // 块单元外壳没有自己的布局盒，同样展平一层量它的孩子
        const blocks: HTMLElement[] = [];
        for (const child of Array.from(measureBody.children)) {
          const el = child as HTMLElement;
          if (el.classList.contains("markdown-body") || getComputedStyle(el).display === "contents") {
            blocks.push(...(Array.from(el.children) as HTMLElement[]));
          } else {
            blocks.push(el);
          }
        }
        const baseTop = measureBody.getBoundingClientRect().top;
        const metrics = blocks.map((el) => {
          const rect = el.getBoundingClientRect();
          return { top: rect.top - baseTop, height: rect.height, el };
        });
        // 首页页顶留白：首块（文档题 h1）的上边距在文档起点不截断
        const firstInset = blocks.length > 0
          ? parseFloat(getComputedStyle(blocks[0]).marginTop) || 0
          : 0;
        const pageSegments = paginatePreview(metrics, EXPORT_CONTENT_HEIGHT_PX, firstInset);
        pages.textContent = "";
        pageSegments.forEach((segments, pageIndex) => {
          const sheet = document.createElement("div");
          sheet.className = "export-page__sheet";
          sheet.style.zoom = String(scaleRef.current);
          const body = document.createElement("div");
          body.className = "markdown-body";
          for (const segment of segments) {
            const clone = segment.el.cloneNode(true) as HTMLElement;
            // 段落拆片段：裁字符区间；下半段上边距归零（分页断点处的 margin 截断）
            if (segment.fromChar || segment.toChar !== undefined) {
              trimCloneToChars(clone, segment.fromChar ?? 0, segment.toChar ?? Number.MAX_SAFE_INTEGER);
            }
            if (segment.fromChar) clone.style.marginTop = "0";
            body.appendChild(clone);
          }
          sheet.appendChild(body);
          // 页眉页脚自第二页起（首页留白，与注入的 @page:first 边盒同一规格）
          if (pageIndex > 0) {
            const header = document.createElement("div");
            header.className = "export-page__hdr";
            header.textContent = String(pageIndex + 1);
            const footer = document.createElement("div");
            footer.className = "export-page__ftr";
            footer.textContent = title + " · 素笺";
            sheet.appendChild(header);
            sheet.appendChild(footer);
          }
          pages.appendChild(sheet);
        });
      });
    };

    rebuild();
    // 字体与图片会改块高：就绪后各重算一次（一次性事件，不长期监听）
    void document.fonts?.ready.then(rebuild).catch(() => {});
    for (const img of Array.from(measureBody.querySelectorAll("img"))) {
      if (!img.complete) img.addEventListener("load", rebuild, { once: true });
    }
    return () => cancelAnimationFrame(raf);
  }, [bodyHtml, title]);

  // 缩放变化只调 zoom，不重建分页（内容与页序不变）
  useEffect(() => {
    pagesRef.current
      ?.querySelectorAll<HTMLElement>(".export-page__sheet")
      .forEach((sheet) => {
        sheet.style.zoom = String(scale);
      });
  }, [scale]);

  const handleExport = useCallback(async () => {
    // 落盘位置经系统保存对话框（工具条里的文件名只是默认值）
    const path = await save({
      defaultPath: fileName,
      filters: [{ name: "PDF 文档", extensions: ["pdf"] }],
    });
    if (!path) return;
    setExporting(true);
    setStatus(null);
    try {
      await invoke("export_pdf", { path });
      setStatus("已导出 · " + path);
    } catch (error) {
      setStatus("导出失败 · " + (error instanceof Error ? error.message : String(error)));
    } finally {
      setExporting(false);
    }
  }, [fileName]);

  return (
    <div className="export-view">
      <div className="export-view__head">
        <button type="button" className="button button-ghost" onClick={onExit}>
          ‹ 返回阅读
        </button>
        <span className="export-view__note" role="status">
          {status ?? "ESC · 预览即所得"}
        </span>
      </div>
      <div className="export-view__stage" ref={stageRef}>
        <div className="export-view__pages" ref={pagesRef} />
        <div className="export-view__toolbar">
          <span className="export-view__spec">A4 · 边距 20/22mm · 宣纸</span>
          <span className="export-view__sep" aria-hidden="true" />
          <input
            className="export-view__filename"
            value={fileName}
            onChange={(event) => setFileName(event.target.value)}
            aria-label="文件名"
            spellCheck={false}
          />
          <button
            type="button"
            className="button button-primary"
            disabled={exporting}
            onClick={() => void handleExport()}
          >
            {exporting ? "导出中…" : "导出为 PDF"}
          </button>
        </div>
      </div>
      {/* 打印底稿：屏幕态 display:none，@media print 下独占纸面（kami.css 主打印段）。
          与预览共用同一份消毒 HTML */}
      <div className="export-sheet" aria-hidden="true">
        <h1 className="document-title">{title}</h1>
        <div
          className="markdown-body"
          dangerouslySetInnerHTML={{ __html: bodyHtml }}
        />
      </div>
      {/* 测量容器：屏外布局（visibility 而非 display:none——后者量不到块高），
          宽度锁定为 A4 版心 166mm，与打印件同栏宽同字号。
          文档题 h1 必须进测量流的第一块：打印底稿首页是它开篇（.export-sheet 的
          h1.document-title），漏掉它预览分页就会与打印件错开一块的高度——
          首页末尾的块在预览里看似放得下，在 PDF 里已被推到下一页 */}
      <div
        className="export-measure"
        aria-hidden="true"
        ref={measureBodyRef}
        style={{ width: EXPORT_CONTENT_WIDTH_PX }}
      >
        <h1 className="document-title">{title}</h1>
        <div
          className="markdown-body"
          style={{ maxWidth: "none" }}
          dangerouslySetInnerHTML={{ __html: bodyHtml }}
        />
      </div>
    </div>
  );
}
