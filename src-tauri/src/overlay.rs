//! Floating game overlay: transparent, undecorated, always-on-top, click-through.
//!
//! Tauri has no equivalent of Electron's `setIgnoreMouseEvents(true, {forward: true})` —
//! `set_ignore_cursor_events` only toggles WS_EX_TRANSPARENT, so a click-through window
//! receives zero mouse events and CSS :hover is dead. Hover is therefore SAMPLED from the
//! global cursor instead of hooked: no WH_MOUSE_LL on our message loop, so a stalled main
//! thread can never freeze the user's cursor system-wide.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, Runtime, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

pub const LABEL: &str = "overlay";

/// Hover sample period. 40 Hz is imperceptible for a chrome reveal and each tick is one
/// cached-cursor read hopped onto the main thread.
const POLL: Duration = Duration::from_millis(25);

/// A window-local rectangle in CSS px, as the webview measures itself.
#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize)]
pub struct Rect {
  pub x: f64,
  pub y: f64,
  pub w: f64,
  pub h: f64,
}

impl Rect {
  fn contains(&self, x: f64, y: f64) -> bool {
    x >= self.x && x < self.x + self.w && y >= self.y && y < self.y + self.h
  }
}

#[derive(Serialize, Clone)]
struct Hover {
  inside: bool,
  x: f64,
  y: f64,
}

#[derive(Default)]
pub struct OverlayState {
  /// Locked = click-through over everything except a hot zone. Unlocked = an ordinary window.
  locked: AtomicBool,
  /// Regions that stay clickable while locked (the header strip / pin), CSS px, window-local.
  hot: Mutex<Vec<Rect>>,
  /// Last values pushed to the OS / webview, so a tick that changes nothing costs nothing.
  ignoring: AtomicBool,
  inside: AtomicBool,
  polling: AtomicBool,
}

// ---- platform tuning -------------------------------------------------------------------
// Everything the cross-platform API cannot express. Both blocks must run on the main thread.

/// Alt-Tab exclusion. `skip_taskbar` is ITaskbarList::DeleteTab, which deletes the taskbar
/// button only; WS_EX_TOOLWINDOW is the style Alt-Tab and Win+Tab actually consult.
#[cfg(target_os = "windows")]
fn platform_tune<R: Runtime>(w: &WebviewWindow<R>) {
  use windows::Win32::UI::WindowsAndMessaging::{
    GetWindowLongPtrW, SetWindowLongPtrW, GWL_EXSTYLE, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW,
  };
  let Ok(hwnd) = w.hwnd() else { return };
  unsafe {
    let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
    let add = (WS_EX_TOOLWINDOW.0 | WS_EX_NOACTIVATE.0) as isize;
    SetWindowLongPtrW(hwnd, GWL_EXSTYLE, ex | add);
  }
}

/// `set_always_on_top` gives NSFloatingWindowLevel (3) only, which a CrossOver game window can
/// sit above; and a floating window is confined to its own Space unless it says otherwise.
#[cfg(target_os = "macos")]
fn platform_tune<R: Runtime>(w: &WebviewWindow<R>) {
  use objc2::msg_send;
  use objc2::runtime::AnyObject;

  const NS_SCREEN_SAVER_LEVEL: isize = 1000;
  const CAN_JOIN_ALL_SPACES: usize = 1 << 0;
  const IGNORES_CYCLE: usize = 1 << 6;
  const FULL_SCREEN_AUXILIARY: usize = 1 << 8;

  let Ok(ptr) = w.ns_window() else { return };
  if ptr.is_null() {
    return;
  }
  let ns = ptr as *mut AnyObject;
  unsafe {
    let _: () = msg_send![ns, setLevel: NS_SCREEN_SAVER_LEVEL];
    let cur: usize = msg_send![ns, collectionBehavior];
    let next = cur | CAN_JOIN_ALL_SPACES | IGNORES_CYCLE | FULL_SCREEN_AUXILIARY;
    let _: () = msg_send![ns, setCollectionBehavior: next];
  }
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn platform_tune<R: Runtime>(_w: &WebviewWindow<R>) {}

// ---- commands --------------------------------------------------------------------------

#[tauri::command]
pub fn overlay_open(app: AppHandle) -> Result<(), String> {
  if let Some(w) = app.get_webview_window(LABEL) {
    let _ = w.show();
    return Ok(());
  }

  let w = WebviewWindowBuilder::new(&app, LABEL, WebviewUrl::App("overlay.html".into()))
    .title(crate::bland_title())
    .inner_size(340.0, 200.0)
    .min_inner_size(180.0, 90.0)
    .decorations(false)
    .transparent(true)
    .always_on_top(true)
    .visible_on_all_workspaces(true)
    .skip_taskbar(true)
    .shadow(false)
    // Born unfocusable so the first paint cannot pull the foreground off the game: tao
    // picks SW_SHOWNOACTIVATE for a window without WS_EX_NOACTIVATE-clearing focusability,
    // which is Electron's showInactive().
    .focusable(false)
    .focused(false)
    .visible(false)
    .build()
    .map_err(|e| e.to_string())?;

  // Commands do not run on the main thread, and the raw platform calls below are
  // main-thread-only on macOS (NSWindow mutation). Tauri's own API is thread-safe — it
  // posts to the event loop for us — so only this hop is needed.
  let tuned = w.clone();
  let _ = app.run_on_main_thread(move || {
    platform_tune(&tuned);
    let _ = tuned.show();
  });

  let state = app.state::<OverlayState>();
  // Locked is the resting state — an overlay you have to unlock to touch cannot eat a click
  // during a fight.
  state.locked.store(true, Ordering::Relaxed);
  state.hot.lock().unwrap().clear();
  apply_ignore(&w, state.inner(), true);
  start_poll(app.clone());
  Ok(())
}

#[tauri::command]
pub fn overlay_close(app: AppHandle) {
  if let Some(w) = app.get_webview_window(LABEL) {
    let _ = w.close();
  }
}

#[tauri::command]
pub fn overlay_set_locked(app: AppHandle, locked: bool) {
  let state = app.state::<OverlayState>();
  state.locked.store(locked, Ordering::Relaxed);
  if let Some(w) = app.get_webview_window(LABEL) {
    // Unlocked is an ordinary window; locked starts click-through and the poll re-opens it
    // over a hot zone.
    apply_ignore(&w, state.inner(), locked);
    let _ = w.set_focusable(!locked);
    let _ = w.emit_to(LABEL, "overlay://locked", locked);
  }
}

#[tauri::command]
pub fn overlay_locked(app: AppHandle) -> bool {
  app.state::<OverlayState>().locked.load(Ordering::Relaxed)
}

/// Declare the regions that stay clickable while locked. The webview measures its own chrome
/// and reports it here, so main never hard-codes a header height.
#[tauri::command]
pub fn overlay_set_hot_zones(app: AppHandle, zones: Vec<Rect>) {
  *app.state::<OverlayState>().hot.lock().unwrap() = zones;
}

// ---- the hover sensor ------------------------------------------------------------------

fn apply_ignore<R: Runtime>(w: &WebviewWindow<R>, state: &OverlayState, ignore: bool) {
  if state.ignoring.swap(ignore, Ordering::Relaxed) == ignore {
    return;
  }
  let _ = w.set_ignore_cursor_events(ignore);
}

/// Sleep off-thread, decide on the main thread. `cursor_position` and the window geometry
/// reads are main-thread-only on GTK, and posting a closure per tick keeps that true without
/// blocking the event loop.
fn start_poll(app: AppHandle) {
  {
    let state = app.state::<OverlayState>();
    if state.polling.swap(true, Ordering::SeqCst) {
      return;
    }
  }
  std::thread::spawn(move || loop {
    std::thread::sleep(POLL);
    let app2 = app.clone();
    if app.run_on_main_thread(move || tick(&app2)).is_err() {
      break;
    }
    if app.get_webview_window(LABEL).is_none() {
      app.state::<OverlayState>().polling.store(false, Ordering::SeqCst);
      break;
    }
  });
}

fn tick(app: &AppHandle) {
  let Some(w) = app.get_webview_window(LABEL) else { return };
  let state = app.state::<OverlayState>();

  if !state.locked.load(Ordering::Relaxed) {
    apply_ignore(&w, state.inner(), false);
    return;
  }

  let (Ok(cursor), Ok(pos), Ok(size), Ok(scale)) = (
    app.cursor_position(),
    w.outer_position(),
    w.outer_size(),
    w.scale_factor(),
  ) else {
    return;
  };

  // Cursor and geometry are both physical, so the only conversion is into the CSS px the
  // webview reported its hot zones in.
  let lx = (cursor.x - pos.x as f64) / scale;
  let ly = (cursor.y - pos.y as f64) / scale;
  let inside = lx >= 0.0 && ly >= 0.0 && lx < size.width as f64 / scale && ly < size.height as f64 / scale;

  let hot = inside && state.hot.lock().unwrap().iter().any(|r| r.contains(lx, ly));
  apply_ignore(&w, state.inner(), !hot);

  if state.inside.swap(inside, Ordering::Relaxed) != inside {
    let _ = w.emit_to(LABEL, "overlay://hover", Hover { inside, x: lx, y: ly });
  }
}
