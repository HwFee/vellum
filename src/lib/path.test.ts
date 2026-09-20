import { basename, compactPath, dirname, fileNameToTitle, isMarkdownPath, isSamePath } from "./path";

test("fileNameToTitle strips the .md extension only", () => {
  expect(fileNameToTitle("cpp-std-move.md")).toBe("cpp-std-move");
  expect(fileNameToTitle("Notes.MD")).toBe("Notes");
  expect(fileNameToTitle("archive.md.bak")).toBe("archive.md.bak");
  expect(fileNameToTitle("no-extension")).toBe("no-extension");
});

/// 日志类文件名照原样当标题（与正文 H1 重复是 Obsidian 的既有行为，Owner 2026-09-18 确认保留）
test("fileNameToTitle keeps date-named logs as-is", () => {
  expect(fileNameToTitle("2026-07-19.md")).toBe("2026-07-19");
});

test("compactPath keeps short paths intact", () => {
  expect(compactPath("C:/notes/readme.md", 40)).toBe("C:/notes/readme.md");
});

test("compactPath shortens long paths from the left", () => {
  expect(compactPath("C:/Users/name/Documents/project/notes/readme.md", 28)).toBe(".../project/notes/readme.md");
});

test("isSamePath treats separators, case and trailing slashes as equivalent", () => {
  expect(isSamePath("C:/notes/live.md", "C:\\notes\\live.md")).toBe(true);
  expect(isSamePath("C:/Notes/Live.md", "c:/notes/live.md")).toBe(true);
  expect(isSamePath("C:/notes/live.md/", "C:/notes/live.md")).toBe(true);
});

test("isSamePath distinguishes different files and rejects empty inputs", () => {
  expect(isSamePath("C:/notes/a.md", "C:/notes/b.md")).toBe(false);
  expect(isSamePath("C:/notes/a.md", "C:/notes/x/a.md")).toBe(false);
  expect(isSamePath(null, "C:/notes/a.md")).toBe(false);
  expect(isSamePath("C:/notes/a.md", null)).toBe(false);
  expect(isSamePath(null, null)).toBe(false);
});

test("basename takes the last segment for either separator and ignores trailing slashes", () => {
  expect(basename("C:/vault/note.md")).toBe("note.md");
  expect(basename("C:\\vault\\note.md")).toBe("note.md");
  expect(basename("C:/vault/")).toBe("vault");
  expect(basename("note.md")).toBe("note.md");
  expect(basename("")).toBe("");
});

test("dirname returns the parent directory with forward slashes", () => {
  expect(dirname("C:/vault/note.md")).toBe("C:/vault");
  expect(dirname("C:\\vault\\sub\\note.md")).toBe("C:/vault/sub");
  expect(dirname("C:/note.md")).toBe("C:");
  // 裸文件名没有父目录
  expect(dirname("note.md")).toBe("");
});

test("isMarkdownPath accepts only .md / .markdown, case-insensitively", () => {
  expect(isMarkdownPath("C:/vault/note.md")).toBe(true);
  expect(isMarkdownPath("C:\\vault\\note.MARKDOWN")).toBe(true);
  expect(isMarkdownPath("C:/vault/note.txt")).toBe(false);
  // 扩展名之外的后缀不算：`.md.bak` 不是 Markdown 文档
  expect(isMarkdownPath("C:/vault/note.md.bak")).toBe(false);
});
