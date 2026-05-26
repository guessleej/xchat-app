/**
 * API 客戶端 — 統一管理所有後端呼叫
 */

const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:8080/api/v1";

// ─── Token 管理（含自動 refresh）──────────────────────────────────────────

function token() { return localStorage.getItem("token") ?? ""; }
function refreshToken() { return localStorage.getItem("refresh_token") ?? ""; }

let _refreshing: Promise<string> | null = null;

async function doRefresh(): Promise<string> {
  const rt = refreshToken();
  if (!rt) throw new Error("No refresh token");
  const res = await fetch(`${BASE}/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: rt }),
  });
  if (!res.ok) throw new Error("Refresh failed");
  const data = await res.json();
  const newToken = data.access_token ?? data.data?.access_token ?? "";
  const newRefresh = data.refresh_token ?? data.data?.refresh_token ?? rt;
  localStorage.setItem("token", newToken);
  localStorage.setItem("refresh_token", newRefresh);
  return newToken;
}

async function getValidToken(): Promise<string> {
  const t = token();
  if (!t) return "";
  try {
    const payload = JSON.parse(atob(t.split(".")[1]));
    if (payload.exp && payload.exp - Date.now() / 1000 < 60) {
      if (!_refreshing) _refreshing = doRefresh().finally(() => { _refreshing = null; });
      try { return await _refreshing; } catch { /* refresh 失敗，交給 401 處理 */ }
    }
  } catch {}
  return t;
}

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const tok = await getValidToken();
  const headers = new Headers(init.headers);
  if (tok) headers.set("Authorization", `Bearer ${tok}`);
  if (!headers.has("Content-Type") && !(init.body instanceof FormData))
    headers.set("Content-Type", "application/json");

  const res = await fetch(`${BASE}${path}`, { ...init, headers });
  if (res.status === 401) {
    // token 已失效，嘗試 refresh 一次
    try {
      const newTok = await doRefresh();
      const headers2 = new Headers(init.headers);
      headers2.set("Authorization", `Bearer ${newTok}`);
      if (!headers2.has("Content-Type") && !(init.body instanceof FormData))
        headers2.set("Content-Type", "application/json");
      const res2 = await fetch(`${BASE}${path}`, { ...init, headers: headers2 });
      if (res2.ok) return res2.json();
    } catch {}
    localStorage.removeItem("token");
    localStorage.removeItem("refresh_token");
    // Electron (file://) 不能用 href 跳轉，改發事件讓 React 處理
    if (window.location.protocol === "file:") {
      window.dispatchEvent(new CustomEvent("xchat:logout"));
    } else {
      window.location.href = "/login";
    }
    throw new Error("Unauthorized");
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: "Unknown error" }));
    throw new Error(err.detail ?? err.message);
  }
  return res.json();
}

// ─── Auth ─────────────────────────────────────────────────────────────────

export const auth = {
  login: async (email: string, password: string) => {
    const res = await req<{ access_token: string; refresh_token?: string }>("/auth/login", {
      method: "POST", body: JSON.stringify({ email, password })
    });
    if (res.refresh_token) localStorage.setItem("refresh_token", res.refresh_token);
    return res;
  },
  register: (email: string, password: string, username: string) =>
    req("/auth/register", {
      method: "POST", body: JSON.stringify({ email, password, username })
    }),
  me: async () => {
    const r = await req<{ success: boolean; data: { id: string; email: string; username: string; plan: string; avatar_url?: string } }>("/auth/me");
    return r.data;
  },
  updateProfile: async (patch: { username?: string; avatar_url?: string }) => {
    const r = await req<{ success: boolean; data: { id: string; email: string; username: string; avatar_url?: string } }>("/auth/me", {
      method: "PATCH", body: JSON.stringify(patch),
    });
    return r.data;
  },
  logout: () => {
    localStorage.removeItem("token");
    localStorage.removeItem("refresh_token");
  },
  // 嘗試用 refresh_token 續期；成功回 true（新 access token 已寫入 localStorage），失敗回 false
  tryRefresh: async (): Promise<boolean> => {
    try { await doRefresh(); return true; } catch { return false; }
  },
};

// ─── Chat（含 SSE 串流）──────────────────────────────────────────────────

export type SSECallback = (event: Record<string, unknown>) => void;

export function streamChat(
  convId: string,
  userMessage: string,
  toolsEnabled: string[],
  onEvent: SSECallback,
  signal?: AbortSignal
): void {
  getValidToken().then(async tok => {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${tok}`,
    };
    // Provider override：從 Zustand store 動態取（key 來自 Keychain hydrate）
    try {
      // 動態 import 避免 api 模組與 store 形成 hard cycle
      const { useProviderStore } = await import("../store/providerStore");
      const p = useProviderStore.getState().active();
      if (p && p.id !== "spark-mistral") {
        headers["X-LLM-Base-URL"] = p.baseUrl;
        headers["X-LLM-API-Key"] = p.apiKey;
        headers["X-LLM-Model"] = p.model;
        headers["X-LLM-Kind"] = p.kind;
      }
    } catch {}

    fetch(`${BASE}/chat/conversations/${convId}/messages`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        conversation_id: convId,
        messages: [{ role: "user", content: userMessage }],
        stream: true,
        tools_enabled: toolsEnabled,
      }),
      signal,
    }).then(async (res) => {
      if (!res.ok || !res.body) {
        onEvent({ type: "error", message: `HTTP ${res.status}` });
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6);
          if (data === "[DONE]") { onEvent({ type: "done" }); return; }
          try { onEvent(JSON.parse(data)); } catch {}
        }
      }
    }).catch((e) => {
      if (e.name !== "AbortError") onEvent({ type: "error", message: e.message });
    });
  });
}

export const chat = {
  list: () => req<{ data: Array<{ conversation_id: string; title: string; updated_at: string }> }>("/chat/conversations"),
  get: (id: string) => req(`/chat/conversations/${id}`),
  delete: (id: string) => req(`/chat/conversations/${id}`, { method: "DELETE" }),
};

// ─── Tools ────────────────────────────────────────────────────────────────

export type ToolType = "ppt" | "website" | "document" | "table" | "code";

export const tools = {
  generate: (toolType: ToolType, prompt: string) =>
    req<{ data: { task_id: string } }>("/tools/generate", {
      method: "POST", body: JSON.stringify({ tool_type: toolType, prompt })
    }),
  getTask: (taskId: string) => req<{ data: Record<string, unknown> }>(`/tools/tasks/${taskId}`),
  pollTask: (taskId: string, onUpdate: (data: Record<string, unknown>) => void) => {
    const id = setInterval(async () => {
      const { data } = await tools.getTask(taskId);
      onUpdate(data);
      if (data.status === "completed" || data.status === "failed") clearInterval(id);
    }, 2000);
    return () => clearInterval(id);
  },
};

// ─── Research（SSE 串流）────────────────────────────────────────────────

export function streamResearch(
  query: string,
  depth: "quick" | "standard" | "deep",
  onEvent: SSECallback,
  signal?: AbortSignal
): void {
  getValidToken().then(tok => {
    fetch(`${BASE}/research/research`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` },
      body: JSON.stringify({ query, depth }),
      signal,
    }).then(async (res) => {
      if (!res.body) return;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const d = line.slice(6);
            if (d === "[DONE]") return;
            try { onEvent(JSON.parse(d)); } catch {}
          }
        }
      }
    }).catch((e) => { if (e.name !== "AbortError") onEvent({ type: "error", message: e.message }); });
  });
}

// ─── Agent ────────────────────────────────────────────────────────────────

export function streamAgent(
  goal: string,
  agents: string[],
  onEvent: SSECallback,
  signal?: AbortSignal,
  webAccess: boolean = false,
): void {
  getValidToken().then(tok => {
    fetch(`${BASE}/agents/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` },
      body: JSON.stringify({ goal, agents, web_access: webAccess }),
      signal,
    }).then(async (res) => {
      if (!res.ok || !res.body) {
        onEvent({ type: "error", message: `HTTP ${res.status}` });
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const d = line.slice(6);
            if (d === "[DONE]") return;
            try { onEvent(JSON.parse(d)); } catch {}
          }
        }
      }
    }).catch((e) => { if (e.name !== "AbortError") onEvent({ type: "error", message: e.message }); });
  });
}

export function streamDynamicAgent(
  goal: string,
  onEvent: SSECallback,
  signal?: AbortSignal,
  webAccess: boolean = false,
  maxAgents: number = 5,
): void {
  getValidToken().then(tok => {
    fetch(`${BASE}/agents/dynamic`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` },
      body: JSON.stringify({ goal, web_access: webAccess, max_agents: maxAgents }),
      signal,
    }).then(async (res) => {
      if (!res.ok || !res.body) {
        onEvent({ type: "error", message: `HTTP ${res.status}` });
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const d = line.slice(6);
            if (d === "[DONE]") return;
            try { onEvent(JSON.parse(d)); } catch {}
          }
        }
      }
    }).catch((e) => { if (e.name !== "AbortError") onEvent({ type: "error", message: e.message }); });
  });
}

// ─── Computer（CUA 電腦控制）────────────────────────────────────────────────

export const computer = {
  screenshot: () =>
    req<{ image: string; timestamp: number }>("/computer/screenshot"),

  click: (x: number, y: number, button = "left") =>
    req<{ ok: boolean; screenshot: string }>("/computer/click", {
      method: "POST", body: JSON.stringify({ x, y, button })
    }),

  type: (text: string) =>
    req<{ ok: boolean }>("/computer/type", {
      method: "POST", body: JSON.stringify({ text })
    }),

  key: (key: string) =>
    req<{ ok: boolean; screenshot: string }>("/computer/key", {
      method: "POST", body: JSON.stringify({ key })
    }),

  scroll: (x: number, y: number, direction = "down", amount = 3) =>
    req<{ ok: boolean }>("/computer/scroll", {
      method: "POST", body: JSON.stringify({ x, y, direction, amount })
    }),

  open: (url: string) =>
    req<{ ok: boolean; screenshot: string }>("/computer/open", {
      method: "POST", body: JSON.stringify({ url })
    }),

  shell: (cmd: string) =>
    req<{ ok: boolean; output: string }>("/computer/shell", {
      method: "POST", body: JSON.stringify({ cmd })
    }),
};

export function streamComputer(
  task: string,
  onEvent: SSECallback,
  signal?: AbortSignal,
  maxSteps = 20
): void {
  getValidToken().then(tok => {
    fetch(`${BASE}/computer/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` },
      body: JSON.stringify({ task, max_steps: maxSteps }),
      signal,
    }).then(async (res) => {
      if (!res.body) return;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try { onEvent(JSON.parse(line.slice(6))); } catch {}
          }
        }
      }
    }).catch((e) => { if (e.name !== "AbortError") onEvent({ type: "error", message: e.message }); });
  });
}

// ─── File ─────────────────────────────────────────────────────────────────

export const files = {
  upload: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return req<{ data: { file_id: string; file_name: string; extracted_text: string } }>(
      "/files/upload", { method: "POST", body: form }
    );
  },
  ask: (fileId: string, question: string) =>
    req<{ data: { answer: string } }>(`/files/files/${fileId}/ask`, {
      method: "POST", body: JSON.stringify({ question })
    }),
};
