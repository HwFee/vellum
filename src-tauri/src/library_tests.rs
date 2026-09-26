use std::fs;
use std::path::PathBuf;

use crate::library::{find_backlinks, list_library, search_library};

/// Removes the temporary test directory when the test ends, even on panic.
struct TestDir(PathBuf);

impl TestDir {
    fn new(name: &str) -> Self {
        let root = std::env::temp_dir().join(name);
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        Self(root)
    }

    fn path(&self) -> &std::path::Path {
        &self.0
    }
}

impl Drop for TestDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn write(dir: &std::path::Path, relative: &str, body: &str) -> PathBuf {
    let path = dir.join(relative);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).unwrap();
    }
    fs::write(&path, body).unwrap();
    path
}

/// canonical 形态的当前文档路径（AppState.current 存的正是它；纯逻辑层以入参为准）
fn canonical(path: &std::path::Path) -> PathBuf {
    dunce::canonicalize(path).unwrap()
}

fn rels(listing: &crate::library::LibraryListing) -> Vec<String> {
    listing.files.iter().map(|f| f.rel_path.clone()).collect()
}

#[test]
fn list_library_walker_skips_dot_dirs_node_modules_and_non_markdown() {
    let root = TestDir::new("vellum_library_list_test");
    write(root.path(), "a.md", "# a\n");
    write(root.path(), "notes/b.markdown", "b\n");
    write(root.path(), ".hidden/c.md", "c\n");
    write(root.path(), "node_modules/d.md", "d\n");
    write(root.path(), "readme.txt", "not markdown\n");
    write(root.path(), "assets/img.png", "fake\n");
    let current = canonical(&root.path().join("a.md"));

    let listing = list_library(&current).unwrap();

    let files = rels(&listing);
    assert_eq!(files, vec!["a.md".to_string(), "notes/b.markdown".to_string()]);
    assert!(!listing.is_vault);
    assert_eq!(listing.root_name, root.path().file_name().unwrap().to_string_lossy());
    assert!(!listing.truncated);
}

#[test]
fn list_library_prefers_vault_root_over_document_dir() {
    let root = TestDir::new("vellum_library_vault_root_test");
    fs::create_dir_all(root.path().join(".obsidian")).unwrap();
    write(root.path(), "index.md", "# 索引\n");
    write(root.path(), "deep/sub/note.md", "n\n");
    // 文档在深层目录：库根必须回退到含 .obsidian 的那一级，而不是文档目录
    let current = canonical(&root.path().join("deep/sub/note.md"));

    let listing = list_library(&current).unwrap();

    assert!(listing.is_vault);
    assert_eq!(listing.root, root.path().to_string_lossy());
    assert_eq!(rels(&listing), vec!["deep/sub/note.md", "index.md"]);
}

#[test]
fn search_is_case_insensitive_ascii_and_cjk() {
    let root = TestDir::new("vellum_library_search_case_test");
    write(root.path(), "a.md", "Hello world\n你好世界\n");
    write(root.path(), "b.md", "nothing here\n");
    let current = canonical(&root.path().join("a.md"));

    let ascii = search_library(&current, "hello").unwrap();
    assert_eq!(ascii.files.len(), 1);
    assert_eq!(ascii.files[0].matches.len(), 1);
    assert_eq!(ascii.files[0].matches[0].line, 1);

    let cjk = search_library(&current, "世界").unwrap();
    assert_eq!(cjk.files[0].matches[0].line, 2);
}

#[test]
fn search_case_folding_is_char_lowercase_not_unicode_folding() {
    let root = TestDir::new("vellum_library_search_fold_test");
    // 逐字符小写语义：ß 的小写仍是 ß（不折叠成 ss），SS 的大写反向也不展开。
    // 即「STRASSE 查 Straße」不命中（与前端 String.toLowerCase 同一套语义），
    // 但 ẞ（U+1E9E）→ ß 这类真·单字符小写照常命中。
    write(root.path(), "de.md", "Straße steht hier.\nFußball!\n");
    let current = canonical(&root.path().join("de.md"));

    let no_fold = search_library(&current, "STRASSE").unwrap();
    assert!(no_fold.files.is_empty());

    let sharp = search_library(&current, "straße").unwrap();
    assert_eq!(sharp.files[0].matches[0].line, 1);

    let capital_sharp = search_library(&current, "STRAẞE").unwrap();
    assert_eq!(capital_sharp.files[0].matches[0].line, 1);
}

#[test]
fn search_snippet_indices_are_char_offsets_around_cjk() {
    let root = TestDir::new("vellum_library_search_cjk_test");
    // CJK 字符占 1 char / 3 byte：matchStart/matchLen 必须是 char 索引而非字节索引
    write(root.path(), "cjk.md", "前面全是中文填充字符，关键字在这里。\n");
    let current = canonical(&root.path().join("cjk.md"));

    let result = search_library(&current, "关键字").unwrap();
    let m = &result.files[0].matches[0];
    let chars: Vec<char> = m.snippet.chars().collect();
    let hit: String = chars[m.match_start..m.match_start + m.match_len].iter().collect();
    assert_eq!(hit, "关键字");
    // 命中前字符数 ≤30，未触边界不加省略号
    assert!(!m.snippet.starts_with('…'));
}

#[test]
fn search_snippet_ellipsizes_when_window_is_cut() {
    let root = TestDir::new("vellum_library_search_ellipsis_test");
    let long_line = format!("{}needle{}", "x".repeat(80), "y".repeat(80));
    write(root.path(), "long.md", &format!("{long_line}\n"));
    let current = canonical(&root.path().join("long.md"));

    let result = search_library(&current, "needle").unwrap();
    let m = &result.files[0].matches[0];
    assert!(m.snippet.starts_with('…'));
    assert!(m.snippet.ends_with('…'));
    // 前 30 + 命中 6 + 后 60 + 两个省略号 = 98 chars
    assert_eq!(m.snippet.chars().count(), 98);
}

#[test]
fn search_caps_at_twenty_per_file() {
    let root = TestDir::new("vellum_library_search_cap_file_test");
    let body: String = (0..30).map(|_| "hit here\n").collect();
    write(root.path(), "many.md", &body);
    let current = canonical(&root.path().join("many.md"));

    let result = search_library(&current, "hit").unwrap();
    assert_eq!(result.files[0].matches.len(), 20);
    assert!(!result.truncated);
}

#[test]
fn search_caps_at_three_hundred_total_and_marks_truncated() {
    let root = TestDir::new("vellum_library_search_cap_total_test");
    // 25 篇 × 20 行命中 → 单文件帽 20，全库帽 300（第 16 篇起截断）
    for i in 0..25 {
        write(
            root.path(),
            &format!("f{i:02}.md"),
            &(0..20).map(|_| "hit\n").collect::<String>(),
        );
    }
    let current = canonical(&root.path().join("f00.md"));

    let result = search_library(&current, "hit").unwrap();
    let total: usize = result.files.iter().map(|f| f.matches.len()).sum();
    assert_eq!(total, 300);
    assert!(result.truncated);
    assert_eq!(result.files.len(), 15);
}

#[test]
fn search_empty_query_and_oversized_query() {
    let root = TestDir::new("vellum_library_search_edge_test");
    write(root.path(), "a.md", "content\n");
    let current = canonical(&root.path().join("a.md"));

    assert!(search_library(&current, "   ").unwrap().files.is_empty());
    assert!(search_library(&current, "").unwrap().files.is_empty());

    let long = "x".repeat(201);
    assert!(search_library(&current, &long).is_err());
    let exact = "x".repeat(200);
    assert!(search_library(&current, &exact).is_ok());
}

#[test]
fn backlinks_finds_alias_fragment_embed_and_md_suffix() {
    let root = TestDir::new("vellum_library_backlinks_test");
    write(root.path(), "current.md", "# 本篇\n");
    write(
        root.path(),
        "a.md",
        "见 [[current|本篇]] 与 [[current#开头]]。\n",
    );
    write(root.path(), "b.md", "嵌入 ![[current]] 与 [[current.md]]。\n");
    write(root.path(), "c.md", "无关 [[other]] 笔记。\n");
    let current = canonical(&root.path().join("current.md"));

    let backlinks = find_backlinks(&current).unwrap();

    let found: Vec<&str> = backlinks.iter().map(|f| f.rel_path.as_str()).collect();
    assert_eq!(found, vec!["a.md", "b.md"]);
    assert_eq!(backlinks[0].snippets.len(), 1);
    assert_eq!(backlinks[0].snippets[0].line, 1);
}

#[test]
fn backlinks_ignores_fenced_code_and_excludes_self() {
    let root = TestDir::new("vellum_library_backlinks_fence_test");
    // 当前文档自己也链自己：自引不算反链
    write(root.path(), "current.md", "见 [[current]] 自己。\n");
    write(
        root.path(),
        "code.md",
        "```md\n[[current]] 在围栏里\n```\n\n[[current]] 在围栏外\n~~~\n[[current]] 波浪围栏\n~~~\n",
    );
    let current = canonical(&root.path().join("current.md"));

    let backlinks = find_backlinks(&current).unwrap();

    assert_eq!(backlinks.len(), 1);
    assert_eq!(backlinks[0].rel_path, "code.md");
    // 只有「围栏外」那一行（第 5 行）
    assert_eq!(backlinks[0].snippets.len(), 1);
    assert_eq!(backlinks[0].snippets[0].line, 5);
}

#[test]
fn backlinks_slash_target_requires_path_suffix() {
    let root = TestDir::new("vellum_library_backlinks_slash_test");
    // 库根必须有 .obsidian：否则库根退化为文档目录（x/sub），链接文件根本不在库内
    fs::create_dir_all(root.path().join(".obsidian")).unwrap();
    // 当前文档 rel = x/sub/a.md → noext = x/sub/a
    write(root.path(), "x/sub/a.md", "# a\n");
    write(root.path(), "ok.md", "见 [[sub/a]] 与 [[x/sub/a]]。\n");
    // other/a 以 a 结尾但不是 x/sub/a 的后缀——不命中
    write(root.path(), "no.md", "见 [[other/a]] 与 [[z/other/a]]。\n");
    let current = canonical(&root.path().join("x/sub/a.md"));

    let backlinks = find_backlinks(&current).unwrap();

    assert_eq!(backlinks.len(), 1);
    assert_eq!(backlinks[0].rel_path, "ok.md");
    // 两条命中目标在同一行：该行只计一条摘录
    assert_eq!(backlinks[0].snippets.len(), 1);
}

#[test]
fn backlinks_slash_target_requires_segment_boundary() {
    let root = TestDir::new("vellum_library_backlinks_boundary_test");
    fs::create_dir_all(root.path().join(".obsidian")).unwrap();
    // rel = xsub/a.md → noext = xsub/a：ends_with("sub/a") 裸比会误中，
    // 段边界判据（「== 目标」或「以 /目标 结尾」）下必须不命中
    write(root.path(), "xsub/a.md", "# a\n");
    write(root.path(), "bad.md", "见 [[sub/a]]。\n");
    let current = canonical(&root.path().join("xsub/a.md"));

    let backlinks = find_backlinks(&current).unwrap();
    assert!(backlinks.is_empty());

    // 对照：目标恰好等于完整相对路径（库根直放）与真·目录后缀都该命中
    write(root.path(), "sub/a.md", "# a 根版\n");
    write(root.path(), "good1.md", "见 [[sub/a]] 根版。\n");
    write(root.path(), "good2.md", "见 [[x/sub/a]]。\n");
    write(root.path(), "x/sub/b.md", "# b\n");
    let current_root = canonical(&root.path().join("sub/a.md"));
    let root_hits = find_backlinks(&current_root).unwrap();
    assert_eq!(
        root_hits.iter().map(|f| f.rel_path.as_str()).collect::<Vec<_>>(),
        vec!["bad.md", "good1.md"]
    );
}

#[test]
fn backlinks_snippets_cap_at_five_per_file() {
    let root = TestDir::new("vellum_library_backlinks_cap_test");
    write(root.path(), "current.md", "# 本篇\n");
    let body: String = (1..=8).map(|i| format!("第{i}行链 [[current]]\n")).collect();
    write(root.path(), "ref.md", &body);
    let current = canonical(&root.path().join("current.md"));

    let backlinks = find_backlinks(&current).unwrap();
    assert_eq!(backlinks.len(), 1);
    assert_eq!(backlinks[0].snippets.len(), 5);
    assert_eq!(backlinks[0].snippets[0].line, 1);
    assert_eq!(backlinks[0].snippets[4].line, 5);
}
