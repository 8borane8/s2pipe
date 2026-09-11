mod commands;

use s2pipe_core::{has_arg, install_launcher, load_config, run_watchdog, set_autostart, Stack};
use tauri::{Emitter, Manager};

fn show_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

pub fn run() {
    if has_arg("--watchdog") {
        run_watchdog();
        return;
    }

    let _ = install_launcher();

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            show_window(app);
        }))
        .setup(|app| {
            let handle = app.handle().clone();
            let launched_at_startup = has_arg("--autostart");

            let config = match load_config() {
                Ok(config) => config,
                Err(error) => {
                    eprintln!("Failed to load config: {error}");
                    None
                }
            };

            if launched_at_startup {
                match config {
                    Some(config) if config.launch_at_startup => {
                        let start_handle = handle.clone();
                        tauri::async_runtime::spawn(async move {
                            match Stack::start(config).await {
                                Ok(()) => start_handle.exit(0),
                                Err(error) => {
                                    eprintln!("Failed to auto-start s2pipe: {error}");
                                    show_window(&start_handle);
                                    let _ =
                                        start_handle.emit("stack-status", format!("error:{error}"));
                                }
                            }
                        });
                        return Ok(());
                    }
                    _ => {
                        let _ = set_autostart(false);
                        app.handle().exit(0);
                        return Ok(());
                    }
                }
            }

            show_window(&handle);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::scan_bluetooth_pad,
            commands::list_capture_devices,
            commands::list_audio_devices,
            commands::list_serial_ports,
            commands::load_last_config,
            commands::save_app_config,
            commands::is_stack_running,
            commands::local_ip,
            commands::public_ip,
            commands::start_s2pipe,
            commands::stop_s2pipe,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
