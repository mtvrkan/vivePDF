#[cfg(target_os = "macos")]
mod macos {
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::OnceLock;

    use objc2::runtime::{AnyObject, Imp, Sel};
    use objc2::{sel, MainThreadMarker};
    use objc2_app_kit::NSApplication;
    use tauri::{AppHandle, Emitter, Runtime};

    const TERMINATE_LATER: usize = 2;
    const SHOULD_TERMINATE_TYPES: &std::ffi::CStr = c"Q@:@";

    static PENDING: AtomicBool = AtomicBool::new(false);
    static ASK_WINDOWS: OnceLock<Box<dyn Fn() + Send + Sync>> = OnceLock::new();

    extern "C-unwind" fn should_terminate(_: &AnyObject, _: Sel, _: *mut AnyObject) -> usize {
        if !PENDING.swap(true, Ordering::SeqCst) {
            if let Some(ask) = ASK_WINDOWS.get() {
                ask();
            }
        }
        TERMINATE_LATER
    }

    fn reply(terminate: bool) {
        if let Some(mtm) = MainThreadMarker::new() {
            NSApplication::sharedApplication(mtm).replyToApplicationShouldTerminate(terminate);
        }
    }

    pub fn install<R: Runtime>(app: &AppHandle<R>) {
        let Some(mtm) = MainThreadMarker::new() else {
            return;
        };
        let Some(delegate) = NSApplication::sharedApplication(mtm).delegate() else {
            return;
        };
        let handle = app.clone();
        let _ = ASK_WINDOWS.set(Box::new(move || {
            crate::tray::show_main_window(&handle);
            let _ = handle.emit("quit-requested", ());
        }));
        let object: &AnyObject = (*delegate).as_ref();
        let class = object.class();
        let callback: extern "C-unwind" fn(&AnyObject, Sel, *mut AnyObject) -> usize =
            should_terminate;
        // SAFETY: the callback has the C signature of applicationShouldTerminate: (NSUInteger, self, _cmd, sender) that the type string spells, and tao's delegate class does not implement it yet.
        unsafe {
            let imp = std::mem::transmute::<
                extern "C-unwind" fn(&AnyObject, Sel, *mut AnyObject) -> usize,
                Imp,
            >(callback);
            objc2::ffi::class_addMethod(
                std::ptr::from_ref(class).cast_mut(),
                sel!(applicationShouldTerminate:),
                imp,
                SHOULD_TERMINATE_TYPES.as_ptr(),
            );
        }
    }

    pub fn windows_closed() -> bool {
        if !PENDING.swap(false, Ordering::SeqCst) {
            return false;
        }
        reply(true);
        true
    }

    pub fn cancelled() {
        if PENDING.swap(false, Ordering::SeqCst) {
            reply(false);
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn closing_the_last_window_answers_only_a_pending_system_quit() {
            assert!(!windows_closed());
            PENDING.store(true, Ordering::SeqCst);
            assert!(windows_closed());
            assert!(!windows_closed());
            PENDING.store(true, Ordering::SeqCst);
            cancelled();
            assert!(!windows_closed());
        }
    }
}

#[cfg(target_os = "macos")]
pub use macos::{install, windows_closed};

#[tauri::command]
pub fn app_quit_cancelled() {
    #[cfg(target_os = "macos")]
    macos::cancelled();
}
