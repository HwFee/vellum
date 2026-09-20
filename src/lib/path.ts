/**
 * Windows 路径等价判定（本应用仅面向 Windows x64）：
 * 统一分隔符、忽略大小写、忽略结尾多余斜杠，空值/不同路径为 false。
 * 用于「同路径重新打开」守卫：深链传入的路径与当前已加载路径可能写法不同。
 */
export function isSamePath(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const canonical = (path: string) =>
    path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  return canonical(a) === canonical(b);
}

/**
 * 文件名 → 正文标题（Obsidian 的 inline title 语义）：标题取自**文件名**而非正文 H1，
 * 只剥 `.md` 扩展名（大小写不敏感），其余原样。
 *
 * 日志类文件（`2026-07-19.md`）的标题因此与正文 H1 重复——这是 Obsidian 的既有行为，
 * 2026-09-18 与 Owner 确认照原样保留，不做「纯日期名不显示」的特殊分支。
 */
export function fileNameToTitle(fileName: string): string {
  return fileName.replace(/\.md$/i, "");
}

/**
 * 取路径的最后一段（文件名）。末尾多余斜杠先剥掉；裸文件名原样返回，
 * 空路径返回空串。分隔符按 `/` 与 `\` 两种写法统一处理（Windows 上两者都会出现）。
 */
export function basename(path: string): string {
  const normalized = stripTrailingSeparators(path);
  const index = normalized.lastIndexOf("/");
  return index === -1 ? normalized : normalized.slice(index + 1);
}

/**
 * 取父目录（不含末尾斜杠，分隔符统一成 `/`）。裸文件名没有父目录，返回空串。
 * 盘符根（`C:/a.md`）返回 `C:`——空态里显示成「C:」是可读的，不必补斜杠。
 */
export function dirname(path: string): string {
  const normalized = stripTrailingSeparators(path);
  const index = normalized.lastIndexOf("/");
  return index <= 0 ? "" : normalized.slice(0, index);
}

/** 是否 Markdown 文档：拖放只认 `.md` / `.markdown`（与打开对话框的扩展名过滤器同源） */
export function isMarkdownPath(path: string): boolean {
  return /\.(md|markdown)$/i.test(path);
}

function stripTrailingSeparators(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

export function compactPath(path: string, maxLength = 64): string {
  const normalized = path.replace(/\\/g, "/");
  if (normalized.length <= maxLength) return normalized;

  const parts = normalized.split("/").filter(Boolean);
  const tail: string[] = [];
  let length = 3;

  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const next = parts[index];
    const nextLength = length + next.length + (tail.length > 0 ? 1 : 0);
    if (nextLength > maxLength) break;
    tail.unshift(next);
    length = nextLength;
  }

  return `.../${tail.join("/")}`;
}
