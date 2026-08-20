fn main() {
    // bundle-resources/ is produced by ../stage-resources.sh and is NOT
    // committed (portable node binary + copies of the built localhost/webview
    // dists). tauri_build errors if a declared resource path is missing, which
    // would break a plain `cargo build` on a fresh clone, so pre-create the
    // two directories as empty placeholders. Empty dirs bundle to nothing;
    // main.rs falls back to the repo-relative dev paths when the staged files
    // are absent. Run stage-resources.sh before `tauri build` to fill them.
    let manifest_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    for dir in ["bundle-resources/nodebin", "bundle-resources/surfaces"] {
        let _ = std::fs::create_dir_all(manifest_dir.join(dir));
    }
    tauri_build::build()
}
