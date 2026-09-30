use std::fs;
use std::hint::black_box;
use std::path::{Path, PathBuf};
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use vellum_lib::library::search_library;

struct Fixture(PathBuf);

impl Drop for Fixture {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.0).unwrap();
    }
}

fn measure(root: &Path, name: &str, body: &str, files: usize, query: &str, expected: usize) {
    let directory = root.join(name);
    fs::create_dir(&directory).unwrap();
    for index in 0..files {
        fs::write(directory.join(format!("{index:03}.md")), body).unwrap();
    }
    let mut samples = Vec::new();
    for index in 0..11 {
        let start = Instant::now();
        let result = black_box(search_library(black_box(&directory), black_box(query)).unwrap());
        let elapsed = start.elapsed().as_secs_f64() * 1000.0;
        let count: usize = result.files.iter().map(|file| file.matches.len()).sum();
        assert_eq!(count, expected);
        assert!(!result.truncated);
        if index >= 2 {
            samples.push(elapsed);
        }
    }
    println!(
        "{{\"case\":\"{name}\",\"files\":{files},\"bytes\":{},\"hits\":{expected},\"samples_ms\":{samples:?}}}",
        body.len() * files
    );
}

fn main() {
    let stamp = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
    let fixture = Fixture(std::env::temp_dir().join(format!(
        "vellum-search-bench-{}-{stamp}",
        std::process::id()
    )));
    fs::create_dir(&fixture.0).unwrap();
    measure(
        &fixture.0,
        "ascii-miss",
        &"Plain Markdown reading with AbCd mixed CASE and ordinary words.\n".repeat(4096),
        64,
        "needleXYZ",
        0,
    );
    measure(
        &fixture.0,
        "unicode-tail-hit",
        &format!("{}needleXYZ\n", "素笺𠀀İ 阅读 AbCd Straße mixed CASE 文本。\n".repeat(4096)),
        64,
        "NEEDLExyz",
        64,
    );
    measure(
        &fixture.0,
        "dense-long-line",
        &"x".repeat(1024 * 1024),
        1,
        "X",
        20,
    );
}
