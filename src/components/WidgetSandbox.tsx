import {
  memo,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { widgetRegistry } from "../lib/widgetRegistry";
import { CodeBlock } from "./CodeBlock";

export type WidgetSandboxProps = {
  html: string;
  autoMount: boolean;
};

interface RegisterResult {
  id: string;
  url: string;
}

export const WidgetSandbox = memo(function WidgetSandbox({
  html,
  autoMount,
}: WidgetSandboxProps) {
  const instanceId = useId();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const idRef = useRef<string | null>(null);
  const rafRef = useRef<number | null>(null);

  const [widgetUrl, setWidgetUrl] = useState<string | null>(null);
  const [height, setHeight] = useState<number>(240);
  const [title, setTitle] = useState<string>("交互演示");
  const [isDormant, setIsDormant] = useState<boolean>(false);
  const [isUserActivated, setIsUserActivated] = useState<boolean>(false);
  const [isInViewport, setIsInViewport] = useState<boolean>(false);
  const [hasError, setHasError] = useState<boolean>(false);

  // 1. 注册进入 widgetRegistry 单例并订阅休眠状态
  useEffect(() => {
    widgetRegistry.register(instanceId);
    const unsubscribe = widgetRegistry.subscribe((targetId, dormant) => {
      if (targetId === instanceId) {
        setIsDormant(dormant);
      }
    });

    return () => {
      unsubscribe();
      widgetRegistry.release(instanceId);
      if (idRef.current) {
        const idToUnregister = idRef.current;
        idRef.current = null;
        void Promise.resolve(invoke("unregister_widget", { id: idToUnregister })).catch(() => {});
      }
    };
  }, [instanceId]);

  // 2. 视口监听：rootMargin 200px
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setIsInViewport(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setIsInViewport(true);
            widgetRegistry.markVisible(instanceId);
          }
        }
      },
      { rootMargin: "200px" }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [instanceId]);

  // 3. 挂载条件仲裁与 register_widget 触发
  const shouldMount = (autoMount || isUserActivated) && !isDormant;

  useEffect(() => {
    if (!shouldMount || !isInViewport || widgetUrl || hasError) {
      return;
    }

    if (!widgetRegistry.requestMount(instanceId)) {
      return;
    }

    let isCancelled = false;

    invoke<RegisterResult>("register_widget", { html })
      .then((res) => {
        if (isCancelled) {
          void Promise.resolve(invoke("unregister_widget", { id: res.id })).catch(() => {});
          return;
        }
        idRef.current = res.id;
        setWidgetUrl(res.url);
      })
      .catch((err) => {
        if (isCancelled) return;
        console.error("Failed to register widget:", err);
        setHasError(true);
      });

    return () => {
      isCancelled = true;
    };
  }, [shouldMount, isInViewport, widgetUrl, hasError, html, instanceId]);

  // 4. postMessage 监听通信契约
  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (!iframeRef.current || event.source !== iframeRef.current.contentWindow) {
        return;
      }
      const data = event.data;
      if (!data || data.type !== "vellum-widget:resize") {
        return;
      }

      if (typeof data.title === "string" && data.title.trim()) {
        setTitle(data.title.trim());
      }

      if (typeof data.height === "number" && !Number.isNaN(data.height)) {
        const clamped = Math.min(2000, Math.max(80, data.height));
        if (rafRef.current !== null) {
          cancelAnimationFrame(rafRef.current);
        }
        rafRef.current = requestAnimationFrame(() => {
          setHeight(clamped);
          rafRef.current = null;
        });
      }
    }

    window.addEventListener("message", handleMessage);
    return () => {
      window.removeEventListener("message", handleMessage);
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);

  // 错误降级渲染（A5: 内部渲染 CodeBlock，保证 MarkdownDocument memo 引用稳定性）
  if (hasError) {
    return <CodeBlock code={html} language="" />;
  }

  // 休眠状态占位块
  if (isDormant) {
    return (
      <div ref={containerRef} className="mdlog-widget">
        <div className="mdlog-widget__bar">
          <span>{title} · vellum-widget</span>
          <span className="state">已休眠</span>
        </div>
        <button
          type="button"
          className="mdlog-widget__placeholder"
          onClick={() => {
            widgetRegistry.activate(instanceId);
            setIsDormant(false);
          }}
        >
          交互已休眠 · 点击查看
        </button>
      </div>
    );
  }

  // 未受信初始占位块（autoMount=false）
  if (!autoMount && !isUserActivated) {
    return (
      <div ref={containerRef} className="mdlog-widget">
        <div className="mdlog-widget__bar">
          <span>{title} · vellum-widget</span>
          <span className="state">未加载</span>
        </div>
        <button
          type="button"
          className="mdlog-widget__placeholder"
          onClick={() => {
            setIsUserActivated(true);
            setIsInViewport(true);
            widgetRegistry.activate(instanceId);
          }}
        >
          交互内容 · 点击加载
        </button>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="mdlog-widget">
      <div className="mdlog-widget__bar">
        <span>{title} · vellum-widget</span>
        <span className="state">{widgetUrl ? "沙箱中运行" : "准备中"}</span>
      </div>
      {widgetUrl ? (
        <iframe
          ref={iframeRef}
          className="mdlog-widget__frame"
          src={widgetUrl}
          title={title}
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          style={{ height: `${height}px` }}
        />
      ) : (
        <div className="mdlog-widget__placeholder">交互准备中…</div>
      )}
    </div>
  );
});
