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

/// Linux starts at machine boot, before anyone logs in over SSH, remote desktop or console.
/// XDG autostart only fires on a graphical login. A systemd user service does it once lingering
/// lets the user manager run without a session. The unit is enabled by its symlink, so no
/// session bus is needed.
#[cfg(not(windows))]
const UNIT: &str = "s2pipe.service";

#[cfg(not(windows))]
fn unit_dir() -> Result<std::path::PathBuf, String> {
    dirs::config_dir()
        .map(|dir| dir.join("systemd/user"))
        .ok_or_else(|| "Unable to find user config directory".to_string())
}

#[cfg(not(windows))]
fn enable(path: &Path) -> Result<(), String> {
    disable();
    let dir = unit_dir()?;
    let wants = dir.join("default.target.wants");
    std::fs::create_dir_all(&wants)
        .map_err(|e| format!("Failed to create {}: {e}", wants.display()))?;

    let unit = dir.join(UNIT);
    std::fs::write(
        &unit,
        format!(
            "[Unit]\nDescription=s2pipe\n\n[Service]\nType=oneshot\nRemainAfterExit=yes\nExecStart=\"{}\" --autostart\n\n[Install]\nWantedBy=default.target\n",
            path.display()
        ),
    )
    .map_err(|e| format!("Failed to write {}: {e}", unit.display()))?;
    std::os::unix::fs::symlink(&unit, wants.join(UNIT))
        .map_err(|e| format!("Failed to enable autostart: {e}"))?;

    match std::process::Command::new("loginctl").arg("enable-linger").status() {
        Ok(status) if status.success() => Ok(()),
        _ => Err("Autostart will only run after the next login. To start at boot, run: sudo loginctl enable-linger $USER".into()),
    }
}

#[cfg(not(windows))]
fn disable() {
    if let Ok(dir) = unit_dir() {
        let _ = std::fs::remove_file(dir.join("default.target.wants").join(UNIT));
        let _ = std::fs::remove_file(dir.join(UNIT));
    }
    // Earlier versions used an XDG entry, which would restart the stack at every login.
    if let Some(dir) = dirs::config_dir() {
        let _ = std::fs::remove_file(dir.join("autostart/s2pipe.desktop"));
    }
}
