use std::path::PathBuf;

use super::archive::{extract_file_from_archive, unblock};
use super::paths::{app_directory, bins_dir, ensure_app_directory, launcher_path};

fn exe(name: &str) -> String {
    if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_string()
    }
}

pub fn bin_path(name: &str) -> Result<PathBuf, String> {
    let path = bins_dir()?.join(exe(name));
    unblock(&path);
    Ok(path)
}

/// Copy this process onto `~/.s2pipe/launcher`. If that file is locked by a
/// running watchdog, the previous copy is kept.
pub fn install_launcher() -> Result<PathBuf, String> {
    ensure_app_directory()?;
    let dest = launcher_path()?;
    let src = std::env::current_exe().map_err(|e| format!("Failed to locate launcher: {e}"))?;

    if let (Ok(src), Ok(dest)) = (src.canonicalize(), dest.canonicalize()) {
        if src == dest {
            return Ok(dest);
        }
    }

    match std::fs::copy(&src, &dest) {
        Ok(_) => {
            make_executable(&dest)?;
            unblock(&dest);
            Ok(dest)
        }
        Err(_) if dest.exists() => Ok(dest),
        Err(error) => Err(format!("Failed to install {}: {error}", dest.display())),
    }
}

fn make_executable(path: &std::path::Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755))
            .map_err(|e| format!("Failed to make {} executable: {e}", path.display()))?;
    }
    #[cfg(not(unix))]
    {
        let _ = path;
    }
    Ok(())
}

pub async fn ensure_downloaded(
    name: &str,
    url: &str,
    archive_name: &str,
) -> Result<PathBuf, String> {
    let destination = bin_path(name)?;
    if destination.exists() {
        return Ok(destination);
    }

    tokio::fs::create_dir_all(bins_dir()?)
        .await
        .map_err(|e| format!("Failed to create bins directory: {e}"))?;

    let archive = app_directory()?.join(archive_name);
    let bytes = download(url).await?;
    tokio::fs::write(&archive, &bytes)
        .await
        .map_err(|e| format!("Failed to write {}: {e}", archive.display()))?;

    extract_file_from_archive(&archive, &exe(name), &destination)?;
    let _ = tokio::fs::remove_file(&archive).await;

    if destination.exists() {
        Ok(destination)
    } else {
        Err(format!(
            "{name} extraction completed but {} was not found",
            destination.display()
        ))
    }
}

async fn download(url: &str) -> Result<Vec<u8>, String> {
    let response = reqwest::get(url)
        .await
        .map_err(|e| format!("Failed to download {url}: {e}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "Download failed with HTTP status {}: {url}",
            response.status()
        ));
    }
    response
        .bytes()
        .await
        .map(|bytes| bytes.to_vec())
        .map_err(|e| format!("Failed to read download: {e}"))
}
