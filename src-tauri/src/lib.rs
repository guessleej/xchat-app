// xChat — Tauri 2.x 主程式 (lib entry，給 macOS/iOS/Android 共用)

#[cfg(desktop)]
use tauri::{
    image::Image,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_notification::init());

    #[cfg(desktop)]
    let builder = builder.setup(|app| {
        setup_tray(app.handle())?;
        Ok(())
    });

    builder
        .invoke_handler(tauri::generate_handler![get_app_info])
        .run(tauri::generate_context!())
        .expect("error while running xChat Tauri application");
}

#[tauri::command]
fn get_app_info() -> serde_json::Value {
    serde_json::json!({
        "name": "xChat",
        "version": env!("CARGO_PKG_VERSION"),
        "framework": "tauri-2",
    })
}

// ──────────────────────────────────────────────────────────────────────────────
// macOS / Windows / Linux Tray（menu bar 圖示 + 選單）
// ──────────────────────────────────────────────────────────────────────────────
#[cfg(desktop)]
fn setup_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
    // 載入 macOS template image（monochrome 黑色，OS 自動依深淺色反色）
    let icon_bytes = include_bytes!("../icons/iconTemplate.png");
    let icon = Image::from_bytes(icon_bytes)?;

    let show_hide = MenuItem::with_id(app, "show_hide", "顯示 xChat", true, Some("Cmd+Shift+Space"))?;
    let new_conv  = MenuItem::with_id(app, "new_conv", "新對話", true, Some("Cmd+N"))?;
    let settings  = MenuItem::with_id(app, "settings", "偏好設定…", true, None::<&str>)?;
    let about     = MenuItem::with_id(app, "about", "關於 xChat", true, None::<&str>)?;
    let quit      = MenuItem::with_id(app, "quit", "退出 xChat", true, Some("Cmd+Q"))?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;

    let menu = Menu::with_items(
        app,
        &[&show_hide, &new_conv, &sep1, &settings, &about, &sep2, &quit],
    )?;

    let _tray = TrayIconBuilder::with_id("xchat-tray")
        .icon(icon)
        .icon_as_template(true) // ← 關鍵：讓 macOS 自動深淺色適配
        .menu(&menu)
        .show_menu_on_left_click(false) // 左鍵切換視窗、右鍵才顯示選單
        .tooltip("xChat")
        .on_tray_icon_event(|tray, event| {
            // 左鍵 → 切換主視窗顯隱（macOS 慣例）
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                if let Some(win) = tray.app_handle().get_webview_window("main") {
                    let visible = win.is_visible().unwrap_or(false);
                    let focused = win.is_focused().unwrap_or(false);
                    if visible && focused {
                        let _ = win.hide();
                    } else {
                        let _ = win.show();
                        let _ = win.set_focus();
                    }
                }
            }
        })
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show_hide" => {
                if let Some(win) = app.get_webview_window("main") {
                    let visible = win.is_visible().unwrap_or(false);
                    if visible {
                        let _ = win.hide();
                    } else {
                        let _ = win.show();
                        let _ = win.set_focus();
                    }
                }
            }
            "new_conv" => {
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.show();
                    let _ = win.set_focus();
                }
                let _ = app.emit("new-conversation", ());
            }
            "settings" => {
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.show();
                    let _ = win.set_focus();
                }
                let _ = app.emit("open-settings", ());
            }
            "about" => {
                // 後續可接 tauri-plugin-dialog 開 about
            }
            "quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .build(app)?;

    Ok(())
}
