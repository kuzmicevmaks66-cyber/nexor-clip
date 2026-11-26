// Скрывает консольное окно в release-сборке Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    nexor_clip_lib::run()
}
