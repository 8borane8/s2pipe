use std::io::{Read, Write};
use std::time::{Duration, Instant};

use crate::config::AppConfig;
use crate::utils::process::{kill_child, Ffmpeg};

use super::{should_start_audio, start_audio, start_video};

const STALL: Duration = Duration::from_secs(10);

pub async fn run() -> Result<(), String> {
    let mut json = String::new();
    std::io::stdin()
        .read_to_string(&mut json)
        .map_err(|e| format!("Failed to read watchdog config: {e}"))?;
    let config: AppConfig =
        serde_json::from_str(&json).map_err(|e| format!("Invalid watchdog config: {e}"))?;

    let video = start_video(&config).await?;
    let audio = if should_start_audio(&config) {
        match start_audio(&config).await {
            Ok(audio) => Some(audio),
            Err(error) => {
                video.kill();
                return Err(error);
            }
        }
    } else {
        None
    };

    println!("READY");
    let _ = std::io::stdout().flush();

    if let Some(audio) = audio {
        tokio::join!(
            keep_alive("FFmpeg video", false, &config, video),
            keep_alive("FFmpeg audio", true, &config, audio),
        );
    } else {
        keep_alive("FFmpeg video", false, &config, video).await;
    }
    Ok(())
}

async fn keep_alive(label: &str, audio: bool, config: &AppConfig, mut ffmpeg: Ffmpeg) {
    loop {
        let mut last = 0;
        let mut changed = Instant::now();
        while ffmpeg.alive() {
            let time = ffmpeg.out_time_us();
            if time > last {
                last = time;
                changed = Instant::now();
            } else if changed.elapsed() >= STALL {
                eprintln!("WATCHDOG: {label} frozen, killing PID {}", ffmpeg.child.id());
                kill_child(&mut ffmpeg.child);
                break;
            }
            tokio::time::sleep(Duration::from_secs(1)).await;
        }
        ffmpeg = restart(label, audio, config).await;
    }
}

async fn restart(label: &str, audio: bool, config: &AppConfig) -> Ffmpeg {
    loop {
        let started = if audio {
            start_audio(config).await
        } else {
            start_video(config).await
        };
        match started {
            Ok(ffmpeg) => return ffmpeg,
            Err(error) => {
                eprintln!("{label} restart failed: {error}");
                tokio::time::sleep(Duration::from_secs(1)).await;
            }
        }
    }
}
