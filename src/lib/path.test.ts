import { compactPath, isSamePath } from "./path";

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
