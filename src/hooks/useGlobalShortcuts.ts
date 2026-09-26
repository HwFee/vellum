import { useEffect, useRef } from "react";
import type { AppRuntime } from "./useAppRuntime";

export type GlobalShortcutDeps = {
  /// Ctrl+K/F 的守卫（侧栏已开时只保焦）与 effect 依赖表的成员
  isOutlineOpen: boolean;
  /// Ctrl+K/F 开侧栏：与全部侧栏入口同一条「先钉视口」路径
  setOutlineOpenPinned: (open: boolean) => void;
  /// Ctrl+B 切换侧栏
  toggleOutlinePinned: () => void;
  /// Alt+← / Alt+→ 历史后退/前进（空依赖 useCallback，引用恒定）
  handleNavBack: () => void;
  handleNavForward: () => void;
  /// Ctrl+P 打开 / 退出「导出为 PDF」视图
  toggleExport: () => void;
  /// Ctrl+O 打开文件对话框（与顶栏「打开文件」同一函数）
  handleOpen: () => void | Promise<void>;
  /// Ctrl+= / Ctrl+- 步进、Ctrl+0 复位正文字号（钉视口路径收口在 usePinnedLayoutActions）
  stepReaderFontSize: (direction: 1 | -1 | 0) => void;
  /// F3 / Shift+F3 下一个/上一个搜索匹配：两个回调随 matchCount 换代，
  /// 不进 effect 依赖表——经 searchNavRef 每渲染刷新后由固定监听读取
  handleNextMatch: () => void;
  handlePrevMatch: () => void;
  /// F11 专注模式（C2「留一线」）进出；状态机在 usePinnedLayoutActions 收口
  toggleFocusMode: () => void;
};

/**
 * 全局快捷键（原 App.tsx 的 keydown effect）：⌘K / Ctrl+K（及 Ctrl+F）聚焦搜索框，
 * Ctrl+O 打开文件对话框，Ctrl+B 切换侧栏，Ctrl+E 切换编辑视图，Ctrl+S 提交当前块，
 * Ctrl+P 导出为 PDF，Ctrl+= / Ctrl+- 步进正文字号、Ctrl+0 复位默认字号，
 * F3 / Shift+F3 下一个/上一个搜索匹配，F11 进出专注模式，Alt+← / Alt+→ 历史后退/前进。
 * 依赖是侧栏开关与引用恒定的回调（空依赖 useCallback 或经 ref 读取），
 * 热重载与每次按键都不重新订阅。
 */
export function useGlobalShortcuts(rt: AppRuntime, deps: GlobalShortcutDeps): void {
  const { editorRef } = rt.doc;
  const { isSettingsOpenRef, isExportOpenRef } = rt.views;
  const { searchInputRef } = rt.dom;
  const { isOutlineOpen, setOutlineOpenPinned, toggleOutlinePinned, handleNavBack, handleNavForward, toggleExport, handleOpen, stepReaderFontSize, handleNextMatch, handlePrevMatch, toggleFocusMode } = deps;

  // 搜索匹配导航回调随 matchCount 换代（useCallback 依赖了它）：固定监听经 ref
  // 读最新一份，不为每次匹配计数变化重挂 window 监听
  const searchNavRef = useRef({ next: handleNextMatch, prev: handlePrevMatch });
  searchNavRef.current = { next: handleNextMatch, prev: handlePrevMatch };

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

      // F3 / Shift+F3：下一个/上一个搜索匹配。同 Alt 组一样必须在 Ctrl/Cmd 早退
      // 之前处理（F3 不带修饰键）。无条件吞键——F3 在系统与 WebView 侧都有
      // 「查找下一处」的默认绑定；设置/导出整页视图打开时正文不在 DOM，
      // 静默忽略（键仍吞掉，不把按键让渡出去）
      if (event.key === "F3" && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        if (!isSettingsOpenRef.current && !isExportOpenRef.current) {
          if (event.shiftKey) searchNavRef.current.prev();
          else searchNavRef.current.next();
        }
        return;
      }

      // F11 专注模式：同 Alt/F3 组一样不带修饰键，必须在 Ctrl/Cmd 早退之前。
      // 无条件吞键——F11 在浏览器里是整页全屏加速键；导出视图打开时静默忽略
      // （键仍吞掉，不把按键让渡出去——导出视图有自家的 Esc / Ctrl+P 退出）
      if (
        event.key === "F11" &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !event.shiftKey
      ) {
        event.preventDefault();
        if (!isExportOpenRef.current) toggleFocusMode();
        return;
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

      if (key === "k" || key === "f") {
        event.preventDefault();
        // 侧栏已开（搜索框可能已聚焦）时只保焦，第二次按下不动作；关闭走 Ctrl+B
        if (!isOutlineOpen) {
          setOutlineOpenPinned(true);
        }
        // 等侧栏展开后再聚焦
        setTimeout(() => searchInputRef.current?.focus(), 60);
        return;
      }

      // Ctrl+O 打开文件对话框：与顶栏「打开文件」同一函数。按住不放（event.repeat）
      // 不反复弹对话框，但键始终吞掉
      if (key === "o") {
        event.preventDefault();
        if (!event.repeat) void handleOpen();
        return;
      }

      // Ctrl+= / Ctrl+- 步进正文字号（Shift+= 给出 "+"、Shift+- 给出 "_" 同样接受），
      // Ctrl+0 复位默认档。无条件吞键：WebView2 把 Ctrl+±/0 当整页缩放加速键，
      // 不吞就会在 --reader-font-size 之外叠出第二套缩放。
      // 导出视图打开时只吞不改：预览分页按当前字号排好了，改字号会让预览与底稿失同步
      if (key === "=" || key === "+" || key === "-" || key === "_") {
        event.preventDefault();
        if (!isExportOpenRef.current) {
          stepReaderFontSize(key === "-" || key === "_" ? -1 : 1);
        }
        return;
      }

      if (key === "0") {
        event.preventDefault();
        if (!isExportOpenRef.current) stepReaderFontSize(0);
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
  }, [isOutlineOpen, setOutlineOpenPinned, toggleOutlinePinned, handleNavBack, handleNavForward, toggleExport, handleOpen, stepReaderFontSize, toggleFocusMode, editorRef, isSettingsOpenRef, isExportOpenRef, searchInputRef]);
}
