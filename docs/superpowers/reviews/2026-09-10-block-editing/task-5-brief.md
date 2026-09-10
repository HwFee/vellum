### Task 5: Rust `save_document`（原子写 + EOL 保真 + 双闸门）

**Files:**
- Modify: `src-tauri/src/document.rs`
- Modify: `src-tauri/src/document_tests.rs`
- Modify: `src-tauri/src/main.rs`（命令 + `invoke_handler` 注册）

**Interfaces:**
- Consumes: `read_mdlog_state_from_path` / `is_pid_alive_win32`（`widget.rs` 现成纯函数）
- Produces:
  ```rust
  #[derive(Debug, Clone, serde::Serialize)]
  #[serde(rename_all = "camelCase")]
  pub struct SaveOutcome { pub path: String, pub bytes_written: usize }
  pub fn save_markdown_file(path: &Path, content: &str) -> Result<SaveOutcome, String>;
  // Tauri 命令
  // save_document(path: String, content: String) -> Result<SaveOutcome, String>
  ```

- [ ] **Step 1: 写失败测试**

```rust
// 追加到 src-tauri/src/document_tests.rs
mod save_tests {
    use super::*;
    use crate::document::save_markdown_file;

    fn write_markdown(dir: &TestDir, name: &str, body: &str) -> PathBuf {
        let path = dir.path().join(name);
        fs::write(&path, body).unwrap();
        path
    }

    #[test]
    fn writes_content_and_reports_size() {
        let dir = TestDir::new("vellum_save_write");
        let path = write_markdown(&dir, "a.md", "旧内容\n");

        let outcome = save_markdown_file(&path, "新内容\n").unwrap();

        assert_eq!(fs::read_to_string(&path).unwrap(), "新内容\n");
        assert_eq!(outcome.bytes_written, "新内容\n".len());
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

        assert!(save_markdown_file(&path, "y\n").is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), "x\n");
    }

    #[test]
    fn leaves_no_temp_file_behind() {
        let dir = TestDir::new("vellum_save_temp");
        let path = write_markdown(&dir, "f.md", "x\n");

        save_markdown_file(&path, "y\n").unwrap();

        let leftovers: Vec<_> = fs::read_dir(dir.path())
            .unwrap()
            .filter_map(|entry| entry.ok())
            .map(|entry| entry.file_name().to_string_lossy().to_string())
            .filter(|name| name.contains("vellum-tmp"))
            .collect();
        assert!(leftovers.is_empty(), "残留临时文件: {leftovers:?}");
    }
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd src-tauri && cargo test save_tests`
Expected: FAIL —— `cannot find function save_markdown_file`

- [ ] **Step 3: 实现写入函数**

```rust
// 追加到 src-tauri/src/document.rs

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveOutcome {
    pub path: String,
    pub bytes_written: usize,
}

/// 原文件的主导换行风格：出现 CRLF 即按 CRLF 处理，否则 LF。
fn dominant_eol(existing: &str) -> &'static str {
    if existing.contains("\r\n") {
        "\r\n"
    } else {
        "\n"
    }
}

/// 把入参统一成 LF 再套用目标换行风格 —— textarea 会把 CRLF 归一成 LF，
/// 若不还原，一次提交就把整篇文档的换行符翻新。
fn apply_eol(content: &str, eol: &str) -> String {
    let normalized = content.replace("\r\n", "\n").replace('\r', "\n");
    if eol == "\r\n" {
        normalized.replace('\n', "\r\n")
    } else {
        normalized
    }
}

pub fn save_markdown_file(path: &Path, content: &str) -> Result<SaveOutcome, String> {
    let canonical =
        dunce::canonicalize(path).map_err(|error| format!("Cannot open file: {error}"))?;

    if !canonical.is_file() {
        return Err(format!("Path is not a file: {}", canonical.display()));
    }
    if !is_markdown_extension(&canonical) {
        return Err(format!("Not a Markdown file: {}", canonical.display()));
    }
    if content.len() as u64 > MAX_FILE_SIZE_BYTES {
        return Err(format!(
            "content too large: {} bytes (max {} bytes)",
            content.len(),
            MAX_FILE_SIZE_BYTES
        ));
    }

    let existing = std::fs::read_to_string(&canonical).unwrap_or_default();
    let payload = apply_eol(content, dominant_eol(&existing));

    let file_name = canonical
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "Cannot resolve file name".to_string())?;
    let temp_path = canonical.with_file_name(format!(".{file_name}.vellum-tmp"));

    std::fs::write(&temp_path, payload.as_bytes())
        .map_err(|error| format!("Cannot write temporary file: {error}"))?;

    if let Err(error) = std::fs::rename(&temp_path, &canonical) {
        let _ = std::fs::remove_file(&temp_path);
        return Err(format!("Cannot replace document: {error}"));
    }

    Ok(SaveOutcome {
        path: canonical.to_string_lossy().to_string(),
        bytes_written: payload.len(),
    })
}
```

- [ ] **Step 4: 加命令与双闸门**

```rust
// 追加到 src-tauri/src/main.rs
#[tauri::command]
async fn save_document(
    path: String,
    content: String,
    state: tauri::State<'_, AppState>,
) -> Result<document::SaveOutcome, String> {
    let canonical = dunce::canonicalize(Path::new(&path))
        .map_err(|error| format!("Cannot open file: {error}"))?;

    // 闸门 1：只允许写当前已加载的文档
    let current = state
        .current
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .clone();
    match current {
        Some(expected) if expected == canonical => {}
        _ => return Err("Only the currently loaded document can be saved".to_string()),
    }

    // 闸门 2：mdlog 记录中拒绝写入（前端门禁之外的服务端兜底）
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0);
    if vellum_lib::widget::read_mdlog_state_from_path(
        Some(&canonical),
        &vellum_lib::widget::is_pid_alive_win32,
        now,
    )
    .is_some()
    {
        return Err("mdlog 记录中：断开连接后才能修改".to_string());
    }

    document::save_markdown_file(&canonical, &content)
}
```

并在 `invoke_handler` 列表里 `resolve_asset,` 之后加一行 `save_document,`。

- [ ] **Step 5: 跑测试确认通过**

Run: `cd src-tauri && cargo test`
Expected: PASS（含新增 6 用例，原有全绿）

- [ ] **Step 6: 提交**

```bash
cd src-tauri && cargo test && cd .. && npx tsc --noEmit
git add src-tauri/src/document.rs src-tauri/src/document_tests.rs src-tauri/src/main.rs
git commit -m "feat(edit): save_document 命令（原子写 + EOL/BOM 保真 + 当前文档与 mdlog 双闸门）"
```

---

