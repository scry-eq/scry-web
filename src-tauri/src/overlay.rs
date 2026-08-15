//! Floating game overlay: transparent, undecorated, always-on-top, click-through.
//!
//! Click-through is done differently per platform, because the good answer is not portable:
//!
//!   - **Windows** — `WM_NCHITTEST`. The window proc answers `HTTRANSPARENT` for any point
//!     outside a hot zone and the OS routes that click to the game. Exact, per-message, and
//!     the same message doubles as the hover signal, so nothing is sampled.
//!   - **elsewhere** — `set_ignore_cursor_events` plus a sampled cursor, because Tauri has no
//!     equivalent of Electron's `setIgnoreMouseEvents(true, {forward: true})`: the flag takes
//!     no options and tao implements it as `WS_EX_TRANSPARENT`, so a click-through window
//!     receives zero mouse events and CSS `:hover` is dead.
//!
//! Neither path installs a global mouse hook, which is how Electron's `forward` puts every
//! system mouse event behind the app's own message loop.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

pub const LABEL: &str = "overlay";

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
  /// Last hover state pushed to the webview, so a decision that changes nothing costs nothing.
  inside: AtomicBool,
  /// Same, for the OS click-through flag. Windows never touches it — the hit-test is the flag.
  #[cfg(not(target_os = "windows"))]
  ignoring: AtomicBool,
  sensor: AtomicBool,
}

// ---- shared geometry -------------------------------------------------------------------

/// A screen point in the window's own CSS px, and whether it lands inside the window at all.
///
/// INNER, not outer, and both halves matter. The webview's CSS origin is the client area, so
/// this is the rectangle the hot zones were measured against — and on GTK `outer_size` is fed
/// by frame-extents events that never arrive without a window manager, so it reads 0x0 and
/// every point tests as outside.
fn local(w: &WebviewWindow, sx: f64, sy: f64) -> Option<(f64, f64, bool)> {
  let pos = w.inner_position().ok()?;
  let size = w.inner_size().ok()?;
  let scale = w.scale_factor().ok()?;
  let lx = (sx - pos.x as f64) / scale;
  let ly = (sy - pos.y as f64) / scale;
  let inside =
    lx >= 0.0 && ly >= 0.0 && lx < size.width as f64 / scale && ly < size.height as f64 / scale;
  Some((lx, ly, inside))
}

fn in_hot_zone(state: &OverlayState, lx: f64, ly: f64) -> bool {
  state.hot.lock().unwrap().iter().any(|r| r.contains(lx, ly))
}

/// Emit on transition only — the webview's job is to show or hide chrome, not to track a
/// pointer it cannot see.
fn note_inside(w: &WebviewWindow, state: &OverlayState, inside: bool, lx: f64, ly: f64) {
  if state.inside.swap(inside, Ordering::Relaxed) != inside {
    let _ = w.emit_to(LABEL, "overlay://hover", Hover { inside, x: lx, y: ly });
  }
}

// ---- platform tuning -------------------------------------------------------------------
// Everything the cross-platform API cannot express. Both blocks must run on the main thread.

/// Alt-Tab exclusion. `skip_taskbar` is ITaskbarList::DeleteTab, which deletes the taskbar
/// button only; WS_EX_TOOLWINDOW is the style Alt-Tab and Win+Tab actually consult.
#[cfg(target_os = "windows")]
fn platform_tune(w: &WebviewWindow) {
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
fn platform_tune(w: &WebviewWindow) {
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
fn platform_tune(_w: &WebviewWindow) {}

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
    // picks SW_SHOWNOACTIVATE for a window without focusability, which is Electron's
    // showInactive().
    .focusable(false)
    .focused(false)
    .visible(false)
    .build()
    .map_err(|e| e.to_string())?;

  let state = app.state::<OverlayState>();
  // Locked is the resting state — an overlay you have to unlock to touch cannot eat a click
  // during a fight.
  state.locked.store(true, Ordering::Relaxed);
  state.inside.store(false, Ordering::Relaxed);
  state.hot.lock().unwrap().clear();

  // Commands do not run on the main thread, and both the platform tuning and the Windows
  // subclass are main-thread-only (NSWindow mutation; the window proc's own thread). Tauri's
  // API is thread-safe on its own — it posts to the event loop for us.
  let tuned = w.clone();
  let handle = app.clone();
  let _ = app.run_on_main_thread(move || {
    platform_tune(&tuned);
    sensor::install(&handle, &tuned);
    let _ = tuned.show();
  });
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
  // A stale `inside` would leave the chrome shown (or hidden) until the next sample.
  state.inside.store(false, Ordering::Relaxed);
  if let Some(w) = app.get_webview_window(LABEL) {
    sensor::relock(&app, &w, locked);
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

// ---- the sensor: Windows ---------------------------------------------------------------

#[cfg(target_os = "windows")]
mod sensor {
  use super::*;
  use std::sync::{Condvar, OnceLock};
  use std::time::Duration;
  use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
  use windows::Win32::UI::Shell::{DefSubclassProc, SetWindowSubclass};
  use windows::Win32::UI::WindowsAndMessaging::{HTTRANSPARENT, WM_NCHITTEST};

  const SUBCLASS_ID: usize = 1;

  /// How often to re-check whether the cursor has LEFT. WM_NCHITTEST tells us about every
  /// move onto and across the window, but silence is ambiguous — a cursor resting inside
  /// looks exactly like a cursor that walked out — so leaving is the one thing still
  /// sampled. It runs only while the cursor is over the overlay.
  const LEAVE_POLL: Duration = Duration::from_millis(120);

  /// The window proc is a bare C callback with no state of its own. There is exactly one
  /// overlay window per process, so a global is the honest way to hand it the app — and
  /// unlike a boxed pointer in `dwRefData` it cannot dangle when the window dies.
  static APP: OnceLock<AppHandle> = OnceLock::new();
  /// Parks the leave-watcher while the cursor is elsewhere: at rest it does not run at all.
  static AWAKE: (Mutex<bool>, Condvar) = (Mutex::new(false), Condvar::new());

  pub fn install(app: &AppHandle, w: &WebviewWindow) {
    let Ok(hwnd) = w.hwnd() else { return };
    let _ = APP.set(app.clone());
    unsafe {
      let _ = SetWindowSubclass(hwnd, Some(hit_test), SUBCLASS_ID, 0);
    }
    if !app.state::<OverlayState>().sensor.swap(true, Ordering::SeqCst) {
      watch_for_leave(app.clone());
    }
  }

  /// Nothing to do at the OS level: the hit-test reads `locked` on every message, so the
  /// window changes behavior without changing a style.
  pub fn relock(_app: &AppHandle, _w: &WebviewWindow, _locked: bool) {}

  unsafe extern "system" fn hit_test(
    hwnd: HWND,
    msg: u32,
    wp: WPARAM,
    lp: LPARAM,
    _id: usize,
    _data: usize,
  ) -> LRESULT {
    if msg == WM_NCHITTEST {
      if let Some(answer) = decide(lp) {
        return answer;
      }
    }
    unsafe { DefSubclassProc(hwnd, msg, wp, lp) }
  }

  /// `Some` = we answered; `None` = let the default proc answer, i.e. behave like a window.
  fn decide(lp: LPARAM) -> Option<LRESULT> {
    let app = APP.get()?;
    let state = app.state::<OverlayState>();
    if !state.locked.load(Ordering::Relaxed) {
      return None;
    }
    let w = app.get_webview_window(LABEL)?;

    // lParam carries the cursor in SCREEN coordinates, packed as two signed 16-bit halves.
    let sx = (lp.0 & 0xffff) as u16 as i16 as f64;
    let sy = ((lp.0 >> 16) & 0xffff) as u16 as i16 as f64;
    let (lx, ly, inside) = local(&w, sx, sy)?;

    note_inside(&w, state.inner(), inside, lx, ly);
    if inside {
      // The cursor is over us, so leaving is now possible and worth watching for.
      let (lock, cv) = &AWAKE;
      let mut awake = lock.lock().unwrap();
      if !*awake {
        *awake = true;
        cv.notify_one();
      }
    }

    if inside && in_hot_zone(state.inner(), lx, ly) {
      None
    } else {
      // Not ours: the OS carries on down the z-order and the game gets the click.
      Some(LRESULT(HTTRANSPARENT as isize))
    }
  }

  fn watch_for_leave(app: AppHandle) {
    std::thread::spawn(move || loop {
      {
        let (lock, cv) = &AWAKE;
        let mut awake = lock.lock().unwrap();
        while !*awake {
          awake = cv.wait(awake).unwrap();
        }
      }
      std::thread::sleep(LEAVE_POLL);
      let handle = app.clone();
      if app.run_on_main_thread(move || check(&handle)).is_err() {
        break;
      }
      if app.get_webview_window(LABEL).is_none() {
        app.state::<OverlayState>().sensor.store(false, Ordering::SeqCst);
        break;
      }
    });
  }

  fn check(app: &AppHandle) {
    let state = app.state::<OverlayState>();
    let Some(w) = app.get_webview_window(LABEL) else { return };
    let Ok(c) = app.cursor_position() else { return };
    let Some((lx, ly, inside)) = local(&w, c.x, c.y) else { return };
    note_inside(&w, state.inner(), inside, lx, ly);
    if !inside {
      *AWAKE.0.lock().unwrap() = false;
    }
  }
}

// ---- the sensor: everywhere else -------------------------------------------------------

#[cfg(not(target_os = "windows"))]
mod sensor {
  use super::*;
  use std::time::Duration;

  /// Hover sample period. 40 Hz is imperceptible for a chrome reveal and each tick is one
  /// cached-cursor read hopped onto the main thread — measured at ~0.8% of one core.
  const POLL: Duration = Duration::from_millis(25);

  pub fn install(app: &AppHandle, _w: &WebviewWindow) {
    // Deliberately NOT click-through yet. On GTK `set_ignore_cursor_events(true)` reaches
    // for the GdkWindow, which does not exist until the widget is realized, and tao
    // unwraps it inside the event loop — an abort, not an error. The first tick applies it
    // once `visible` says there is something to apply it to.
    if !app.state::<OverlayState>().sensor.swap(true, Ordering::SeqCst) {
      poll(app.clone());
    }
  }

  pub fn relock(app: &AppHandle, w: &WebviewWindow, locked: bool) {
    // Locked starts click-through; the sensor re-opens it over a hot zone.
    if w.is_visible().unwrap_or(false) {
      apply_ignore(w, &app.state::<OverlayState>(), locked);
    }
  }

  fn apply_ignore(w: &WebviewWindow, state: &OverlayState, ignore: bool) {
    if state.ignoring.swap(ignore, Ordering::Relaxed) == ignore {
      return;
    }
    let _ = w.set_ignore_cursor_events(ignore);
  }

  /// Sleep off-thread, decide on the main thread. `cursor_position` and the window geometry
  /// reads are main-thread-only on GTK, and posting a closure per tick keeps that true
  /// without blocking the event loop.
  fn poll(app: AppHandle) {
    std::thread::spawn(move || loop {
      std::thread::sleep(POLL);
      let handle = app.clone();
      if app.run_on_main_thread(move || tick(&handle)).is_err() {
        break;
      }
      if app.get_webview_window(LABEL).is_none() {
        app.state::<OverlayState>().sensor.store(false, Ordering::SeqCst);
        break;
      }
    });
  }

  fn tick(app: &AppHandle) {
    let state = app.state::<OverlayState>();
    let Some(w) = app.get_webview_window(LABEL) else { return };
    if !w.is_visible().unwrap_or(false) {
      return;
    }

    if !state.locked.load(Ordering::Relaxed) {
      apply_ignore(&w, state.inner(), false);
      return;
    }

    let Ok(c) = app.cursor_position() else { return };
    let Some((lx, ly, inside)) = local(&w, c.x, c.y) else { return };

    note_inside(&w, state.inner(), inside, lx, ly);
    apply_ignore(&w, state.inner(), !(inside && in_hot_zone(state.inner(), lx, ly)));
  }
}
