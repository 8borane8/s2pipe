use std::path::{Path, PathBuf};
use std::process::Command;

use crate::config::AppConfig;
use crate::utils::bin::ensure_downloaded;
use crate::utils::paths::{app_directory, log_path};
use crate::utils::process::spawn_logged;

const DENO_VERSION: &str = "2.9.6";

pub async fn ensure() -> Result<PathBuf, String> {
    if cfg!(debug_assertions) {
        return Ok(PathBuf::from("deno"));
    }

    let (url, archive) = if cfg!(target_os = "windows") {
        (
            format!(
                "https://github.com/denoland/deno/releases/download/v{DENO_VERSION}/\
                 deno-x86_64-pc-windows-msvc.zip"
            ),
            format!("deno-{DENO_VERSION}.zip"),
        )
    } else if cfg!(target_os = "linux") {
        (
            format!(
                "https://github.com/denoland/deno/releases/download/v{DENO_VERSION}/\
                 deno-x86_64-unknown-linux-gnu.zip"
            ),
            format!("deno-{DENO_VERSION}.zip"),
        )
    } else {
        return Err("Unsupported operating system".into());
    };

    ensure_downloaded("deno", &url, &archive).await
}

pub fn start_node(deno: &Path, workspace: &Path, config: &AppConfig) -> Result<u32, String> {
    spawn_app(
        deno,
        workspace,
        workspace
            .join("apps")
            .join("node")
            .join("src")
            .join("index.ts"),
        [
            ("NODE_PORT", config.node_port.as_str()),
            ("MEDIA_HOST", "127.0.0.1"),
            ("CAPTURE_SOURCE", config.capture_source.as_str()),
            ("PICO_SERIAL", config.pico_serial.as_str()),
            ("SWITCH_BT_MAC", config.switch_bt_mac.as_str()),
            ("CONTROLLER_BT_MAC", config.controller_bt_mac.as_str()),
            ("CONTROLLER_BT_PID", config.controller_bt_pid.as_str()),
        ],
        "node",
    )
}

pub fn start_client(deno: &Path, workspace: &Path, config: &AppConfig) -> Result<u32, String> {
    spawn_app(
        deno,
        workspace,
        workspace
            .join("apps")
            .join("client")
            .join("src")
            .join("index.ts"),
        [
            ("CLIENT_PORT", config.client_port.as_str()),
            ("NODE_BASE_URL", config.node_base_url.as_str()),
        ],
        "client",
    )
}

fn spawn_app<'a>(
    deno: &Path,
    workspace: &Path,
    entry: PathBuf,
    env: impl IntoIterator<Item = (&'a str, &'a str)>,
    name: &str,
) -> Result<u32, String> {
    if !entry.exists() {
        return Err(format!("App entry not found: {}", entry.display()));
    }

    let mut command = Command::new(deno);
    command
        .arg("run")
        .arg("-A")
        .arg("--config")
        .arg(workspace.join("deno.json"))
        .arg(&entry)
        .current_dir(workspace)
        .env("DENO_DIR", app_directory()?.join("deno"));

    for (key, value) in env {
        command.env(key, value);
    }

    spawn_logged(command, name, &log_path(name)?)
}
