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
