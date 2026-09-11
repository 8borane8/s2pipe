mod encoder;
mod input;
mod runner;

use std::process::Command;

use crate::config::AppConfig;
use crate::utils::bin::{bin_path, ensure_downloaded};
use crate::utils::paths::log_path;
use crate::utils::process::spawn_logged;

use encoder::Backend;
use runner::run;

const FFMPEG_VERSION: &str = "9.0";
const RTSP_VIDEO: &str = "rtsp://127.0.0.1:8554/switch";
const RTSP_AUDIO: &str = "rtsp://127.0.0.1:8554/switch-audio";

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

pub fn should_start_audio(config: &AppConfig) -> bool {
    input::is_test(config) || !config.capture_audio.trim().is_empty()
}

#[derive(Clone, Copy)]
struct VideoAttempt {
    backend: Backend,
    loose: bool,
}

pub async fn start_video(config: &AppConfig) -> Result<u32, String> {
    let log = log_path("ffmpeg-video")?;
    let backends = encoder::backends(config);

    // Strict first on every backend: a missing GPU and a capture card that
    // refuses the requested mode look the same until FFmpeg exits.
    let mut attempts: Vec<VideoAttempt> = backends
        .iter()
        .map(|&backend| VideoAttempt {
            backend,
            loose: false,
        })
        .collect();

    if !input::is_test(config) {
        attempts.extend(backends.iter().map(|&backend| VideoAttempt {
            backend,
            loose: true,
        }));
    }

    run("FFmpeg video", &log, &attempts, |attempt| {
        let mut command = ffmpeg_command()?;
        input::video(&mut command, config, attempt.loose)?;
        encoder::video(&mut command, config, attempt.backend);
        rtsp_output(&mut command, RTSP_VIDEO);
        spawn_logged(command, "FFmpeg video", &log)
    })
    .await
}

pub async fn start_audio(config: &AppConfig) -> Result<u32, String> {
    let log = log_path("ffmpeg-audio")?;
    // DirectShow's default capture buffer is hundreds of milliseconds. A short
    // one may be refused, so Windows retries without it. ALSA has no such knob.
    let attempts = if cfg!(target_os = "windows") && !input::is_test(config) {
        vec![true, false]
    } else {
        vec![false]
    };

    run("FFmpeg audio", &log, &attempts, |small_buffer| {
        let mut command = ffmpeg_command()?;
        input::audio(&mut command, config, small_buffer)?;
        encoder::audio(&mut command);
        rtsp_output(&mut command, RTSP_AUDIO);
        spawn_logged(command, "FFmpeg audio", &log)
    })
    .await
}

fn ffmpeg_command() -> Result<Command, String> {
    let path = bin_path("ffmpeg")?;
    if !path.exists() {
        return Err(format!("FFmpeg binary not found: {}", path.display()));
    }
    let mut command = Command::new(path);
    command.args(["-hide_banner", "-nostats", "-loglevel", "warning"]);
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
