import { openUrl } from "@tauri-apps/plugin-opener";
import { isValidElement, useMemo, type ReactElement, type ReactNode } from "react";
import type { Components } from "react-markdown";
import { unitMarkProps, extractText } from "../lib/headingId";
import { wikilinkHref } from "../lib/wikilink";
import type { HeadingLevel } from "../types";
import { CodeBlock } from "./CodeBlock";
import { MarkdownImage } from "./MarkdownImage";
import { WidgetSandbox } from "./WidgetSandbox";

export type MarkdownComponentsDeps = {
  /// 标题 id 分配器（useHeadingIdResolver 的产物；渲染期同步调用是它的不变量约束）
  resolveHeadingId: (level: HeadingLevel, text: string) => string;
  /// mdlog 可信文档标记：决定 vellum-widget 代码块是否自动挂载
  isTrustedMdlog: boolean;
  /// wikilink 目标 → 已解析的绝对路径（缺省时锚点保持惰性）
  wikilinks?: ReadonlyMap<string, string | null>;
  onOpenWikilink?: (path: string, target: string, fragment?: string) => void;
  /// 阅读视图 + 有接管方时才挂 li/input 两条覆盖渲染（任务列表勾选）
  taskToggleEnabled: boolean;
  onToggleTask?: (itemStart: number) => void;
};

/**
 * react-markdown 的 components 映射（原 MarkdownBody 内嵌的 useMemo，逐字不变）。
 * components 对象必须 memo：内联创建会让 react-markdown 每次渲染都重走解析管线。
 */
export function useMarkdownComponents(deps: MarkdownComponentsDeps): Components {
  const { resolveHeadingId, isTrustedMdlog, wikilinks, onOpenWikilink, taskToggleEnabled, onToggleTask } = deps;

  return useMemo(
    () => ({
      h1: ({ children, ...props }) => {
        const mark = unitMarkProps(props);
        return (
          <h1
            id={resolveHeadingId(1, extractText(children))}
            data-vellum-unit={mark.unit}
            data-vellum-locked={mark.locked}
          >
            {children}
          </h1>
        );
      },
      h2: ({ children, ...props }) => {
        const mark = unitMarkProps(props);
        return (
          <h2
            id={resolveHeadingId(2, extractText(children))}
            data-vellum-unit={mark.unit}
            data-vellum-locked={mark.locked}
          >
            {children}
          </h2>
        );
      },
      h3: ({ children, ...props }) => {
        const mark = unitMarkProps(props);
        return (
          <h3
            id={resolveHeadingId(3, extractText(children))}
            data-vellum-unit={mark.unit}
            data-vellum-locked={mark.locked}
          >
            {children}
          </h3>
        );
      },
      // h4–h6 与 h1–h3 同一套 id 分配器：大纲收录到 h6，条目点击依赖正文标题带 id
      h4: ({ children, ...props }) => {
        const mark = unitMarkProps(props);
        return (
          <h4
            id={resolveHeadingId(4, extractText(children))}
            data-vellum-unit={mark.unit}
            data-vellum-locked={mark.locked}
          >
            {children}
          </h4>
        );
      },
      h5: ({ children, ...props }) => {
        const mark = unitMarkProps(props);
        return (
          <h5
            id={resolveHeadingId(5, extractText(children))}
            data-vellum-unit={mark.unit}
            data-vellum-locked={mark.locked}
          >
            {children}
          </h5>
        );
      },
      h6: ({ children, ...props }) => {
        const mark = unitMarkProps(props);
        return (
          <h6
            id={resolveHeadingId(6, extractText(children))}
            data-vellum-unit={mark.unit}
            data-vellum-locked={mark.locked}
          >
            {children}
          </h6>
        );
      },
      a: ({ href, children, ...rest }) => {
        // wikilink 必须在协议分支**之前**处理：它的 href 也带方案（`wikilink:`），
        // 落到外链分支就会被交给系统 opener 打开一个不存在的协议
        const props = rest as Record<string, unknown>;
        const target = props["data-wikilink"];
        if (typeof target === "string" && target !== "") {
          // 片段（`#人读标题原文`）单独携带：渲染层只负责把它交给 App，
          // 匹配哪一条标题由 App 按目标文档的大纲决定
          const rawFragment = props["data-wikilink-fragment"];
          const fragment = typeof rawFragment === "string" && rawFragment !== "" ? rawFragment : undefined;
          const label = children;
          const resolved = wikilinks?.get(target);

          // 未传表（只出现在不接 App 的调用方与测试里）：锚点保持惰性——
          // 不接点击、不导航，但形状与已解析时一致
          if (!wikilinks) {
            return (
              <a className="wikilink" data-wikilink={target} title={typeof props.title === "string" ? props.title : undefined}>
                {label}
              </a>
            );
          }

          if (typeof resolved === "string") {
            return (
              <a
                className="wikilink"
                href={wikilinkHref(target)}
                data-wikilink={target}
                data-wikilink-fragment={fragment}
                title={typeof props.title === "string" ? props.title : undefined}
                onClick={(event) => {
                  event.preventDefault();
                  // 有片段才带第三个实参：没有片段的链接保持两参调用，
                  // 既有调用方与断言一字不改
                  if (fragment === undefined) {
                    onOpenWikilink?.(resolved, target);
                  } else {
                    onOpenWikilink?.(resolved, target, fragment);
                  }
                }}
              >
                {label}
              </a>
            );
          }

          // 库内找不到（或表里显式 null）：降级为纯文本 + 提示，绝不给出假链接
          return (
            <span
              className="wikilink wikilink--missing"
              data-wikilink={target}
              title={`未找到笔记：${target}`}
            >
              {label}
            </span>
          );
        }

        // 带协议（http(s)、mailto、ftp 等）的链接交给系统默认程序打开；
        // 页内锚点（#...）与相对路径保持原生行为
        const hasProtocol = href ? /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(href) : false;

        function isImageElement(child: unknown): boolean {
          if (!isValidElement(child)) return false;
          const type = (child as { type?: unknown }).type;
          return type === "img" || type === MarkdownImage;
        }

        const childArray = Array.isArray(children) ? children : [children];
        const isImageLink = childArray.length === 1 && isImageElement(childArray[0]);

        if (hasProtocol) {
          return (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              data-image-link={isImageLink ? "true" : undefined}
              onClick={(event) => {
                event.preventDefault();
                void openUrl(href ?? "");
              }}
            >
              {children}
            </a>
          );
        }
        return <a href={href}>{children}</a>;
      },
      img: ({ src, alt, title }) => <MarkdownImage src={src} alt={alt} title={title} />,
      pre: ({ children }) => {
        const childArray = Array.isArray(children) ? children : [children];
        const nonWhitespaceChildren = childArray.filter((child) => {
          if (typeof child === "string" || typeof child === "number") {
            return String(child).trim() !== "";
          }
          return true;
        });
        if (nonWhitespaceChildren.length === 1) {
          const child = nonWhitespaceChildren[0];
          if (
            isValidElement(child) &&
            (typeof child.type === "string"
              ? child.type === "code"
              : (child.props as { node?: { tagName?: string } }).node?.tagName === "code")
          ) {
            const codeChild = child as ReactElement<{
              className?: string;
              children?: ReactNode;
              node?: { tagName?: string };
            }>;
            const className = codeChild.props.className ?? "";
            const match = /language-([\w-]+)/.exec(className);
            const language = match?.[1] ?? "";
            const code = extractText(codeChild.props.children).replace(/\n$/, "");

            if (language === "vellum-widget") {
              // P9: 512KB 预检短路：字符数超 524288 字节数必超（短路超限）；
              // 字符数 <= 131072 即便全部为 4 字节 UTF-8 字符也绝不可能超（短路安全）；
              // 仅在临界区间 (131072, 524288] 才执行 TextEncoder 编码。
              const isOversized =
                code.length > 524288 ||
                (code.length > 131072 && new TextEncoder().encode(code).length > 524288);
              if (isOversized) {
                // F12: 降级语言统一为 markup——CodeBlock 已注册的 Prism 语言，
                // 且 widget 内容本就是完整 HTML 文档；空串会被当成 text 丢掉高亮
                return <CodeBlock code={code} language="markup" />;
              }
              return (
                <WidgetSandbox
                  html={code}
                  autoMount={isTrustedMdlog}
                />
              );
            }

            return <CodeBlock code={code} language={language} />;
          }
        }
        return <pre>{children}</pre>;
      },
      code: ({ node: _node, className, children, ...props }) => {
        return (
          <code className={className} {...props}>
            {children}
          </code>
        );
      },
      // 任务列表勾选：<input> 上没有源码位置（GFM 生成时就不带），<li> 上有——
      // 所以「点的是哪一项」由 <li> 交出去，勾选与写盘全在 App / useDocumentEditor 一侧。
      ...(taskToggleEnabled
        ? {
            li: ({ node, children, ...props }) => {
              const position = node?.position?.start?.offset;
              const className = typeof props.className === "string" ? props.className : "";
              // task-list-item 这个类是 mdast-util-to-hast 给 GFM 任务项加的；
              // 没有源码位置就定位不到块单元与标记，宁可不接管
              const toggleable =
                className.split(/\s+/).includes("task-list-item") &&
                typeof position === "number";
              return (
                <li
                  {...props}
                  onClick={
                    toggleable
                      ? (event) => {
                          const target = event.target;
                          // 只有点在复选框上才算勾选：点条目文字是选字/阅读，不该改文件
                          if (
                            !(target instanceof HTMLInputElement) ||
                            target.type !== "checkbox"
                          ) {
                            return;
                          }
                          onToggleTask?.(position);
                        }
                      : undefined
                  }
                >
                  {children}
                </li>
              );
            },
            input: ({ node, ...props }) => {
              // GFM 任务复选框由 mdast-util-to-hast 生成：**不带源码位置**且恒为 disabled。
              // disabled 控件不派发点击事件，要让它在 Vellum 里可点就必须摘掉。
              // 原始 HTML 里的 <input>（rehype-raw 解析，带位置）一律不动：HTML 块只读，
              // 作者写下的 disabled 该留着。
              const isTaskCheckbox =
                props.type === "checkbox" && node !== undefined && node.position === undefined;
              if (!isTaskCheckbox) return <input {...props} />;

              // checked 受控 + readOnly：勾选态由源码字符串单向驱动，乐观更新与失败回滚
              // 都靠这次重渲染回到正确状态（readOnly 只是压掉 React 的受控告警；
              // 复选框本身不认 readOnly，点击照常冒泡到上面的 <li>）
              const { disabled: _disabled, ...rest } = props;
              return <input {...rest} type="checkbox" checked={rest.checked === true} readOnly />;
            },
          }
        : {}),
    }),
    [
      resolveHeadingId,
      isTrustedMdlog,
      wikilinks,
      onOpenWikilink,
      taskToggleEnabled,
      onToggleTask,
    ]
  );
}
