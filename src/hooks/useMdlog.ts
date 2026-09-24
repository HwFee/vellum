import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useState } from "react";
import { computeRecheckDelay, type MdlogState } from "../lib/mdlogState";
import type { AppRuntime } from "./useAppRuntime";

export type Mdlog = {
  mdlogState: MdlogState | null;
  isMdlogActive: boolean;
  /// 直接置回 state（loadPath 的失败兜底与 scheduleRecheck 的复査都用 ?? null 归一）
  setMdlogState: (state: MdlogState | null) => void;
  /// 加载成功路径的 mdlog 状态写入（state + 活跃路径 + 复査调度一次完成）
  applyLoadedState: (liveState: MdlogState | null, path: string) => void;
  /// 切换文档时重置 mdlog 活跃路径与前置标志，避免切换过渡时误触发断开补写
  resetForDocumentSwitch: () => void;
};

/**
 * mdlog 现场日志：状态监听、到期复査、连接迁移的集中处理与编辑门禁
 * （原 App.tsx 的 scheduleRecheck / mdlog 状态监听 / 连接迁移 / 门禁三个 effect）。
 */
export function useMdlog(
  rt: AppRuntime,
  deps: { persistCurrentScroll: () => void }
): Mdlog {
  const { currentPathRef, editorRef } = rt.doc;
  const { isMdlogActiveRef, prevIsMdlogActiveRef, activeMdlogPathRef, recheckTimerRef } = rt.mdlog;
  const { persistCurrentScroll } = deps;

  const [mdlogState, setMdlogState] = useState<MdlogState | null>(null);
  const isMdlogActive = mdlogState !== null;
  isMdlogActiveRef.current = isMdlogActive;

  const scheduleRecheck = useCallback(
    (liveState: MdlogState | null) => {
      if (recheckTimerRef.current !== null) {
        clearTimeout(recheckTimerRef.current);
        recheckTimerRef.current = null;
      }
      if (!liveState) return;

      const delay = computeRecheckDelay(liveState.expiresAt);
      recheckTimerRef.current = setTimeout(async () => {
        recheckTimerRef.current = null;
        if (!currentPathRef.current) return;
        const expectedPath = currentPathRef.current;
        try {
          const latestState = await invoke<MdlogState | null>("read_mdlog_state");
          if (currentPathRef.current !== expectedPath) return;
          // 防御：后端异常/反序列化抖动可能给出 undefined，?? 归一为 null——
          // undefined !== null 会被 isMdlogActive 误判为记录中，静默禁用吸底、
          // 热重载印章与阅读位置记忆
          setMdlogState(latestState ?? null);
          if (latestState != null) {
            activeMdlogPathRef.current = expectedPath;
          }
          scheduleRecheck(latestState ?? null);
        } catch {
          if (currentPathRef.current !== expectedPath) return;
          setMdlogState(null);
        }
      }, delay);
    },
    [recheckTimerRef, currentPathRef, activeMdlogPathRef]
  );

  /// 加载成功路径的 mdlog 状态写入：与 checkState / scheduleRecheck 同口径
  /// （?? null 归一 + 活跃路径记录 + 下一次复査调度），调用方负责在途判定
  const applyLoadedState = useCallback(
    (liveState: MdlogState | null, path: string) => {
      setMdlogState(liveState ?? null);
      if (liveState != null) {
        activeMdlogPathRef.current = path;
      }
      scheduleRecheck(liveState ?? null);
    },
    [activeMdlogPathRef, scheduleRecheck]
  );

  /// 切换文档时重置 mdlog 活跃路径与前置标志，避免切换过渡时误触发断开补写
  const resetForDocumentSwitch = useCallback(() => {
    prevIsMdlogActiveRef.current = false;
    activeMdlogPathRef.current = null;
    if (recheckTimerRef.current !== null) {
      clearTimeout(recheckTimerRef.current);
      recheckTimerRef.current = null;
    }
    setMdlogState(null);
  }, [prevIsMdlogActiveRef, activeMdlogPathRef, recheckTimerRef]);

  // mdlog 活跃记录态与状态监听
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    async function checkState() {
      if (!currentPathRef.current) return;
      const expectedPath = currentPathRef.current;
      try {
        const liveState = await invoke<MdlogState | null>("read_mdlog_state");
        if (cancelled || currentPathRef.current !== expectedPath) return;
        setMdlogState(liveState ?? null);
        if (liveState != null) {
          activeMdlogPathRef.current = expectedPath;
        }
        scheduleRecheck(liveState ?? null);
      } catch {
        if (cancelled || currentPathRef.current !== expectedPath) return;
        setMdlogState(null);
      }
    }

    async function bindState() {
      const unlistenFn = await listen("mdlog-state-changed", () => {
        void checkState();
      });
      if (cancelled) {
        unlistenFn();
      } else {
        unlisten = unlistenFn;
      }
    }

    void bindState();

    return () => {
      cancelled = true;
      unlisten?.();
      if (recheckTimerRef.current !== null) {
        clearTimeout(recheckTimerRef.current);
        recheckTimerRef.current = null;
      }
    };
  }, [scheduleRecheck, currentPathRef, activeMdlogPathRef, recheckTimerRef]);

  // mdlog 连接状态迁移的集中处理：
  // 连接建立瞬间立即记录当前阅读位置——此后即使 pi 进程被强杀、Vellum 被强关
  //（beforeunload 来不及跑），下次打开也能回到连接前的位置；断开时再集中补写一次
  useEffect(() => {
    if (isMdlogActive && !prevIsMdlogActiveRef.current) {
      persistCurrentScroll();
    }
    if (prevIsMdlogActiveRef.current && !isMdlogActive) {
      if (activeMdlogPathRef.current && activeMdlogPathRef.current === currentPathRef.current) {
        persistCurrentScroll();
      }
      activeMdlogPathRef.current = null;
    }
    prevIsMdlogActiveRef.current = isMdlogActive;
  }, [isMdlogActive, prevIsMdlogActiveRef, activeMdlogPathRef, currentPathRef, persistCurrentScroll]);

  // mdlog 记录变活跃 ⇒ 编辑门禁全关（规格 §6.4）：先中断当前块编辑（草稿尽力写入剪贴板），
  // 再退回阅读视图。经 editorRef 读最新会话，effect 只随门禁边沿触发。
  // 提示只保留一条（审查 Minor 3）：编辑视图下 toggleView → commitActive 的提交口门禁
  // （F25）已经做了「写剪贴板 + 清场 + 提示」，此处不得再重复弹一次；
  // 既不在编辑视图又没有活动块时本就无编辑会话可中断，静默（与裁定 F32 同口径）。
  useEffect(() => {
    if (!isMdlogActive) return;
    const current = editorRef.current;
    if (!current) return;
    if (current.viewMode === "editing") {
      void current.toggleView();
      return;
    }
    if (current.activeUnit) {
      current.notifyInterrupted("记录已开始 · 编辑已取消");
    }
  }, [isMdlogActive, editorRef]);

  return { mdlogState, isMdlogActive, setMdlogState, applyLoadedState, resetForDocumentSwitch };
}
