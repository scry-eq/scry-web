use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Manager;

mod overlay;

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

/// One of TITLES. The counter keeps two windows opened in the same nanosecond from
/// landing on the same label.
pub(crate) fn bland_title() -> &'static str {
  static NTH: AtomicUsize = AtomicUsize::new(0);
  let nanos = SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .map(|d| d.subsec_nanos() as usize)
    .unwrap_or(0);
  TITLES[(nanos + NTH.fetch_add(1, Ordering::Relaxed)) % TITLES.len()]
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .manage(overlay::OverlayState::default())
    .invoke_handler(tauri::generate_handler![
      overlay::overlay_open,
      overlay::overlay_close,
      overlay::overlay_locked,
      overlay::overlay_set_locked,
      overlay::overlay_set_hot_zones,
    ])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      // Cover any window the user/config defines, not just "main", in case
      // the label is renamed or extra windows get added later.
      for (_, w) in app.webview_windows() {
        let _ = w.set_title(bland_title());
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
