//! The yaz desktop application binary.
//!
//! Everything it can do is in the library beside it; this is the host that
//! draws a window around that.

// Release builds are GUI binaries: without this, launching yaz from Explorer
// also opens a console window behind it.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
#![deny(unsafe_code)]
#![warn(clippy::all)]

fn main() {
    // Taken first thing, so the startup measurement covers process start rather
    // than starting from whenever the window happened to be created.
    let clock = yaz_app::StartupClock::now();

    yaz_app::start_logging("desktop");

    yaz_app::install(
        tauri::Builder::default().plugin(tauri_plugin_dialog::init()),
        clock,
    )
    .setup(|_app| {
        if yaz_app::is_dev_mode() {
            tracing::warn!("development mode: updater and live plugin registry are disabled");
        }
        Ok(())
    })
    .run(tauri::generate_context!())
    .expect("failed to start the yaz application");
}
