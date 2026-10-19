use std::collections::HashMap;
use std::sync::Mutex;

use tauri::{Runtime, WebviewWindow, Window};

pub const EVENT: &str = "mac-fullscreen";

static SHOWN: Mutex<Option<HashMap<String, Vec<Spot>>>> = Mutex::new(None);

#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize)]
pub struct Spot {
    x: f64,
    y: f64,
    size: f64,
}

#[derive(Clone, Debug, serde::Serialize)]
pub struct Change {
    fullscreen: bool,
    lights: Vec<Spot>,
}

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn remember(label: &str, change: &Change) {
    let mut shown = SHOWN
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let shown = shown.get_or_insert_with(HashMap::new);
    if change.fullscreen {
        shown.insert(label.to_string(), change.lights.clone());
    } else {
        shown.remove(label);
    }
}

fn state_of(label: &str) -> Change {
    let shown = SHOWN
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    match shown.as_ref().and_then(|shown| shown.get(label)) {
        Some(lights) => Change {
            fullscreen: true,
            lights: lights.clone(),
        },
        None => Change {
            fullscreen: false,
            lights: Vec::new(),
        },
    }
}

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn spot_from_bottom(x: f64, y: f64, width: f64, height: f64, window_height: f64) -> Spot {
    Spot {
        x,
        y: window_height - y - height,
        size: width.min(height),
    }
}

#[cfg(target_os = "macos")]
mod macos {
    use std::cell::RefCell;
    use std::collections::HashMap;
    use std::ptr::NonNull;

    use block2::RcBlock;
    use objc2::rc::Retained;
    use objc2::runtime::{NSObjectProtocol, ProtocolObject};
    use objc2_app_kit::{
        NSView, NSWindow, NSWindowButton, NSWindowDidEnterFullScreenNotification,
        NSWindowDidExitFullScreenNotification, NSWindowWillEnterFullScreenNotification,
    };
    use objc2_foundation::{NSNotification, NSNotificationCenter, NSNotificationName};
    use tauri::{Emitter, Runtime, Window};

    use super::{remember, spot_from_bottom, Change, Spot, EVENT};

    const LIGHTS: [NSWindowButton; 3] = [
        NSWindowButton::CloseButton,
        NSWindowButton::MiniaturizeButton,
        NSWindowButton::ZoomButton,
    ];

    type Observer = Retained<ProtocolObject<dyn NSObjectProtocol>>;

    thread_local! {
        static OBSERVERS: RefCell<HashMap<String, Vec<Observer>>> = RefCell::new(HashMap::new());
    }

    fn titlebar_of(ns_window: &NSWindow) -> Option<Retained<NSView>> {
        let close = ns_window.standardWindowButton(NSWindowButton::CloseButton)?;
        // SAFETY: superview only walks up the view tree of this live window, on the main thread.
        unsafe { close.superview().and_then(|titlebar| titlebar.superview()) }
    }

    fn spots(ns_window: &NSWindow) -> Vec<Spot> {
        let Some(content) = ns_window.contentView() else {
            return Vec::new();
        };
        let height = content.frame().size.height;
        LIGHTS
            .iter()
            .filter_map(|kind| ns_window.standardWindowButton(*kind))
            .map(|light| {
                let frame = light.convertRect_toView(light.bounds(), None);
                spot_from_bottom(
                    frame.origin.x,
                    frame.origin.y,
                    frame.size.width,
                    frame.size.height,
                    height,
                )
            })
            .collect()
    }

    fn tell<R: Runtime>(window: &Window<R>, change: Change) {
        remember(window.label(), &change);
        let _ = window.emit_to(window.label(), EVENT, change);
    }

    fn will_enter<R: Runtime>(ns_window: &NSWindow, window: &Window<R>) {
        let lights = spots(ns_window);
        if let Some(titlebar) = titlebar_of(ns_window) {
            titlebar.setHidden(true);
        }
        tell(
            window,
            Change {
                fullscreen: true,
                lights,
            },
        );
    }

    fn did_enter<R: Runtime>(ns_window: &NSWindow, _window: &Window<R>) {
        let Some(titlebar) = titlebar_of(ns_window) else {
            return;
        };
        titlebar.setHidden(true);
        if let Some(strip) = titlebar.window() {
            if !std::ptr::eq(&*strip, ns_window) {
                strip.setIgnoresMouseEvents(true);
            }
        }
    }

    fn did_exit<R: Runtime>(ns_window: &NSWindow, window: &Window<R>) {
        if let Some(content) = ns_window.contentView() {
            content.setNeedsDisplay(true);
            content.displayIfNeeded();
        }
        if let Some(titlebar) = titlebar_of(ns_window) {
            titlebar.setHidden(false);
        }
        tell(
            window,
            Change {
                fullscreen: false,
                lights: Vec::new(),
            },
        );
    }

    fn observe<R: Runtime>(
        ns_window: &NSWindow,
        window: &Window<R>,
        name: &NSNotificationName,
        act: fn(&NSWindow, &Window<R>),
    ) -> Observer {
        let target = window.clone();
        let block = RcBlock::new(move |_: NonNull<NSNotification>| {
            if let Ok(pointer) = target.ns_window() {
                // SAFETY: AppKit posts these notifications on the main thread for this live window.
                act(unsafe { &*pointer.cast::<NSWindow>() }, &target);
            }
        });
        // SAFETY: the observer is tied to this window object and runs on the posting (main) thread, as the block expects.
        unsafe {
            NSNotificationCenter::defaultCenter().addObserverForName_object_queue_usingBlock(
                Some(name),
                Some(ns_window.as_ref()),
                None,
                &block,
            )
        }
    }

    pub fn install<R: Runtime>(ns_window: &NSWindow, window: &Window<R>) {
        let label = window.label().to_string();
        if OBSERVERS.with(|observers| observers.borrow().contains_key(&label)) {
            return;
        }
        // SAFETY: AppKit's notification names are immutable globals that live for the whole process.
        let (will_enter_name, did_enter_name, did_exit_name) = unsafe {
            (
                NSWindowWillEnterFullScreenNotification,
                NSWindowDidEnterFullScreenNotification,
                NSWindowDidExitFullScreenNotification,
            )
        };
        let tokens = vec![
            observe(ns_window, window, will_enter_name, will_enter),
            observe(ns_window, window, did_enter_name, did_enter),
            observe(ns_window, window, did_exit_name, did_exit),
        ];
        OBSERVERS.with(|observers| observers.borrow_mut().insert(label, tokens));
    }

    pub fn forget<R: Runtime>(window: &Window<R>) {
        let Some(tokens) =
            OBSERVERS.with(|observers| observers.borrow_mut().remove(window.label()))
        else {
            return;
        };
        let center = NSNotificationCenter::defaultCenter();
        for token in tokens {
            // SAFETY: each token came from addObserverForName on this same default center.
            unsafe { center.removeObserver(token.as_ref()) };
        }
    }
}

#[cfg(target_os = "macos")]
fn on_main<R: Runtime>(
    window: Window<R>,
    act: impl FnOnce(&objc2_app_kit::NSWindow, &Window<R>) + Send + 'static,
) {
    let target = window.clone();
    let _ = window.run_on_main_thread(move || {
        if let Ok(pointer) = target.ns_window() {
            // SAFETY: tauri hands back the live NSWindow of this window and this closure runs on the main thread AppKit requires.
            act(
                unsafe { &*pointer.cast::<objc2_app_kit::NSWindow>() },
                &target,
            );
        }
    });
}

pub fn install<R: Runtime>(window: &WebviewWindow<R>) {
    #[cfg(target_os = "macos")]
    on_main(window.as_ref().window(), macos::install);
    #[cfg(not(target_os = "macos"))]
    let _ = window;
}

pub fn forget<R: Runtime>(window: &Window<R>) {
    remember(
        window.label(),
        &Change {
            fullscreen: false,
            lights: Vec::new(),
        },
    );
    #[cfg(target_os = "macos")]
    on_main(window.clone(), |_, window| macos::forget(window));
    #[cfg(not(target_os = "macos"))]
    let _ = window;
}

#[tauri::command]
pub fn mac_fullscreen_state<R: Runtime>(window: WebviewWindow<R>) -> Change {
    state_of(window.label())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_light_measured_from_the_bottom_lands_at_the_same_spot_from_the_top() {
        let spot = spot_from_bottom(15.0, 862.0, 14.0, 16.0, 900.0);

        assert_eq!(
            spot,
            Spot {
                x: 15.0,
                y: 22.0,
                size: 14.0
            }
        );
    }

    #[test]
    fn a_change_reaches_the_page_in_the_shape_the_top_bar_reads() {
        let change = Change {
            fullscreen: true,
            lights: vec![Spot {
                x: 15.0,
                y: 22.0,
                size: 14.0,
            }],
        };

        assert_eq!(
            serde_json::to_value(change).unwrap(),
            serde_json::json!({"fullscreen": true, "lights": [{"x": 15.0, "y": 22.0, "size": 14.0}]})
        );
    }

    #[test]
    fn a_reloaded_page_still_finds_the_lights_of_a_full_screen_window() {
        let lights = vec![Spot {
            x: 15.0,
            y: 22.0,
            size: 14.0,
        }];

        remember(
            "doc-7",
            &Change {
                fullscreen: true,
                lights: lights.clone(),
            },
        );
        assert_eq!(state_of("doc-7").lights, lights);
        assert!(state_of("doc-7").fullscreen);

        remember(
            "doc-7",
            &Change {
                fullscreen: false,
                lights: Vec::new(),
            },
        );
        assert!(!state_of("doc-7").fullscreen);
        assert!(!state_of("doc-8").fullscreen);
    }
}
