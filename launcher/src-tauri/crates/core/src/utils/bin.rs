use std::path::PathBuf;

use super::archive::{extract_file_from_archive, unblock};
use super::paths::{app_directory, bins_dir};

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
