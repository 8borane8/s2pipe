use crate::config::AppConfig;
use crate::runtime::{apps, deno, ffmpeg, mediamtx};
use crate::utils::bin::install_launcher;
use crate::utils::paths::{app_directory, ensure_app_directory, log_path};
use crate::utils::process::{kill_pid, kill_pid_force, pid_alive, spawn_worker, with_log_tail};

use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Default, Serialize, Deserialize)]
#[serde(default)]
struct StackPids {
    ffmpeg_watchdog: Option<u32>,
    mediamtx: Option<u32>,
    node: Option<u32>,
    client: Option<u32>,
}

impl StackPids {
    fn pids(&self) -> impl Iterator<Item = u32> {
        [
            self.ffmpeg_watchdog,
            self.client,
            self.node,
            self.mediamtx,
        ]
        .into_iter()
        .flatten()
    }

    fn is_running(&self) -> bool {
        self.pids().any(pid_alive)
    }

    fn kill_all(&self) {
        if let Some(pid) = self.ffmpeg_watchdog {
            kill_pid_force(pid);
        }
        for pid in self.pids() {
            if Some(pid) != self.ffmpeg_watchdog {
                kill_pid(pid);
            }
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

        let watchdog_bin = install_launcher()?;
        let workspace = apps::ensure()?;
        ffmpeg::ensure().await?;
        mediamtx::ensure().await?;
        let deno_bin = deno::ensure().await?;
        mediamtx::write_config(&config)?;

        let mut pids = StackPids::default();
        let started = async {
            // Each pid is written as soon as it exists: a launcher killed
            // mid-start otherwise leaves orphans that hold :8554 and :8000,
            // and the next start fails on a port that nothing owns anymore.
            let mediamtx_pid = mediamtx::start()?;
            pids.mediamtx = Some(mediamtx_pid);
            save_pids(&pids)?;
            wait_for_port(8554, "MediaMTX", mediamtx_pid, &log_path("mediamtx")?).await?;

            pids.ffmpeg_watchdog = Some(start_ffmpeg_watchdog(&watchdog_bin, &config).await?);
            save_pids(&pids)?;

            let node_pid = deno::start_node(&deno_bin, &workspace, &config)?;
            pids.node = Some(node_pid);
            save_pids(&pids)?;
            let client_pid = deno::start_client(&deno_bin, &workspace, &config)?;
            pids.client = Some(client_pid);
            save_pids(&pids)?;

            wait_for_port(node_port, "Node", node_pid, &log_path("node")?).await?;
            wait_for_port(client_port, "Client", client_pid, &log_path("client")?).await?;
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

async fn start_ffmpeg_watchdog(binary: &Path, config: &AppConfig) -> Result<u32, String> {
    let json =
        serde_json::to_vec(config).map_err(|e| format!("Failed to encode watchdog config: {e}"))?;
    let log = log_path("ffmpeg-watchdog")?;
    let mut command = Command::new(binary);
    command.arg("--watchdog");
    let (mut child, stdout) = spawn_worker(command, "FFmpeg watchdog", &log, &json)?;
    let pid = child.id();
    let ready = tokio::task::spawn_blocking(move || {
        let mut line = String::new();
        BufReader::new(stdout).read_line(&mut line).map(|_| line)
    });

    let error = match tokio::time::timeout(std::time::Duration::from_secs(60), ready).await {
        Ok(Ok(Ok(line))) if line.trim() == "READY" => return Ok(pid),
        Ok(Ok(Ok(_))) => "FFmpeg watchdog exited before becoming ready".into(),
        Ok(Ok(Err(error))) => format!("Failed to read FFmpeg watchdog status: {error}"),
        Ok(Err(error)) => format!("FFmpeg watchdog status task failed: {error}"),
        Err(_) => "FFmpeg watchdog did not become ready".into(),
    };
    kill_pid_force(pid);
    let _ = child.wait();
    Err(with_log_tail(error, &log))
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

async fn wait_for_port(port: u16, name: &str, pid: u32, log: &Path) -> Result<(), String> {
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(60);
    loop {
        if !pid_alive(pid) {
            return Err(with_log_tail(
                format!("{name} exited before opening :{port}"),
                log,
            ));
        }
        if tokio::net::TcpStream::connect(("127.0.0.1", port))
            .await
            .is_ok()
        {
            return Ok(());
        }
        if std::time::Instant::now() >= deadline {
            return Err(with_log_tail(format!("{name} did not open :{port}"), log));
        }
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    }
}
