use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Manager;

// Bland, generic window titles so the app blends in on the desktop and
// nothing in the title bar pattern-matches the project name (in case
// another process is enumerating window titles). Indexed by SystemTime
// sub-second nanos — plenty of spread for a title bar without pulling a
// `rand` crate. The static fallback in tauri.conf.json is similarly
// generic for the brief window before this runs.
const TITLES: &[&str] = &[
  "Notes",
  "Inbox",
  "Calendar",
  "Tasks",
  "Documents",
  "Reader",
  "Library",
  "Editor",
  "Viewer",
  "Console",
  "Settings",
  "Preferences",
  "Workspace",
  "Dashboard",
  "Untitled",
  "New Tab",
];

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      let idx = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.subsec_nanos() as usize)
        .unwrap_or(0) % TITLES.len();
      let title = TITLES[idx];
      // Cover any window the user/config defines, not just "main", in case
      // the label is renamed or extra windows get added later.
      for (_, w) in app.webview_windows() {
        let _ = w.set_title(title);
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
