/**
 * `@tauri-apps/api/window`, for a yaz served to a browser (ADR-0030).
 *
 * A tab is not a window yaz owns: the browser minimises and closes it. The
 * one control that still means something is "maximise", which becomes
 * fullscreen — the same wish, granted by the thing that can grant it.
 */

type UnlistenFn = () => void;

// The title bar reads this to drop the three window buttons, which in a tab
// would be two that do nothing and one the browser already has a key for.
document.documentElement.dataset.host = "web";

const tab = {
  isMaximized(): Promise<boolean> {
    return Promise.resolve(document.fullscreenElement !== null);
  },

  onResized(handler: () => void): Promise<UnlistenFn> {
    document.addEventListener("fullscreenchange", handler);
    return Promise.resolve(() =>
      document.removeEventListener("fullscreenchange", handler),
    );
  },

  async toggleMaximize(): Promise<void> {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      // Refused by the browser, which is its decision to make.
    }
  },

  minimize(): Promise<void> {
    return Promise.resolve();
  },

  close(): Promise<void> {
    return Promise.resolve();
  },
};

export function getCurrentWindow(): typeof tab {
  return tab;
}
