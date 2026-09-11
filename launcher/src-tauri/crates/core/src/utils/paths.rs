use std::path::PathBuf;

pub fn app_directory() -> Result<PathBuf, String> {
    dirs::home_dir()
        .ok_or_else(|| "Unable to find user home directory".to_string())
        .map(|home| home.join(".s2pipe"))
}

pub fn bins_dir() -> Result<PathBuf, String> {
    Ok(app_directory()?.join("bins"))
}

/// Last GUI or CLI that was launched. Watchdog and autostart always use this.
pub fn launcher_path() -> Result<PathBuf, String> {
    Ok(app_directory()?.join(if cfg!(windows) {
        "launcher.exe"
    } else {
        "launcher"
    }))
}

pub fn log_path(name: &str) -> Result<PathBuf, String> {
    Ok(app_directory()?.join("logs").join(format!("{name}.log")))
}

pub fn ensure_app_directory() -> Result<(), String> {
    std::fs::create_dir_all(app_directory()?)
        .map_err(|e| format!("Failed to create app directory: {e}"))?;
    Ok(())
}
