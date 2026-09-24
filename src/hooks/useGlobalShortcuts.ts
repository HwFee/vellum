import { useEffect } from "react";
import type { AppRuntime } from "./useAppRuntime";

export type GlobalShortcutDeps = {
  /// Ctrl+K 的守卫（侧栏已开时只保焦）与 effect 依赖表的成员
  isOutlineOpen: boolean;
  /// Ctrl+K 开侧栏：与全部侧栏入口同一条「先钉视口」路径
  setOutlineOpenPinned: (open: boolean) => void;
  /// Ctrl+B 切换侧栏
  toggleOutlinePinned: () => void;
  /// Alt+← / Alt+→ 历史后退/前进（空依赖 useCallback，引用恒定）
  handleNavBack: () => void;
  handleNavForward: () => void;
  /// Ctrl+P 打开 / 退出「导出为 PDF」视图
  toggleExport: () => void;
};

/**
 * 全局快捷键（原 App.tsx 的 keydown effect）：⌘K / Ctrl+K 聚焦搜索框，
 * Ctrl+B 切换侧栏，Ctrl+E 切换编辑视图，Ctrl+S 提交当前块，
 * Ctrl+P 导出为 PDF，Alt+← / Alt+→ 历史后退/前进。
 * 依赖只有侧栏开关与两个历史回调（它们都是空依赖 useCallback，引用恒定；其余经
 * editorRef/callback ref 读取），热重载与每次按键都不重新订阅。
 */
export function useGlobalShortcuts(rt: AppRuntime, deps: GlobalShortcutDeps): void {
  const { editorRef } = rt.doc;
  const { isSettingsOpenRef, isExportOpenRef } = rt.views;
  const { searchInputRef } = rt.dom;
  const { isOutlineOpen, setOutlineOpenPinned, toggleOutlinePinned, handleNavBack, handleNavForward, toggleExport } = deps;

  useEffect(() => {
    function handleGlobalShortcut(event: KeyboardEvent) {
      // Alt+← / Alt+→ 必须在下面的 Ctrl/Cmd 早退之前处理（Alt 组合没有 ctrl/meta）。
      // 不检查 event.defaultPrevented：这里就是它们的唯一消费者。
      // preventDefault 是必须的：WebView2 把 Alt+←/→ 当自己的历史导航加速键，
      // 不吞掉就会连整个页面一起导航走（与 Ctrl+S 吞「保存网页」同理）
      if (event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          handleNavBack();
          return;
        }
        if (event.key === "ArrowRight") {
          event.preventDefault();
          handleNavForward();
          return;
        }
      }
      if (!(event.metaKey || event.ctrlKey)) return;
      // 已被消费的按键不再处理（终审 C2 / 裁定 F38-A）：编辑框的 onKeyDown 对
      // Ctrl+S 调过 preventDefault，事件继续冒泡到 window；这里无条件再调一次
      // 就会形成双通道提交（而此时 editorRef 已被 flushSync 换成新闭包）。
      if (event.defaultPrevented) return;
      const key = event.key.toLowerCase();

      // Ctrl+S（裁定 F6）：阅读视图下也必须吞掉 WebView 自带的「保存网页」默认行为；
      // 无活动块时 commitActive 为 no-op
      if (key === "s") {
        event.preventDefault();
        void editorRef.current?.commitActive();
        return;
      }

      if (key === "e") {
        event.preventDefault();
        // 整页视图（设置 / 导出）里不切视图：正文不在 DOM 里，切了也看不见
        //（编辑视图是正文区的语义，静默改掉它只会让「返回阅读」时状态与预期不符）
        if (isSettingsOpenRef.current || isExportOpenRef.current) return;
        void editorRef.current?.toggleView();
        return;
      }

      if (key === "b") {
        event.preventDefault();
        toggleOutlinePinned();
        return;
      }

      if (key === "k") {
        event.preventDefault();
        // 侧栏已开（搜索框可能已聚焦）时只保焦，第二次按下不动作；关闭走 Ctrl+B
        if (!isOutlineOpen) {
          setOutlineOpenPinned(true);
        }
        // 等侧栏展开后再聚焦
        setTimeout(() => searchInputRef.current?.focus(), 60);
        return;
      }

      // Ctrl+P（2026-09-21 改绑）：打开 / 退出「导出为 PDF」视图（纸张舞台），
      // 系统打印对话框退役——导出走后端 CDP Page.printToPDF 直接落盘，界面与预览都是
      // 自家的。无条件吞键：没有文档可导时也不把按键让给 WebView 的浏览器加速键。
      // Ctrl+Shift+P 不归这里（带 Shift 是另一个组合键，不切视图、不吞键）。
      if (key === "p" && !event.shiftKey) {
        event.preventDefault();
        toggleExport();
        return;
      }
    }
    window.addEventListener("keydown", handleGlobalShortcut);
    return () => window.removeEventListener("keydown", handleGlobalShortcut);
  }, [isOutlineOpen, setOutlineOpenPinned, toggleOutlinePinned, handleNavBack, handleNavForward, toggleExport, editorRef, isSettingsOpenRef, isExportOpenRef, searchInputRef]);
}
