use std::fs;
use std::io;
use std::path::Path;

use flate2::read::GzDecoder;
use liblzma::read::XzDecoder;
use tar::Archive;
use zip::ZipArchive;

pub(crate) fn extract_file_from_archive(
    archive_path: &Path,
    filename: &str,
    destination: &Path,
) -> Result<(), String> {
    let name = archive_path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("");

    if name.ends_with(".tar.xz") {
        return extract_from_tar_xz(archive_path, filename, destination);
    }
    if name.ends_with(".tar.gz") {
        return extract_from_tar_gz(archive_path, filename, destination);
    }
    if name.ends_with(".zip") {
        return extract_from_zip(archive_path, filename, destination);
    }

    Err(format!(
        "Unsupported archive format: {}",
        archive_path.display()
    ))
}

fn extract_from_zip(archive_path: &Path, filename: &str, destination: &Path) -> Result<(), String> {
    let file =
        fs::File::open(archive_path).map_err(|e| format!("Failed to open ZIP archive: {e}"))?;
    let mut archive =
        ZipArchive::new(file).map_err(|e| format!("Failed to read ZIP archive: {e}"))?;

    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| format!("Failed to read ZIP entry: {e}"))?;
        let entry_name = Path::new(entry.name())
            .file_name()
            .and_then(|name| name.to_str());
        if entry_name == Some(filename) {
            let mut output = fs::File::create(destination)
                .map_err(|e| format!("Failed to create destination file: {e}"))?;
            io::copy(&mut entry, &mut output)
                .map_err(|e| format!("Failed to extract {filename}: {e}"))?;
            set_executable(destination)?;
            return Ok(());
        }
    }

    Err(format!(
        "{filename} was not found in archive {}",
        archive_path.display()
    ))
}

fn extract_from_tar_gz(
    archive_path: &Path,
    filename: &str,
    destination: &Path,
) -> Result<(), String> {
    let file =
        fs::File::open(archive_path).map_err(|e| format!("Failed to open TAR.GZ archive: {e}"))?;
    let mut archive = Archive::new(GzDecoder::new(file));
    extract_from_tar(&mut archive, filename, destination)
}

fn extract_from_tar_xz(
    archive_path: &Path,
    filename: &str,
    destination: &Path,
) -> Result<(), String> {
    let file =
        fs::File::open(archive_path).map_err(|e| format!("Failed to open TAR.XZ archive: {e}"))?;
    let mut archive = Archive::new(XzDecoder::new(file));
    extract_from_tar(&mut archive, filename, destination)
}

fn extract_from_tar<R: io::Read>(
    archive: &mut Archive<R>,
    filename: &str,
    destination: &Path,
) -> Result<(), String> {
    for entry in archive
        .entries()
        .map_err(|e| format!("Failed to read TAR entries: {e}"))?
    {
        let mut entry = entry.map_err(|e| format!("Failed to read TAR entry: {e}"))?;
        let entry_name = entry
            .path()
            .ok()
            .and_then(|path| path.file_name().map(|name| name.to_owned()));
        if entry_name.as_deref().and_then(|name| name.to_str()) == Some(filename) {
            entry
                .unpack(destination)
                .map_err(|e| format!("Failed to extract {filename}: {e}"))?;
            set_executable(destination)?;
            return Ok(());
        }
    }

    Err(format!("{filename} was not found in archive"))
}

fn set_executable(destination: &Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(destination, fs::Permissions::from_mode(0o755))
            .map_err(|e| format!("Failed to set executable permission: {e}"))?;
    }
    unblock(destination);
    Ok(())
}

pub(crate) fn unblock(path: &Path) {
    #[cfg(windows)]
    {
        let _ = fs::remove_file(format!("{}:Zone.Identifier", path.display()));
    }
    #[cfg(not(windows))]
    {
        let _ = path;
    }
}
