#[cfg(not(target_os = "android"))]
mod desktop;
#[cfg(not(target_os = "android"))]
mod local_files;
#[cfg(target_os = "android")]
mod android;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "android")]
    android::run();
    #[cfg(not(target_os = "android"))]
    desktop::run();
}
