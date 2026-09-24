import { useMemo } from "react";
import { extractOutline } from "../lib/outline";
import { useOutlineSync } from "./useOutlineSync";
import type { AppRuntime } from "./useAppRuntime";
import type { OutlineHeading } from "../types";

export type Outline = {
  headings: OutlineHeading[];
  activeHeadingId: string | undefined;
  handleSelectHeading: (id: string) => void;
};

/// 文档大纲：提取、滚动跟随（useOutlineSync）、点章跳转与窄屏收栏
/// （原 App.tsx 的 headings memo / useOutlineSync 调用 / handleSelectHeading）。
export function useOutline(
  rt: AppRuntime,
  deps: {
    markdown: string | undefined;
    /// revision 传视图标识：设置视图期间正文整块退出 DOM，回来时标题是新元素——
    /// 观察器不按它重挂就再也不会回调（大纲高亮会停在设置视图里的空白态）
    revision: string;
    isNarrow: boolean;
    setOutlineOpenPinned: (open: boolean) => void;
    scrollHeadingIntoView: (id: string) => void;
  }
): Outline {
  const { headingsRef } = rt.doc;

  const headings = useMemo(
    () => (deps.markdown !== undefined ? extractOutline(deps.markdown) : []),
    [deps.markdown]
  );
  headingsRef.current = headings;

  const activeHeadingId = useOutlineSync(
    rt.dom.scrollRef,
    headings,
    rt.nav.outlineNavTargetRef,
    deps.revision
  );

  const handleSelectHeading = (id: string) => {
    // 与 wikilink 片段跳转共用同一条缓动路径（scrollHeadingIntoView）
    deps.scrollHeadingIntoView(id);
    if (deps.isNarrow) {
      deps.setOutlineOpenPinned(false);
    }
  };

  return { headings, activeHeadingId, handleSelectHeading };
}
