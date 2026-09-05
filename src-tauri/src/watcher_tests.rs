use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use crate::watcher::{sidecar_path_for, DebounceEmits, DoubleDebounceTracker};

#[test]
fn derives_correct_sidecar_path() {
    let doc = Path::new("C:/notes/session.md");
    let sidecar = sidecar_path_for(doc);
    assert_eq!(sidecar, PathBuf::from("C:/notes/session.md.mdlog"));

    let doc_upper = Path::new("C:/notes/README.MARKDOWN");
    let sidecar_upper = sidecar_path_for(doc_upper);
    assert_eq!(
        sidecar_upper,
        PathBuf::from("C:/notes/README.MARKDOWN.mdlog")
    );

    let doc_mixed = Path::new("C:/Notes/MySession.Md");
    let sidecar_mixed = sidecar_path_for(doc_mixed);
    assert_eq!(sidecar_mixed, PathBuf::from("C:/Notes/MySession.Md.mdlog"));
}

#[test]
fn log_event_does_not_affect_sidecar_deadline() {
    let target = PathBuf::from("C:/notes/log.md");
    let debounce = Duration::from_millis(400);
    let mut tracker = DoubleDebounceTracker::new(target.clone(), debounce);

    let now = Instant::now();
    tracker.handle_event_paths(std::slice::from_ref(&target), now);

    assert!(tracker.log_deadline.is_some());
    assert!(tracker.sidecar_deadline.is_none());
}

#[test]
fn sidecar_event_does_not_affect_log_deadline() {
    let target = PathBuf::from("C:/notes/log.md");
    let sidecar = PathBuf::from("C:/notes/log.md.mdlog");
    let debounce = Duration::from_millis(400);
    let mut tracker = DoubleDebounceTracker::new(target, debounce);

    let now = Instant::now();
    tracker.handle_event_paths(&[sidecar], now);

    assert!(tracker.log_deadline.is_none());
    assert!(tracker.sidecar_deadline.is_some());
}

#[test]
fn independent_deadlines_take_minimum_timeout() {
    let target = PathBuf::from("C:/notes/log.md");
    let sidecar = PathBuf::from("C:/notes/log.md.mdlog");
    let debounce = Duration::from_millis(400);
    let mut tracker = DoubleDebounceTracker::new(target.clone(), debounce);

    let t0 = Instant::now();
    tracker.handle_event_paths(&[target], t0);

    let t1 = t0 + Duration::from_millis(100);
    tracker.handle_event_paths(&[sidecar], t1);

    // log 到期时间为 t0 + 400ms，sidecar 到期时间为 t1 + 400ms = t0 + 500ms
    // 在 t1 时刻，超时应为 (t0 + 400ms) - t1 = 300ms（取两者之较早者）
    let idle = Duration::from_secs(3600);
    let timeout = tracker.compute_timeout(t1, idle);
    assert_eq!(timeout, Duration::from_millis(300));
}

#[test]
fn poll_expired_emits_each_event_independently() {
    let target = PathBuf::from("C:/notes/log.md");
    let sidecar = PathBuf::from("C:/notes/log.md.mdlog");
    let debounce = Duration::from_millis(400);
    let mut tracker = DoubleDebounceTracker::new(target.clone(), debounce);

    let t0 = Instant::now();
    tracker.handle_event_paths(&[target], t0);
    let t1 = t0 + Duration::from_millis(200);
    tracker.handle_event_paths(&[sidecar], t1);

    // 在 t0 + 400ms 时，log 到期，但 sidecar（到期于 t0 + 600ms）未到期
    let emits_at_400 = tracker.poll_expired(t0 + Duration::from_millis(400));
    assert_eq!(
        emits_at_400,
        DebounceEmits {
            file_changed: true,
            mdlog_state_changed: false,
        }
    );
    assert!(tracker.log_deadline.is_none());
    assert!(tracker.sidecar_deadline.is_some());

    // 在 t0 + 600ms 时，sidecar 到期
    let emits_at_600 = tracker.poll_expired(t0 + Duration::from_millis(600));
    assert_eq!(
        emits_at_600,
        DebounceEmits {
            file_changed: false,
            mdlog_state_changed: true,
        }
    );
    assert!(tracker.sidecar_deadline.is_none());
}

#[test]
fn event_paths_match_case_insensitively_on_windows() {
    let target = PathBuf::from("C:/notes/log.md");
    let debounce = Duration::from_millis(400);
    let mut tracker = DoubleDebounceTracker::new(target, debounce);

    let now = Instant::now();
    let upper_event = PathBuf::from("C:/NOTES/LOG.MD");
    let upper_sidecar = PathBuf::from("C:/NOTES/LOG.MD.MDLOG");

    tracker.handle_event_paths(&[upper_event, upper_sidecar], now);

    #[cfg(windows)]
    {
        assert!(tracker.log_deadline.is_some());
        assert!(tracker.sidecar_deadline.is_some());
    }
}
