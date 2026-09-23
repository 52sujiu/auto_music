//! Opens LizardByte's official driver installer. The MSI is not redistributed.

use serde::Serialize;

#[cfg(windows)]
const INSTALLER_URL: &str = "https://github.com/LizardByte/libvirtualhid/releases/download/v2026.914.1218.10/libvirtualhid-Windows-AMD64-driver-installer.msi";

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
        Ok("已打开 libvirtualhid 官方 MSI 下载链接；安装后请激活许可证，再点“检查驱动”".into())
    }
    #[cfg(not(windows))]
    {
        Err("驱动安装仅支持 Windows".into())
    }
}
