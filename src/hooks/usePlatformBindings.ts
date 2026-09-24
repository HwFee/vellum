import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useEffect, useRef, useState } from "react";
import { fileNameToTitle, isMarkdownPath } from "../lib/path";
import type { DocumentState, LoadedDocument } from "../types";
import type { AppRuntime, LoadOptions } from "./useAppRuntime";

/// 应用名：窗口标题的后半段（无文档时整条标题），与 `tauri.conf.json` 的窗口标题同值
const APP_NAME = "素笺";

export type PlatformBindings = {
  /// 拖放提示态：文件悬停在窗口上时正文区亮一道靛青内描边
  isDropTarget: boolean;
};

/**
 * 平台侧绑定（原 App.tsx 的四个挂载期 effect）：拖放打开、启动管线
 * （pending paths → 最近打开恢复 → 窗口显示 + 关窗前提交活动块）、
 * file-changed 外部变更分流、窗口标题随文档。
 */
export function usePlatformBindings(
  rt: AppRuntime,
  deps: {
    loadPath: (path: string, options?: LoadOptions) => Promise<void>;
    reloadCurrent: (preloaded?: LoadedDocument) => Promise<void>;
    setState: (state: DocumentState) => void;
    loadRecent: () => Promise<string[]>;
    state: DocumentState;
  }
): PlatformBindings {
  const { currentPathRef, currentMarkdownRef, editorRef, loadPathRef } = rt.doc;
  const { loadPath, reloadCurrent, setState, loadRecent, state } = deps;
  const [isDropTarget, setIsDropTarget] = useState(false);
  const startupLoaded = useRef(false);
  const openRequestSeenRef = useRef(false);
  const drainChainRef = useRef(Promise.resolve());

  /// 拖放打开（Tauri 2 的 webview 拖放事件）。提示态与打开动作分离：
  /// enter/over 亮描边（over 只带坐标、不带路径，故判定不依赖 paths），
  /// leave 熄灭；drop 先熄灭再取**第一个** Markdown 路径走既有打开管线——
  /// 非 Markdown（图片/压缩包等）整体忽略，多文件也只认第一个。
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    async function bindDragDrop() {
      const unlistenFn = await getCurrentWebviewWindow().onDragDropEvent((event) => {
        const payload = event.payload;
        if (payload.type === "enter" || payload.type === "over") {
          setIsDropTarget(true);
          return;
        }
        if (payload.type === "leave") {
          setIsDropTarget(false);
          return;
        }
        setIsDropTarget(false);
        const path = payload.paths.find(isMarkdownPath);
        if (path) {
          // 经 ref 取最新一份 loadPath：本 effect 只在挂载时注册一次
          void loadPathRef.current(path);
        }
      });
      if (cancelled) {
        unlistenFn();
      } else {
        unlisten = unlistenFn;
      }
    }

    // 拖放能力缺失（旧 WebView2 / 权限未授予）不该影响阅读：失败即静默降级
    void bindDragDrop().catch(() => {});

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [loadPathRef]);

  useEffect(() => {
    let cancelled = false;
    let unlistenClose: (() => void) | undefined;
    let shown = false;

    async function revealWindow() {
      if (shown || cancelled) return;
      shown = true;
      try {
        await getCurrentWindow().show();
      } catch {
        // 非关键路径：窗口可能已经可见
      }
    }

    function drainPendingPaths() {
      drainChainRef.current = drainChainRef.current.catch(() => {}).then(async () => {
        const paths = await invoke<string[]>("drain_pending_open_paths");
        const latestPath = paths[paths.length - 1];
        if (latestPath) {
          openRequestSeenRef.current = true;
          startupLoaded.current = true;
          await loadPath(latestPath);
        }
      });
      return drainChainRef.current;
    }

    async function bindStartup() {
      // 多实例（2026-09-12）：无单实例转发，每个进程只在启动时 drain 自己的命令行路径；
      // 运行期不再有「pending-open-paths」事件（其唯一生产者是已移除的单实例插件）。

      // 关窗前先提交活动块（规格 §6.3）：有未提交草稿时拦下本次关闭，提交完成后再看结果。
      // 绝不能「先 preventDefault、再自行 close()」—— close() 会重发可拦截的 closeRequested
      //（window.d.ts:745；tauri-runtime-wry 的 WindowMessage::Close 也走同一处理器），
      // 落盘失败时 hook 会重新激活同一块并保留草稿（F24），于是形成
      // 「拦截 → 提交失败 → close → 再拦截」的无限重试（审查 C1）。
      // 正确姿势：提交之后按「活动块是否真的清掉」决定要不要拦（commitActive 的返回值
      // 就是这个问题 —— 消费者的 editorRef 是上一轮渲染的快照，不能用来判定）；
      // 不拦时的窗口销毁由 JS 包装层自己做（onCloseRequested → destroy，
      // 且它会 await 本处理器，故晚到的 preventDefault 依然生效）。
      const closeUnlisten = await getCurrentWindow().onCloseRequested(async (event) => {
        // 关窗路径的**绝对不变量**：绝不能因本处理器抛错/卡住而让窗口关不掉。
        // 任何意外都放行（不 preventDefault），最多损失一次未提交的草稿；
        // 真正做到拦截的只有「提交返回 false」那一条路径。
        try {
          const current = editorRef.current;
          if (!current?.activeUnit) return;
          // 提交成功（含 mdlog 门禁把会话中断掉）⇒ 不拦，包装层 destroy；
          // 落盘失败 ⇒ 草稿仍在框里，拦下本次关闭让用户处理，绝不重试关闭。
          const cleared = await current.commitActive();
          if (!cleared) {
            event.preventDefault();
          }
        } catch (error) {
          console.error("close-requested handler failed, closing anyway", error);
        }
      });
      if (cancelled) {
        closeUnlisten();
      } else {
        unlistenClose = closeUnlisten;
      }

      await drainPendingPaths();
      if (!openRequestSeenRef.current && !startupLoaded.current) {
        startupLoaded.current = true;
        // 最近打开列表（新→旧）：列表供空态渲染，首条即「启动恢复」的目标。
        const recents = await loadRecent();
        const lastPath = recents[0] ?? null;
        if (lastPath && !openRequestSeenRef.current) {
          await loadPath(lastPath);
        }
      }
      // 等待 React 将 loadPath 的状态更新提交到 DOM，避免窗口先显示空状态再闪现文档
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      });
      await revealWindow();
    }

    void bindStartup().catch(async (error) => {
      if (!cancelled) {
        setState({ status: "error", message: String(error) });
      }
      // 同样等待 React 提交错误状态到 DOM 再显示窗口
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      });
      await revealWindow();
    });

    return () => {
      cancelled = true;
      unlistenClose?.();
    };
    // loadPath / loadRecent / setState 都是稳定引用（rt ref 与 useCallback），
    // 挂载时注册一次的语义与拆分前一致
  }, [editorRef, loadPath, loadRecent, setState]);

  // 监听后端文件变更事件：先分流「我方写入回声 / 外部变更」，再决定是否热重载
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    /// 外部变更分流（规格 §7.2）：file-changed 到达时先读盘，并与**当前内存 markdown**
    /// 按归一 EOL 比对（裁定 F30）——相等即无实际外部变更（可能是我方写入的 watcher
    /// 回声；F24 保证内存不长期领先磁盘），整体忽略（不更新状态、不递增 reloadTick、
    /// 不闪印章、不做滚动补偿）；不等则属外部变更，中断当前编辑后走既有热重载路径。
    /// 经 editorRef 读最新会话：否则首次渲染的闭包会把中断当成无事发生（M11）。
    async function reloadIfExternal() {
      const path = currentPathRef.current;
      if (!path) return;
      try {
        const latest = await invoke<LoadedDocument>("load_document", { path });
        // 预读期间可能已切换文档/卸载：作废本次分流
        if (cancelled || currentPathRef.current !== path) return;
        const normalized = latest.markdown.replace(/\r\n/g, "\n");
        if (normalized === currentMarkdownRef.current.replace(/\r\n/g, "\n")) {
          return; // 磁盘与内存一致：无变更可热重载，整体忽略
        }
        // 提示只在确有编辑会话被中断时才弹（裁定 F32）：mdlog 记录中模型每次追加
        // 都会走这条路径，而那时用户从未进过编辑态，不能刷「编辑已取消」。
        if (editorRef.current?.activeUnit) {
          editorRef.current.notifyInterrupted("文件已被外部修改 · 编辑已取消");
        }
        await reloadCurrent(latest);
      } catch {
        // 读失败：保留旧内容
      }
    }

    async function bindReload() {
      const unlistenFn = await listen("file-changed", () => {
        void reloadIfExternal();
      });
      if (cancelled) {
        unlistenFn();
      } else {
        unlisten = unlistenFn;
      }
    }

    void bindReload();

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [currentPathRef, currentMarkdownRef, editorRef, reloadCurrent]);

  // 窗口标题（OS 级 setTitle，**不是**顶栏文本——顶栏不显示文件名是设计红线）：
  // 有文档时「文件名 — 素笺」（fileNameToTitle 与正文 h1.document-title 同源），
  // 无文档（空态）与加载失败复位为应用名。
  // loading 是切文档的过渡帧：null 表示本次不改写标题，沿用上一篇的——否则任务栏
  // 会在换文档时闪一帧「素笺」。
  const windowTitle =
    state.status === "ready"
      ? `${fileNameToTitle(state.document.fileName)} — ${APP_NAME}`
      : state.status === "loading"
        ? null
        : APP_NAME;

  // 依赖是标题串而非 state 对象：编辑提交（markdown 变、state 换引用）不该重写标题。
  // 写标题失败（权限缺失/非 Tauri 环境）静默降级——它是装饰性副作用，不该冒泡成错误页
  useEffect(() => {
    if (windowTitle === null) return;
    void getCurrentWindow()
      .setTitle(windowTitle)
      .catch(() => {});
  }, [windowTitle]);

  return { isDropTarget };
}
