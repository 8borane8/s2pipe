use std::process::Command;

use crate::config::AppConfig;

#[derive(Clone, Copy)]
pub enum Backend {
    Cpu,
    Nvenc,
    Amf,
}

impl Backend {
    fn parse(name: &str) -> Option<Self> {
        match name.trim().to_ascii_lowercase().as_str() {
            "cpu" => Some(Self::Cpu),
            "nvenc" => Some(Self::Nvenc),
            "amf" => Some(Self::Amf),
            _ => None,
        }
    }
}

/// Backends to try, in order. "auto" walks the hardware ones first and keeps
/// the CPU as the last resort, since it is the only one always available.
pub fn backends(config: &AppConfig) -> Vec<Backend> {
    match Backend::parse(&config.video_encoder) {
        Some(backend) => vec![backend],
        None => vec![Backend::Nvenc, Backend::Amf, Backend::Cpu],
    }
}

fn is_hevc(config: &AppConfig) -> bool {
    matches!(
        config.video_codec.trim().to_ascii_lowercase().as_str(),
        "h265" | "hevc"
    )
}

fn bitrate(config: &AppConfig) -> String {
    let value = config.video_bitrate.trim();
    if value.is_empty() {
        "6M".to_string()
    } else {
        value.to_string()
    }
}

pub fn video(command: &mut Command, config: &AppConfig, backend: Backend) {
    let hevc = is_hevc(config);
    let gop = config.capture_fps.max(1).to_string();
    let rate = bitrate(config);

    command.args(["-an", "-c:v", codec_name(backend, hevc)]);

    match backend {
        Backend::Cpu if hevc => command.args([
            "-preset",
            "ultrafast",
            "-tune",
            "zerolatency",
            "-profile:v",
            "main",
            // libx265 hides the GOP and B-frame knobs behind its own option string.
            "-x265-params",
            &format!("bframes=0:keyint={gop}:min-keyint={gop}:scenecut=0:repeat-headers=1"),
        ]),
        Backend::Cpu => command.args([
            "-preset",
            "ultrafast",
            "-tune",
            "zerolatency",
            "-profile:v",
            "high",
            "-bf",
            "0",
            "-g",
            &gop,
            "-keyint_min",
            &gop,
            "-sc_threshold",
            "0",
        ]),
        Backend::Nvenc => command.args([
            "-preset",
            "p1",
            "-tune",
            "ull",
            "-profile:v",
            if hevc { "main" } else { "high" },
            "-rc",
            "cbr",
            "-bf",
            "0",
            "-delay",
            "0",
            "-no-scenecut",
            "1",
            "-forced-idr",
            "1",
            "-strict_gop",
            "1",
            "-g",
            &gop,
            "-keyint_min",
            &gop,
        ]),
        Backend::Amf => command.args([
            "-usage",
            "ultralowlatency",
            "-quality",
            "speed",
            "-profile:v",
            if hevc { "main" } else { "high" },
            "-rc",
            "cbr",
            "-bf",
            "0",
            "-header_insertion_mode",
            "idr",
            "-g",
            &gop,
        ]),
    };

    command.args([
        "-fps_mode",
        "cfr",
        "-r",
        &gop,
        "-pix_fmt",
        "yuv420p",
        "-b:v",
        &rate,
        "-maxrate",
        &rate,
        "-bufsize",
        &rate,
    ]);
}

fn codec_name(backend: Backend, hevc: bool) -> &'static str {
    match (backend, hevc) {
        (Backend::Cpu, false) => "libx264",
        (Backend::Cpu, true) => "libx265",
        (Backend::Nvenc, false) => "h264_nvenc",
        (Backend::Nvenc, true) => "hevc_nvenc",
        (Backend::Amf, false) => "h264_amf",
        (Backend::Amf, true) => "hevc_amf",
    }
}

pub fn audio(command: &mut Command) {
    command.args([
        "-vn",
        // A short capture buffer delivers slightly irregular timestamps, which
        // the Opus encoder rejects as going backward in time.
        "-af",
        "aresample=async=1:first_pts=0",
        "-c:a",
        "libopus",
        "-application",
        "lowdelay",
        "-frame_duration",
        "10",
        "-b:a",
        "64k",
        "-ar",
        "48000",
        "-ac",
        "2",
    ]);
}
