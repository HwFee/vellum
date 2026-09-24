import { useCallback, useEffect } from "react";
import { animateScrollTo } from "../lib/smoothScroll";
import { settingsSectionElementId, type SettingsSectionId } from "../components/SettingsView";
import type { AppRuntime } from "./useAppRuntime";

export type SmoothNav = {
  /** 缓动滚到容器内某处；lockId 非空时锁定大纲高亮到该标题 */
  animateContainerTo: (target: number, lockId?: string) => void;
  /** 把正文里某个标题滚到视口顶：点大纲与 wikilink 片段跳转共用这一条缓动路径 */
  scrollHeadingIntoView: (id: string) => void;
  /** 侧栏设置导航点条目：切激活态并缓动滚到对应分节 */
  handleSelectSettingsSection: (id: SettingsSectionId) => void;
  /** 文档内锚点链接 `[文字](#id)` 的就地跳转 */
  scrollToContentFragment: (rawId: string) => void;
};

/**
 * 程序化滚动与文档内导航（原 App.tsx 的 animateContainerTo / scrollHeadingIntoView /
 * handleSelectSettingsSection / scrollToContentFragment / 锚点点击委托）。
 */
export function useSmoothNav(
  rt: AppRuntime,
  deps: { setSettingsSectionId: (id: SettingsSectionId) => void }
): SmoothNav {
  const { scrollRef, contentRef } = rt.dom;
  const { outlineNavTargetRef } = rt.nav;
  const { headingsRef, editorRef } = rt.doc;
  const { setSettingsSectionId } = deps;

  /// 缓动滚到容器内某处（与恢复位置同一套动画）；lockId 非空时锁定大纲高亮到该标题，
  /// 动画自然结束或被用户滚动/按键打断时解除锁定。
  const animateContainerTo = useCallback(
    (target: number, lockId?: string) => {
      const container = scrollRef.current;
      if (!container) return;
      if (Math.abs(target - container.scrollTop) < 1) return;
      outlineNavTargetRef.current = lockId ?? null;
      animateScrollTo(container, target, () => {
        outlineNavTargetRef.current = null;
      });
    },
    [scrollRef, outlineNavTargetRef]
  );

  /// 把正文里某个标题滚到视口顶：点大纲与 wikilink 片段跳转**共用**这一条缓动路径
  /// （含大纲高亮锁定）。调用前提是目标标题的 DOM 已提交——懒加载正文尚未进 DOM 时
  /// getElementById 取不到，直接不滚（宁可不动，也不去猜一个位置）。
  const scrollHeadingIntoView = useCallback(
    (id: string) => {
      const element = document.getElementById(id);
      const container = scrollRef.current;
      if (!element || !container) return;
      animateContainerTo(
        container.scrollTop +
          element.getBoundingClientRect().top -
          container.getBoundingClientRect().top,
        id
      );
    },
    [scrollRef, animateContainerTo]
  );

  /// 侧栏设置导航点条目：切激活态并缓动滚到对应分节（与大纲跳转共用同一条缓动路径；
  /// 分节就在同一个滚动容器里，故不必另开滚动容器）
  const handleSelectSettingsSection = useCallback(
    (id: SettingsSectionId) => {
      setSettingsSectionId(id);
      const container = scrollRef.current;
      const target = document.getElementById(settingsSectionElementId(id));
      if (!container || !target) return;
      animateContainerTo(
        container.scrollTop +
          target.getBoundingClientRect().top -
          container.getBoundingClientRect().top
      );
    },
    [setSettingsSectionId, scrollRef, animateContainerTo]
  );

  /// 文档内锚点链接（Markdown 标准语法 `[文字](#id)`）。浏览器默认的 hash 跳转会改写
  /// URL 与历史，且不参与我们的缓动滚动与大纲联动，所以全部接管：
  /// - 目标元素在正文里 ⇒ 缓动滚到它（与点大纲同一条路径；标题会顺带锁定大纲高亮）
  /// - 「文档顶部」约定 ⇒ 回顶部。HTML 规范里空片段与 `top` 本就表示文档顶部；`main`
  ///   是 HTML 导出文档里最常见的包裹 id（`<main id="main">`——本应用外壳就是这层），
  ///   用户那份报告里 7 处 `[返回顶部](#main)` 正属于这一类（文档自身没定义该 id，
  ///   所以直接交给浏览器只会没反应）。
  /// - 其余找不到的目标：不猜、不动，但仍阻止 hash 改写
  const scrollToContentFragment = useCallback(
    (rawId: string) => {
      const container = scrollRef.current;
      const content = contentRef.current;
      if (!container) return;
      let id = rawId;
      try {
        id = decodeURIComponent(rawId);
      } catch {
        // 非法百分号编码：按原样找
      }
      const found = id === "" ? null : document.getElementById(id);
      const inContent = found && content?.contains(found) ? found : null;
      if (inContent) {
        animateContainerTo(
          container.scrollTop +
            inContent.getBoundingClientRect().top -
            container.getBoundingClientRect().top,
          headingsRef.current.some((heading) => heading.id === inContent.id)
            ? inContent.id
            : undefined
        );
        return;
      }
      const lower = id.toLowerCase();
      if (id === "" || lower === "top" || lower === "main") {
        animateContainerTo(0);
      }
    },
    [scrollRef, contentRef, animateContainerTo, headingsRef]
  );

  // 锚点点击接管（事件委托在滚动容器上）。编辑视图下返回：那里点击的目标是「进入块编辑」，
  // 不能被链接抢走（块内链接仍可读，只是不跳转）
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const onClick = (event: MouseEvent) => {
      // 只接管「干净的左键点击」：带修饰键/其它键的点击交给浏览器原行为，
      // Shift+点击选字、Ctrl+点击等都不该被拽去跳锚点
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      if (editorRef.current?.viewMode === "editing") return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest('a[href^="#"]');
      if (!anchor) return;
      event.preventDefault();
      scrollToContentFragment((anchor.getAttribute("href") ?? "").slice(1));
    };
    container.addEventListener("click", onClick);
    return () => container.removeEventListener("click", onClick);
  }, [scrollRef, editorRef, scrollToContentFragment]);

  return {
    animateContainerTo,
    scrollHeadingIntoView,
    handleSelectSettingsSection,
    scrollToContentFragment,
  };
}
