//! Adapter for libvirtualhid's public C++ API through a bundled bridge.

#[cfg(windows)]
use super::HeldInput;
#[cfg(windows)]
use enigo::Button;
#[cfg(windows)]
use std::{
    io::{BufRead, BufReader, Write},
    process::{Child, ChildStdin, ChildStdout, Command, Stdio},
};
#[cfg(windows)]
use tauri::{AppHandle, Manager};

#[cfg(windows)]
fn bridge_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let path = app
        .path()
        .resource_dir()
        .map_err(|error| format!("无法定位应用资源：{error}"))?
        .join("driver")
        .join("auto-music-lvh-bridge.exe");
    if !path.is_file() {
        return Err("缺少 libvirtualhid 桥接程序；请重新安装 Auto Music".into());
    }
    Ok(path)
}

#[cfg(windows)]
fn bridge_response(line: &str) -> Result<(), String> {
    let line = line.trim();
    if line == "READY" || line == "OK" {
        Ok(())
    } else if let Some(message) = line.strip_prefix("ERR ") {
        Err(format!("libvirtualhid：{message}"))
    } else {
        Err(format!("libvirtualhid 桥接程序返回异常：{line}"))
    }
}

#[cfg(windows)]
pub fn probe(app: &AppHandle) -> Result<(), String> {
    let output = Command::new(bridge_path(app)?)
        .arg("--probe")
        .output()
        .map_err(|error| format!("无法启动 libvirtualhid 桥接程序：{error}"))?;
    let message = String::from_utf8_lossy(&output.stdout);
    bridge_response(message.lines().next().unwrap_or(""))?;
    if !output.status.success() {
        return Err("libvirtualhid 驱动检查失败".into());
    }
    Ok(())
}

#[cfg(windows)]
pub struct VhidOutput {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
}

#[cfg(windows)]
impl VhidOutput {
    pub fn open(app: &AppHandle) -> Result<Self, String> {
        let mut child = Command::new(bridge_path(app)?)
            .arg("--play")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|error| format!("无法启动 libvirtualhid 桥接程序：{error}"))?;
        let stdin = child.stdin.take().ok_or("桥接程序没有输入通道")?;
        let stdout = child.stdout.take().ok_or("桥接程序没有输出通道")?;
        let mut output = Self {
            child,
            stdin,
            stdout: BufReader::new(stdout),
        };
        output.read_response()?;
        Ok(output)
    }

    fn read_response(&mut self) -> Result<(), String> {
        let mut line = String::new();
        self.stdout
            .read_line(&mut line)
            .map_err(|error| format!("读取 libvirtualhid 响应失败：{error}"))?;
        bridge_response(&line)
    }

    pub fn send(&mut self, input: HeldInput, down: bool) -> Result<(), String> {
        let command = match input {
            HeldInput::Key(key) => format!("K {key} {}\n", u8::from(down)),
            HeldInput::Mouse(button) => {
                let button = match button {
                    Button::Left => 'L',
                    Button::Right => 'R',
                    Button::Middle => 'M',
                    _ => return Err("虚拟鼠标仅支持左、右、中键".into()),
                };
                format!("M {button} {}\n", u8::from(down))
            }
        };
        self.stdin
            .write_all(command.as_bytes())
            .and_then(|_| self.stdin.flush())
            .map_err(|error| format!("发送 libvirtualhid 输入失败：{error}"))?;
        self.read_response()
    }
}

#[cfg(windows)]
impl Drop for VhidOutput {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}
