/// 侧栏题头字形偏好（设置页「界面」节「侧栏题头字形」分段器）：出厂繁体
/// （与 1.12 的「目錄 / 檢索 / 反鏈 / 設定」一套题头一致），可选简体。
/// 只动题头标签的字形，不改界面其余文案——那些一直是简体。
export type HeadingScript = "traditional" | "simplified";

/// 读盘值校验：非「traditional / simplified」一律回出厂繁体（含旧版无此键）
export function parseHeadingScript(value: unknown): HeadingScript {
  return value === "simplified" || value === "traditional" ? value : "traditional";
}

/// 侧栏题头的语义名：页签条四枚 + 设置导航一枚。
export type HeadingId = "outline" | "files" | "search" | "backlinks" | "settings";

/// 双形对照表（唯一的字面出处：SidebarTabs / OutlinePanel 默认题头 / SettingsNav 同查这张表）
export const HEADING_LABELS: Record<HeadingId, Record<HeadingScript, string>> = {
  outline: { traditional: "目錄", simplified: "目录" },
  files: { traditional: "文件", simplified: "文件" },
  search: { traditional: "檢索", simplified: "检索" },
  backlinks: { traditional: "反鏈", simplified: "反链" },
  settings: { traditional: "設定", simplified: "设置" },
};
