// Auto Music 桌面壳：保存文件与系统输入播放。

use std::fs;
use tauri::Manager;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Shortcut, ShortcutState};

mod playback;

/// 把文本写到用户选定的路径。返回真正写入的路径。
///
/// 前端先弹保存对话框拿到路径，再把内容送进来 —— 内容是文本（Lua / CSV），
/// 体积很小，直接走 IPC 没有性能问题。
#[tauri::command]
fn save_text_file(path: String, contents: String) -> Result<String, String> {
    if path.trim().is_empty() {
        return Err("路径为空".into());
    }
    // 只在用户已经通过系统对话框选定路径时才被调用，这里不再额外限制目录。
    fs::write(&path, contents).map_err(|e| format!("写入失败：{e}"))?;
    Ok(path)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(playback::PlaybackState::default())
        .setup(|app| {
            let stop_shortcut = Shortcut::new(None, Code::F8);
            app.handle().plugin(
                tauri_plugin_global_shortcut::Builder::new()
                    .with_handler(move |handle, shortcut, event| {
                        if shortcut == &stop_shortcut && event.state() == ShortcutState::Pressed {
                            playback::request_stop(&handle.state::<playback::PlaybackState>());
                        }
                    })
                    .build(),
            )?;
            if let Err(error) = app.global_shortcut().register(stop_shortcut) {
                eprintln!("F8 全局停止快捷键不可用：{error}");
            } else {
                app.state::<playback::PlaybackState>()
                    .set_hotkey_available(true);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            save_text_file,
            playback::start_playback,
            playback::stop_playback
        ])
        .run(tauri::generate_context!())
        .expect("启动 Tauri 应用失败");
}
