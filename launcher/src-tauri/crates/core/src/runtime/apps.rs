use std::path::{Path, PathBuf};

use include_dir::{include_dir, Dir};

use crate::utils::paths::app_directory;

/// The Deno apps are baked into the binary, so the GUI installer and the
/// standalone CLI both ship everything they need.
static APPS: Dir<'_> = include_dir!("$CARGO_MANIFEST_DIR/../../../../apps");
static SHARED: Dir<'_> = include_dir!("$CARGO_MANIFEST_DIR/../../../../shared");
static DENO_JSON: &str = include_str!("../../../../../../deno.json");

/// Writes the embedded workspace to a writable location and returns its root.
/// Rewritten on every start so it always matches the running binary.
pub fn ensure() -> Result<PathBuf, String> {
    let root = app_directory()?.join("app");
    let _ = std::fs::remove_dir_all(&root);

    write_dir(&APPS, &root.join("apps"))?;
    write_dir(&SHARED, &root.join("shared"))?;
    std::fs::write(root.join("deno.json"), DENO_JSON)
        .map_err(|e| format!("Failed to write deno.json: {e}"))?;

    Ok(root)
}

/// `Dir::extract` assumes the target exists, and it does not on a clean run.
fn write_dir(dir: &Dir<'_>, target: &Path) -> Result<(), String> {
    std::fs::create_dir_all(target)
        .map_err(|e| format!("Failed to create {}: {e}", target.display()))?;
    dir.extract(target)
        .map_err(|e| format!("Failed to write {}: {e}", target.display()))
}
