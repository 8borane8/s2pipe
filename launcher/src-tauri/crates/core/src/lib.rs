mod config;
mod modules;
mod runtime;
mod stack;
mod utils;

pub use config::{load_config, save_config, AppConfig};
pub use modules::{
    list_audio_devices, list_capture_devices, list_serial_ports, scan_bluetooth_pad, AudioDevice,
    CaptureDevice, SerialPortInfo, WakeScanResult,
};
pub use stack::Stack;
pub use utils::autostart::set_autostart;
pub use utils::bin::install_launcher;
pub use utils::net::{local_ip, public_ip};

pub fn has_arg(flag: &str) -> bool {
    std::env::args().any(|arg| arg == flag)
}

/// Used by the GUI, which has no Tokio main of its own.
pub fn run_watchdog() {
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .expect("watchdog runtime");
    if let Err(error) = runtime.block_on(runtime::ffmpeg::run_watchdog()) {
        eprintln!("FFmpeg watchdog error: {error}");
        std::process::exit(1);
    }
}
