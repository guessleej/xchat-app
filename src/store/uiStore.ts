import { create } from "zustand";

type Theme = "dark" | "light";

export interface LastResult {
  tool: "ppt" | "website" | "document" | "table" | "code";
  label: string;
  html?: string;
  text?: string;
  downloadUrl?: string;
  downloadName?: string;
}

interface UIState {
  theme: Theme;
  userMenuOpen: boolean;
  preview: { html?: string; text?: string; downloadUrl?: string; downloadName?: string } | null;
  isDragging: boolean;
  showScrollBtn: boolean;
  updateInfo: { version: string; ready: boolean; progress: number } | null;
  lastResult: LastResult | null;
  activeTask: { convId: string; label: string; aiId: string } | null;
  webAccess: boolean;
  heartbeat: number;

  setTheme: (t: Theme) => void;
  toggleTheme: () => void;
  setUserMenuOpen: (v: boolean) => void;
  setPreview: (p: UIState["preview"]) => void;
  setIsDragging: (v: boolean) => void;
  setShowScrollBtn: (v: boolean) => void;
  setUpdateInfo: (info: UIState["updateInfo"]) => void;
  setLastResult: (r: LastResult | null) => void;
  setActiveTask: (t: UIState["activeTask"]) => void;
  setWebAccess: (v: boolean) => void;
  bumpHeartbeat: () => void;
}

export const useUIStore = create<UIState>((set, get) => ({
  theme: (localStorage.getItem("xchat-theme") as Theme) || "dark",
  userMenuOpen: false,
  preview: null,
  isDragging: false,
  showScrollBtn: false,
  updateInfo: null,
  lastResult: null,
  activeTask: null,
  webAccess: localStorage.getItem("xchat-web-access") === "1",
  heartbeat: 0,

  setTheme(t) {
    localStorage.setItem("xchat-theme", t);
    document.documentElement.setAttribute("data-theme", t);
    set({ theme: t });
  },

  toggleTheme() {
    get().setTheme(get().theme === "dark" ? "light" : "dark");
  },

  setUserMenuOpen: (v) => set({ userMenuOpen: v }),
  setPreview: (p) => set({ preview: p }),
  setIsDragging: (v) => set({ isDragging: v }),
  setShowScrollBtn: (v) => set({ showScrollBtn: v }),
  setUpdateInfo: (info) => set({ updateInfo: info }),
  setLastResult: (r) => set({ lastResult: r }),
  setActiveTask: (t) => set({ activeTask: t }),
  setWebAccess: (v) => {
    localStorage.setItem("xchat-web-access", v ? "1" : "0");
    set({ webAccess: v });
  },
  bumpHeartbeat: () => set((s) => ({ heartbeat: s.heartbeat + 1 })),
}));
