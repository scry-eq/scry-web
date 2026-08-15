use std::path::Path;
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

/// The daemon address, when the UI is not a usable way to set it. `SCRY_DAEMON_URL=...`
/// or `--url ws://host:9090`.
///
/// The default is localhost, which is wrong for every setup where the client and the daemon
/// are on different machines — and a client pointed at an address that can never answer is
/// exactly when the address field is hardest to use. This is the way in that does not depend
/// on the UI behaving.
#[tauri::command]
fn daemon_url_override() -> Option<String> {
  if let Some(v) = std::env::var_os("SCRY_DAEMON_URL") {
    return v.into_string().ok().filter(|s| !s.is_empty());
  }
  let mut args = std::env::args().skip(1);
  while let Some(a) = args.next() {
    if a == "--url" {
      return args.next().filter(|s| !s.is_empty());
    }
    if let Some(v) = a.strip_prefix("--url=") {
      return Some(v.to_string()).filter(|s| !s.is_empty());
    }
  }
  None
}

/// Where the log goes. The OS log dir is the right home for it, but it is also a place a
/// user has to be told how to find — so the exe's own directory gets a copy. When someone is
/// running a build straight out of a shared build tree, that is the one file both ends can
/// already see.
fn log_targets() -> Vec<tauri_plugin_log::Target> {
  use tauri_plugin_log::{Target, TargetKind};
  let mut targets = vec![
    Target::new(TargetKind::Stdout),
    Target::new(TargetKind::LogDir {
      file_name: Some("scry-web".into()),
    }),
  ];
  if let Some(dir) = std::env::current_exe().ok().and_then(|e| e.parent().map(Path::to_path_buf)) {
    targets.push(Target::new(TargetKind::Folder {
      path: dir,
      file_name: Some("scry-web".into()),
    }));
  }
  targets
}

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
      overlay::overlay_status,
      daemon_url_override,
      overlay::overlay_set_locked,
      overlay::overlay_set_hot_zones,
    ])
    .setup(|app| {
      // Release builds log too, to a file. A packaged app has no console, and the overlay
      // is a window that can fail by being invisible — without this there is nothing to
      // read when it does. Path is the OS log dir for the bundle identifier, e.g.
      // %LOCALAPPDATA%\com.scryeq.web\logs on Windows.
      app.handle().plugin(
        tauri_plugin_log::Builder::default()
          .level(log::LevelFilter::Info)
          .targets(log_targets())
          .build(),
      )?;
      // First line in the log, so "is the log even being written / is this the binary I
      // think it is" is answerable without reproducing anything.
      log::info!(
        "scry-web {} starting, built {}",
        env!("CARGO_PKG_VERSION"),
        env!("SCRY_BUILD_ID")
      );
      log::info!("daemon url override: {:?}", daemon_url_override());
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
