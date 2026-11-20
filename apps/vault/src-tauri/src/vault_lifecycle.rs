use std::ptr::NonNull;

use block2::RcBlock;
use objc2_app_kit::{
    NSWorkspace, NSWorkspaceSessionDidResignActiveNotification, NSWorkspaceWillSleepNotification,
};
use objc2_foundation::{NSNotification, NSNotificationCenter};
use tauri::{AppHandle, Manager};

fn observe(center: &NSNotificationCenter, on_lock: impl Fn() + Send + Sync + 'static) {
    let block = RcBlock::new(move |_: NonNull<NSNotification>| on_lock());
    // The workspace center retains these observers for the life of the app.
    unsafe {
        for name in [
            NSWorkspaceWillSleepNotification,
            NSWorkspaceSessionDidResignActiveNotification,
        ] {
            center.addObserverForName_object_queue_usingBlock(Some(name), None, None, &block);
        }
    }
}

pub fn install(app: AppHandle) {
    observe(
        &NSWorkspace::sharedWorkspace().notificationCenter(),
        move || {
            if let Some(state) = app.try_state::<crate::vault::VaultState>() {
                let _ = state.lock();
            }
        },
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    };

    #[test]
    fn workspace_notifications_trigger_lock_only_on_sleep_or_deactivation() {
        let center = NSNotificationCenter::new();
        let locks = Arc::new(AtomicUsize::new(0));
        observe(&center, {
            let locks = Arc::clone(&locks);
            move || {
                locks.fetch_add(1, Ordering::Relaxed);
            }
        });
        unsafe {
            center.postNotificationName_object(objc2_app_kit::NSWorkspaceDidWakeNotification, None);
            assert_eq!(locks.load(Ordering::Relaxed), 0);
            center.postNotificationName_object(NSWorkspaceWillSleepNotification, None);
            assert_eq!(locks.load(Ordering::Relaxed), 1);
            center.postNotificationName_object(NSWorkspaceSessionDidResignActiveNotification, None);
            assert_eq!(locks.load(Ordering::Relaxed), 2);
        }
    }
}
