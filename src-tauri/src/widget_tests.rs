use crate::widget::{
    build_widget_response, cleanup_stale_sidecar_if_dead, judge_mdlog_alive,
    read_mdlog_state_from_path, should_cleanup_stale_sidecar, MdlogSidecarData, MdlogStateResponse,
    RegisterResult, WidgetRegistry, WidgetState, HEARTBEAT_TIMEOUT_MS, MAX_REGISTRY_CAPACITY,
    MAX_WIDGET_HTML_BYTES,
};
use std::fs;
use std::path::PathBuf;

#[test]
fn registry_rejects_html_exceeding_512kb() {
    let mut registry = WidgetRegistry::default();
    let oversized = "a".repeat(MAX_WIDGET_HTML_BYTES + 1);
    let result = registry.insert("oversized-id".to_string(), oversized);

    assert!(result.is_err());
    assert_eq!(
        result.unwrap_err(),
        "Widget HTML exceeds maximum size of 512KB"
    );
    assert_eq!(registry.len(), 0);
}

#[test]
fn registry_evicts_lru_entry_when_exceeding_64_entries() {
    let mut registry = WidgetRegistry::default();

    // 填满 64 条 (widget-0 .. widget-63)
    for i in 0..MAX_REGISTRY_CAPACITY {
        let id = format!("widget-{i}");
        let html = format!("<div>widget {i}</div>");
        registry.insert(id, html).expect("insert within capacity");
    }
    assert_eq!(registry.len(), MAX_REGISTRY_CAPACITY);

    // 访问 widget-0，将其提鲜至最新位置（成真 LRU，S1）
    assert!(registry.get("widget-0").is_some());

    // 插入第 65 条，此时最旧项为 widget-1，应当淘汰 widget-1，保留被提鲜的 widget-0
    registry
        .insert("widget-64".to_string(), "<div>widget 64</div>".to_string())
        .expect("insert 65th item");

    assert_eq!(registry.len(), MAX_REGISTRY_CAPACITY);
    assert!(registry.peek("widget-1").is_none());
    assert!(registry.peek("widget-0").is_some());
    assert!(registry.peek("widget-64").is_some());
}

#[test]
fn register_result_serializes_to_camel_case() {
    let res = RegisterResult {
        id: "abc-123".to_string(),
        url: "http://vellum-widget.localhost/abc-123".to_string(),
    };
    let json = serde_json::to_string(&res).unwrap();
    assert!(json.contains("\"id\":\"abc-123\""));
    assert!(json.contains("\"url\":\"http://vellum-widget.localhost/abc-123\""));
}

fn assert_all_security_headers(response: &tauri::http::Response<Vec<u8>>) {
    assert_eq!(
        response.headers().get("Content-Type").unwrap(),
        "text/html; charset=utf-8"
    );
    assert_eq!(
        response.headers().get("Content-Security-Policy").unwrap(),
        "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:"
    );
    assert_eq!(
        response.headers().get("X-Content-Type-Options").unwrap(),
        "nosniff"
    );
    assert_eq!(response.headers().get("Cache-Control").unwrap(), "no-store");
}

#[test]
fn build_widget_response_returns_200_with_all_4_security_headers() {
    let mut registry = WidgetRegistry::default();
    registry
        .insert("test-id".to_string(), "<h1>Hello</h1>".to_string())
        .unwrap();

    let response = build_widget_response(
        "GET",
        "http://vellum-widget.localhost/test-id",
        &mut registry,
    );

    assert_eq!(response.status().as_u16(), 200);
    assert_all_security_headers(&response);
    assert_eq!(response.body(), b"<h1>Hello</h1>");
}

#[test]
fn build_widget_response_returns_404_with_all_4_security_headers_for_unknown_or_invalid() {
    let mut registry = WidgetRegistry::default();

    // 1. 未知 id
    let resp_404 = build_widget_response(
        "GET",
        "vellum-widget://localhost/non-existent",
        &mut registry,
    );
    assert_eq!(resp_404.status().as_u16(), 404);
    assert_all_security_headers(&resp_404);

    // 2. 非 GET 请求拒绝为 404
    let resp_post = build_widget_response(
        "POST",
        "http://vellum-widget.localhost/test-id",
        &mut registry,
    );
    assert_eq!(resp_post.status().as_u16(), 404);
    assert_all_security_headers(&resp_post);

    // 3. 越界或非法多段路径
    let resp_traversal = build_widget_response(
        "GET",
        "http://vellum-widget.localhost/id/extra/path",
        &mut registry,
    );
    assert_eq!(resp_traversal.status().as_u16(), 404);
    assert_all_security_headers(&resp_traversal);
}

#[test]
fn build_widget_response_rejects_boundary_uris_as_404() {
    let mut registry = WidgetRegistry::default();
    registry
        .insert("test-id".to_string(), "<h1>Hello</h1>".to_string())
        .unwrap();

    // 1. 无路径 URI: http://vellum-widget.localhost
    let resp_no_path =
        build_widget_response("GET", "http://vellum-widget.localhost", &mut registry);
    assert_eq!(resp_no_path.status().as_u16(), 404);
    assert_all_security_headers(&resp_no_path);

    // 2. 仅根路径: http://vellum-widget.localhost/
    let resp_root = build_widget_response("GET", "http://vellum-widget.localhost/", &mut registry);
    assert_eq!(resp_root.status().as_u16(), 404);
    assert_all_security_headers(&resp_root);

    // 3. 编码遍历: http://vellum-widget.localhost/%2e%2e%2f%2e%2e%2fwindows
    let resp_encoded_traversal = build_widget_response(
        "GET",
        "http://vellum-widget.localhost/%2e%2e%2f%2e%2e%2fwindows",
        &mut registry,
    );
    assert_eq!(resp_encoded_traversal.status().as_u16(), 404);
    assert_all_security_headers(&resp_encoded_traversal);
}

#[test]
fn judge_mdlog_alive_matrix_and_pid_fallback_evaluation() {
    let sidecar = MdlogSidecarData {
        version: Some(1),
        session_id: Some("sess-1".to_string()),
        pid: 9999,
        connected_at: Some(1000),
        last_write_at: 1000,
        heartbeat_at: 100_000,
        anchor_lost: Some(false),
    };

    // 1. pid 存活 且 心跳正常（相差 50s <= 120s） -> true
    let alive = judge_mdlog_alive(&sidecar, 150_000, &|pid| pid == 9999);
    assert!(alive);

    // 2. pid 存活 但 心跳超时（相差 120_001ms > 120s） -> false
    let timeout = judge_mdlog_alive(&sidecar, 220_001, &|pid| pid == 9999);
    assert!(!timeout);

    // 3. pid 已死 且 心跳正常 -> false
    let dead_pid = judge_mdlog_alive(&sidecar, 150_000, &|_pid| false);
    assert!(!dead_pid);

    // 4. pid 已死 且 心跳超时 -> false
    let dead_both = judge_mdlog_alive(&sidecar, 250_000, &|_pid| false);
    assert!(!dead_both);

    // 5. 时钟回拨加固（now < heartbeat_at）：直接返回 false，防止回拨误判为存活（S7）
    let clock_rollback = judge_mdlog_alive(&sidecar, 90_000, &|pid| pid == 9999);
    assert!(!clock_rollback);

    // 6. 原生 Win32 进程存活检查：自身 pid 必须为 true（正例 W3）；不存在的 pid 必须返回 false（A1）
    #[cfg(windows)]
    {
        assert!(crate::widget::is_pid_alive_win32(std::process::id()));
        assert!(!crate::widget::is_pid_alive_win32(u32::MAX));
    }
}

#[test]
fn uuid_generation_entropy_and_format_check() {
    use std::collections::HashSet;
    let mut ids = HashSet::new();
    for _ in 0..1000 {
        let id = uuid::Uuid::new_v4().to_string();
        assert_eq!(id.len(), 36);
        assert_eq!(id.chars().nth(14), Some('4')); // RFC 4122 v4 version
        let variant = id.chars().nth(19).unwrap();
        assert!(matches!(variant, '8' | '9' | 'a' | 'b')); // RFC 4122 variant
        assert!(ids.insert(id), "UUID collision detected!");
    }
}

#[test]
fn read_mdlog_state_returns_none_when_current_doc_is_none() {
    let result = read_mdlog_state_from_path(None, &|_| true, 100_000);
    assert_eq!(result, None);
}

#[test]
fn read_mdlog_state_returns_none_when_sidecar_file_does_not_exist() {
    let temp_doc = std::env::temp_dir().join("test_non_existent_doc.md");
    let result = read_mdlog_state_from_path(Some(&temp_doc), &|_| true, 100_000);
    assert_eq!(result, None);
}

#[test]
fn read_mdlog_state_returns_none_for_corrupted_json() {
    let temp_doc = std::env::temp_dir().join("test_corrupted_doc.md");
    let temp_sidecar = std::env::temp_dir().join("test_corrupted_doc.md.mdlog");
    fs::write(&temp_sidecar, "{ corrupted json").unwrap();

    let result = read_mdlog_state_from_path(Some(&temp_doc), &|_| true, 100_000);
    let _ = fs::remove_file(&temp_sidecar);

    assert_eq!(result, None);
}

#[test]
fn read_mdlog_state_reads_valid_sidecar_and_computes_expires_at() {
    let temp_doc = std::env::temp_dir().join("test_valid_doc.md");
    let temp_sidecar = std::env::temp_dir().join("test_valid_doc.md.mdlog");

    let sidecar_json = r#"{
        "version": 1,
        "sessionId": "pi-test-session",
        "pid": 4321,
        "connectedAt": 1000,
        "lastWriteAt": 50000,
        "heartbeatAt": 60000,
        "anchorLost": false
    }"#;
    fs::write(&temp_sidecar, sidecar_json).unwrap();

    // 当前时间 70_000（心跳过去 10s <= 120s，pid 存活）
    let result = read_mdlog_state_from_path(Some(&temp_doc), &|pid| pid == 4321, 70_000);
    let _ = fs::remove_file(&temp_sidecar);

    assert_eq!(
        result,
        Some(MdlogStateResponse {
            last_write_at: 50000,
            heartbeat_at: 60000,
            expires_at: 180_000, // 60000 + 120_000
        })
    );
}

#[test]
fn read_mdlog_state_returns_none_when_heartbeat_expired_or_pid_dead() {
    let temp_doc = std::env::temp_dir().join("test_expired_doc.md");
    let temp_sidecar = std::env::temp_dir().join("test_expired_doc.md.mdlog");

    let sidecar_json = r#"{
        "pid": 4321,
        "lastWriteAt": 50000,
        "heartbeatAt": 60000
    }"#;
    fs::write(&temp_sidecar, sidecar_json).unwrap();

    // 1. 超时测试：当前时间 180_001（心跳相差 120_001ms > 120s）
    let res_expired = read_mdlog_state_from_path(Some(&temp_doc), &|pid| pid == 4321, 180_001);
    assert_eq!(res_expired, None);

    // 2. pid 死亡测试：pid_alive 返回 false
    let res_dead = read_mdlog_state_from_path(Some(&temp_doc), &|_| false, 70_000);
    assert_eq!(res_dead, None);

    let _ = fs::remove_file(&temp_sidecar);
}

/// 构造一份仅 pid / heartbeatAt 可变的 sidecar 数据，供清理判据测试复用。
fn sidecar_data(pid: u32, heartbeat_at: u64) -> MdlogSidecarData {
    MdlogSidecarData {
        version: Some(1),
        session_id: Some("sess-cleanup".to_string()),
        pid,
        connected_at: Some(heartbeat_at.saturating_sub(10_000)),
        last_write_at: heartbeat_at,
        heartbeat_at,
        anchor_lost: Some(false),
    }
}

/// 在临时目录创建唯一的一对 `<文档>.md` 与 `<文档>.md.mdlog` 路径（uuid 保证并行测试互不撞名）。
fn temp_doc_and_sidecar(tag: &str) -> (PathBuf, PathBuf) {
    let doc = std::env::temp_dir().join(format!(
        "vellum_sidecar_cleanup_{tag}_{}.md",
        uuid::Uuid::new_v4()
    ));
    let sidecar = crate::watcher::sidecar_path_for(&doc);
    (doc, sidecar)
}

fn write_sidecar(path: &PathBuf, data: &MdlogSidecarData) {
    fs::write(path, serde_json::to_string(data).unwrap()).unwrap();
}

#[test]
fn should_cleanup_stale_sidecar_matrix_covers_pid_heartbeat_and_clock_rollback() {
    let hb = 100_000_u64;
    let alive_pid = |pid: u32| pid == 9999;
    let dead_pid = |_pid: u32| false;

    // 1. pid 已死 + 心跳新鲜 -> true（进程被强杀，属残留，可清理）
    assert!(should_cleanup_stale_sidecar(
        &sidecar_data(9999, hb),
        110_000,
        &dead_pid
    ));

    // 2. pid 已死 + 心跳超时 -> true
    assert!(should_cleanup_stale_sidecar(
        &sidecar_data(9999, hb),
        250_000,
        &dead_pid
    ));

    // 3. pid 存活 + 心跳新鲜 -> false（正在记录，绝不删除）
    assert!(!should_cleanup_stale_sidecar(
        &sidecar_data(9999, hb),
        110_000,
        &alive_pid
    ));

    // 4. pid 存活 + 心跳彻底超时 -> true（进程僵死 / 心跳写入器停摆）
    assert!(should_cleanup_stale_sidecar(
        &sidecar_data(9999, hb),
        220_001,
        &alive_pid
    ));

    // 5. 时钟回拨（heartbeat_at > now）+ pid 存活 -> false（刻意保留，宁可不删活会话状态）
    assert!(!should_cleanup_stale_sidecar(
        &sidecar_data(9999, hb),
        90_000,
        &alive_pid
    ));
}

#[test]
fn should_cleanup_stale_sidecar_boundary_only_exceeding_timeout_counts_as_stale() {
    let hb = 100_000_u64;
    let alive_pid = |pid: u32| pid == 9999;

    // 心跳刚刚写入 -> false
    assert!(!should_cleanup_stale_sidecar(
        &sidecar_data(9999, hb),
        hb,
        &alive_pid
    ));

    // now - heartbeat_at 恰好等于 120_000（阈值内）-> false，必须「超过」才算超时
    assert!(!should_cleanup_stale_sidecar(
        &sidecar_data(9999, hb),
        hb + HEARTBEAT_TIMEOUT_MS,
        &alive_pid
    ));

    // 再多 1ms -> true
    assert!(should_cleanup_stale_sidecar(
        &sidecar_data(9999, hb),
        hb + HEARTBEAT_TIMEOUT_MS + 1,
        &alive_pid
    ));
}

#[test]
fn should_cleanup_stale_sidecar_is_complementary_to_judge_mdlog_alive_except_clock_rollback() {
    let hb = 500_000_u64;
    let cases: [(u64, bool); 4] = [
        (hb, true),                            // 刚写入心跳
        (hb + HEARTBEAT_TIMEOUT_MS, true),     // 阈值边界（未超时）
        (hb + HEARTBEAT_TIMEOUT_MS + 1, true), // 彻底超时
        (hb + 10_000, false),                  // 心跳新鲜但 pid 已死
    ];

    for (now, pid_alive) in cases {
        let data = sidecar_data(9999, hb);
        let alive = judge_mdlog_alive(&data, now, &|_| pid_alive);
        let stale = should_cleanup_stale_sidecar(&data, now, &|_| pid_alive);
        assert_ne!(
            alive, stale,
            "now={now}, pid_alive={pid_alive}: 判活与判残留必须互斥"
        );
    }

    // 唯一例外：时钟回拨（heartbeat_at > now）时两侧都判 false，此时刻意保留不删
    let rollback = sidecar_data(9999, hb);
    assert!(!judge_mdlog_alive(&rollback, hb - 1, &|_| true));
    assert!(!should_cleanup_stale_sidecar(&rollback, hb - 1, &|_| true));
}

#[test]
fn cleanup_stale_sidecar_removes_heartbeat_expired_file_and_keeps_live_one() {
    // 固定假时钟（毫秒），避免真实时间抖动导致用例不稳定
    let now = 1_700_000_000_000_u64;

    // A. 心跳彻底超时（now - heartbeat_at > 120s）-> 判残留并删除
    let (doc_a, sidecar_a) = temp_doc_and_sidecar("expired");
    fs::write(&doc_a, "# expired").unwrap();
    write_sidecar(
        &sidecar_a,
        &sidecar_data(std::process::id(), now - HEARTBEAT_TIMEOUT_MS - 1),
    );
    assert!(sidecar_a.is_file());
    assert!(cleanup_stale_sidecar_if_dead(&sidecar_a, now));
    assert!(!sidecar_a.exists());

    // B. 自身 pid + 新鲜心跳 -> 活会话，绝不删除
    let (doc_b, sidecar_b) = temp_doc_and_sidecar("live");
    fs::write(&doc_b, "# live").unwrap();
    write_sidecar(&sidecar_b, &sidecar_data(std::process::id(), now));
    assert!(!cleanup_stale_sidecar_if_dead(&sidecar_b, now));
    assert!(sidecar_b.is_file());

    let _ = fs::remove_file(doc_a);
    let _ = fs::remove_file(doc_b);
    let _ = fs::remove_file(sidecar_b);
}

#[test]
#[cfg(windows)]
fn cleanup_stale_sidecar_removes_dead_pid_file_even_with_fresh_heartbeat() {
    // 仅 Windows 有意义：非 Windows 分支的 is_pid_alive_win32 是恒 true 存根。
    let now = 1_700_000_000_000_u64;
    let dead_pid = u32::MAX - 1;
    assert!(!crate::widget::is_pid_alive_win32(dead_pid));

    let (doc, sidecar) = temp_doc_and_sidecar("deadpid");
    fs::write(&doc, "# deadpid").unwrap();
    write_sidecar(&sidecar, &sidecar_data(dead_pid, now));

    // 心跳新鲜但进程已不存在（终端被强杀的典型形态）-> 仍判残留并删除
    assert!(cleanup_stale_sidecar_if_dead(&sidecar, now));
    assert!(!sidecar.exists());

    let _ = fs::remove_file(doc);
}

#[test]
fn cleanup_stale_sidecar_is_best_effort_on_missing_or_unparsable_file() {
    let now = 1_700_000_000_000_u64;

    // 1. 文件不存在 -> false，不 panic
    let missing = std::env::temp_dir().join(format!(
        "vellum_sidecar_missing_{}.mdlog",
        uuid::Uuid::new_v4()
    ));
    assert!(!cleanup_stale_sidecar_if_dead(&missing, now));

    let (doc, sidecar) = temp_doc_and_sidecar("unparsable");
    fs::write(&doc, "# unparsable").unwrap();

    // 2. JSON 损坏 -> false，文件原样保留
    fs::write(&sidecar, "{ corrupted json").unwrap();
    assert!(!cleanup_stale_sidecar_if_dead(&sidecar, now));
    assert!(sidecar.is_file());

    // 3. JSON 合法但缺 pid / heartbeatAt 必填字段 -> false，文件原样保留
    fs::write(&sidecar, r#"{"lastWriteAt":1}"#).unwrap();
    assert!(!cleanup_stale_sidecar_if_dead(&sidecar, now));
    assert!(sidecar.is_file());

    let _ = fs::remove_file(sidecar);
    let _ = fs::remove_file(doc);
}

#[test]
fn read_mdlog_state_from_path_stays_side_effect_free_deferring_cleanup_to_command_layer() {
    let now = 1_700_000_000_000_u64;
    let (doc, sidecar) = temp_doc_and_sidecar("purity");
    fs::write(&doc, "# purity").unwrap();
    write_sidecar(
        &sidecar,
        &sidecar_data(u32::MAX - 1, now - HEARTBEAT_TIMEOUT_MS - 1),
    );

    // 纯函数只仲裁状态，绝不产生删除副作用
    assert_eq!(
        read_mdlog_state_from_path(Some(&doc), &|_| false, now),
        None
    );
    assert!(
        sidecar.is_file(),
        "read_mdlog_state_from_path 必须保持纯净：清理只允许发生在命令层"
    );

    // 命令层的清理钩子负责真正删除
    assert!(cleanup_stale_sidecar_if_dead(&sidecar, now));
    assert!(!sidecar.exists());

    let _ = fs::remove_file(doc);
}

#[test]
fn widget_state_registers_and_unregisters() {
    let state = WidgetState::default();
    {
        let mut reg = state.0.lock().unwrap();
        reg.insert("w-1".to_string(), "<div>1</div>".to_string())
            .unwrap();
        assert_eq!(reg.len(), 1);
        assert!(reg.get("w-1").is_some());

        reg.remove("w-1");
        assert_eq!(reg.len(), 0);
        assert!(reg.get("w-1").is_none());
    }
}
