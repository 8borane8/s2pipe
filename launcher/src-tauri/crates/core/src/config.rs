use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AppConfig {
    pub node_port: String,
    pub node_base_url: String,
    pub client_port: String,
    pub exposure: String,

    pub media_ice_ip: String,
    pub media_ice_port: String,

    pub capture_source: String,
    pub capture_device: String,
    pub capture_audio: String,
    pub capture_format: String,
    pub capture_width: u32,
    pub capture_height: u32,
    pub capture_fps: u32,

    pub video_encoder: String,
    pub video_codec: String,
    pub video_bitrate: String,

    pub pico_serial: String,

    pub switch_bt_mac: String,
    pub controller_bt_mac: String,
    pub controller_bt_pid: String,

    pub launch_at_startup: bool,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            node_port: "5050".into(),
            node_base_url: "http://localhost:5050".into(),
            client_port: "5000".into(),
            exposure: "local".into(),
            media_ice_ip: "127.0.0.1".into(),
            media_ice_port: "8189".into(),
            capture_source: "test".into(),
            capture_device: String::new(),
            capture_audio: String::new(),
            capture_format: "yuyv422".into(),
            capture_width: 1920,
            capture_height: 1080,
            capture_fps: 60,
            video_encoder: "auto".into(),
            video_codec: "h264".into(),
            video_bitrate: "6M".into(),
            pico_serial: String::new(),
            switch_bt_mac: String::new(),
            controller_bt_mac: String::new(),
            controller_bt_pid: String::new(),
            launch_at_startup: false,
        }
    }
}

pub fn load_config() -> Result<Option<AppConfig>, String> {
    let path = config_path()?;
    if !path.exists() {
        return Ok(None);
    }

    let json = std::fs::read_to_string(&path).map_err(|e| format!("Failed to read config: {e}"))?;
    let config = serde_json::from_str(&json).map_err(|e| format!("Failed to parse config: {e}"))?;
    Ok(Some(config))
}

pub fn save_config(config: &AppConfig) -> Result<(), String> {
    crate::utils::paths::ensure_app_directory()?;
    let json = serde_json::to_string_pretty(config)
        .map_err(|e| format!("Failed to serialize config: {e}"))?;
    std::fs::write(config_path()?, json).map_err(|e| format!("Failed to write config: {e}"))?;
    Ok(())
}

fn config_path() -> Result<std::path::PathBuf, String> {
    Ok(crate::utils::paths::app_directory()?.join("config.json"))
}
