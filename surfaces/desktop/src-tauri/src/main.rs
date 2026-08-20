// AgentNet desktop shell (Tauri v2).
//
// This is a thin native wrapper around the EXISTING AgentNet localhost surface:
// it spawns `node surfaces/localhost/dist/index.js` (which serves the built
// webview SPA plus the /events SSE and /rpc transport on one origin), waits for
// the port to answer, and only then opens a native window pointed at
// http://localhost:4317, so the SAME-ORIGIN SPA runs exactly as in a browser.
// None of her code is rewritten or modified.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindowBuilder, WindowEvent};

const PORT: u16 = 4317;

/// The .app's Contents/Resources dir, when running from inside a macOS
/// bundle. Resolved from the CANONICALIZED executable path, so launching
/// through a symlinked location (/tmp -> /private/tmp, a symlinked
/// ~/Applications, a dotfiles-managed dir) still finds the real bundle.
/// (tauri's resource_dir() refuses symlinked exe paths on macOS and errors,
/// which previously caused a silent fallback to repo paths.) A bare cargo
/// binary in target/<profile>/ returns None, so dev builds keep dev paths.
fn bundle_resources_dir() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?.canonicalize().ok()?;
    let macos = exe.parent()?;
    if !macos.ends_with("Contents/MacOS") {
        return None;
    }
    Some(macos.parent()?.join("Resources"))
}

/// Path to the built localhost server (run unchanged). Resolved, in order:
///   1. AGENTNET_SERVER_JS env var (explicit override always wins)
///   2. the bundled resource inside a packaged .app (staged by
///      stage-resources.sh; the surfaces/ layout is preserved so the server
///      finds ../../webview/dist relative to itself exactly as in the repo).
///      Inside a bundle a MISSING resource is a packaging bug and a hard
///      error: never silently fall back to a repo checkout that may not exist.
///   3. (debug builds only) relative to this crate's source at build time, so
///      `cargo run` from any clone just works. Release binaries do not embed
///      the build machine's path; outside a bundle they require the env var.
fn server_js() -> Result<String, String> {
    if let Ok(p) = std::env::var("AGENTNET_SERVER_JS") {
        return Ok(p);
    }
    if let Some(res) = bundle_resources_dir() {
        let bundled = res
            .join("surfaces")
            .join("localhost")
            .join("dist")
            .join("index.js");
        if bundled.is_file() {
            return Ok(bundled.to_string_lossy().into_owned());
        }
        return Err(format!(
            "bundled server missing at {} (run stage-resources.sh before tauri build)",
            bundled.display()
        ));
    }
    #[cfg(debug_assertions)]
    {
        Ok(concat!(env!("CARGO_MANIFEST_DIR"), "/../../localhost/dist/index.js").to_string())
    }
    #[cfg(not(debug_assertions))]
    {
        Err("not inside a .app bundle and AGENTNET_SERVER_JS is not set".to_string())
    }
}

/// Node binary. AGENTNET_NODE_BIN wins, else the portable node bundled in the
/// .app's Resources (official nodejs.org build, links only system dylibs;
/// missing = hard packaging error), else common installs, else PATH.
fn node_bin() -> Result<String, String> {
    if let Ok(n) = std::env::var("AGENTNET_NODE_BIN") {
        return Ok(n);
    }
    if let Some(res) = bundle_resources_dir() {
        let bundled = res.join("nodebin").join("node");
        if bundled.is_file() {
            // Resource copying can drop the exec bit; restore it if needed.
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                if let Ok(meta) = std::fs::metadata(&bundled) {
                    let mut perms = meta.permissions();
                    if perms.mode() & 0o111 == 0 {
                        perms.set_mode(0o755);
                        let _ = std::fs::set_permissions(&bundled, perms);
                    }
                }
            }
            return Ok(bundled.to_string_lossy().into_owned());
        }
        return Err(format!(
            "bundled node missing at {} (run stage-resources.sh before tauri build)",
            bundled.display()
        ));
    }
    for candidate in [
        "/opt/homebrew/opt/node@24/bin/node",
        "/opt/homebrew/bin/node",
        "/usr/local/bin/node",
        "/usr/bin/node",
    ] {
        if Path::new(candidate).exists() {
            return Ok(candidate.to_string());
        }
    }
    Ok("node".to_string())
}

/// Last-spawned child pid for the signal path. RunEvent::ExitRequested covers
/// menu Quit / Cmd-Q, but a raw SIGTERM/SIGINT bypasses tauri's event loop and
/// previously leaked the node child; this handler reaps it, then exits.
static CHILD_PID: std::sync::atomic::AtomicI32 = std::sync::atomic::AtomicI32::new(0);

#[cfg(unix)]
extern "C" fn on_term_signal(_sig: libc::c_int) {
    let pid = CHILD_PID.load(std::sync::atomic::Ordering::Relaxed);
    if pid > 0 {
        unsafe {
            libc::kill(pid, libc::SIGTERM);
        }
    }
    unsafe { libc::_exit(0) }
}

#[cfg(unix)]
fn install_signal_handlers() {
    let handler: extern "C" fn(libc::c_int) = on_term_signal;
    unsafe {
        libc::signal(libc::SIGTERM, handler as usize as libc::sighandler_t);
        libc::signal(libc::SIGINT, handler as usize as libc::sighandler_t);
    }
}

/// Holds the spawned node server so we can kill it on exit. `None` when the
/// server was already running before we launched (we don't own it then).
struct ServerProcess(Mutex<Option<Child>>);

fn port_answering() -> bool {
    TcpStream::connect_timeout(
        &(std::net::Ipv4Addr::LOCALHOST, PORT).into(),
        Duration::from_millis(250),
    )
    .is_ok()
}

fn spawn_server(node: &str, server: &str) -> std::io::Result<Child> {
    let server_dir = PathBuf::from(server)
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| PathBuf::from("."));
    let child = Command::new(node)
        .arg(server)
        .env("AGENTNET_PORT", PORT.to_string())
        .current_dir(server_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .spawn()?;
    CHILD_PID.store(child.id() as i32, std::sync::atomic::Ordering::Relaxed);
    Ok(child)
}

fn kill_server(app: &tauri::AppHandle) {
    if let Some(state) = app.try_state::<ServerProcess>() {
        if let Some(mut child) = state.0.lock().unwrap().take() {
            eprintln!("[agentnet-desktop] stopping node server (pid {})", child.id());
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

/// Show + focus the main window (tray "Open", tray click, dock reopen).
fn show_main_window(app: &tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.set_focus();
    }
}

fn hide_main_window(app: &tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.hide();
    }
}

fn toggle_main_window(app: &tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        if win.is_visible().unwrap_or(false) {
            let _ = win.hide();
        } else {
            let _ = win.show();
            let _ = win.set_focus();
        }
    }
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            // (a) Spawn her server unless something already answers on the port
            // (e.g. a dev server the user started by hand; don't double-bind,
            // and don't kill a process we don't own).
            #[cfg(unix)]
            install_signal_handlers();
            let child = if port_answering() {
                eprintln!("[agentnet-desktop] port {PORT} already serving; reusing it");
                None
            } else {
                let node = node_bin()?;
                let server = server_js()?;
                eprintln!("[agentnet-desktop] spawning node server: {node} {server}");
                Some(spawn_server(&node, &server)?)
            };
            app.manage(ServerProcess(Mutex::new(child)));

            // (b) Wait until the server answers, up to ~30s.
            let deadline = Instant::now() + Duration::from_secs(30);
            while !port_answering() {
                if Instant::now() >= deadline {
                    return Err("AgentNet server did not answer on port 4317 within 30s".into());
                }
                std::thread::sleep(Duration::from_millis(200));
            }

            // (c) Only now create the window, pointed at the same-origin SPA.
            let window = WebviewWindowBuilder::new(
                app,
                "main",
                WebviewUrl::External(format!("http://localhost:{PORT}").parse().unwrap()),
            )
            .title("AgentNet")
            .inner_size(1240.0, 840.0)
            .min_inner_size(380.0, 640.0)
            .resizable(true)
            .build()?;

            // (d) Run in background on close: the red close button HIDES the
            // window instead of quitting. App + node server stay up; reopen
            // from the tray. Only the tray "Quit" (or Cmd-Q) really exits.
            window.on_window_event({
                let window = window.clone();
                move |event| {
                    if let WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = window.hide();
                    }
                }
            });

            // (e) System tray (macOS menu bar / Windows+Linux tray).
            let open = MenuItemBuilder::with_id("open", "Open AgentNet").build(app)?;
            let hide = MenuItemBuilder::with_id("hide", "Hide").build(app)?;
            let quit = MenuItemBuilder::with_id("quit", "Quit AgentNet").build(app)?;
            let menu = MenuBuilder::new(app)
                .items(&[&open, &hide])
                .separator()
                .item(&quit)
                .build()?;

            let mut tray = TrayIconBuilder::with_id("agentnet-tray")
                .menu(&menu)
                .show_menu_on_left_click(false) // left click toggles; right click opens the menu
                .tooltip("AgentNet")
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "open" => show_main_window(app),
                    "hide" => hide_main_window(app),
                    // app.exit(0) fires ExitRequested -> Exit below, so the
                    // node child is still reaped by kill_server.
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    }
                    | TrayIconEvent::DoubleClick {
                        button: MouseButton::Left,
                        ..
                    } = event
                    {
                        toggle_main_window(tray.app_handle());
                    }
                });
            // Her IQLabs atom as a macOS template icon (monochrome + alpha, so the
            // menu bar tints it for light/dark automatically).
            tray = tray
                .icon(tauri::include_image!("icons/tray-template@2x.png"))
                .icon_as_template(true);
            tray.build(app)?;
            eprintln!("[agentnet-desktop] tray icon ready");
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| match event {
            // macOS: clicking the dock icon re-shows the hidden window.
            #[cfg(target_os = "macos")]
            RunEvent::Reopen { .. } => show_main_window(app),
            // Fired on quit (tray "Quit" -> app.exit(0), or Cmd-Q):
            // reap the node child so we never leak servers.
            RunEvent::ExitRequested { .. } => kill_server(app),
            // Belt and braces: `take()` in kill_server makes this a no-op
            // if ExitRequested already cleaned up.
            RunEvent::Exit => kill_server(app),
            _ => {}
        });
}
