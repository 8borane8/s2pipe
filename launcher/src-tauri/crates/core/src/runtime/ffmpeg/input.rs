use std::process::Command;

use crate::config::AppConfig;

pub fn is_test(config: &AppConfig) -> bool {
    config.capture_source == "test"
}

/// `loose` drops the requested size, framerate and pixel format, letting the
/// driver pick whatever it actually supports.
pub fn video(command: &mut Command, config: &AppConfig, loose: bool) -> Result<(), String> {
    let size = format!("{}x{}", config.capture_width, config.capture_height);
    let fps = config.capture_fps.to_string();

    if is_test(config) {
        command.args([
            "-re",
            "-f",
            "lavfi",
            "-i",
            &format!("testsrc2=size={size}:rate={fps}"),
        ]);
        return Ok(());
    }

    let device = config.capture_device.trim();
    if device.is_empty() {
        return Err("No capture device selected".into());
    }

    command.args([
        "-fflags",
        "+genpts+igndts+discardcorrupt+nobuffer",
        "-flags",
        "low_delay",
        "-probesize",
        "32",
        "-analyzeduration",
        "0",
        "-thread_queue_size",
        "2048",
    ]);

    #[cfg(target_os = "windows")]
    {
        if looks_like_device_path(device) {
            return Err(
                "Re-select the camera in the launcher. Windows needs the camera name, not the device path."
                    .into(),
            );
        }
        command.args(["-rtbufsize", "16M", "-f", "dshow"]);
        if !loose {
            command.args(["-video_size", &size, "-framerate", &fps]);
            match config.capture_format.trim() {
                "" | "yuyv422" => {}
                "mjpeg" => {
                    command.args(["-vcodec", "mjpeg"]);
                }
                other => {
                    command.args(["-pixel_format", other]);
                }
            }
        }
        command.args(["-i", &format!("video={device}")]);
        Ok(())
    }

    #[cfg(target_os = "linux")]
    {
        command.args(["-f", "v4l2"]);
        if !loose {
            command.args(["-video_size", &size, "-framerate", &fps]);
            let format = config.capture_format.trim();
            if !format.is_empty() {
                command.args(["-input_format", format]);
            }
        }
        command.args(["-i", device]);
        Ok(())
    }

    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    {
        let _ = (command, loose, size, fps, device);
        Err("Unsupported operating system".into())
    }
}

/// `small_buffer` asks the driver for a short capture buffer. DirectShow
/// otherwise defaults to a multiple of 500 ms, which is audible as lip sync
/// drift, but a device may refuse a buffer that short.
pub fn audio(command: &mut Command, config: &AppConfig, small_buffer: bool) -> Result<(), String> {
    if is_test(config) {
        command.args([
            "-re",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:sample_rate=48000",
        ]);
        return Ok(());
    }

    let device = config.capture_audio.trim();
    if device.is_empty() {
        return Err("No audio device selected".into());
    }

    command.args([
        "-fflags",
        "nobuffer",
        "-flags",
        "low_delay",
        "-thread_queue_size",
        "512",
    ]);

    #[cfg(target_os = "windows")]
    {
        command.args(["-f", "dshow"]);
        if small_buffer {
            command.args(["-audio_buffer_size", "20"]);
        }
        command.args(["-i", &format!("audio={device}")]);
        Ok(())
    }

    #[cfg(target_os = "linux")]
    {
        let _ = small_buffer;
        command.args(["-f", "alsa", "-ar", "48000", "-ac", "2", "-i", device]);
        Ok(())
    }

    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    {
        let _ = (command, small_buffer, device);
        Err("Unsupported operating system".into())
    }
}

#[cfg(target_os = "windows")]
fn looks_like_device_path(device: &str) -> bool {
    let lower = device.to_ascii_lowercase();
    lower.contains(r"\\?\") || lower.contains("usb#") || lower.starts_with("@device_")
}
