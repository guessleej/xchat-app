import { create } from "zustand";

export type SearchMode = "auto" | "always" | "research";
export type SearchDepth = "quick" | "standard" | "deep";
export type SearchRecency = "any" | "day" | "week" | "month" | "year";

export interface SearchSettings {
  enabled: boolean;
  mode: SearchMode;
  depth: SearchDepth;
  recency: SearchRecency;
  sources: string[];
}

export const SEARCH_MODES: Array<{ id: SearchMode; label: string }> = [
  { id: "auto", label: "自動" },
  { id: "always", label: "每次" },
  { id: "research", label: "研究" },
];

export const SEARCH_DEPTHS: Array<{ id: SearchDepth; label: string }> = [
  { id: "quick", label: "快速" },
  { id: "standard", label: "標準" },
  { id: "deep", label: "深入" },
];

export const SEARCH_RECENCIES: Array<{ id: SearchRecency; label: string }> = [
  { id: "any", label: "不限" },
  { id: "day", label: "24h" },
  { id: "week", label: "7天" },
  { id: "month", label: "30天" },
  { id: "year", label: "一年" },
];

interface SearchState {
  mode: SearchMode;
  depth: SearchDepth;
  recency: SearchRecency;
  sourcesText: string;
  setMode: (mode: SearchMode) => void;
  setDepth: (depth: SearchDepth) => void;
  setRecency: (recency: SearchRecency) => void;
  setSourcesText: (sourcesText: string) => void;
  toSettings: (enabled: boolean) => SearchSettings;
}

function parseSources(value: string): string[] {
  return value.split(",").map((s) => s.trim()).filter(Boolean);
}

export const useSearchStore = create<SearchState>((set, get) => ({
  mode: (localStorage.getItem("xchat-search-mode") as SearchMode) || "auto",
  depth: (localStorage.getItem("xchat-search-depth") as SearchDepth) || "standard",
  recency: (localStorage.getItem("xchat-search-recency") as SearchRecency) || "week",
  sourcesText: localStorage.getItem("xchat-search-sources") || "",

  setMode(mode) {
    localStorage.setItem("xchat-search-mode", mode);
    set({ mode });
  },

  setDepth(depth) {
    localStorage.setItem("xchat-search-depth", depth);
    set({ depth });
  },

  setRecency(recency) {
    localStorage.setItem("xchat-search-recency", recency);
    set({ recency });
  },

  setSourcesText(sourcesText) {
    localStorage.setItem("xchat-search-sources", sourcesText);
    set({ sourcesText });
  },

  toSettings(enabled) {
    const { mode, depth, recency, sourcesText } = get();
    return { enabled, mode, depth, recency, sources: parseSources(sourcesText) };
  },
}));
