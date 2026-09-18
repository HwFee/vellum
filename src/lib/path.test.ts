import { compactPath, fileNameToTitle, isSamePath } from "./path";

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
