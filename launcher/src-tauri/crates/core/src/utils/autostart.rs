use std::path::Path;

use super::bin::install_launcher;

/// Autostart always points at `~/.s2pipe/launcher`.
pub fn set_autostart(enabled: bool) -> Result<(), String> {
    if enabled {
        enable(&install_launcher()?)
    } else {
        disable();
        Ok(())
    }
}

#[cfg(windows)]
fn enable(path: &Path) -> Result<(), String> {
    let command = format!("\"{}\" --autostart", path.display());
    reg(&[
        "add",
        r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run",
        "/v",
        "s2pipe",
        "/t",
        "REG_SZ",
        "/d",
        &command,
        "/f",
    ])
    .map_err(|e| format!("Failed to enable autostart: {e}"))
}

#[cfg(windows)]
fn disable() {
    for name in ["s2pipe", "s2pipe-gui", "launcher"] {
        let _ = reg(&[
            "delete",
            r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run",
            "/v",
            name,
            "/f",
        ]);
    }
}

#[cfg(windows)]
fn reg(args: &[&str]) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    let status = std::process::Command::new("reg")
        .args(args)
        .creation_flags(0x0800_0000)
        .status()
        .map_err(|e| e.to_string())?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("reg exited with {status}"))
    }
}

/// XDG autostart: GNOME, KDE, XFCE, Cinnamon, etc. read `~/.config/autostart`.
#[cfg(not(windows))]
fn desktop_file() -> Option<std::path::PathBuf> {
    dirs::config_dir().map(|dir| dir.join("autostart/s2pipe.desktop"))
}

#[cfg(not(windows))]
fn enable(path: &Path) -> Result<(), String> {
    let file = desktop_file().ok_or_else(|| "Unable to find user config directory".to_string())?;
    if let Some(dir) = file.parent() {
        std::fs::create_dir_all(dir)
            .map_err(|e| format!("Failed to create autostart directory: {e}"))?;
    }
    std::fs::write(
        &file,
        format!(
            "[Desktop Entry]\nType=Application\nName=s2pipe\nExec=\"{}\" --autostart\nTerminal=false\nX-GNOME-Autostart-enabled=true\n",
            path.display()
        ),
    )
    .map_err(|e| format!("Failed to enable autostart: {e}"))
}

#[cfg(not(windows))]
fn disable() {
    if let Some(file) = desktop_file() {
        let _ = std::fs::remove_file(file);
    }
}
