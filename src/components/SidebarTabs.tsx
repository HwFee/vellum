import type { SidebarTab } from "../lib/library";

const TABS: ReadonlyArray<{ id: SidebarTab; label: string }> = [
  { id: "outline", label: "目錄" },
  { id: "files", label: "文件" },
  { id: "search", label: "檢索" },
  { id: "backlinks", label: "反鏈" },
];

/**
 * 侧栏页签（接管 `.outline-panel__header` 那个槽位：同一块 20px 上距 +
 * 发丝底线 + 字距的题头区）。繁体字形与既有「目錄」「設定」题头一致。
 * 激活态是靛青 2px 底栏——与大纲激活指示条同一语汇，不加重量感。
 */
export function SidebarTabs({
  active,
  onSelect,
}: {
  active: SidebarTab;
  onSelect: (tab: SidebarTab) => void;
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
          {tab.label}
        </button>
      ))}
    </div>
  );
}
