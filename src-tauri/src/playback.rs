use std::{
    collections::HashSet,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};

use enigo::{Button, Direction, Enigo, Key, Keyboard, Mouse, Settings};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

#[cfg(any(windows, test))]
mod vhid;

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PlaybackBackend {
    System,
    VirtualHid,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq)]
#[serde(rename_all = "kebab-case")]
enum InputKind {
    Key,
    MouseLeft,
    MouseRight,
    MouseMiddle,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InputEvent {
    at_ms: f64,
    kind: InputKind,
    key: String,
    down: bool,
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
enum HeldInput {
    Key(char),
    Mouse(Button),
}

#[derive(Default)]
struct PlaybackInner {
    generation: u64,
    running: bool,
    cancel: Option<Arc<AtomicBool>>,
}

#[derive(Default)]
pub struct PlaybackState(Mutex<PlaybackInner>, AtomicBool);

impl PlaybackState {
    pub fn set_hotkey_available(&self, available: bool) {
        self.1.store(available, Ordering::Relaxed);
    }

    #[cfg(windows)]
    pub fn is_running(&self) -> bool {
        self.0.lock().map(|inner| inner.running).unwrap_or(false)
    }
}

#[derive(Clone, Serialize)]
struct PlaybackStatus {
    state: &'static str,
    message: String,
}

fn emit_status(app: &AppHandle, state: &'static str, message: impl Into<String>) {
    let _ = app.emit(
        "auto-playback:status",
        PlaybackStatus {
            state,
            message: message.into(),
        },
    );
}

fn input_of(event: &InputEvent) -> Result<HeldInput, String> {
    match event.kind {
        InputKind::Key => {
            let key = match event.key.as_str() {
                "Z" => 'z',
                "X" => 'x',
                "C" => 'c',
                "V" => 'v',
                "B" => 'b',
                "N" => 'n',
                "M" => 'm',
                "," => ',',
                _ => return Err(format!("不支持的音键：{}", event.key)),
            };
            Ok(HeldInput::Key(key))
        }
        InputKind::MouseLeft => Ok(HeldInput::Mouse(Button::Left)),
        InputKind::MouseRight => Ok(HeldInput::Mouse(Button::Right)),
        InputKind::MouseMiddle => Ok(HeldInput::Mouse(Button::Middle)),
    }
}

fn validate(events: &[InputEvent], countdown_ms: u64) -> Result<(), String> {
    if events.is_empty() || events.len() > 100_000 {
        return Err("事件数量必须在 1 到 100000 之间".into());
    }
    if countdown_ms > 10_000 {
        return Err("倒计时不能超过 10 秒".into());
    }
    let mut previous = 0.0;
    let mut held = HashSet::new();
    for event in events {
        if !event.at_ms.is_finite() || event.at_ms < previous || event.at_ms > 7_200_000.0 {
            return Err("事件时刻无效或未按时间排序".into());
        }
        if event.kind != InputKind::Key && !event.key.is_empty() {
            return Err("鼠标事件不能包含音键".into());
        }
        let input = input_of(event)?;
        if event.down && !held.insert(input) {
            return Err("同一输入重复按下".into());
        }
        if !event.down && !held.remove(&input) {
            return Err("输入在按下前被抬起".into());
        }
        previous = event.at_ms;
    }
    Ok(())
}

fn wait_until(deadline: Instant, cancel: &AtomicBool) -> bool {
    loop {
        if cancel.load(Ordering::Relaxed) {
            return false;
        }
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return true;
        }
        thread::sleep(remaining.min(Duration::from_millis(5)));
    }
}

fn send(enigo: &mut Enigo, input: HeldInput, down: bool) -> Result<(), String> {
    let direction = if down {
        Direction::Press
    } else {
        Direction::Release
    };
    match input {
        HeldInput::Key(key) => enigo.key(Key::Unicode(key), direction),
        HeldInput::Mouse(button) => enigo.button(button, direction),
    }
    .map_err(|error| format!("发送输入失败：{error}"))
}

fn play(
    app: &AppHandle,
    events: &[InputEvent],
    countdown_ms: u64,
    cancel: &AtomicBool,
    hotkey_available: bool,
    backend: PlaybackBackend,
) -> Result<(), String> {
    enum Output {
        System(Enigo),
        #[cfg(windows)]
        VirtualHid(vhid::VhidOutput),
    }
    let mut output = match backend {
        PlaybackBackend::System => Output::System(
            Enigo::new(&Settings::default())
                .map_err(|error| format!("无法连接系统输入服务：{error}"))?,
        ),
        PlaybackBackend::VirtualHid => {
            #[cfg(windows)]
            {
                Output::VirtualHid(vhid::VhidOutput::open()?)
            }
            #[cfg(not(windows))]
            {
                return Err("虚拟 HID 仅支持 Windows".into());
            }
        }
    };
    let mut send_output = |input, down| match &mut output {
        Output::System(enigo) => send(enigo, input, down),
        #[cfg(windows)]
        Output::VirtualHid(device) => device.send(input, down),
    };
    emit_status(
        app,
        "countdown",
        format!(
            "{} 秒后开始，请切换到目标窗口{}",
            countdown_ms / 1000,
            if hotkey_available {
                "；F8 可停止"
            } else {
                "；请回到程序点击停止"
            }
        ),
    );
    let start = Instant::now() + Duration::from_millis(countdown_ms);
    let mut held = HashSet::new();
    let mut outcome = Ok(());

    if wait_until(start, cancel) {
        emit_status(
            app,
            "playing",
            if hotkey_available {
                "正在自动演奏，按 F8 可停止"
            } else {
                "正在自动演奏，请回到程序点击停止"
            },
        );
    }

    for event in events {
        let at = start + Duration::from_millis(event.at_ms.round() as u64);
        if !wait_until(at, cancel) {
            break;
        }
        if cancel.load(Ordering::Relaxed) {
            break;
        }
        let input = input_of(event)?;
        if let Err(error) = send_output(input, event.down) {
            outcome = Err(error);
            break;
        }
        if event.down {
            held.insert(input);
        } else {
            held.remove(&input);
        }
    }

    // 正常结束和中途停止都只释放本程序仍按住的输入。
    for input in held {
        let _ = send_output(input, false);
    }
    outcome
}

#[tauri::command]
pub fn start_playback(
    app: AppHandle,
    state: State<'_, PlaybackState>,
    events: Vec<InputEvent>,
    countdown_ms: u64,
    backend: PlaybackBackend,
) -> Result<bool, String> {
    validate(&events, countdown_ms)?;
    let hotkey_available = state.1.load(Ordering::Relaxed);
    let (cancel, generation) = {
        let mut inner = state.0.lock().map_err(|_| "播放状态不可用")?;
        if inner.running {
            return Err("已有自动演奏正在运行".into());
        }
        inner.generation = inner.generation.wrapping_add(1);
        inner.running = true;
        let cancel = Arc::new(AtomicBool::new(false));
        inner.cancel = Some(cancel.clone());
        (cancel, inner.generation)
    };

    thread::spawn(move || {
        let result = play(
            &app,
            &events,
            countdown_ms,
            &cancel,
            hotkey_available,
            backend,
        );
        let current = {
            let state = app.state::<PlaybackState>();
            let mut inner = state.0.lock().expect("播放状态锁异常");
            if inner.generation != generation {
                false
            } else {
                inner.running = false;
                inner.cancel = None;
                true
            }
        };
        if current {
            match result {
                Err(error) => emit_status(&app, "error", error),
                Ok(()) if cancel.load(Ordering::Relaxed) => {
                    emit_status(&app, "stopped", "自动演奏已停止")
                }
                Ok(()) => emit_status(&app, "finished", "自动演奏已完成"),
            }
        }
    });
    Ok(hotkey_available)
}

pub fn request_stop(state: &PlaybackState) {
    if let Ok(inner) = state.0.lock() {
        if let Some(cancel) = &inner.cancel {
            cancel.store(true, Ordering::Relaxed);
        }
    }
}

#[tauri::command]
pub fn stop_playback(state: State<'_, PlaybackState>) {
    request_stop(&state);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn event(at_ms: f64, kind: InputKind, key: &str, down: bool) -> InputEvent {
        InputEvent {
            at_ms,
            kind,
            key: key.into(),
            down,
        }
    }

    #[test]
    fn accepts_balanced_notes_and_mouse_modifiers() {
        let events = [
            event(0.0, InputKind::MouseLeft, "", true),
            event(40.0, InputKind::Key, "Z", true),
            event(120.0, InputKind::Key, "Z", false),
            event(160.0, InputKind::MouseLeft, "", false),
        ];
        assert!(validate(&events, 5000).is_ok());
    }

    #[test]
    fn rejects_unsorted_or_unbalanced_input() {
        assert!(validate(
            &[
                event(40.0, InputKind::Key, "Z", true),
                event(20.0, InputKind::Key, "Z", false),
            ],
            5000
        )
        .is_err());
        assert!(validate(&[event(0.0, InputKind::Key, "Z", false)], 5000).is_err());
        assert!(validate(
            &[
                event(0.0, InputKind::Key, "Z", true),
                event(20.0, InputKind::Key, "Z", true),
            ],
            5000
        )
        .is_err());
    }

    #[test]
    fn rejects_unknown_keys_and_invalid_times() {
        assert!(validate(&[event(0.0, InputKind::Key, "Q", true)], 5000).is_err());
        assert!(validate(&[event(f64::NAN, InputKind::Key, "Z", true)], 5000).is_err());
        assert!(validate(&[event(0.0, InputKind::MouseMiddle, "Z", true)], 5000).is_err());
    }

    #[test]
    fn accepts_frontend_camel_case_timestamps() {
        let event: InputEvent = serde_json::from_value(serde_json::json!({
            "atMs": 40.0,
            "kind": "mouse-middle",
            "key": "",
            "down": true
        }))
        .unwrap();
        assert_eq!(event.at_ms, 40.0);
        assert_eq!(event.kind, InputKind::MouseMiddle);
    }

    #[test]
    fn stop_interrupts_wait_without_sending_input() {
        let cancelled = AtomicBool::new(true);
        assert!(!wait_until(
            Instant::now() + Duration::from_secs(1),
            &cancelled
        ));
    }
}
