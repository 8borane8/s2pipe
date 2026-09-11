use std::fs::{File, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use std::process::{Child, ChildStdout, Command, Stdio};
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

pub struct Ffmpeg {
    pub child: Child,
    out_time_us: Arc<AtomicI64>,
}

impl Ffmpeg {
    pub fn kill(mut self) {
        kill_child(&mut self.child);
    }

    pub fn alive(&mut self) -> bool {
        matches!(self.child.try_wait(), Ok(None))
    }

    pub fn out_time_us(&self) -> i64 {
        self.out_time_us.load(Ordering::Relaxed)
    }

    pub async fn wait_output(&mut self, timeout: Duration) -> bool {
        let deadline = Instant::now() + timeout;
        loop {
            if !self.alive() {
                return false;
            }
            if self.out_time_us() > 0 {
                return true;
            }
            if Instant::now() >= deadline {
                return false;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    }
}

pub(crate) fn kill_child(child: &mut Child) {
    kill_pid_force(child.id());
    let _ = child.wait();
}

fn create_log(log: &Path, append: bool) -> Result<File, String> {
    if let Some(dir) = log.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("Failed to create log directory: {e}"))?;
    }
    let mut options = OpenOptions::new();
    options.create(true);
    if append {
        options.append(true);
    } else {
        options.write(true).truncate(true);
    }
    options
        .open(log)
        .map_err(|e| format!("Failed to create log {}: {e}", log.display()))
}

fn detach(command: &mut Command) {
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000 | 0x0000_0200);
    }
}

fn spawn(command: &mut Command, label: &str) -> Result<Child, String> {
    command
        .spawn()
        .map_err(|e| format!("Failed to start {label}: {e}"))
}

fn abandon<T>(mut child: Child, message: String) -> Result<T, String> {
    let _ = child.kill();
    let _ = child.wait();
    Err(message)
}

pub fn spawn_logged(mut command: Command, label: &str, log: &Path) -> Result<u32, String> {
    let file = create_log(log, false)?;
    let stderr = file
        .try_clone()
        .map_err(|e| format!("Failed to clone log handle: {e}"))?;

    command
        .stdin(Stdio::null())
        .stdout(Stdio::from(file))
        .stderr(Stdio::from(stderr));
    detach(&mut command);
    spawn(&mut command, label).map(|child| child.id())
}

pub fn spawn_ffmpeg(mut command: Command, label: &str, log: &Path) -> Result<Ffmpeg, String> {
    // `-progress pipe:2`: stdout is buffered on Windows and never delivers
    // `out_time_us=`. stderr is not.
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    detach(&mut command);
    let mut child = spawn(&mut command, label)?;
    let Some(stderr) = child.stderr.take() else {
        return abandon(child, format!("Failed to open {label} progress pipe"));
    };
    let out_time_us = Arc::new(AtomicI64::new(0));
    let clock = out_time_us.clone();
    let mut log = create_log(log, true)?;
    std::thread::spawn(move || {
        for line in BufReader::new(stderr).lines().flatten() {
            if let Some(n) = line.strip_prefix("out_time_us=").and_then(|v| v.trim().parse().ok()) {
                clock.store(n, Ordering::Relaxed);
            } else if line.contains(' ') {
                let _ = writeln!(log, "{line}");
            }
        }
    });
    Ok(Ffmpeg { child, out_time_us })
}

pub fn spawn_worker(
    mut command: Command,
    label: &str,
    log: &Path,
    input: &[u8],
) -> Result<(Child, ChildStdout), String> {
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::from(create_log(log, false)?));
    detach(&mut command);

    let mut child = spawn(&mut command, label)?;
    let Some(mut stdin) = child.stdin.take() else {
        return abandon(child, format!("Failed to open {label} input pipe"));
    };
    if let Err(error) = stdin.write_all(input) {
        return abandon(child, format!("Failed to configure {label}: {error}"));
    }
    drop(stdin);
    let Some(stdout) = child.stdout.take() else {
        return abandon(child, format!("Failed to open {label} output pipe"));
    };

    Ok((child, stdout))
}

fn log_tail(path: &Path, n: usize) -> String {
    let text = std::fs::read_to_string(path).unwrap_or_default();
    let lines: Vec<&str> = text.lines().collect();
    lines[lines.len().saturating_sub(n)..].join("\n")
}

pub fn with_log_tail(message: String, log: &Path) -> String {
    let tail = log_tail(log, 30);
    if tail.is_empty() {
        format!("{message}. See {}", log.display())
    } else {
        format!("{message}:\n{tail}")
    }
}

pub fn kill_pid(pid: u32) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let _ = Command::new("taskkill")
            .args(["/F", "/T", "/PID", &pid.to_string()])
            .creation_flags(0x0800_0000)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }

    #[cfg(unix)]
    unix_kill(pid, "-TERM");
}

pub fn kill_pid_force(pid: u32) {
    #[cfg(windows)]
    kill_pid(pid);

    #[cfg(unix)]
    unix_kill(pid, "-KILL");
}

#[cfg(unix)]
fn unix_kill(pid: u32, signal: &str) {
    let _ = Command::new("kill")
        .args([signal, &format!("-{pid}")])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
    let _ = Command::new("kill")
        .args([signal, &pid.to_string()])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
}

pub fn pid_alive(pid: u32) -> bool {
    if pid == 0 {
        return false;
    }

    #[cfg(windows)]
    {
        use windows::Win32::Foundation::CloseHandle;
        use windows::Win32::System::Threading::{
            GetExitCodeProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
        };

        const STILL_ACTIVE: u32 = 259;

        unsafe {
            let Ok(handle) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) else {
                return false;
            };
            let mut code = 0;
            let alive = GetExitCodeProcess(handle, &mut code).is_ok() && code == STILL_ACTIVE;
            let _ = CloseHandle(handle);
            alive
        }
    }

    #[cfg(unix)]
    {
        Path::new(&format!("/proc/{pid}")).exists()
    }

    #[cfg(not(any(windows, unix)))]
    {
        let _ = pid;
        false
    }
}
