fn main() {
  // Stamp the binary so a running app can say which build it is. Debugging an invisible
  // window across two machines is otherwise guesswork about which exe is on disk.
  let stamp = std::time::SystemTime::now()
    .duration_since(std::time::UNIX_EPOCH)
    .map(|d| d.as_secs())
    .unwrap_or(0);
  println!("cargo:rustc-env=SCRY_BUILD_ID={stamp}");
  println!("cargo:rerun-if-changed=src");
  tauri_build::build()
}
