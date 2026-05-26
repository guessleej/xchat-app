import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

/**
 * 地端 LLM Provider — 全部 OpenAI-compatible 端點
 * - 不存任何 API key 進 localStorage（地端通常不需要 key，但 vLLM/sglang 可能要 token）
 * - 若需要 key → 存 Keychain
 */

export type ProviderKind = "local-openai";

export interface Provider {
  id: string;
  name: string;
  kind: ProviderKind;
  baseUrl: string;
  apiKey: string;
  model: string;
  isBuiltin: boolean;
  description?: string;
}

// 內建：純地端 + OpenAI-compatible
const BUILTIN_PROVIDERS: Provider[] = [
  {
    id: "spark-mistral",
    name: "Mistral on Spark",
    kind: "local-openai",
    baseUrl: "http://192.168.11.24:18181/v1",
    apiKey: "not-required",
    model: "mistral-small-4",
    isBuiltin: true,
    description: "DGX Spark + llama.cpp + Mistral-Small-4-119B MXFP4",
  },
  {
    id: "ollama-local",
    name: "Ollama",
    kind: "local-openai",
    baseUrl: "http://localhost:11434/v1",
    apiKey: "ollama",
    model: "llama3.3",
    isBuiltin: true,
    description: "本機 Ollama（http://localhost:11434）",
  },
  {
    id: "llama-cpp",
    name: "llama.cpp",
    kind: "local-openai",
    baseUrl: "http://localhost:8080/v1",
    apiKey: "not-required",
    model: "default",
    isBuiltin: true,
    description: "llama-server（OpenAI-compatible，預設 8080）",
  },
  {
    id: "vllm",
    name: "vLLM",
    kind: "local-openai",
    baseUrl: "http://localhost:8000/v1",
    apiKey: "EMPTY",
    model: "",
    isBuiltin: true,
    description: "vLLM OpenAI server（python -m vllm.entrypoints.openai.api_server）",
  },
  {
    id: "sglang",
    name: "SGLang",
    kind: "local-openai",
    baseUrl: "http://localhost:30000/v1",
    apiKey: "not-required",
    model: "default",
    isBuiltin: true,
    description: "SGLang server（python -m sglang.launch_server）",
  },
];

const STORAGE_KEY = "xchat-providers-v2";
const ACTIVE_KEY = "xchat-active-provider-v2";

async function keychainSet(account: string, value: string) {
  try { await invoke("keychain_set", { account, value }); }
  catch (e) { console.warn("[keychain_set]", e); localStorage.setItem(`xchat-key-${account}`, value); }
}
async function keychainGet(account: string): Promise<string> {
  try {
    const v = await invoke<string | null>("keychain_get", { account });
    if (v) return v;
  } catch (e) { console.warn("[keychain_get]", e); }
  return localStorage.getItem(`xchat-key-${account}`) ?? "";
}
async function keychainDelete(account: string) {
  try { await invoke("keychain_delete", { account }); } catch {}
  localStorage.removeItem(`xchat-key-${account}`);
}

function loadProvidersMeta(): Provider[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const stored = JSON.parse(raw) as Provider[];
      const map = new Map(stored.map((p) => [p.id, p]));
      for (const b of BUILTIN_PROVIDERS) {
        if (map.has(b.id)) {
          const old = map.get(b.id)!;
          map.set(b.id, { ...b, baseUrl: old.baseUrl || b.baseUrl, model: old.model || b.model, apiKey: "" });
        } else {
          map.set(b.id, { ...b, apiKey: "" });
        }
      }
      return Array.from(map.values()).map((p) => ({ ...p, apiKey: "" }));
    }
  } catch {}
  return BUILTIN_PROVIDERS.map((p) => ({ ...p, apiKey: "" }));
}

function saveProvidersMeta(list: Provider[]) {
  const lite = list.map((p) => ({ ...p, apiKey: "" }));
  localStorage.setItem(STORAGE_KEY, JSON.stringify(lite));
}

export async function hydrateKeysFromKeychain() {
  const list = useProviderStore.getState().providers;
  const hydrated = await Promise.all(list.map(async (p) => ({
    ...p,
    apiKey: p.apiKey || (await keychainGet(p.id)) || p.apiKey,
  })));
  useProviderStore.setState({ providers: hydrated });
}

interface ProviderState {
  providers: Provider[];
  activeId: string;
  setActive: (id: string) => void;
  updateProvider: (id: string, patch: Partial<Provider>) => void;
  addCustomProvider: (p: Omit<Provider, "isBuiltin">) => void;
  removeProvider: (id: string) => void;
  resetBuiltin: (id: string) => void;
  active: () => Provider;
}

export const useProviderStore = create<ProviderState>((set, get) => ({
  providers: loadProvidersMeta(),
  activeId: localStorage.getItem(ACTIVE_KEY) || "spark-mistral",

  setActive(id) {
    localStorage.setItem(ACTIVE_KEY, id);
    set({ activeId: id });
  },

  updateProvider(id, patch) {
    const list = get().providers.map((p) => (p.id === id ? { ...p, ...patch } : p));
    saveProvidersMeta(list);
    if (patch.apiKey !== undefined) {
      if (patch.apiKey) keychainSet(id, patch.apiKey);
      else keychainDelete(id);
    }
    set({ providers: list });
  },

  addCustomProvider(p) {
    const list = [...get().providers, { ...p, isBuiltin: false }];
    saveProvidersMeta(list);
    if (p.apiKey) keychainSet(p.id, p.apiKey);
    set({ providers: list });
  },

  removeProvider(id) {
    const target = get().providers.find((p) => p.id === id);
    if (!target || target.isBuiltin) return;
    const list = get().providers.filter((p) => p.id !== id);
    saveProvidersMeta(list);
    keychainDelete(id);
    if (get().activeId === id) {
      set({ activeId: list[0]?.id ?? "spark-mistral" });
      localStorage.setItem(ACTIVE_KEY, list[0]?.id ?? "spark-mistral");
    }
    set({ providers: list });
  },

  resetBuiltin(id) {
    const builtin = BUILTIN_PROVIDERS.find((b) => b.id === id);
    if (!builtin) return;
    get().updateProvider(id, { ...builtin });
    keychainDelete(id);
  },

  active() {
    return get().providers.find((p) => p.id === get().activeId) ?? get().providers[0];
  },
}));
