use clap::{Args, Parser, Subcommand};
use s2pipe_core::{has_arg, install_launcher, load_config, run_watchdog, AppConfig, Stack};

#[derive(Parser)]
#[command(
    name = "s2pipe",
    about = "Start or stop the s2pipe stack without the GUI",
    after_help = "start relaunches if the stack is already running. Flags overlay ~/.s2pipe/config.json for that run only."
)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Start the stack in the background (restarts if already running)
    Start(Box<StartArgs>),
    /// Stop the detached stack
    Stop,
}

#[derive(Args)]
struct StartArgs {
    #[arg(long)]
    node_port: Option<String>,
    #[arg(long)]
    node_base_url: Option<String>,
    #[arg(long)]
    client_port: Option<String>,
    #[arg(long)]
    media_ice_ip: Option<String>,
    #[arg(long)]
    media_ice_port: Option<String>,
    #[arg(long)]
    capture_source: Option<String>,
    #[arg(long)]
    capture_device: Option<String>,
    #[arg(long)]
    capture_audio: Option<String>,
    #[arg(long)]
    capture_format: Option<String>,
    #[arg(long)]
    capture_width: Option<u32>,
    #[arg(long)]
    capture_height: Option<u32>,
    #[arg(long)]
    capture_fps: Option<u32>,
    /// auto, cpu, nvenc or amf
    #[arg(long)]
    video_encoder: Option<String>,
    /// h264 or h265
    #[arg(long)]
    video_codec: Option<String>,
    #[arg(long)]
    video_bitrate: Option<String>,
    #[arg(long)]
    pico_serial: Option<String>,
    #[arg(long)]
    switch_bt_mac: Option<String>,
    #[arg(long)]
    controller_bt_mac: Option<String>,
    #[arg(long)]
    controller_bt_pid: Option<String>,
}

fn overlay<T>(slot: &mut T, value: Option<T>) {
    if let Some(value) = value {
        *slot = value;
    }
}

fn follow_url_port(url: &str, old_port: &str, new_port: &str) -> String {
    let trimmed = url.trim().trim_end_matches('/');
    match trimmed.strip_suffix(&format!(":{old_port}")) {
        Some(prefix) if !prefix.is_empty() => format!("{prefix}:{new_port}"),
        _ => url.to_string(),
    }
}

impl StartArgs {
    fn merge(self, mut config: AppConfig) -> AppConfig {
        if let Some(port) = self.node_port {
            if self.node_base_url.is_none() {
                config.node_base_url =
                    follow_url_port(&config.node_base_url, &config.node_port, &port);
            }
            config.node_port = port;
        }
        overlay(&mut config.node_base_url, self.node_base_url);
        overlay(&mut config.client_port, self.client_port);
        overlay(&mut config.media_ice_ip, self.media_ice_ip);
        overlay(&mut config.media_ice_port, self.media_ice_port);
        overlay(&mut config.capture_audio, self.capture_audio);
        overlay(&mut config.capture_format, self.capture_format);
        overlay(&mut config.capture_width, self.capture_width);
        overlay(&mut config.capture_height, self.capture_height);
        overlay(&mut config.capture_fps, self.capture_fps);
        overlay(&mut config.video_encoder, self.video_encoder);
        overlay(&mut config.video_codec, self.video_codec);
        overlay(&mut config.video_bitrate, self.video_bitrate);
        overlay(&mut config.pico_serial, self.pico_serial);
        overlay(&mut config.switch_bt_mac, self.switch_bt_mac);
        overlay(&mut config.controller_bt_mac, self.controller_bt_mac);
        overlay(&mut config.controller_bt_pid, self.controller_bt_pid);

        if let Some(device) = self.capture_device {
            if self.capture_source.is_none() && config.capture_source == "test" {
                config.capture_source = "v4l2".into();
            }
            config.capture_device = device;
        }
        overlay(&mut config.capture_source, self.capture_source);

        config
    }
}

fn main() {
    if has_arg("--watchdog") {
        run_watchdog();
        return;
    }

    let _ = install_launcher();
    if let Err(error) = run() {
        eprintln!("error: {error}");
        std::process::exit(1);
    }
}

#[tokio::main]
async fn run() -> Result<(), String> {
    if has_arg("--autostart") {
        return match load_config()? {
            Some(config) if config.launch_at_startup => Stack::start(config).await,
            _ => Ok(()),
        };
    }

    match Cli::parse().command {
        Command::Start(args) => {
            let config = args.merge(load_config()?.unwrap_or_default());
            println!("Starting s2pipe...");
            Stack::start(config).await?;
            println!("s2pipe is running in the background. Use `s2pipe stop` to stop it.");
            Ok(())
        }
        Command::Stop => {
            if !Stack::is_running() {
                println!("s2pipe is not running.");
                return Ok(());
            }
            println!("Stopping s2pipe...");
            Stack::stop()?;
            println!("Stopped.");
            Ok(())
        }
    }
}
