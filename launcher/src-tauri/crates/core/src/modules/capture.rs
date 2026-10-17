use nokhwa::query;
use nokhwa::utils::{ApiBackend, CameraIndex};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureDevice {
    pub path: String,
    pub label: String,
}

#[cfg(target_os = "linux")]
fn device_path(index: &CameraIndex, _name: &str) -> String {
    match index {
        CameraIndex::Index(i) => format!("/dev/video{i}"),
        CameraIndex::String(s) => s.clone(),
    }
}

#[cfg(target_os = "windows")]
fn device_path(index: &CameraIndex, name: &str) -> String {
    if name.is_empty() {
        match index {
            CameraIndex::Index(i) => i.to_string(),
            CameraIndex::String(s) => s.clone(),
        }
    } else {
        name.to_string()
    }
}

#[cfg(not(any(target_os = "windows", target_os = "linux")))]
fn device_path(index: &CameraIndex, name: &str) -> String {
    if !name.is_empty() {
        return name.to_string();
    }
    match index {
        CameraIndex::Index(i) => i.to_string(),
        CameraIndex::String(s) => s.clone(),
    }
}

pub async fn list_capture_devices() -> Result<Vec<CaptureDevice>, String> {
    tokio::task::spawn_blocking(|| {
        let cameras = query(ApiBackend::Auto).map_err(|e| e.to_string())?;
        Ok(cameras
            .into_iter()
            .map(|info| {
                let name = info.human_name();
                CaptureDevice {
                    path: device_path(info.index(), &name),
                    label: name,
                }
            })
            .filter(|device| is_capture_node(&device.path))
            .collect())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// A UVC device exposes a second `/dev/videoN` for metadata (sysfs `index` > 0) that cannot
/// capture and fails with "Inappropriate ioctl for device". Only index 0 is a capture node.
/// Anything that is not a Linux device node is kept.
fn is_capture_node(path: &str) -> bool {
    let Some(node) = path.strip_prefix("/dev/") else {
        return true;
    };
    std::fs::read_to_string(format!("/sys/class/video4linux/{node}/index"))
        .ok()
        .and_then(|index| index.trim().parse::<u32>().ok())
        .map_or(true, |index| index == 0)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioDevice {
    pub path: String,
    pub label: String,
}

pub async fn list_audio_devices() -> Result<Vec<AudioDevice>, String> {
    tokio::task::spawn_blocking(list_audio_devices_sync)
        .await
        .map_err(|e| format!("Audio detection failed: {e}"))?
}

fn list_audio_devices_sync() -> Result<Vec<AudioDevice>, String> {
    #[cfg(target_os = "windows")]
    return list_windows_audio_devices();

    #[cfg(target_os = "linux")]
    return list_linux_audio_devices();

    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    Ok(Vec::new())
}

#[cfg(target_os = "windows")]
fn list_windows_audio_devices() -> Result<Vec<AudioDevice>, String> {
    use windows::core::GUID;
    use windows::Win32::{
        Media::Audio::{eCapture, IMMDeviceEnumerator, MMDeviceEnumerator, DEVICE_STATE_ACTIVE},
        System::Com::{
            CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize,
            StructuredStorage::PropVariantToStringAlloc, CLSCTX_ALL, COINIT_MULTITHREADED,
            STGM_READ,
        },
        UI::Shell::PropertiesSystem::PROPERTYKEY,
    };

    struct ComGuard;
    impl Drop for ComGuard {
        fn drop(&mut self) {
            unsafe { CoUninitialize() };
        }
    }

    unsafe {
        CoInitializeEx(None, COINIT_MULTITHREADED)
            .ok()
            .map_err(|e| format!("COM initialization failed: {e}"))?;
        let _guard = ComGuard;

        let enumerator: IMMDeviceEnumerator =
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
                .map_err(|e| format!("Unable to create audio enumerator: {e}"))?;

        let devices = enumerator
            .EnumAudioEndpoints(eCapture, DEVICE_STATE_ACTIVE)
            .map_err(|e| format!("Unable to enumerate audio devices: {e}"))?;
        let count = devices
            .GetCount()
            .map_err(|e| format!("Unable to get device count: {e}"))?;

        let key = PROPERTYKEY {
            fmtid: GUID::from_u128(0xa45c254e_df1c_4efd_8020_67d146a850e0),
            pid: 14,
        };

        (0..count)
            .map(|i| {
                let device = devices
                    .Item(i)
                    .map_err(|e| format!("Unable to get device {i}: {e}"))?;
                let id = device
                    .GetId()
                    .map_err(|e| format!("Unable to get device ID: {e}"))?;
                let path = id
                    .to_string()
                    .map_err(|e| format!("Invalid device ID: {e}"))?;
                CoTaskMemFree(Some(id.0 as *const _));

                let label = device
                    .OpenPropertyStore(STGM_READ)
                    .ok()
                    .and_then(|store| store.GetValue(&key).ok())
                    .and_then(|variant| PropVariantToStringAlloc(&variant).ok())
                    .and_then(|pwstr| {
                        let s = pwstr.to_string().ok();
                        CoTaskMemFree(Some(pwstr.0 as *const _));
                        s
                    })
                    .filter(|s| !s.is_empty())
                    .unwrap_or_else(|| path.clone());

                Ok(AudioDevice {
                    path: label.clone(),
                    label,
                })
            })
            .collect()
    }
}

/// Reads ALSA capture endpoints straight from the kernel, so the launcher does
/// not depend on alsa-utils being installed.
#[cfg(target_os = "linux")]
fn list_linux_audio_devices() -> Result<Vec<AudioDevice>, String> {
    let pcm = std::fs::read_to_string("/proc/asound/pcm")
        .map_err(|e| format!("Unable to read /proc/asound/pcm: {e}"))?;

    Ok(pcm
        .lines()
        .filter(|line| line.contains("capture "))
        .filter_map(|line| {
            let mut fields = line.split(':');
            let (card, device) = fields.next()?.trim().split_once('-')?;
            let card: u32 = card.parse().ok()?;
            let device: u32 = device.parse().ok()?;
            let name = fields.next()?.trim();
            Some(AudioDevice {
                path: format!("hw:{card},{device}"),
                label: format!("{name} (hw:{card},{device})"),
            })
        })
        .collect())
}

/// The bundled FFmpeg has no ALSA demuxer, only PulseAudio (which PipeWire also serves), so a
/// listed `hw:card,device` endpoint is captured through a Pulse source. Returns the source on
/// that endpoint, asking the server to load one when it did not detect the card itself
/// (headless session, server started without hardware detection). Any other name is already a
/// Pulse source name and is returned unchanged.
#[cfg(target_os = "linux")]
pub(crate) fn pulse_source_for(device: &str) -> Result<String, String> {
    let Some((card, dev)) = device.strip_prefix("hw:").and_then(|d| d.split_once(',')) else {
        return Ok(device.to_string());
    };

    let sources = pactl(&["list", "sources"])?;
    for block in sources.split("Source #").skip(1) {
        let value = |key: &str| {
            block
                .lines()
                .find_map(|line| line.trim().strip_prefix(key))
                .map(|rest| rest.trim().trim_matches('"'))
        };
        if value("device.class = ") != Some("monitor")
            && value("alsa.card = ") == Some(card)
            && value("alsa.device = ") == Some(dev)
        {
            return Ok(value("Name: ").unwrap_or_default().to_string());
        }
    }

    let name = format!("s2pipe_hw_{card}_{dev}");
    pactl(&[
        "load-module",
        "module-alsa-source",
        &format!("device={device}"),
        &format!("source_name={name}"),
    ])?;
    Ok(name)
}

#[cfg(target_os = "linux")]
fn pactl(args: &[&str]) -> Result<String, String> {
    let output = std::process::Command::new("pactl")
        .args(args)
        .env("LC_ALL", "C")
        // AppImage prepends its own libraries here, which can break system binaries.
        .env_remove("LD_LIBRARY_PATH")
        .output()
        .map_err(|e| {
            format!("Unable to run pactl ({e}). Install pulseaudio-utils or pipewire-pulse.")
        })?;
    if !output.status.success() {
        return Err(format!(
            "pactl {} failed: {}",
            args.join(" "),
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}
