import type { SidebarTab } from "../lib/library";
import { HEADING_LABELS, type HeadingScript } from "../lib/headingLabels";

/// 页签 id 即 HEADING_LABELS 的键（两表共用一份语义名）
const TABS: ReadonlyArray<{ id: SidebarTab }> = [
  { id: "outline" },
  { id: "files" },
  { id: "search" },
  { id: "backlinks" },
];

/**
 * 侧栏页签（接管 `.outline-panel__header` 那个槽位：同一块 20px 上距 +
 * 发丝底线 + 字距的题头区）。题头字形随偏好 headingScript（出厂繁体，与
 * 「設定」题头一套语汇；简体仅换题头标签，不动界面其余文案）。
 * 激活态是靛青 2px 底栏——与大纲激活指示条同一语汇，不加重量感。
 */
export function SidebarTabs({
  active,
  onSelect,
  script = "traditional",
}: {
  active: SidebarTab;
  onSelect: (tab: SidebarTab) => void;
  script?: HeadingScript;
}) {
  return (
    <div className="sidebar-tabs" role="tablist" aria-label="侧栏面板">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={active === tab.id}
          className={
            "sidebar-tabs__tab" +
            (active === tab.id ? " sidebar-tabs__tab--active" : "")
          }
          onClick={() => onSelect(tab.id)}
        >
          {HEADING_LABELS[tab.id][script]}
        </button>
      ))}
    </div>
  );
}
