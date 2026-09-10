use std::fs;
use std::path::PathBuf;

use crate::document::{
    load_markdown_file, resolve_asset_to_data_url, resolve_local_asset_path, AssetRef,
};

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

#[test]
fn load_markdown_file_reads_utf8_content() {
    let root = TestDir::new("kami_md_viewer_load_test");
    let file = root.path().join("note.md");
    fs::write(&file, "# 标题\n\n正文").unwrap();

    let doc = load_markdown_file(&file).unwrap();

    assert_eq!(doc.file_name, "note.md");
    assert_eq!(doc.parent_path, root.path().to_string_lossy());
    assert_eq!(doc.markdown, "# 标题\n\n正文");
}

#[test]
fn load_markdown_file_accepts_uppercase_extension() {
    let root = TestDir::new("kami_md_viewer_upper_ext_test");
    let file = root.path().join("NOTE.MD");
    fs::write(&file, "# Upper").unwrap();

    let doc = load_markdown_file(&file).unwrap();

    assert_eq!(doc.file_name, "NOTE.MD");
    assert_eq!(doc.markdown, "# Upper");
}

#[test]
fn load_markdown_file_rejects_non_markdown_files() {
    let root = TestDir::new("kami_md_viewer_ext_test");
    let file = root.path().join("note.txt");
    fs::write(&file, "# Title").unwrap();

    let result = load_markdown_file(&file);
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("Not a Markdown file"));
}

#[test]
fn load_markdown_file_rejects_missing_file() {
    let root = TestDir::new("kami_md_viewer_missing_test");
    let file = root.path().join("does-not-exist.md");

    let result = load_markdown_file(&file);
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("Cannot open file"));
}

#[test]
fn load_markdown_file_rejects_non_utf8_content() {
    let root = TestDir::new("kami_md_viewer_non_utf8_test");
    let file = root.path().join("binary.md");
    fs::write(&file, [0xff, 0xfe, 0x00, 0x01]).unwrap();

    let result = load_markdown_file(&file);
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("Cannot read UTF-8 Markdown"));
}

#[test]
fn resolve_local_asset_path_uses_anchor_directory() {
    let root = TestDir::new("kami_md_viewer_asset_test");
    let assets = root.path().join("assets");
    fs::create_dir_all(&assets).unwrap();
    let image = assets.join("demo.gif");
    fs::write(&image, b"gif").unwrap();

    let resolved = resolve_local_asset_path(root.path(), "assets/demo.gif").unwrap();

    assert_eq!(
        resolved,
        AssetRef::Local(dunce::canonicalize(&image).unwrap())
    );
}

#[test]
fn resolve_local_asset_path_keeps_remote_urls_unchanged() {
    let anchor = std::env::temp_dir();

    let resolved = resolve_local_asset_path(&anchor, "https://example.com/a.png").unwrap();

    assert_eq!(
        resolved,
        AssetRef::Remote("https://example.com/a.png".to_string())
    );
}

#[test]
fn resolve_local_asset_path_rejects_traversal() {
    let root = TestDir::new("kami_md_viewer_traversal_test");
    let docs = root.path().join("docs");
    fs::create_dir_all(&docs).unwrap();
    let markdown = docs.join("note.md");
    let secret = root.path().join("secret.png");
    fs::write(&markdown, "![demo](../secret.png)").unwrap();
    fs::write(&secret, b"png").unwrap();

    // `../secret.png` really exists, so canonicalize succeeds and only the
    // containment check can reject it.
    let resolved = resolve_local_asset_path(&docs, "../secret.png");
    assert!(resolved.is_err());
    assert!(resolved
        .unwrap_err()
        .contains("escapes the Markdown directory"));
}

#[test]
fn resolve_local_asset_path_rejects_percent_encoded_traversal() {
    let root = TestDir::new("kami_md_viewer_pct_traversal_test");
    let docs = root.path().join("docs");
    fs::create_dir_all(&docs).unwrap();
    let secret = root.path().join("secret.png");
    fs::write(&secret, b"png").unwrap();

    let resolved = resolve_local_asset_path(&docs, "..%2Fsecret.png");
    assert!(resolved.is_err());
    assert!(resolved
        .unwrap_err()
        .contains("escapes the Markdown directory"));
}

#[test]
fn resolve_local_asset_path_rejects_absolute_outside_directory() {
    let root = TestDir::new("kami_md_viewer_absolute_test");
    let outside = TestDir::new("kami_md_viewer_outside");
    let image = outside.path().join("secret.png");
    fs::write(&image, b"png").unwrap();

    let resolved = resolve_local_asset_path(root.path(), image.to_string_lossy().as_ref());
    assert!(resolved.is_err());
}

#[test]
fn resolve_asset_to_data_url_returns_base64_for_local_image() {
    let root = TestDir::new("kami_md_viewer_data_url_test");
    let assets = root.path().join("assets");
    fs::create_dir_all(&assets).unwrap();
    let image = assets.join("demo.gif");
    fs::write(&image, b"GIF89a").unwrap();

    let resolved = resolve_asset_to_data_url(root.path(), "assets/demo.gif").unwrap();

    assert!(resolved.starts_with("data:image/gif;base64,"));
}

#[test]
fn resolve_asset_to_data_url_keeps_remote_urls_unchanged() {
    let anchor = std::env::temp_dir();

    let resolved = resolve_asset_to_data_url(&anchor, "https://example.com/a.png").unwrap();

    assert_eq!(resolved, "https://example.com/a.png");
}

#[test]
fn resolve_asset_to_data_url_keeps_data_urls_unchanged() {
    let anchor = std::env::temp_dir();

    let resolved = resolve_asset_to_data_url(&anchor, "data:image/png;base64,abc").unwrap();

    assert_eq!(resolved, "data:image/png;base64,abc");
}

mod save_tests {
    use super::*;
    use crate::document::{
        check_save_gates, save_markdown_file, save_temp_path, MAX_FILE_SIZE_BYTES,
    };

    fn write_markdown(dir: &TestDir, name: &str, body: &str) -> PathBuf {
        let path = dir.path().join(name);
        fs::write(&path, body).unwrap();
        path
    }

    fn temp_leftovers(dir: &TestDir) -> Vec<String> {
        fs::read_dir(dir.path())
            .unwrap()
            .filter_map(|entry| entry.ok())
            .map(|entry| entry.file_name().to_string_lossy().to_string())
            .filter(|name| name.contains("vellum-tmp"))
            .collect()
    }

    #[test]
    fn writes_content_and_reports_size() {
        let dir = TestDir::new("vellum_save_write");
        let path = write_markdown(&dir, "a.md", "旧内容\n");

        let outcome = save_markdown_file(&path, "新内容\n").unwrap();

        assert_eq!(fs::read_to_string(&path).unwrap(), "新内容\n");
        assert_eq!(outcome.bytes_written, "新内容\n".len());
        assert_eq!(
            outcome.path,
            dunce::canonicalize(&path).unwrap().to_string_lossy()
        );
    }

    #[test]
    fn preserves_crlf_line_endings() {
        let dir = TestDir::new("vellum_save_crlf");
        let path = write_markdown(&dir, "b.md", "第一行\r\n第二行\r\n");

        save_markdown_file(&path, "甲\n乙\n").unwrap();

        assert_eq!(fs::read_to_string(&path).unwrap(), "甲\r\n乙\r\n");
    }

    #[test]
    fn does_not_introduce_crlf_into_lf_files() {
        let dir = TestDir::new("vellum_save_lf");
        let path = write_markdown(&dir, "c.md", "一行\n二行\n");

        save_markdown_file(&path, "甲\n乙\n").unwrap();

        assert_eq!(fs::read_to_string(&path).unwrap(), "甲\n乙\n");
    }

    #[test]
    fn does_not_double_convert_crlf_content() {
        let dir = TestDir::new("vellum_save_crlf_roundtrip");
        let path = write_markdown(&dir, "g.md", "一\r\n二\r\n");

        // 前端 textarea 归一后应给 LF，但即便给出 CRLF 也不得变成 \r\r\n
        save_markdown_file(&path, "甲\r\n乙\r\n").unwrap();

        assert_eq!(fs::read_to_string(&path).unwrap(), "甲\r\n乙\r\n");
    }

    #[test]
    fn preserves_utf8_bom() {
        let dir = TestDir::new("vellum_save_bom");
        let path = write_markdown(&dir, "d.md", "\u{FEFF}原文\n");

        save_markdown_file(&path, "\u{FEFF}改后\n").unwrap();

        assert!(fs::read_to_string(&path).unwrap().starts_with('\u{FEFF}'));
    }

    #[test]
    fn rejects_non_markdown_extension() {
        let dir = TestDir::new("vellum_save_ext");
        let path = write_markdown(&dir, "e.txt", "x\n");

        let error = save_markdown_file(&path, "y\n").unwrap_err();

        assert!(error.contains("Not a Markdown file"), "{error}");
        assert_eq!(fs::read_to_string(&path).unwrap(), "x\n");
        assert!(temp_leftovers(&dir).is_empty());
    }

    #[test]
    fn rejects_oversized_content_without_touching_the_file() {
        let dir = TestDir::new("vellum_save_oversize");
        let path = write_markdown(&dir, "h.md", "原文\n");
        let oversized = "a".repeat((MAX_FILE_SIZE_BYTES + 1) as usize);

        let error = save_markdown_file(&path, &oversized).unwrap_err();

        assert!(error.contains("content too large"), "{error}");
        assert_eq!(fs::read_to_string(&path).unwrap(), "原文\n");
        assert!(temp_leftovers(&dir).is_empty(), "{error}");
    }

    #[test]
    fn leaves_no_temp_file_behind() {
        let dir = TestDir::new("vellum_save_temp");
        let path = write_markdown(&dir, "f.md", "x\n");

        save_markdown_file(&path, "y\n").unwrap();

        let leftovers = temp_leftovers(&dir);
        assert!(leftovers.is_empty(), "残留临时文件: {leftovers:?}");
    }

    #[test]
    fn rejects_save_when_existing_content_cannot_be_read() {
        let dir = TestDir::new("vellum_save_unreadable");
        let path = write_markdown(&dir, "n.md", "原文\n");
        // 真机上「读旧内容失败」唯一可达的构造：文档加载后文件被外部进程改成非 UTF-8。
        // 此时读失败（InvalidData）而 rename 只需 DELETE 权限仍可能成功 ⇒ 若降级为 LF
        // 会把 CRLF 文档整篇翻新。这里锁定「拒绝保存」这个方向。
        let invalid_utf8 = [0x23u8, 0x20, 0xFF, 0xFE];
        fs::write(&path, invalid_utf8).unwrap();

        let error = save_markdown_file(&path, "新内容\n").unwrap_err();

        assert!(error.contains("Cannot read existing document"), "{error}");
        assert_eq!(fs::read(&path).unwrap(), invalid_utf8, "原文件不得被改写");
        assert!(temp_leftovers(&dir).is_empty());
    }

    #[test]
    fn temp_path_is_unique_per_call_and_stays_next_to_the_target() {
        let dir = TestDir::new("vellum_save_temp_unique");
        let canonical = dunce::canonicalize(write_markdown(&dir, "u.md", "x\n")).unwrap();

        let mut seen = std::collections::HashSet::new();
        for _ in 0..256 {
            let temp = save_temp_path(&canonical).unwrap();

            assert_eq!(temp.parent(), canonical.parent());
            assert_ne!(temp, canonical);
            let name = temp.file_name().unwrap().to_string_lossy().to_string();
            assert!(name.starts_with(".u.md."), "{name}");
            assert!(name.ends_with(".vellum-tmp"), "{name}");
            assert!(seen.insert(temp), "临时路径重复（并发保存会互踩）: {name}");
        }
    }

    #[test]
    fn gate_rejects_path_that_is_not_the_current_document() {
        let dir = TestDir::new("vellum_save_gate_path");
        let path = write_markdown(&dir, "i.md", "x\n");
        let canonical = dunce::canonicalize(&path).unwrap();
        let other = dunce::canonicalize(write_markdown(&dir, "j.md", "y\n")).unwrap();

        let error = check_save_gates(Some(other.as_path()), &canonical, false).unwrap_err();

        assert!(error.contains("currently loaded document"), "{error}");
    }

    #[test]
    fn gate_rejects_when_no_document_is_loaded() {
        let dir = TestDir::new("vellum_save_gate_none");
        let canonical = dunce::canonicalize(write_markdown(&dir, "k.md", "x\n")).unwrap();

        let error = check_save_gates(None, &canonical, false).unwrap_err();

        assert!(error.contains("currently loaded document"), "{error}");
    }

    #[test]
    fn gate_rejects_while_a_live_mdlog_sidecar_exists() {
        let dir = TestDir::new("vellum_save_gate_mdlog");
        let path = write_markdown(&dir, "l.md", "x\n");
        let canonical = dunce::canonicalize(&path).unwrap();
        let now = 1_000_000u64;
        let sidecar = crate::watcher::sidecar_path_for(&canonical);
        fs::write(
            &sidecar,
            r#"{"pid": 4321, "lastWriteAt": 1000000, "heartbeatAt": 1000000}"#,
        )
        .unwrap();

        // 与 read_mdlog_state 命令同一判定链：进程存活 + 心跳未超时 ⇒ 记录中
        let mdlog_active = crate::widget::read_mdlog_state_from_path(
            Some(&canonical),
            &|_pid: u32| true,
            now,
        )
        .is_some();
        assert!(mdlog_active, "前置条件：存活 sidecar 必须判定为记录中");

        let error = check_save_gates(Some(&canonical), &canonical, mdlog_active).unwrap_err();

        assert!(error.contains("mdlog 记录中"), "{error}");
    }

    #[test]
    fn gate_allows_current_document_without_mdlog_record() {
        let dir = TestDir::new("vellum_save_gate_ok");
        let canonical = dunce::canonicalize(write_markdown(&dir, "m.md", "x\n")).unwrap();

        assert!(check_save_gates(Some(&canonical), &canonical, false).is_ok());
    }
}
