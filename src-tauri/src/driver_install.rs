//! Install a supplied, Microsoft-signed VHF driver package after a single UAC prompt.

#[cfg(windows)]
mod windows {
    use std::{
        fs::OpenOptions,
        io, iter,
        os::windows::ffi::OsStrExt,
        path::{Path, PathBuf},
        ptr, thread,
        time::Duration,
    };
    use windows_sys::{
        core::GUID,
        Win32::{
            Devices::DeviceAndDriverInstallation::{
                SetupDiCallClassInstaller, SetupDiCreateDeviceInfoList, SetupDiCreateDeviceInfoW,
                SetupDiDestroyDeviceInfoList, SetupDiEnumDeviceInfo, SetupDiGetClassDevsW,
                SetupDiGetDeviceRegistryPropertyW, SetupDiGetINFClassW,
                SetupDiSetDeviceRegistryPropertyW, UpdateDriverForPlugAndPlayDevicesW,
                DICD_GENERATE_ID, DIF_REGISTERDEVICE, DIF_REMOVE, DIGCF_ALLCLASSES,
                SPDRP_HARDWAREID, SP_DEVINFO_DATA,
            },
            Foundation::{CloseHandle, INVALID_HANDLE_VALUE},
            System::Threading::{GetExitCodeProcess, WaitForSingleObject},
            UI::{
                Shell::{ShellExecuteExW, SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW},
                WindowsAndMessaging::SW_HIDE,
            },
        },
    };

    const HARDWARE_ID: &str = "Root\\AutoMusicVhid";

    fn wide(value: &std::ffi::OsStr) -> Vec<u16> {
        value.encode_wide().chain(iter::once(0)).collect()
    }

    fn package_path(path: &Path) -> Result<PathBuf, String> {
        let path = path
            .canonicalize()
            .map_err(|error| format!("找不到驱动 INF：{error}"))?;
        if path.file_name().and_then(|name| name.to_str()) != Some("AutoMusicVhid.inf") {
            return Err("请选择 AutoMusicVhid.inf".into());
        }
        let parent = path.parent().ok_or("驱动路径无效")?;
        for name in ["AutoMusicVhid.sys", "AutoMusicVhid.cat"] {
            if !parent.join(name).is_file() {
                return Err(format!("驱动包缺少 {name}；需要完整且已签名的 INF/SYS/CAT"));
            }
        }
        Ok(path)
    }

    pub fn installed() -> bool {
        OpenOptions::new()
            .write(true)
            .open(r"\\.\AutoMusicVhid")
            .is_ok()
    }

    /// Starts this same executable as an elevated, short-lived installer helper.
    pub fn install(path: &Path) -> Result<String, String> {
        let path = package_path(path)?;
        if installed() {
            return Ok("虚拟 HID 驱动已安装并可用".into());
        }
        let exe = std::env::current_exe().map_err(|error| format!("无法定位程序：{error}"))?;
        let verb = wide(std::ffi::OsStr::new("runas"));
        let exe_wide = wide(exe.as_os_str());
        let args = wide(std::ffi::OsStr::new(&format!(
            "--install-vhid-driver \"{}\"",
            path.display()
        )));
        let mut launch: SHELLEXECUTEINFOW = unsafe { std::mem::zeroed() };
        launch.cbSize = std::mem::size_of::<SHELLEXECUTEINFOW>() as u32;
        launch.fMask = SEE_MASK_NOCLOSEPROCESS;
        launch.lpVerb = verb.as_ptr();
        launch.lpFile = exe_wide.as_ptr();
        launch.lpParameters = args.as_ptr();
        launch.nShow = SW_HIDE;
        if unsafe { ShellExecuteExW(&mut launch) } == 0 {
            return Err(format!(
                "未能启动管理员安装程序：{}",
                io::Error::last_os_error()
            ));
        }
        if launch.hProcess.is_null() {
            return Err("管理员安装程序没有返回进程句柄".into());
        }
        let wait = unsafe { WaitForSingleObject(launch.hProcess, 120_000) };
        let mut exit_code = 0u32;
        let read_ok = unsafe { GetExitCodeProcess(launch.hProcess, &mut exit_code) } != 0;
        unsafe {
            CloseHandle(launch.hProcess);
        }
        if wait != 0 || !read_ok {
            return Err("等待驱动安装超时或失败".into());
        }
        if exit_code != 0 {
            return Err("Windows 未能加载驱动：请确认 INF/SYS/CAT 已由 Microsoft 签名，并查看设备管理器错误".into());
        }
        for _ in 0..20 {
            if installed() {
                return Ok("虚拟 HID 驱动安装完成并可用".into());
            }
            thread::sleep(Duration::from_millis(100));
        }
        Err("驱动安装已执行，但设备尚不可用；请检查设备管理器或重启 Windows".into())
    }

    fn device_exists() -> Result<bool, String> {
        let root = wide(std::ffi::OsStr::new("ROOT"));
        let list = unsafe {
            SetupDiGetClassDevsW(
                ptr::null(),
                root.as_ptr(),
                ptr::null_mut(),
                DIGCF_ALLCLASSES,
            )
        };
        if list == INVALID_HANDLE_VALUE as isize {
            return Err(format!("无法枚举设备：{}", io::Error::last_os_error()));
        }
        let mut found = false;
        let mut index = 0;
        loop {
            let mut data: SP_DEVINFO_DATA = unsafe { std::mem::zeroed() };
            data.cbSize = std::mem::size_of::<SP_DEVINFO_DATA>() as u32;
            if unsafe { SetupDiEnumDeviceInfo(list, index, &mut data) } == 0 {
                break;
            }
            let mut buffer = [0u8; 4096];
            let mut required = 0;
            if unsafe {
                SetupDiGetDeviceRegistryPropertyW(
                    list,
                    &data,
                    SPDRP_HARDWAREID,
                    ptr::null_mut(),
                    buffer.as_mut_ptr(),
                    buffer.len() as u32,
                    &mut required,
                )
            } != 0
            {
                let ids: Vec<u16> = buffer[..(required as usize).min(buffer.len())]
                    .chunks_exact(2)
                    .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
                    .collect();
                if String::from_utf16_lossy(&ids)
                    .split('\0')
                    .any(|id| id.eq_ignore_ascii_case(HARDWARE_ID))
                {
                    found = true;
                    break;
                }
            }
            index += 1;
        }
        unsafe {
            SetupDiDestroyDeviceInfoList(list);
        }
        Ok(found)
    }

    pub fn install_elevated(path: &Path) -> Result<(), String> {
        let path = package_path(path)?;
        let inf = wide(path.as_os_str());
        let hardware_id = wide(std::ffi::OsStr::new(HARDWARE_ID));
        if !device_exists()? {
            let mut class_guid: GUID = unsafe { std::mem::zeroed() };
            let mut class_name = [0u16; 256];
            if unsafe {
                SetupDiGetINFClassW(
                    inf.as_ptr(),
                    &mut class_guid,
                    class_name.as_mut_ptr(),
                    class_name.len() as u32,
                    ptr::null_mut(),
                )
            } == 0
            {
                return Err(format!(
                    "读取驱动 INF 类别失败：{}",
                    io::Error::last_os_error()
                ));
            }
            let list = unsafe { SetupDiCreateDeviceInfoList(&class_guid, ptr::null_mut()) };
            if list == INVALID_HANDLE_VALUE as isize {
                return Err(format!(
                    "创建根设备列表失败：{}",
                    io::Error::last_os_error()
                ));
            }
            let mut data: SP_DEVINFO_DATA = unsafe { std::mem::zeroed() };
            data.cbSize = std::mem::size_of::<SP_DEVINFO_DATA>() as u32;
            let created = unsafe {
                SetupDiCreateDeviceInfoW(
                    list,
                    class_name.as_ptr(),
                    &class_guid,
                    ptr::null(),
                    ptr::null_mut(),
                    DICD_GENERATE_ID,
                    &mut data,
                )
            } != 0;
            let mut multi_id = hardware_id.clone();
            multi_id.push(0);
            let registered = created
                && unsafe {
                    SetupDiSetDeviceRegistryPropertyW(
                        list,
                        &mut data,
                        SPDRP_HARDWAREID,
                        multi_id.as_ptr().cast(),
                        (multi_id.len() * 2) as u32,
                    )
                } != 0
                && unsafe { SetupDiCallClassInstaller(DIF_REGISTERDEVICE, list, &data) } != 0;
            if !registered {
                unsafe {
                    SetupDiDestroyDeviceInfoList(list);
                }
                return Err(format!("创建根设备失败：{}", io::Error::last_os_error()));
            }
            let mut reboot = 0;
            let installed = unsafe {
                UpdateDriverForPlugAndPlayDevicesW(
                    ptr::null_mut(),
                    hardware_id.as_ptr(),
                    inf.as_ptr(),
                    0,
                    &mut reboot,
                )
            } != 0;
            if !installed {
                unsafe {
                    SetupDiCallClassInstaller(DIF_REMOVE, list, &data);
                }
            }
            unsafe {
                SetupDiDestroyDeviceInfoList(list);
            }
            if !installed {
                return Err(format!("安装驱动失败：{}", io::Error::last_os_error()));
            }
        } else {
            let mut reboot = 0;
            if unsafe {
                UpdateDriverForPlugAndPlayDevicesW(
                    ptr::null_mut(),
                    hardware_id.as_ptr(),
                    inf.as_ptr(),
                    0,
                    &mut reboot,
                )
            } == 0
            {
                return Err(format!("更新驱动失败：{}", io::Error::last_os_error()));
            }
        }
        Ok(())
    }
}

#[tauri::command]
pub fn vhid_driver_status() -> bool {
    #[cfg(windows)]
    {
        windows::installed()
    }
    #[cfg(not(windows))]
    {
        false
    }
}

#[tauri::command]
pub fn vhid_driver_package_available(app: tauri::AppHandle) -> bool {
    #[cfg(windows)]
    {
        use tauri::Manager;
        app.path()
            .resource_dir()
            .ok()
            .map(|dir| dir.join("driver").join("AutoMusicVhid.inf"))
            .map(|path| {
                path.is_file()
                    && path.with_extension("sys").is_file()
                    && path.with_extension("cat").is_file()
            })
            .unwrap_or(false)
    }
    #[cfg(not(windows))]
    {
        let _ = app;
        false
    }
}

#[tauri::command]
pub async fn install_vhid_driver(
    app: tauri::AppHandle,
    inf_path: Option<String>,
) -> Result<String, String> {
    #[cfg(windows)]
    {
        use tauri::Manager;
        let path = match inf_path {
            Some(path) => std::path::PathBuf::from(path),
            None => app
                .path()
                .resource_dir()
                .map_err(|error| format!("无法定位应用资源：{error}"))?
                .join("driver")
                .join("AutoMusicVhid.inf"),
        };
        tauri::async_runtime::spawn_blocking(move || windows::install(&path))
            .await
            .map_err(|error| format!("安装任务失败：{error}"))?
    }
    #[cfg(not(windows))]
    {
        let _ = (app, inf_path);
        Err("虚拟 HID 驱动只支持 Windows".into())
    }
}

/// Called before Tauri starts, only by the UAC-elevated installer child process.
pub fn run_elevated_helper() -> bool {
    let mut args = std::env::args_os();
    let _ = args.next();
    if args.next().as_deref() != Some(std::ffi::OsStr::new("--install-vhid-driver")) {
        return false;
    }
    #[cfg(windows)]
    {
        let result = args
            .next()
            .ok_or("缺少 INF 路径".to_string())
            .and_then(|path| windows::install_elevated(std::path::Path::new(&path)));
        if let Err(error) = &result {
            eprintln!("{error}");
        }
        std::process::exit(if result.is_ok() { 0 } else { 1 });
    }
    #[cfg(not(windows))]
    {
        std::process::exit(1);
    }
}
