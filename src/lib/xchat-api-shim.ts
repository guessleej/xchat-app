/**
 * xchatAPI Tauri Shim — 完全 lazy 版
 * 不做任何 module-top-level side-effect，避免渲染還沒掛上時就 throw
 */

type Theme = "dark" | "light";

function isTauriEnv(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function installXchatAPI(): void {
  if (!isTauriEnv()) {
    console.warn("[xchat-api-shim] not in Tauri environment, skip install");
    return;
  }

  // 先掛一個 minimal 的 fallback，確保 renderer 任何時候讀都不會 undefined
  const fallback: any = {
    platform: "unknown",
    openExternal: () => {},
    getTheme: async () => "dark" as Theme,
    onThemeChanged: () => () => {},
    setTitle: () => {},
    onNewConversation: () => () => {},
    onFocusSearch: () => () => {},
    onOpenModelPicker: () => () => {},
    touchbarSetModel: () => {},
    taskbarProgress: () => {},
    toastNotify: () => {},
    onUpdateAvailable: () => () => {},
    onUpdateProgress: () => () => {},
    onUpdateReady: () => () => {},
    downloadUpdate: () => {},
    installUpdate: () => {},
  };
  (window as any).xchatAPI = fallback;

  // 動態 import 真實實作（任一個失敗都不會擋住 renderer）
  loadRealAPI().catch((e) => {
    console.error("[xchat-api-shim] load real API failed (using fallback):", e);
  });
}

async function loadRealAPI() {
  const [
    { type: osType },
    { open: shellOpen },
    { getCurrentWindow, ProgressBarStatus },
    { listen, emit },
    notif,
  ] = await Promise.all([
    import("@tauri-apps/plugin-os"),
    import("@tauri-apps/plugin-shell"),
    import("@tauri-apps/api/window"),
    import("@tauri-apps/api/event"),
    import("@tauri-apps/plugin-notification"),
  ]);

  // 推斷 platform
  try {
    const t = await osType();
    const map: Record<string, string> = {
      macos: "darwin",
      windows: "win32",
      linux: "linux",
      ios: "ios",
      android: "android",
    };
    (window as any).xchatAPI.platform = map[t] ?? t;
  } catch {}

  function wrapListener<T>(eventName: string, handler: (payload: T) => void): () => void {
    let unlisten: (() => void) | null = null;
    listen<T>(eventName, (e) => handler(e.payload as T)).then((fn) => {
      unlisten = fn;
    });
    return () => {
      if (unlisten) unlisten();
    };
  }

  const real = {
    get platform() {
      return (window as any).xchatAPI.platform || "unknown";
    },
    openExternal: async (url: string) => {
      try {
        await shellOpen(url);
      } catch (e) {
        console.error("openExternal:", e);
      }
    },
    getTheme: async (): Promise<Theme> => {
      try {
        const t = await getCurrentWindow().theme();
        return t === "light" ? "light" : "dark";
      } catch {
        return "dark";
      }
    },
    onThemeChanged: (cb: (t: Theme) => void) => {
      let unlisten: (() => void) | null = null;
      getCurrentWindow()
        .onThemeChanged(({ payload }) => cb((payload === "light" ? "light" : "dark") as Theme))
        .then((fn) => {
          unlisten = fn;
        })
        .catch(() => {});
      return () => {
        if (unlisten) unlisten();
      };
    },
    setTitle: async (title: string) => {
      try {
        await getCurrentWindow().setTitle(title);
      } catch {}
    },
    onNewConversation: (cb: () => void) => wrapListener<null>("new-conversation", () => cb()),
    onFocusSearch: (cb: () => void) => wrapListener<null>("focus-search", () => cb()),
    onOpenModelPicker: (cb: () => void) => wrapListener<null>("open-model-picker", () => cb()),
    touchbarSetModel: async (model: string) => {
      try {
        await emit("touchbar-set-model", model);
      } catch {}
    },
    taskbarProgress: async (value: number) => {
      try {
        const win = getCurrentWindow();
        if (value < 0) {
          await win.setProgressBar({ status: ProgressBarStatus.Indeterminate });
        } else if (value === 0) {
          await win.setProgressBar({ status: ProgressBarStatus.None });
        } else {
          await win.setProgressBar({ status: ProgressBarStatus.Normal, progress: Math.round(value) });
        }
      } catch {}
    },
    toastNotify: async (title: string, body: string) => {
      try {
        let granted = await notif.isPermissionGranted();
        if (!granted) {
          granted = (await notif.requestPermission()) === "granted";
        }
        if (granted) notif.sendNotification({ title, body });
      } catch {}
    },
    onUpdateAvailable: (cb: (v: string) => void) =>
      wrapListener<{ version: string }>("update-available", (p) => cb(p.version)),
    onUpdateProgress: (cb: (n: number) => void) =>
      wrapListener<{ progress: number }>("update-progress", (p) => cb(p.progress)),
    onUpdateReady: (cb: () => void) => wrapListener<null>("update-ready", () => cb()),
    downloadUpdate: async () => {
      try {
        const { check } = await import("@tauri-apps/plugin-updater");
        const update = await check();
        if (!update) return;
        let downloaded = 0;
        let total = 0;
        await update.downloadAndInstall((e: any) => {
          if (e.event === "Started") {
            total = e.data?.contentLength ?? 0;
            emit("update-available", { version: update.version });
          } else if (e.event === "Progress") {
            downloaded += e.data?.chunkLength ?? 0;
            const pct = total > 0 ? Math.round((downloaded / total) * 100) : 0;
            emit("update-progress", { progress: pct });
          } else if (e.event === "Finished") {
            emit("update-ready", null);
          }
        });
      } catch (e) {
        console.error("[updater] downloadUpdate failed:", e);
      }
    },
    installUpdate: async () => {
      try {
        const { relaunch } = await import("@tauri-apps/plugin-process");
        await relaunch();
      } catch (e) {
        console.error("[updater] installUpdate (relaunch) failed:", e);
      }
    },
  };

  // 保留 fallback 的 platform 字串，把其他 method 覆寫成真實版
  Object.assign((window as any).xchatAPI, real);
  console.info("[xchat-api-shim] real API installed");
}
