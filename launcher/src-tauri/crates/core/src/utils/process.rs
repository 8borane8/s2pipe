use std::fs::File;
use std::path::Path;
use std::process::{Command, Stdio};

pub fn spawn_detached(command: Command, label: &str) -> Result<u32, String> {
    spawn(command, label, None)
}

pub fn spawn_logged(command: Command, label: &str, log: &Path) -> Result<u32, String> {
    spawn(command, label, Some(log))
}

fn spawn(mut command: Command, label: &str, log: Option<&Path>) -> Result<u32, String> {
    command.stdin(Stdio::null());
    match log {
        Some(path) => {
            if let Some(dir) = path.parent() {
                std::fs::create_dir_all(dir)
                    .map_err(|e| format!("Failed to create log directory: {e}"))?;
            }
            let file = File::create(path)
                .map_err(|e| format!("Failed to create log {}: {e}", path.display()))?;
            let stderr = file
                .try_clone()
                .map_err(|e| format!("Failed to clone log handle: {e}"))?;
            command.stdout(Stdio::from(file));
            command.stderr(Stdio::from(stderr));
        }
        None => {
            command.stdout(Stdio::null()).stderr(Stdio::null());
        }
    }

    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
        return command
            .spawn()
            .map(|child| child.id())
            .map_err(|e| format!("Failed to start {label}: {e}"));
    }

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        command.creation_flags(CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP);
        command
            .spawn()
            .map(|child| child.id())
            .map_err(|e| format!("Failed to start {label}: {e}"))
    }

    #[cfg(not(any(windows, unix)))]
    {
        let _ = (command, label);
        Err("Unsupported operating system".into())
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
    {
        let _ = Command::new("kill")
            .args(["-TERM", &format!("-{pid}")])
            .status();
        let _ = Command::new("kill")
            .args(["-TERM", &pid.to_string()])
            .status();
    }
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
