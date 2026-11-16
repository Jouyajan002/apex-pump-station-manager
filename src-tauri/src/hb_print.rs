// ============================================================================
//  hb_print.rs — چاپِ سیستمیِ ویندوز برای APEX Pump Station Manager (مورد ۲۹)
//  ---------------------------------------------------------------------------
//  همهٔ چاپ‌ها (بل، رسید، گزارش، بارکد) فقط «پنجرهٔ چاپِ سیستمِ ویندوز» را باز می‌کنند؛
//  پنجرهٔ پیش‌نمایشِ اضافه پشتِ آن باز نمی‌شود (پیش‌نمایشِ اورلیِ داخلِ برنامه کافی است).
//
//  روش: پنجرهٔ نامرئیِ ۱×۱ با برچسبِ hb-print (print-window.html) محتوا را می‌گیرد و می‌نویسد؛ سپس
//  پنجرهٔ اصلی همین فرمان را با label='hb-print' صدا می‌زند و روی WebView2ِ همان پنجره
//  ShowPrintUI(COREWEBVIEW2_PRINT_DIALOG_KIND_SYSTEM) اجرا می‌شود. اگر نشد (مثلاً WebView2 نسخهٔ ۱۰۹ در Win7 که ICoreWebView2_16 را ندارد)، خطا
//  برمی‌گردد و جاوااسکریپت به چاپِ iframe برمی‌گردد (onFallback).
//
//  ویندوز ۱۱: پیش از نمایشِ پنجرهٔ چاپ، PreferLegacyPrintDialog=1 در
//  HKCU\Software\Microsoft\Print\UnifiedPrintDialog نوشته می‌شود تا پنجرهٔ چاپ مثلِ ویندوز ۱۰ باشد؛
//  ۸ ثانیه بعد مقدارِ قبلی برمی‌گردد (یا اگر نبود پاک می‌شود). اگر از قبل ۱ بود، کاری نمی‌شود.
//  (تصمیمِ صاحب برنامه: فقط هنگامِ چاپِ APEX، نه دائمی — چون برای همهٔ برنامه‌های همان کاربر اثر دارد.)
//  هشدار: اثرِ این تنظیم روی پنجرهٔ چاپِ WebView2 فقط از منابعِ وب است و روی ویندوز ۱۱ واقعی تست نشده.
// ============================================================================

#[tauri::command]
pub async fn hb_print_system(app: tauri::AppHandle, label: Option<String>) -> Result<(), String> {
    use tauri::Manager;
    let window = app
        .get_webview_window(label.as_deref().unwrap_or("hb-print"))
        .ok_or_else(|| "no-window".to_string())?;
    #[cfg(target_os = "windows")]
    {
        legacy::prefer_legacy_temporarily();
        let (tx, rx) = std::sync::mpsc::channel::<Result<(), String>>();
        window
            .with_webview(move |wv| {
                let r = (|| -> Result<(), String> {
                    use webview2_com::Microsoft::Web::WebView2::Win32::{
                        ICoreWebView2_16, COREWEBVIEW2_PRINT_DIALOG_KIND_SYSTEM,
                    };
                    use windows::core::Interface;
                    unsafe {
                        let core = wv.controller().CoreWebView2().map_err(|e| e.to_string())?;
                        let c16: ICoreWebView2_16 = core.cast().map_err(|e| e.to_string())?;
                        c16.ShowPrintUI(COREWEBVIEW2_PRINT_DIALOG_KIND_SYSTEM)
                            .map_err(|e| e.to_string())?;
                    }
                    Ok(())
                })();
                let _ = tx.send(r);
            })
            .map_err(|e| e.to_string())?;
        return rx
            .recv_timeout(std::time::Duration::from_secs(5))
            .map_err(|_| "timeout".to_string())?;
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = window;
        Err("unsupported".to_string())
    }
}

#[cfg(target_os = "windows")]
mod legacy {
    use std::os::windows::process::CommandExt;
    use std::process::Command;

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    const KEY: &str = r"HKCU\Software\Microsoft\Print\UnifiedPrintDialog";
    const VAL: &str = "PreferLegacyPrintDialog";

    fn reg(args: &[&str]) -> Option<String> {
        Command::new("reg.exe")
            .args(args)
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .ok()
            .filter(|o| o.status.success())
            .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
    }

    /// مقدارِ فعلی: Some(n) اگر وجود دارد، None اگر نیست
    fn current() -> Option<u32> {
        let out = reg(&["query", KEY, "/v", VAL])?;
        let line = out.lines().find(|l| l.contains(VAL))?;
        let hex = line.split_whitespace().last()?;
        u32::from_str_radix(hex.trim_start_matches("0x"), 16).ok()
    }

    pub fn prefer_legacy_temporarily() {
        let prev = current();
        if prev == Some(1) {
            return; // از قبل روشن است؛ دست نمی‌زنیم
        }
        if reg(&["add", KEY, "/v", VAL, "/t", "REG_DWORD", "/d", "1", "/f"]).is_none() {
            return;
        }
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_secs(8));
            match prev {
                Some(v) => {
                    let s = v.to_string();
                    let _ = reg(&["add", KEY, "/v", VAL, "/t", "REG_DWORD", "/d", &s, "/f"]);
                }
                None => {
                    let _ = reg(&["delete", KEY, "/v", VAL, "/f"]);
                }
            }
        });
    }
}
