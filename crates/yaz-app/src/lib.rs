//! The yaz command surface, and the two programs that host it.
//!
//! This crate is intentionally thin. It wires the domain crates to the Tauri
//! command surface and owns no domain logic, so that everything meaningful stays
//! testable without a running application and reusable by a future CLI or
//! language server ([ADR-0017]).
//!
//! It is a library because there are two hosts: the desktop application
//! (`yaz`), and the web server (`yaz-web`, [ADR-0030]). Both call [`install`],
//! so there is one list of commands and no second place for it to drift.
//!
//! [ADR-0017]: https://github.com/texyaz/yaz/blob/main/docs/adr/0017-repository-layout.md
//! [ADR-0030]: https://github.com/texyaz/yaz/blob/main/docs/adr/0030-a-web-server-hosts-the-same-commands.md

#![deny(unsafe_code)]
#![deny(missing_docs)]
#![warn(clippy::all)]

mod appearance;
mod commands;
mod latex_installs;
mod mcp;
mod mcp_commands;
mod plugin_host;
mod plugin_updates;
mod vcs_commands;

pub use commands::StartupClock;

/// True when running in development mode.
///
/// Dev mode never contacts the update server or the live plugin registry, and
/// loads unpacked plugins from `dev-plugins/` with hot reload. Signature
/// verification is **not** relaxed — disabling it on the path developers
/// exercise daily is how it ends up disabled in a release build
/// ([ADR-0013](https://github.com/GeneralPawz/yaz/blob/main/docs/adr/0013-update-distribution.md)).
#[must_use]
pub fn is_dev_mode() -> bool {
    cfg!(debug_assertions) || std::env::var_os("YAZ_DEV").is_some()
}

/// Start logging and say what is starting.
///
/// Shared so that a log from the web server reads like a log from the
/// application, which is what somebody comparing the two will have open.
pub fn start_logging(host: &str) {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_env("YAZ_LOG")
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    tracing::info!(
        version = env!("CARGO_PKG_VERSION"),
        arch = std::env::consts::ARCH,
        os = std::env::consts::OS,
        dev_mode = is_dev_mode(),
        // Which certificate roots are in play. ADR-0019 makes this
        // machine-dependent, so a TLS failure is not reproducible without it.
        tls_roots = yaz_core::net::trust_roots().as_str(),
        host,
        "yaz starting"
    );
}

/// Read Zotero from another machine, forwarded to `endpoint`.
///
/// For a host that runs somewhere other than where the writer's Zotero does —
/// the web server. Call it after [`install`] has built the app and before the
/// first command; it is not itself a command, so nothing running inside yaz
/// can choose where Zotero requests go ([ADR-0008]).
///
/// [ADR-0008]: https://github.com/texyaz/yaz/blob/main/docs/adr/0008-zotero-integration.md
pub fn use_remote_zotero<R: tauri::Runtime>(
    app: &tauri::App<R>,
    endpoint: yaz_zotero::local_api::Endpoint,
) {
    use tauri::Manager as _;
    app.state::<plugin_host::PluginHost>()
        .use_remote_zotero(endpoint);
}

/// Give a host the whole command surface: the state and every command.
///
/// Generic over the runtime because the web server builds the same handler on
/// Tauri's mock runtime, where there is no window to draw ([ADR-0030]).
///
/// [ADR-0030]: https://github.com/texyaz/yaz/blob/main/docs/adr/0030-a-web-server-hosts-the-same-commands.md
#[must_use]
pub fn install<R: tauri::Runtime>(
    builder: tauri::Builder<R>,
    clock: StartupClock,
) -> tauri::Builder<R> {
    builder
        .manage(clock)
        .manage(plugin_host::PluginHost::new())
        // Off until asked: the server is not started here, only made
        // available to the command that starts it (ADR-0022).
        .manage(mcp::McpState::default())
        .manage(mcp::OpenProject::default())
        .invoke_handler(tauri::generate_handler![
            commands::open_project,
            commands::read_file,
            commands::write_file,
            commands::compile_project,
            commands::existing_build,
            commands::list_engines,
            commands::get_project_settings,
            commands::set_project_engine,
            commands::set_project_images,
            commands::create_directory,
            commands::create_file,
            commands::rename_entry,
            commands::delete_entry,
            commands::create_project,
            commands::set_project_workspace,
            commands::recent_projects,
            appearance::get_appearance,
            appearance::set_appearance,
            appearance::get_view_preferences,
            appearance::set_view_preferences,
            appearance::list_themes,
            appearance::theme_stylesheet,
            appearance::export_theme,
            appearance::install_theme,
            appearance::save_theme,
            appearance::get_key_preferences,
            appearance::set_key_preferences,
            appearance::get_format_preferences,
            appearance::set_format_preferences,
            appearance::get_development_plugin,
            appearance::set_development_plugin,
            latex_installs::get_latex_installs,
            latex_installs::scan_latex_installs,
            latex_installs::add_latex_install,
            latex_installs::remove_latex_install,
            latex_installs::verify_latex_install,
            mcp_commands::mcp_start,
            mcp_commands::mcp_stop,
            mcp_commands::mcp_status,
            mcp_commands::mcp_set_project,
            mcp_commands::mcp_set_plugin_tools,
            mcp_commands::mcp_drop_plugin_tools,
            mcp_commands::mcp_tool_result,
            vcs_commands::vcs_backends,
            vcs_commands::vcs_status,
            vcs_commands::vcs_enable,
            vcs_commands::vcs_disable,
            vcs_commands::vcs_commit,
            vcs_commands::vcs_history,
            vcs_commands::vcs_restore,
            commands::read_project_bytes,
            commands::write_project_bytes,
            commands::read_artefact,
            commands::locate_in_source,
            commands::report_ready,
            plugin_host::plugin_has_credential,
            plugin_host::plugin_set_credential,
            plugin_host::plugin_fetch_with_credential,
            plugin_host::plugin_get_settings,
            plugin_host::plugin_get_project_settings,
            plugin_host::plugin_set_project_settings,
            plugin_host::plugin_set_settings,
            plugin_host::plugin_zotero_status,
            plugin_host::plugin_zotero_refresh_bibliography,
            plugin_host::plugin_zotero_installed,
            plugin_host::plugin_zotero_launch,
            plugin_host::plugin_zotero_search,
            plugin_host::plugin_zotero_annotations,
            plugin_host::plugin_zotero_ensure_in_bibliography,
            plugin_host::plugin_zotero_reconnect,
            plugin_host::plugin_denials,
            plugin_host::plugin_list,
            plugin_updates::plugin_latest_release,
            plugin_host::plugin_set_project,
            plugin_host::plugin_set_zotero_data_dir,
        ])
}
