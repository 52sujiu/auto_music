//! Driver downloads are not redistributed; the app opens official releases.

use serde::Serialize;

#[cfg(windows)]
const INSTALLER_URL: &str = "https://github.com/LizardByte/libvirtualhid/releases/download/v2026.914.1218.10/libvirtualhid-Windows-AMD64-driver-installer.msi";
#[cfg(windows)]
const INTERCEPTION_URL: &str =
    "https://github.com/oblitum/Interception/releases/download/v1.0.1/Interception.zip";

#[derive(Serialize)]
pub struct DriverStatus {
    ready: bool,
    message: String,
}

#[tauri::command]
pub async fn vhid_driver_status(app: tauri::AppHandle) -> DriverStatus {
    #[cfg(windows)]
    {
        let result =
            tauri::async_runtime::spawn_blocking(move || crate::playback::vhid_driver_probe(&app))
                .await;
        match result {
            Ok(Ok(())) => DriverStatus {
                ready: true,
                message: "libvirtualhid 键盘和鼠标 HID 已就绪".into(),
            },
            Ok(Err(message)) => DriverStatus {
                ready: false,
                message,
            },
            Err(error) => DriverStatus {
                ready: false,
                message: format!("驱动检查失败：{error}"),
            },
        }
    }
    #[cfg(not(windows))]
    {
        let _ = app;
        DriverStatus {
            ready: false,
            message: "libvirtualhid 仅支持 Windows".into(),
        }
    }
}

#[tauri::command]
pub fn download_vhid_driver() -> Result<String, String> {
    #[cfg(windows)]
    {
        use std::{iter, os::windows::ffi::OsStrExt};
        use windows_sys::Win32::UI::Shell::ShellExecuteW;
        let url: Vec<u16> = std::ffi::OsStr::new(INSTALLER_URL)
            .encode_wide()
            .chain(iter::once(0))
            .collect();
        let result = unsafe {
            ShellExecuteW(
                std::ptr::null_mut(),
                std::ptr::null(),
                url.as_ptr(),
                std::ptr::null(),
                std::ptr::null(),
                1,
            )
        };
        if result as usize <= 32 {
            return Err(format!(
                "无法打开官方安装包下载链接：错误码 {}",
                result as usize
            ));
        }
        Ok("已打开 libvirtualhid 官方 MSI 下载链接；安装后请用 virtualhid_control.exe 激活许可证，再点“检查驱动”".into())
    }
    #[cfg(not(windows))]
    {
        Err("驱动安装仅支持 Windows".into())
    }
}

#[tauri::command]
pub async fn interception_driver_status(app: tauri::AppHandle) -> DriverStatus {
    #[cfg(windows)]
    {
        let result = tauri::async_runtime::spawn_blocking(move || {
            crate::playback::interception_driver_probe(&app)
        })
        .await;
        match result {
            Ok(Ok(())) => DriverStatus {
                ready: true,
                message: "Interception 键盘和鼠标已就绪".into(),
            },
            Ok(Err(message)) => DriverStatus {
                ready: false,
                message,
            },
            Err(error) => DriverStatus {
                ready: false,
                message: format!("驱动检查失败：{error}"),
            },
        }
    }
    #[cfg(not(windows))]
    {
        let _ = app;
        DriverStatus {
            ready: false,
            message: "Interception 仅支持 Windows".into(),
        }
    }
}

#[tauri::command]
pub async fn download_interception_driver(app: tauri::AppHandle) -> Result<String, String> {
    #[cfg(windows)]
    {
        use tauri::Manager;
        let resource_dir = app
            .path()
            .resource_dir()
            .map_err(|error| format!("无法定位应用资源：{error}"))?;
        let driver_dir = resource_dir.join("driver");
        let result = tauri::async_runtime::spawn_blocking(move || {
            install_interception(&driver_dir)
        })
        .await
        .map_err(|error| format!("安装任务失败：{error}"))?;
        result
    }
    #[cfg(not(windows))]
    {
        let _ = app;
        Err("驱动安装仅支持 Windows".into())
    }
}

#[cfg(windows)]
fn install_interception(driver_dir: &std::path::Path) -> Result<String, String> {
    use std::process::Command;
    let url = INTERCEPTION_URL;
    let driver_dir_str = driver_dir.to_string_lossy().replace('"', "");
    // One click: download zip to TEMP, expand, best-effort copy dll next to bridge,
    // then elevate only the official installer. DLL also loads from TEMP, no admin needed.
    let ps = format!(
        "$ErrorActionPreference='Stop';"
        "$base=Join-Path $env:TEMP 'auto-music-interception';"
        "$zip=Join-Path $base 'Interception.zip';"
        "$dir=Join-Path $base 'Interception';"
        "New-Item -ItemType Directory -Path $base -Force|Out-Null;"
        "if(!(Test-Path $zip)){{[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12;"
        "Invoke-WebRequest -Uri '{url}' -OutFile $zip -UseBasicParsing}};"
        "if(!(Test-Path (Join-Path $dir 'Install-interception.exe'))){{"
        "Expand-Archive -Path $zip -DestinationPath $dir -Force}};"
        "$dll=Join-Path $dir 'x64\\interception.dll';"
        "try{{New-Item -ItemType Directory -Path '{drv}' -Force|Out-Null;"
        "Copy-Item $dll -Destination '{drv}\\interception.dll' -Force}}catch{{}};"
        "$inst=Join-Path $dir 'Install-interception.exe';"
        "try{{$p=Start-Process -FilePath $inst -ArgumentList '/install' -Verb RunAs -Wait -PassThru;"
        "if($p.ExitCode -ne 0){{throw "安装程序返回 "+$p.ExitCode}}}}"
        "catch{{throw '安装需要管理员确认:'+$_.Exception.Message}};"
        "'INTERCEPTION_INSTALL_OK:'+$dll",
        url = url,
        drv = driver_dir_str,
    );
    let output = Command::new("powershell.exe")
        .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", &ps])
        .output()
        .map_err(|error| format!("无法启动安装脚本：{error}"))?;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    if !output.status.success() {
        let detail = if !stderr.trim().is_empty() { stderr.trim() } else { stdout.trim() };
        return Err(format!("自动安装失败：{detail}"));
    }
    Ok("Interception 已自动下载并安装（已弹管理员确认）；请重启 Windows 后再点“检查驱动”。DLL 已就位，无需手动搜索下载。".into())
}
