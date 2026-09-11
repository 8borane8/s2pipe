use s2pipe_core::{
    local_ip as detect_local_ip, public_ip as detect_public_ip, set_autostart, AppConfig,
    AudioDevice, CaptureDevice, SerialPortInfo, Stack, WakeScanResult,
};

#[tauri::command]
pub async fn scan_bluetooth_pad(timeout_ms: u64) -> Result<Option<WakeScanResult>, String> {
    s2pipe_core::scan_bluetooth_pad(timeout_ms).await
}

#[tauri::command]
pub async fn list_capture_devices() -> Result<Vec<CaptureDevice>, String> {
    s2pipe_core::list_capture_devices().await
}

#[tauri::command]
pub async fn list_audio_devices() -> Result<Vec<AudioDevice>, String> {
    s2pipe_core::list_audio_devices().await
}

#[tauri::command]
pub fn list_serial_ports() -> Result<Vec<SerialPortInfo>, String> {
    s2pipe_core::list_serial_ports()
}

#[tauri::command]
pub fn load_last_config() -> Result<Option<AppConfig>, String> {
    s2pipe_core::load_config()
}

#[tauri::command]
pub async fn save_app_config(config: AppConfig) -> Result<(), String> {
    s2pipe_core::save_config(&config)?;
    set_autostart(config.launch_at_startup)?;
    Ok(())
}

#[tauri::command]
pub fn is_stack_running() -> bool {
    Stack::is_running()
}

#[tauri::command]
pub fn local_ip() -> Result<String, String> {
    detect_local_ip()
}

#[tauri::command]
pub async fn public_ip() -> Result<String, String> {
    detect_public_ip().await
}

#[tauri::command]
pub async fn start_s2pipe(config: AppConfig) -> Result<(), String> {
    save_app_config(config.clone()).await?;
    Stack::start(config.clone()).await?;
    let _ = open::that_detached(format!("http://127.0.0.1:{}", config.client_port));
    Ok(())
}

#[tauri::command]
pub fn stop_s2pipe() -> Result<(), String> {
    Stack::stop()
}
