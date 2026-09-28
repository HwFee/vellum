use crate::state::{AppState, LibraryMarker, LibraryRef, Opened};
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
        assert!(current.is_none());
    }
    {
        let watcher = state.watcher.lock().expect("lock watcher");
        assert!(watcher.is_none());
    }

    {
        let mut current = state.current.lock().expect("lock current");
        *current = Some(Opened {
            doc: PathBuf::from("C:/notes/test.md"),
            library: None,
        });
    }

    let current = state.current.lock().expect("lock current");
    assert_eq!(
        current.as_ref().map(|opened| opened.doc.as_path()),
        Some(std::path::Path::new("C:/notes/test.md"))
    );
}

#[test]
fn opened_carries_library_atomically() {
    // 文档与库在同一对象里共存亡：换文档时库根同步换代是模式判定不自相矛盾的前提。
    let library = LibraryRef {
        root: PathBuf::from("C:/vaults/wisdom"),
        explicit: false,
        marker: Some(LibraryMarker::Vellum),
    };
    let opened = Opened {
        doc: PathBuf::from("C:/vaults/wisdom/deep/note.md"),
        library: Some(library),
    };

    let lib = opened.library.as_ref().expect("library must exist");
    assert_eq!(lib.root, PathBuf::from("C:/vaults/wisdom"));
    assert!(!lib.explicit);
    assert_eq!(lib.marker, Some(LibraryMarker::Vellum));
    assert_eq!(lib.marker.unwrap().dir_name(), ".vellum");
    assert_eq!(LibraryMarker::Obsidian.dir_name(), ".obsidian");
}
