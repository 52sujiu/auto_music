//! Read practice keys globally while the guide is playing, including when a game has focus.

use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use tauri::{AppHandle, State};

#[derive(Default)]
pub struct GuideInputState(Mutex<Option<Arc<AtomicBool>>>);

impl GuideInputState {
    pub fn stop(&self) {
        if let Ok(mut active) = self.0.lock() {
            if let Some(stop) = active.take() {
                stop.store(true, Ordering::Relaxed);
            }
        }
    }
}

#[cfg(windows)]
#[derive(serde::Serialize)]
struct GuideInput {
    key: &'static str,
    left: bool,
    right: bool,
    middle: bool,
}

#[tauri::command]
pub fn start_guide_input(
    app: AppHandle,
    state: State<'_, GuideInputState>,
) -> Result<bool, String> {
    #[cfg(windows)]
    {
        use std::{thread, time::Duration};
        use tauri::{Emitter, Manager};
        use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
            GetAsyncKeyState, VK_LBUTTON, VK_MBUTTON, VK_OEM_COMMA, VK_RBUTTON,
        };

        let mut active = state.0.lock().map_err(|_| "引导输入状态不可用")?;
        if active.is_some() {
            return Ok(true);
        }
        let stop = Arc::new(AtomicBool::new(false));
        let thread_stop = stop.clone();
        thread::Builder::new()
            .name("auto-music-guide-input".into())
            .spawn(move || {
                const KEYS: [(i32, &str); 8] = [
                    (b'Z' as i32, "Z"),
                    (b'X' as i32, "X"),
                    (b'C' as i32, "C"),
                    (b'V' as i32, "V"),
                    (b'B' as i32, "B"),
                    (b'N' as i32, "N"),
                    (b'M' as i32, "M"),
                    (VK_OEM_COMMA as i32, ","),
                ];
                let pressed = |vk: i32| unsafe { (GetAsyncKeyState(vk) as u16 & 0x8000) != 0 };
                let mut previous = [false; 8];
                while !thread_stop.load(Ordering::Relaxed) {
                    let auto_playing = app.state::<crate::playback::PlaybackState>().is_running();
                    let left = pressed(VK_LBUTTON as i32);
                    let right = pressed(VK_RBUTTON as i32);
                    let middle = pressed(VK_MBUTTON as i32);
                    for (index, (vk, key)) in KEYS.iter().enumerate() {
                        let down = pressed(*vk);
                        if down && !previous[index] && !auto_playing {
                            let _ = app.emit(
                                "guide:input",
                                GuideInput {
                                    key,
                                    left,
                                    right,
                                    middle,
                                },
                            );
                        }
                        previous[index] = down;
                    }
                    thread::sleep(Duration::from_millis(5));
                }
            })
            .map_err(|error| format!("无法启动全局按键检测：{error}"))?;
        *active = Some(stop);
        Ok(true)
    }
    #[cfg(not(windows))]
    {
        let _ = (app, state);
        Ok(false)
    }
}
