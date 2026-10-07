mod autostart;
mod chain_secrets;
mod desktop_links;
mod diagnostics;
mod document_windows;
mod e2e;
mod file_association;
mod files;
mod font_source;
mod launch;
mod lens;
mod navigation;
mod rpc;
mod secret_injection;
mod session_file;
mod shell_integration;
mod sidecar;
mod tray;
mod view_source;
mod watch_debounce;
mod watch_paths;
mod watch_tickets;
mod watcher;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    if std::env::args()
        .skip(1)
        .any(|argument| argument == chain_secrets::FORGET_FLAG)
    {
        chain_secrets::forget_everything();
        return;
    }
    desktop_links::declare_app_id();
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            let background = autostart::started_in_background(argv.iter().skip(1));
            let request = launch::parse(argv.into_iter().skip(1), Some(std::path::Path::new(&cwd)));
            document_windows::deliver_launch(app, request, !background);
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(e2e::dialog_plugin())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(navigation::guard())
        .manage(sidecar::Sidecar::default())
        .manage(watcher::Watchers::default())
        .manage(tray::TrayState::default())
        .manage(document_windows::DocumentWindows::default())
        .manage(chain_secrets::ChainSecrets::default())
        .manage(watch_tickets::WatchTickets::default())
        .manage(view_source::ViewSources::default())
        .register_asynchronous_uri_scheme_protocol(
            view_source::SCHEME,
            |context, request, responder| {
                let app = context.app_handle().clone();
                let window = context.webview_label().to_string();
                tauri::async_runtime::spawn_blocking(move || {
                    use tauri::Manager;
                    let sources = app.state::<view_source::ViewSources>();
                    responder.respond(view_source::respond(
                        &sources,
                        &request,
                        &window,
                        cfg!(debug_assertions),
                    ));
                });
            },
        )
        .register_asynchronous_uri_scheme_protocol(
            font_source::SCHEME,
            |context, request, responder| {
                let app = context.app_handle().clone();
                let window = context.webview_label().to_string();
                tauri::async_runtime::spawn_blocking(move || {
                    use tauri::Emitter;
                    let fonts_dir = font_source::fonts_dir();
                    let outcome = font_source::respond(
                        &request,
                        cfg!(debug_assertions),
                        fonts_dir.as_deref(),
                        |name| font_source::bundled_font(&app, name),
                    );
                    if let Some(set) = &outcome.missing {
                        let _ = app.emit_to(window.as_str(), font_source::MISSING_EVENT, set);
                    }
                    responder.respond(outcome.response);
                });
            },
        )
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                use tauri::Manager;
                window
                    .state::<document_windows::DocumentWindows>()
                    .release_window(window.label());
                window
                    .state::<view_source::ViewSources>()
                    .release_window(window.label());
            }
        })
        .setup(|app| {
            chain_secrets::load_index(app.handle());
            view_source::clear_snapshots(app.handle());
            tray::prepare_startup(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            rpc::rpc,
            rpc::rpc_cancel,
            files::read_document,
            files::write_document,
            files::delete_file,
            launch::launch_request,
            document_windows::window_open,
            document_windows::document_claim,
            document_windows::document_claims_sync,
            desktop_links::send_to_supported,
            desktop_links::send_to_enabled,
            desktop_links::set_send_to,
            desktop_links::remember_recent_document,
            file_association::file_association_enabled,
            file_association::file_association_stale,
            file_association::set_file_association,
            file_association::open_default_apps_settings,
            shell_integration::shell_integration_supported,
            shell_integration::shell_integration_enabled,
            shell_integration::shell_integration_stale,
            shell_integration::set_shell_integration,
            watcher::watch_folder_start,
            watcher::watch_folder_stop,
            watcher::watch_path_relation,
            session_file::session_read,
            session_file::session_write,
            diagnostics::log_line,
            diagnostics::diagnostics_info,
            diagnostics::open_log_dir,
            diagnostics::write_text_file,
            diagnostics::reveal_path,
            diagnostics::path_exists,
            diagnostics::path_kinds,
            files::open_produced_picture,
            files::open_produced_file,
            files::open_folder,
            lens::search_picture_with_lens,
            tray::tray_configure,
            tray::window_hide_to_tray,
            autostart::autostart_status,
            autostart::autostart_set,
            chain_secrets::chain_secret_store,
            chain_secrets::chain_secret_status,
            chain_secrets::chain_secret_delete,
            chain_secrets::chain_secret_prune,
            chain_secrets::chain_secret_purge_all,
            chain_secrets::rpc_with_chain_secret,
            watch_tickets::watch_ticket,
            watch_tickets::watch_ticket_release,
            view_source::view_source,
            view_source::view_source_release
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    files::set_produced_store(app.handle());
    diagnostics::install_panic_hook(app.handle().clone());

    app.run(|handle, event| match event {
        tauri::RunEvent::Exit => {
            sidecar::shutdown(handle);
            view_source::clear_snapshots(handle);
        }
        #[cfg(target_os = "macos")]
        tauri::RunEvent::Opened { urls } => {
            let paths: Vec<String> = urls
                .iter()
                .filter_map(|url| url.to_file_path().ok())
                .map(|path| path.to_string_lossy().to_string())
                .collect();
            document_windows::deliver_launch(
                handle,
                launch::LaunchRequest { tool: None, paths },
                true,
            );
        }
        _ => {}
    });
}
