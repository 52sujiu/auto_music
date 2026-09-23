//! Shared wire format for the Windows VHF source driver.
//! Reports include their report ID as byte zero.

use super::HeldInput;
use enigo::Button;
use std::collections::BTreeSet;

const KEYBOARD_ID: u8 = 1;
const MOUSE_ID: u8 = 2;

#[derive(Clone, Default)]
struct ReportState {
    keys: BTreeSet<u8>,
    buttons: u8,
}

impl ReportState {
    fn update(&mut self, input: HeldInput, down: bool) -> Result<Vec<u8>, String> {
        match input {
            HeldInput::Key(key) => {
                let usage = match key {
                    'z' => 0x1d,
                    'x' => 0x1b,
                    'c' => 0x06,
                    'v' => 0x19,
                    'b' => 0x05,
                    'n' => 0x11,
                    'm' => 0x10,
                    ',' => 0x36,
                    _ => return Err(format!("没有 HID 用法码：{key}")),
                };
                if down {
                    self.keys.insert(usage);
                } else {
                    self.keys.remove(&usage);
                }
                if self.keys.len() > 6 {
                    return Err("虚拟键盘最多同时按住 6 个音键".into());
                }
                let mut report = vec![KEYBOARD_ID, 0, 0, 0, 0, 0, 0, 0, 0];
                for (slot, usage) in self.keys.iter().enumerate() {
                    report[3 + slot] = *usage;
                }
                Ok(report)
            }
            HeldInput::Mouse(button) => {
                let mask = match button {
                    Button::Left => 1,
                    Button::Right => 2,
                    Button::Middle => 4,
                    _ => return Err("虚拟鼠标仅支持左、右、中键".into()),
                };
                if down {
                    self.buttons |= mask;
                } else {
                    self.buttons &= !mask;
                }
                Ok(vec![MOUSE_ID, self.buttons, 0, 0, 0])
            }
        }
    }
}

#[cfg(windows)]
pub struct VhidOutput {
    file: std::fs::File,
    state: ReportState,
}

#[cfg(windows)]
impl VhidOutput {
    pub fn open() -> Result<Self, String> {
        let file = std::fs::OpenOptions::new()
            .write(true)
            .open(r"\\.\AutoMusicVhid")
            .map_err(|error| format!("无法打开虚拟 HID 驱动（请先安装并启动驱动）：{error}"))?;
        Ok(Self {
            file,
            state: ReportState::default(),
        })
    }

    pub fn send(&mut self, input: HeldInput, down: bool) -> Result<(), String> {
        use std::io::Write;
        let mut next = self.state.clone();
        let report = next.update(input, down)?;
        self.file
            .write_all(&report)
            .map_err(|error| format!("发送虚拟 HID 报告失败：{error}"))?;
        self.state = next;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keyboard_report_has_id_and_six_key_slots() {
        let mut state = ReportState::default();
        assert_eq!(
            state.update(HeldInput::Key('z'), true).unwrap(),
            [1, 0, 0, 0x1d, 0, 0, 0, 0, 0]
        );
        assert_eq!(
            state.update(HeldInput::Key('x'), true).unwrap(),
            [1, 0, 0, 0x1b, 0x1d, 0, 0, 0, 0]
        );
        assert_eq!(
            state.update(HeldInput::Key('z'), false).unwrap(),
            [1, 0, 0, 0x1b, 0, 0, 0, 0, 0]
        );
    }

    #[test]
    fn mouse_report_preserves_other_buttons() {
        let mut state = ReportState::default();
        assert_eq!(
            state.update(HeldInput::Mouse(Button::Left), true).unwrap(),
            [2, 1, 0, 0, 0]
        );
        assert_eq!(
            state
                .update(HeldInput::Mouse(Button::Middle), true)
                .unwrap(),
            [2, 5, 0, 0, 0]
        );
        assert_eq!(
            state.update(HeldInput::Mouse(Button::Left), false).unwrap(),
            [2, 4, 0, 0, 0]
        );
    }
}
