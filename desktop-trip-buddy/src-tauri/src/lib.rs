//! Minimal Tauri shell: loads FedEx dispatch in the **system WebView** (top-level document).
//! No iframe — avoids X-Frame-Options. Uses OS WebKit/WebView2 (not a second Chromium bundle).

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .run(tauri::generate_context!())
    .expect("error while running Trip Buddy desktop shell");
}
