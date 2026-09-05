use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::time::{Duration, Instant};

use notify::{Config, Event, RecommendedWatcher, RecursiveMode, Watcher};
use tauri::{AppHandle, Emitter};

/// 防抖静默期：连续文件变更事件在此期间合并为一次重载。
pub const DEBOUNCE: Duration = Duration::from_millis(400);

/// 依据目标 Markdown 文件路径推导同级 `<目标>.mdlog` sidecar 文件路径。
pub fn sidecar_path_for(file_path: &Path) -> PathBuf {
    let mut name = file_path
        .file_name()
        .map(|n| n.to_os_string())
        .unwrap_or_default();
    name.push(".mdlog");
    file_path.with_file_name(name)
}

/// 路径比较助手：在 Windows 下统一路径分隔符并进行 ASCII 大小写不敏感比较，
/// 消除历史文件重命名大小写残留与斜杠/反斜杠差异导致的事件漏检（S5）。
fn paths_equal(p1: &Path, p2: &Path) -> bool {
    #[cfg(windows)]
    {
        let s1 = p1.to_string_lossy().replace('/', "\\");
        let s2 = p2.to_string_lossy().replace('/', "\\");
        s1.eq_ignore_ascii_case(&s2)
    }
    #[cfg(not(windows))]
    {
        p1 == p2
    }
}

/// 标识单次超时检测需要触发的 Tauri 事件。
#[derive(Debug, Default, PartialEq, Eq)]
pub struct DebounceEmits {
    pub file_changed: bool,
    pub mdlog_state_changed: bool,
}

/// 双路独立防抖状态机：
/// target 变更 -> 400ms log_deadline -> emit "file-changed"
/// sidecar 变更 -> 400ms sidecar_deadline -> emit "mdlog-state-changed"
/// 两路计时独立维护，互不顶替、互不合并。
pub struct DoubleDebounceTracker {
    pub target: PathBuf,
    pub sidecar_target: PathBuf,
    pub log_deadline: Option<Instant>,
    pub sidecar_deadline: Option<Instant>,
    pub debounce: Duration,
}

impl DoubleDebounceTracker {
    pub fn new(target: PathBuf, debounce: Duration) -> Self {
        let sidecar_target = sidecar_path_for(&target);
        Self {
            target,
            sidecar_target,
            log_deadline: None,
            sidecar_deadline: None,
            debounce,
        }
    }

    /// 根据接收到的事件路径，分别刷新对应管线的 deadline。
    pub fn handle_event_paths(&mut self, paths: &[PathBuf], now: Instant) {
        if paths.iter().any(|p| paths_equal(p, &self.target)) {
            self.log_deadline = Some(now + self.debounce);
        }
        if paths.iter().any(|p| paths_equal(p, &self.sidecar_target)) {
            self.sidecar_deadline = Some(now + self.debounce);
        }
    }

    /// 计算下一次 `recv_timeout` 的等待时长（取两路 deadline 的较早者）。
    pub fn compute_timeout(&self, now: Instant, idle_wait: Duration) -> Duration {
        match (self.log_deadline, self.sidecar_deadline) {
            (Some(ld), Some(sd)) => {
                let earliest = ld.min(sd);
                if earliest <= now {
                    Duration::ZERO
                } else {
                    earliest - now
                }
            }
            (Some(ld), None) => {
                if ld <= now {
                    Duration::ZERO
                } else {
                    ld - now
                }
            }
            (None, Some(sd)) => {
                if sd <= now {
                    Duration::ZERO
                } else {
                    sd - now
                }
            }
            (None, None) => idle_wait,
        }
    }

    /// 提取已到期的事件并清除对应 deadline。
    pub fn poll_expired(&mut self, now: Instant) -> DebounceEmits {
        let mut emits = DebounceEmits::default();

        if let Some(ld) = self.log_deadline {
            if ld <= now {
                emits.file_changed = true;
                self.log_deadline = None;
            }
        }

        if let Some(sd) = self.sidecar_deadline {
            if sd <= now {
                emits.mdlog_state_changed = true;
                self.sidecar_deadline = None;
            }
        }

        emits
    }
}

/// 启动针对目标文件及其同级 sidecar 的双路监听器。
/// 返回的 `RecommendedWatcher` drop 时自动停止监听并结束内部事件循环线程。
pub fn watch_file(app: AppHandle, file_path: PathBuf) -> Result<RecommendedWatcher, String> {
    let parent = file_path
        .parent()
        .ok_or_else(|| "Cannot resolve parent directory for watch".to_string())?
        .to_path_buf();

    let (tx, rx) = mpsc::channel::<notify::Result<Event>>();
    let mut watcher = RecommendedWatcher::new(tx, Config::default())
        .map_err(|error| format!("Watcher init failed: {error}"))?;

    watcher
        .watch(&parent, RecursiveMode::NonRecursive)
        .map_err(|error| format!("Watch failed: {error}"))?;

    let target = file_path.clone();
    let app_handle = app.clone();
    std::thread::spawn(move || {
        let idle_wait = Duration::from_secs(3600);
        let mut tracker = DoubleDebounceTracker::new(target, DEBOUNCE);

        loop {
            let now = Instant::now();
            let timeout = tracker.compute_timeout(now, idle_wait);

            match rx.recv_timeout(timeout) {
                Ok(Ok(event)) => {
                    tracker.handle_event_paths(&event.paths, Instant::now());
                }
                Ok(Err(_)) => continue,
                Err(mpsc::RecvTimeoutError::Timeout) => {}
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            }

            let emits = tracker.poll_expired(Instant::now());
            if emits.file_changed {
                let _ = app_handle.emit("file-changed", ());
            }
            if emits.mdlog_state_changed {
                let _ = app_handle.emit("mdlog-state-changed", ());
            }
        }
    });

    Ok(watcher)
}
