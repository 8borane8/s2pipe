use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use crate::utils::paths::logs_dir;
use crate::utils::process::{kill_pid, pid_alive};

/// FFmpeg rejects a bad device or encoder within a few hundred milliseconds, so
/// a process still alive after this is considered good.
const STABLE_AFTER: Duration = Duration::from_millis(1500);

pub fn log_path(name: &str) -> Result<PathBuf, String> {
    Ok(logs_dir()?.join(format!("{name}.log")))
}

/// Spawns each attempt in order and keeps the first one that survives.
pub async fn run<T: Copy>(
    label: &str,
    log: &Path,
    attempts: &[T],
    mut spawn: impl FnMut(T) -> Result<u32, String>,
) -> Result<u32, String> {
    let mut spawn_error: Option<String> = None;
    let mut started = false;

    for attempt in attempts {
        match spawn(*attempt) {
            Ok(pid) => {
                started = true;
                if wait_alive(pid).await {
                    return Ok(pid);
                }
                kill_pid(pid);
            }
            Err(error) => spawn_error = Some(error),
        }
    }

    // A process that started and died leaves its reason in the log; one that
    // never started only has the spawn error.
    if started {
        return Err(exit_error(label, log));
    }
    Err(spawn_error.unwrap_or_else(|| format!("{label} could not be started")))
}

async fn wait_alive(pid: u32) -> bool {
    let deadline = Instant::now() + STABLE_AFTER;
    loop {
        if !pid_alive(pid) {
            return false;
        }
        if Instant::now() >= deadline {
            return true;
        }
        tokio::time::sleep(Duration::from_millis(150)).await;
    }
}

fn exit_error(label: &str, log: &Path) -> String {
    let text = std::fs::read_to_string(log).unwrap_or_default();
    let lines: Vec<&str> = text.lines().collect();
    let tail = lines[lines.len().saturating_sub(30)..].join("\n");
    if tail.is_empty() {
        format!("{label} exited immediately. See {}", log.display())
    } else {
        format!("{label} exited immediately:\n{tail}")
    }
}
