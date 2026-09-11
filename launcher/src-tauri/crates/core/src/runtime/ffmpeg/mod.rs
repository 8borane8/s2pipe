mod encoder;
mod input;
mod watchdog;

use std::path::Path;
use std::process::Command;
use std::time::Duration;

use crate::config::AppConfig;
use crate::utils::bin::{bin_path, ensure_downloaded};
use crate::utils::paths::log_path;
use crate::utils::process::{spawn_ffmpeg, with_log_tail, Ffmpeg};

pub(crate) use watchdog::run as run_watchdog;

const FFMPEG_VERSION: &str = "9.0";
const RTSP_VIDEO: &str = "rtsp://127.0.0.1:8554/switch";
const RTSP_AUDIO: &str = "rtsp://127.0.0.1:8554/switch-audio";
const FIRST_OUTPUT: Duration = Duration::from_secs(8);

pub async fn ensure() -> Result<(), String> {
    let (url, archive) = if cfg!(target_os = "windows") {
        (
            format!(
                "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/\
                 ffmpeg-n{FFMPEG_VERSION}-latest-win64-gpl-{FFMPEG_VERSION}.zip"
            ),
            format!("ffmpeg-{FFMPEG_VERSION}.zip"),
        )
    } else if cfg!(target_os = "linux") {
        (
            format!(
                "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/\
                 ffmpeg-n{FFMPEG_VERSION}-latest-linux64-gpl-{FFMPEG_VERSION}.tar.xz"
            ),
            format!("ffmpeg-{FFMPEG_VERSION}.tar.xz"),
        )
    } else {
        return Err("Unsupported operating system".into());
    };

    ensure_downloaded("ffmpeg", &url, &archive)
        .await
        .map(|_| ())
}

fn should_start_audio(config: &AppConfig) -> bool {
    input::is_test(config) || !config.capture_audio.trim().is_empty()
}

async fn start_video(config: &AppConfig) -> Result<Ffmpeg, String> {
    let log = log_path("ffmpeg-video")?;
    let backends = encoder::backends(config);
    let mut attempts = Vec::new();
    for &backend in &backends {
        attempts.push((backend, false));
    }
    if !input::is_test(config) {
        for &backend in &backends {
            attempts.push((backend, true));
        }
    }

    first_output("FFmpeg video", &log, &attempts, |&(backend, loose)| {
        let mut command = ffmpeg_command()?;
        input::video(&mut command, config, loose)?;
        encoder::video(&mut command, config, backend);
        rtsp_output(&mut command, RTSP_VIDEO);
        spawn_ffmpeg(command, "FFmpeg video", &log)
    })
    .await
}

async fn start_audio(config: &AppConfig) -> Result<Ffmpeg, String> {
    let log = log_path("ffmpeg-audio")?;
    let attempts = if cfg!(target_os = "windows") && !input::is_test(config) {
        vec![true, false]
    } else {
        vec![false]
    };

    first_output("FFmpeg audio", &log, &attempts, |&small_buffer| {
        let mut command = ffmpeg_command()?;
        input::audio(&mut command, config, small_buffer)?;
        encoder::audio(&mut command);
        rtsp_output(&mut command, RTSP_AUDIO);
        spawn_ffmpeg(command, "FFmpeg audio", &log)
    })
    .await
}

async fn first_output<T>(
    label: &str,
    log: &Path,
    attempts: &[T],
    mut spawn: impl FnMut(&T) -> Result<Ffmpeg, String>,
) -> Result<Ffmpeg, String> {
    let mut spawn_error = None;
    let mut started = false;
    for attempt in attempts {
        match spawn(attempt) {
            Ok(mut ffmpeg) => {
                started = true;
                if ffmpeg.wait_output(FIRST_OUTPUT).await {
                    return Ok(ffmpeg);
                }
                ffmpeg.kill();
            }
            Err(error) => spawn_error = Some(error),
        }
    }
    if started {
        Err(with_log_tail(format!("{label} produced no output"), log))
    } else {
        Err(spawn_error.unwrap_or_else(|| format!("{label} could not be started")))
    }
}

fn ffmpeg_command() -> Result<Command, String> {
    let path = bin_path("ffmpeg")?;
    if !path.exists() {
        return Err(format!("FFmpeg binary not found: {}", path.display()));
    }
    let mut command = Command::new(path);
    command.args([
        "-hide_banner",
        "-nostats",
        "-loglevel",
        "warning",
        "-progress",
        "pipe:2",
    ]);
    Ok(command)
}

fn rtsp_output(command: &mut Command, url: &str) {
    command.args([
        "-flush_packets",
        "1",
        "-muxdelay",
        "0",
        "-muxpreload",
        "0",
        "-f",
        "rtsp",
        "-rtsp_transport",
        "tcp",
        url,
    ]);
}
