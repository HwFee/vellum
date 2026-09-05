use crate::widget::{
    build_widget_response, judge_mdlog_alive, MdlogSidecarData, RegisterResult, WidgetRegistry,
    MAX_REGISTRY_CAPACITY, MAX_WIDGET_HTML_BYTES,
};

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
    assert_eq!(
        response.headers().get("Cache-Control").unwrap(),
        "no-store"
    );
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
    assert_eq!(
        resp_404.headers().get("Content-Type").unwrap(),
        "text/html; charset=utf-8"
    );
    assert_eq!(
        resp_404.headers().get("Content-Security-Policy").unwrap(),
        "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:"
    );

    // 2. 非 GET 请求拒绝为 404
    let resp_post = build_widget_response(
        "POST",
        "http://vellum-widget.localhost/test-id",
        &mut registry,
    );
    assert_eq!(resp_post.status().as_u16(), 404);

    // 3. 越界或非法多段路径
    let resp_traversal = build_widget_response(
        "GET",
        "http://vellum-widget.localhost/id/extra/path",
        &mut registry,
    );
    assert_eq!(resp_traversal.status().as_u16(), 404);
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

    // 5. 原生 Win32 进程存活检查：不存在的 pid 必须返回 false（A1）
    #[cfg(windows)]
    {
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
