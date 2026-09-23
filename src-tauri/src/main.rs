// Windows 下 release 构建不弹控制台窗口。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    auto_music_lib::driver_install_helper();
    auto_music_lib::run()
}
