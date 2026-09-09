import {
  memo,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { widgetRegistry } from "../lib/widgetRegistry";
import { isWidgetInteractive } from "../lib/widgetInteractivity";
import { CodeBlock } from "./CodeBlock";

export type WidgetSandboxProps = {
  html: string;
  autoMount: boolean;
};

// 预载视距：进入视口前提前挂载 iframe——下方 1200px（阅读方向，滑到时已渲染完毕，
// 不再看到「闪一下」），上方 400px（回滑同理）。仍受 widgetRegistry 的 LRU 上限约束。
const PRELOAD_ROOT_MARGIN = "400px 0px 1200px 0px";
// iframe load 后未收到 resize 上报（非规范 widget 无通信 IIFE）的淡入兜底时长
const READY_FALLBACK_MS = 500;

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
  // iframe 内容就绪（首个 resize 上报或 load 后超时兜底）前保持透明，就绪后淡入，
  // 避免「空白子帧 → 内容突然拍出」的硬闪
  const [isFrameReady, setIsFrameReady] = useState<boolean>(false);
  // 授权记录在 activatedForHtmlRef 上（A1：必须以 html 为键且在仲裁 effect 执行期实时读取），
  // 而 ref 写入本身不触发渲染；用户点击占位块授权时靠 grantRenderTick 强制一次渲染，
  // 让下方挂载仲裁 effect 以新的 isAuthorized 重新求值（故必须列入 effect 依赖表）。
  const [grantRenderTick, setGrantRenderTick] = useState(0);
  const [isInViewport, setIsInViewport] = useState<boolean>(false);
  const [hasError, setHasError] = useState<boolean>(false);

  const prevHtmlRef = useRef(html);
  const prevAutoMountRef = useRef(autoMount);
  const readyFallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 静态图（通信 IIFE 之外无脚本/控件/链接）的 iframe 禁用指针事件：
  // 滚轮手势命中跨源沙箱子帧会被 scroll-latch 锁住（子帧哪怕只有几 px 可滚动
  // 余量，整个手势期父容器都收不到滚动——「图上滚动卡住、图微移、停一两秒自愈」
  // 的根因）。命中测试穿透 iframe 后，手势直接落在滚动容器上，从根上消除锁存。
  // 交互 widget 保持放行（判定保守化，见 widgetInteractivity.ts）。
  const interactive = useMemo(() => isWidgetInteractive(html), [html]);

  const clearReadyFallbackTimer = () => {
    if (readyFallbackTimerRef.current !== null) {
      clearTimeout(readyFallbackTimerRef.current);
      readyFallbackTimerRef.current = null;
    }
  };

  // 安全门禁以 html 字符串为键：同一份 widget 内容只需授权一次。
  // 通过 ref 在仲裁 effect 执行期实时读取，规避 React 提交帧闭包导致的旧授权在途越权注册竞态（A1/P2-race）。
  const activatedForHtmlRef = useRef<string | null>(autoMount ? html : null);

  if (prevAutoMountRef.current && !autoMount) {
    activatedForHtmlRef.current = null;
  } else if (autoMount) {
    activatedForHtmlRef.current = html;
  }

  // 0. 内容/授权生命周期绑定（P2 防线）：
  // html prop 变化 或 autoMount 翻为 false 时：
  // 对已注册的旧 id unregister_widget、清空 widgetUrl、收回授权（activatedForHtmlRef）、重置休眠态。
  // 「用户已授权」不再单独存 state：授权必须与 html 同键，否则跨文档/同内容多实例会串档（A1）。
  useLayoutEffect(() => {
    const htmlChanged = prevHtmlRef.current !== html;
    const autoMountFlippedFalse = prevAutoMountRef.current && !autoMount;

    if (htmlChanged || autoMountFlippedFalse) {
      prevHtmlRef.current = html;
      prevAutoMountRef.current = autoMount;
      activatedForHtmlRef.current = autoMount ? html : null;

      if (idRef.current) {
        const idToUnregister = idRef.current;
        idRef.current = null;
        void Promise.resolve(invoke("unregister_widget", { id: idToUnregister })).catch(() => {});
      }
      setWidgetUrl(null);
      setIsDormant(false);
      setHasError(false);
      setIsFrameReady(false);
      clearReadyFallbackTimer();
      // 实例复用时同步复位展示态，避免上一文档的标题/高度残留
      setTitle("交互演示");
      setHeight(240);
    } else {
      prevHtmlRef.current = html;
      prevAutoMountRef.current = autoMount;
      if (autoMount) {
        activatedForHtmlRef.current = html;
      }
    }
  }, [html, autoMount]);

  // 1. 注册进入 widgetRegistry 单例并订阅休眠状态
  useEffect(() => {
    widgetRegistry.register(instanceId);
    const unsubscribe = widgetRegistry.subscribe((targetId, dormant) => {
      if (targetId === instanceId) {
        setIsDormant(dormant);
        if (dormant) {
          // P4: 进入休眠时立即注销后端资源并清空 widgetUrl，防止持续占内存并确保唤醒后重新注册新 URL
          if (idRef.current) {
            const idToUnregister = idRef.current;
            idRef.current = null;
            void Promise.resolve(invoke("unregister_widget", { id: idToUnregister })).catch(() => {});
          }
          setWidgetUrl(null);
          setIsFrameReady(false);
          clearReadyFallbackTimer();
        }
      }
    });

    return () => {
      unsubscribe();
      widgetRegistry.release(instanceId);
      clearReadyFallbackTimer();
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
      { rootMargin: PRELOAD_ROOT_MARGIN }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [instanceId]);

  // 3. 挂载条件仲裁与 register_widget 触发
  const isAuthorized = autoMount || activatedForHtmlRef.current === html;
  const shouldMount = isAuthorized && !isDormant;

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
  }, [shouldMount, isInViewport, widgetUrl, hasError, html, instanceId, grantRenderTick]);

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

      // 收到首个合法上报说明沙箱已完成排版，可以淡入
      setIsFrameReady(true);
      clearReadyFallbackTimer();

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
      clearReadyFallbackTimer();
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);

  // 错误降级渲染（A5: 内部渲染 CodeBlock，保证 MarkdownDocument memo 引用稳定性）
  // F12: markup 是 CodeBlock 已注册的 Prism 语言（xml 未注册，写上去也无高亮）
  if (hasError) {
    return <CodeBlock code={html} language="markup" />;
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
            activatedForHtmlRef.current = html;
            setIsInViewport(true);
            widgetRegistry.activate(instanceId);
            setIsDormant(false);
          }}
        >
          交互已休眠 · 点击查看
        </button>
      </div>
    );
  }

  // 未受信初始占位块（autoMount=false 且未针对当前 html 授权）
  if (!isAuthorized) {
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
            activatedForHtmlRef.current = html;
            setGrantRenderTick((tick) => tick + 1);
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
          className={
            (isFrameReady ? "mdlog-widget__frame mdlog-widget__frame--ready" : "mdlog-widget__frame") +
            (interactive ? "" : " mdlog-widget__frame--static")
          }
          src={widgetUrl}
          title={title}
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          onLoad={() => {
            // 非规范 widget 可能永不上报 resize：load 后超时兜底放行，避免永远透明
            clearReadyFallbackTimer();
            readyFallbackTimerRef.current = setTimeout(() => {
              readyFallbackTimerRef.current = null;
              setIsFrameReady(true);
            }, READY_FALLBACK_MS);
          }}
          style={{ height: `${height}px` }}
        />
      ) : (
        <div className="mdlog-widget__placeholder">交互准备中…</div>
      )}
    </div>
  );
});
