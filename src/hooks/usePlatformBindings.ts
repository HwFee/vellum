import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useEffect, useRef, useState } from "react";
import { fileNameToTitle, isMarkdownPath, isSamePath } from "../lib/path";
import type { DocumentState, LoadedDocument } from "../types";
import type { AppRuntime, LoadOptions } from "./useAppRuntime";

/// 应用名：窗口标题的后半段（无文档时整条标题），与 `tauri.conf.json` 的窗口标题同值
const APP_NAME = "素笺";

export type PlatformBindings = {
  /// 拖放提示态：文件悬停在窗口上时正文区亮一道靛青内描边
  isDropTarget: boolean;
  /// 启动序列是否已落定（pending drain + 最近恢复都已消化或失败收尾）
  startupResolved: boolean;
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
  /// 文件夹拖放去重桶：onDragDropEvent 的 path_is_directory 探针与 Rust 侧
  /// open-dropped-folder 事件都可能带同一个目录来——上一次「文件夹装入请求」的
  /// 路径 + 时间戳记在这里，300ms 内同路径的第二次不再重复打开
  const lastFolderDropRef = useRef<{ path: string; at: number } | null>(null);
  const { loadPath, reloadCurrent, setState, loadRecent, state } = deps;
  const [isDropTarget, setIsDropTarget] = useState(false);
  const [startupResolved, setStartupResolved] = useState(false);
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
        // .md 文件优先：paths 里有 Markdown 就走既有打开管线（混合拖入也认第一个 .md）。
        // 无 .md 时才探目录（path_is_directory 是 Rust 侧一次 is_dir 检查）：
        // 文件夹按 loadPath → load_document 正常管线进库模式——与「打开文件夹…」同一动线，
        // 草稿提交与阅读位置交接在 Rust 写入 AppState 之前，顺序天然安全。
        // Rust 侧 WindowEvent::DragDrop 同样监听 Dropped（无 .md 时发 open-dropped-folder
        // 事件）：两路消费同一拖放互不重迭，下面那个 listener 里的去重桶挡二次打开。
        const path = payload.paths.find(isMarkdownPath);
        if (path) {
          // 经 ref 取最新一份 loadPath：本 effect 只在挂载时注册一次
          void loadPathRef.current(path);
          return;
        }
        const dir = payload.paths[0];
        if (dir) {
          // 探针失败静默降级（拖放能力缺失不该影响阅读）；非 Promise 返回（测试桩
          // 未 mock 该命令时 resolve undefined）同样安全落地
          void Promise.resolve(invoke<boolean>("path_is_directory", { path: dir }))
            .then((isDir) => {
              if (isDir !== true) return;
              // 与 open-dropped-folder 监听同用去重桶（isSamePath 归一化比较）：
              // 探针先到时 Rust 事件里的同一路径被判重挡住，反之亦然
              const last = lastFolderDropRef.current;
              if (last && isSamePath(last.path, dir) && Date.now() - last.at < 300) return;
              lastFolderDropRef.current = { path: dir, at: Date.now() };
              void loadPathRef.current(dir);
            })
            .catch(() => {});
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

  // Rust 侧 WindowEvent::DragDrop 的兜底路：文件夹路径经「open-dropped-folder」
  // 事件到前端，走与 onDragDropEvent 探针同一条 loadPath 管线。去重桶挡双发
  // （两路注册都存活的平台会前后脚各送一次同一目录）
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    async function bindFolderDrop() {
      const unlistenFn = await listen<string>("open-dropped-folder", (event) => {
        const dir = event.payload;
        if (typeof dir !== "string" || !dir) return;
        const last = lastFolderDropRef.current;
        // 判重用归一化比较（分隔符/大小写）：Rust 侧 to_string_lossy 与前端原始串
        // 在同一目录上也可能写法不同（C:\a vs C:/a）
        if (last && isSamePath(last.path, dir) && Date.now() - last.at < 300) return;
        lastFolderDropRef.current = { path: dir, at: Date.now() };
        void loadPathRef.current(dir);
      });
      if (cancelled) {
        unlistenFn();
      } else {
        unlisten = unlistenFn;
      }
    }

    void bindFolderDrop().catch(() => {});

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [loadPathRef]);

  useEffect(() => {
    let cancelled = false;
    let unlistenClose: (() => void) | undefined;

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
      void getCurrentWindow()
        .onCloseRequested(async (event) => {
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
        })
        .then((closeUnlisten) => {
          if (cancelled) {
            closeUnlisten();
          } else {
            unlistenClose = closeUnlisten;
          }
        })
        .catch((error) => {
          console.error("close-requested registration failed", error);
        });

      // 最近列表与 pending drain 并行：互不依赖，谁先到谁先用；
      // 原来串行把「drain → loadRecent」叠在一起，白屏时间直接加倍。
      const recentsPromise = loadRecent().catch(() => [] as string[]);
      await drainPendingPaths();
      if (!openRequestSeenRef.current && !startupLoaded.current) {
        startupLoaded.current = true;
        const recents = await recentsPromise;
        const lastPath = recents[0] ?? null;
        if (lastPath && !openRequestSeenRef.current) {
          await loadPath(lastPath);
        }
      }
      // 启动序列落定（drain 与恢复都已消化）：亮窗交给 useStartupWindow 按
      // 「首个可绘制内容」决策，这里不再等 React 提交、不调 show()。
      setStartupResolved(true);
    }

    void bindStartup().catch((error) => {
      if (!cancelled) {
        setState({ status: "error", message: String(error) });
      }
      // 启动失败同样落定：错误页经 useStartupWindow 的「提交后显示」路径亮窗
      setStartupResolved(true);
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

  return { isDropTarget, startupResolved };
}
