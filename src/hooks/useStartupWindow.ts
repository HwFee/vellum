import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useRef } from "react";
import type { DocumentState } from "../types";

/// 首屏实际用到的字面子集：正文 400 + 题头/强调 500，两只 CJK 字重与 mono。
/// 等 `document.fonts.ready` 会拖到全部声明 face（含未用到的 KaTeX 一族）落定；
/// 改为只拉这几只，超时兜底 400ms——字体慢宁可先亮窗，不让 17MB 全量挡住首帧。
const STARTUP_FONT_SPECS = [
  '400 16px "TsangerJinKai02"',
  '500 16px "TsangerJinKai02"',
  '400 16px "JetBrains Mono"',
  '500 16px "JetBrains Mono"',
];
const STARTUP_FONT_SAMPLE = "素笺正文阅读題頭0123456789";

function fontsReady(): Promise<unknown> {
  try {
    const fonts = typeof document !== "undefined" ? document.fonts : undefined;
    if (!fonts?.load) return Promise.resolve();
    return Promise.race([
      Promise.allSettled(
        STARTUP_FONT_SPECS.map((spec) => fonts.load(spec, STARTUP_FONT_SAMPLE))
      ),
      new Promise((resolve) => setTimeout(resolve, 400)),
    ]);
  } catch {
    return Promise.resolve();
  }
}

/// 等两帧绘制。不可见窗口（`visible:false` 起始态）在 WebView2/多数浏览器里 rAF 被
/// 节流到极低频甚至不调度——裸等 rAF 会把亮窗拖进秒级。用 setTimeout 兜底：
/// rAF 先到算绘制完成，超时也放行（亮窗比「等完两帧」重要）。
function nextPaintFrames(): Promise<void> {
  return new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (!done) {
        done = true;
        resolve();
      }
    };
    requestAnimationFrame(() => requestAnimationFrame(finish));
    setTimeout(finish, 100);
  });
}

export function useStartupWindow(
  state: DocumentState,
  startupResolved: boolean,
  onVisible?: () => void
): () => void {
  const shownRef = useRef(false);
  const cancelledRef = useRef(false);
  const pendingRef = useRef<DocumentState | null>(null);
  const stateRef = useRef(state);
  const onVisibleRef = useRef(onVisible);

  stateRef.current = state;
  onVisibleRef.current = onVisible;

  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  const attemptReveal = useCallback((expected: DocumentState) => {
    if (shownRef.current || cancelledRef.current || pendingRef.current === expected) {
      return;
    }
    pendingRef.current = expected;
    void (async () => {
      try {
        await fontsReady();
      } catch {
        // never hide the window forever over a font-loading hiccup
      }
      await nextPaintFrames();
      if (cancelledRef.current || shownRef.current) return;
      if (stateRef.current !== expected || pendingRef.current !== expected) {
        if (pendingRef.current === expected) pendingRef.current = null;
        return;
      }
      pendingRef.current = null;
      shownRef.current = true;
      try {
        await getCurrentWindow().show();
        onVisibleRef.current?.();
      } catch {
        shownRef.current = false;
      }
    })();
  }, []);

  useEffect(() => {
    if (shownRef.current || !startupResolved) return;
    const eligible =
      state.status === "empty" ||
      state.status === "error" ||
      (state.status === "ready" && state.document.path === "");
    if (eligible) attemptReveal(state);
  }, [state, startupResolved, attemptReveal]);

  return useCallback(() => {
    const current = stateRef.current;
    if (current.status !== "ready" || current.document.path === "") return;
    attemptReveal(current);
  }, [attemptReveal]);
}
