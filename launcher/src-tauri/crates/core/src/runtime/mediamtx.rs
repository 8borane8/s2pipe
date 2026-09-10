use std::process::Command;

use crate::config::AppConfig;
use crate::utils::bin::{bin_path, ensure_downloaded};
use crate::utils::paths::app_directory;
use crate::utils::process::spawn_detached;

const MEDIAMTX_VERSION: &str = "1.20.1";

pub async fn ensure() -> Result<(), String> {
    let (url, archive) = if cfg!(target_os = "windows") {
        (
            format!(
                "https://github.com/bluenviron/mediamtx/releases/download/v{MEDIAMTX_VERSION}/\
                 mediamtx_v{MEDIAMTX_VERSION}_windows_amd64.zip"
            ),
            format!("mediamtx-{MEDIAMTX_VERSION}.zip"),
        )
    } else if cfg!(target_os = "linux") {
        (
            format!(
                "https://github.com/bluenviron/mediamtx/releases/download/v{MEDIAMTX_VERSION}/\
                 mediamtx_v{MEDIAMTX_VERSION}_linux_amd64.tar.gz"
            ),
            format!("mediamtx-{MEDIAMTX_VERSION}.tar.gz"),
        )
    } else {
        return Err("Unsupported operating system".into());
    };

    ensure_downloaded("mediamtx", &url, &archive)
        .await
        .map(|_| ())
}

pub fn write_config(config: &AppConfig) -> Result<(), String> {
    let yaml = format!(
        r#"logLevel: warn
rtsp: true
rtspAddress: 127.0.0.1:8554
hls: false
webrtc: true
webrtcAddress: :8889
webrtcEncryption: no
webrtcAllowOrigins: ['*']
webrtcLocalUDPAddress: :{}
webrtcIPsFromInterfaces: no
webrtcAdditionalHosts: ["{}"]
rtmp: false
srt: false
playback: false
api: false
metrics: false

writeQueueSize: 8192
writeTimeout: 10s
readTimeout: 10s

paths:
  switch:
    source: publisher
  switch-audio:
    source: publisher
"#,
        config.media_ice_port, config.media_ice_ip,
    );

    std::fs::write(config_path()?, yaml)
        .map_err(|e| format!("Failed to write MediaMTX config: {e}"))
}

pub fn start() -> Result<u32, String> {
    let binary = bin_path("mediamtx")?;
    let config = config_path()?;

    if !binary.exists() {
        return Err(format!("MediaMTX binary not found: {}", binary.display()));
    }
    if !config.exists() {
        return Err(format!("MediaMTX config not found: {}", config.display()));
    }

    let mut command = Command::new(binary);
    command.arg(&config);
    command.current_dir(app_directory()?);
    spawn_detached(command, "MediaMTX")
}

fn config_path() -> Result<std::path::PathBuf, String> {
    Ok(app_directory()?.join("mediamtx.yml"))
}
