use crate::config::AppConfig;
use crate::runtime::{apps, deno, ffmpeg, mediamtx};
use crate::utils::paths::{app_directory, ensure_app_directory};
use crate::utils::process::{kill_pid, pid_alive};

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Default, Serialize, Deserialize)]
#[serde(default)]
struct StackPids {
    mediamtx: Option<u32>,
    ffmpeg: Option<u32>,
    ffmpeg_audio: Option<u32>,
    node: Option<u32>,
    client: Option<u32>,
}

impl StackPids {
    fn pids(&self) -> impl Iterator<Item = u32> {
        [
            self.client,
            self.node,
            self.ffmpeg,
            self.ffmpeg_audio,
            self.mediamtx,
        ]
        .into_iter()
        .flatten()
    }

    fn is_running(&self) -> bool {
        self.pids().any(pid_alive)
    }

    fn kill_all(&self) {
        for pid in self.pids() {
            kill_pid(pid);
        }
    }
}

pub struct Stack;

impl Stack {
    pub fn is_running() -> bool {
        load_pids().is_some_and(|pids| pids.is_running())
    }

    pub fn stop() -> Result<(), String> {
        if let Some(pids) = load_pids() {
            pids.kill_all();
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(2);
            while pids.is_running() && std::time::Instant::now() < deadline {
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
            // COM handles can linger a tick after the process exit code flips.
            std::thread::sleep(std::time::Duration::from_millis(150));
        }
        let _ = std::fs::remove_file(pids_path()?);
        Ok(())
    }

    pub async fn start(config: AppConfig) -> Result<(), String> {
        let node_port = parse_port(&config.node_port, "node")?;
        let client_port = parse_port(&config.client_port, "client")?;
        parse_port(&config.media_ice_port, "ICE")?;

        ensure_app_directory()?;
        let _ = Self::stop();

        let workspace = apps::ensure()?;
        ffmpeg::ensure().await?;
        mediamtx::ensure().await?;
        let deno_bin = deno::ensure().await?;
        mediamtx::write_config(&config)?;

        let mut pids = StackPids::default();
        let started = async {
            let mediamtx_pid = mediamtx::start()?;
            pids.mediamtx = Some(mediamtx_pid);
            wait_for_port(8554, "MediaMTX", mediamtx_pid).await?;

            pids.ffmpeg = Some(ffmpeg::start_video(&config).await?);

            if ffmpeg::should_start_audio(&config) {
                pids.ffmpeg_audio = Some(ffmpeg::start_audio(&config).await?);
            }

            let node_pid = deno::start_node(&deno_bin, &workspace, &config)?;
            pids.node = Some(node_pid);
            let client_pid = deno::start_client(&deno_bin, &workspace, &config)?;
            pids.client = Some(client_pid);

            save_pids(&pids)?;
            wait_for_port(node_port, "Node", node_pid).await?;
            wait_for_port(client_port, "Client", client_pid).await?;
            Ok::<(), String>(())
        }
        .await;

        if let Err(error) = started {
            pids.kill_all();
            let _ = std::fs::remove_file(pids_path()?);
            return Err(error);
        }

        Ok(())
    }
}

fn pids_path() -> Result<PathBuf, String> {
    Ok(app_directory()?.join("stack.json"))
}

fn load_pids() -> Option<StackPids> {
    let path = pids_path().ok()?;
    let json = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&json).ok()
}

fn save_pids(pids: &StackPids) -> Result<(), String> {
    let json = serde_json::to_string_pretty(pids)
        .map_err(|e| format!("Failed to serialize stack pids: {e}"))?;
    std::fs::write(pids_path()?, json).map_err(|e| format!("Failed to write stack pids: {e}"))
}

fn parse_port(value: &str, name: &str) -> Result<u16, String> {
    let port: u16 = value
        .trim()
        .parse()
        .map_err(|_| format!("Invalid {name} port"))?;
    if port == 0 {
        return Err(format!("Invalid {name} port"));
    }
    Ok(port)
}

async fn wait_for_port(port: u16, name: &str, pid: u32) -> Result<(), String> {
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(60);
    loop {
        if !pid_alive(pid) {
            return Err(format!("{name} exited before opening :{port}"));
        }
        if tokio::net::TcpStream::connect(("127.0.0.1", port))
            .await
            .is_ok()
        {
            return Ok(());
        }
        if std::time::Instant::now() >= deadline {
            return Err(format!("{name} did not open :{port}"));
        }
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    }
}
