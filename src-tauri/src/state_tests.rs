use crate::state::AppState;
use std::path::PathBuf;

fn assert_send_sync<T: Send + Sync>() {}

#[test]
fn app_state_implements_send_and_sync() {
    assert_send_sync::<AppState>();
}

#[test]
fn app_state_initializes_empty_and_allows_interior_mutability() {
    let state = AppState::default();
    {
        let current = state.current.lock().expect("lock current");
        assert_eq!(*current, None);
    }
    {
        let watcher = state.watcher.lock().expect("lock watcher");
        assert!(watcher.is_none());
    }

    {
        let mut current = state.current.lock().expect("lock current");
        *current = Some(PathBuf::from("C:/notes/test.md"));
    }

    let current = state.current.lock().expect("lock current");
    assert_eq!(*current, Some(PathBuf::from("C:/notes/test.md")));
}
