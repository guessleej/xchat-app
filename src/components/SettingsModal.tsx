import React, { useEffect, useRef, useState } from "react";
import { useUIStore } from "../store/uiStore";
import { useProviderStore } from "../store/providerStore";
import {
  SEARCH_MODES, SEARCH_DEPTHS, SEARCH_RECENCIES,
  useSearchStore,
} from "../store/searchStore";
import { auth } from "../api";
import { decodeJWT } from "../App";

interface Props {
  onClose: () => void;
}

// 為了讓 sidebar 跟其他頁面同步，仍快取一份在 localStorage（不是 source of truth）
const AVATAR_CACHE_KEY = "xchat-avatar-cache";

export function SettingsModal({ onClose }: Props) {
  const { theme, toggleTheme } = useUIStore();
  const { providers, activeId, setActive, updateProvider } = useProviderStore();
  const activeProvider = providers.find((p) => p.id === activeId) ?? providers[0];

  const {
    mode: searchMode, depth: searchDepth, recency: searchRecency,
    sourcesText: searchSourcesText,
    setMode: setSearchMode, setDepth: setSearchDepth,
    setRecency: setSearchRecency, setSourcesText: setSearchSourcesText,
  } = useSearchStore();

  // ── 使用者個人資料（先讀快取，再背景 refresh）───────────────────
  const cachedProfile = (() => {
    try {
      const c = localStorage.getItem("xchat-profile-cache");
      if (c) {
        const p = JSON.parse(c) as { email?: string; username?: string; avatar_url?: string };
        if (p.username || p.email) return p;
      }
    } catch {}
    // fallback：直接解 JWT
    const jwt = decodeJWT(localStorage.getItem("token") || "");
    if (jwt.username || jwt.email) {
      return { username: jwt.username, email: jwt.email, avatar_url: localStorage.getItem(AVATAR_CACHE_KEY) || undefined };
    }
    return {};
  })();

  const [profile, setProfile] = useState<{ email?: string; username?: string; avatar_url?: string }>(cachedProfile);
  const [usernameInput, setUsernameInput] = useState(cachedProfile.username ?? "");
  const [usernameDirty, setUsernameDirty] = useState(false);
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState("");
  const [avatarDataUrl, setAvatarDataUrl] = useState<string>(
    () => cachedProfile.avatar_url || localStorage.getItem(AVATAR_CACHE_KEY) || ""
  );
  const [savingAvatar, setSavingAvatar] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    auth.me()
      .then((d) => {
        setProfile({ email: d.email, username: d.username, avatar_url: d.avatar_url });
        setUsernameInput((prev) => (prev ? prev : d.username || ""));
        try {
          localStorage.setItem("xchat-profile-cache", JSON.stringify({ username: d.username, email: d.email, avatar_url: d.avatar_url }));
        } catch {}
        if (d.avatar_url) {
          setAvatarDataUrl(d.avatar_url);
          localStorage.setItem(AVATAR_CACHE_KEY, d.avatar_url);
        }
      })
      .catch((e) => console.warn("auth.me failed:", e));
  }, []);

  const saveUsername = async () => {
    if (!usernameDirty || !usernameInput.trim()) return;
    setSavingName(true); setNameError("");
    try {
      const upd = await auth.updateProfile({ username: usernameInput.trim() });
      setProfile((p) => ({ ...p, username: upd.username }));
      setUsernameDirty(false);
      // 通知 App.tsx 重抓 profile
      window.dispatchEvent(new CustomEvent("xchat:profile-updated"));
    } catch (e) {
      setNameError((e as Error).message || "更新失敗");
    }
    setSavingName(false);
  };

  const onPickAvatar = () => fileInputRef.current?.click();

  const onAvatarFile = (f: File | null) => {
    if (!f) return;
    if (f.size > 2 * 1024 * 1024) { setNameError("圖片需小於 2 MB"); return; }
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const url = ev.target?.result as string;
      setAvatarDataUrl(url);
      localStorage.setItem(AVATAR_CACHE_KEY, url);
      // 同步上傳到後端
      setSavingAvatar(true); setNameError("");
      try {
        await auth.updateProfile({ avatar_url: url });
        window.dispatchEvent(new CustomEvent("xchat:profile-updated"));
      } catch (e) {
        setNameError("上傳大頭照失敗：" + ((e as Error).message || ""));
      }
      setSavingAvatar(false);
    };
    reader.readAsDataURL(f);
  };

  const onClearAvatar = async () => {
    setAvatarDataUrl("");
    localStorage.removeItem(AVATAR_CACHE_KEY);
    setSavingAvatar(true);
    try {
      await auth.updateProfile({ avatar_url: "" });
      window.dispatchEvent(new CustomEvent("xchat:profile-updated"));
    } catch (e) {
      setNameError("移除大頭照失敗：" + ((e as Error).message || ""));
    }
    setSavingAvatar(false);
  };

  return (
    <div className="settings-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="settings-panel">
        <div className="settings-header">
          <span className="settings-title">使用者設定</span>
          <button className="settings-close" onClick={onClose}>✕</button>
        </div>

        <div className="settings-body">

          {/* ── 個人資料 ───────────────────────────────────── */}
          <div className="settings-section-title">個人資料</div>

          <div className="settings-profile">
            <div className="settings-avatar-wrap">
              {avatarDataUrl ? (
                <img src={avatarDataUrl} alt="avatar" className="settings-avatar-img" />
              ) : (
                <div className="settings-avatar-placeholder">
                  {(profile.username || profile.email || "U").slice(0, 1).toUpperCase()}
                </div>
              )}
              <div className="settings-avatar-actions">
                <button className="settings-btn-mini" onClick={onPickAvatar} disabled={savingAvatar}>
                  {savingAvatar ? "上傳中…" : "更換大頭照"}
                </button>
                {avatarDataUrl && (
                  <button className="settings-btn-mini settings-btn-mini--danger" onClick={onClearAvatar} disabled={savingAvatar}>移除</button>
                )}
              </div>
              <input
                ref={fileInputRef} type="file" hidden accept="image/*"
                onChange={(e) => onAvatarFile(e.target.files?.[0] ?? null)}
              />
            </div>
          </div>

          <div className="settings-row">
            <div className="settings-row__label">電子郵件</div>
            <span className="settings-row__value">{profile.email || "—"}</span>
          </div>

          <div className="settings-row">
            <div className="settings-row__label">使用者名稱</div>
            <div className="settings-row__inline">
              <input
                className="settings-input"
                value={usernameInput}
                onChange={(e) => { setUsernameInput(e.target.value); setUsernameDirty(true); }}
                placeholder="輸入使用者名稱"
              />
              <button
                className="settings-btn-primary"
                onClick={saveUsername}
                disabled={!usernameDirty || savingName || !usernameInput.trim()}
              >
                {savingName ? "儲存中…" : "儲存"}
              </button>
            </div>
          </div>
          {nameError && <div className="settings-error">{nameError}</div>}

          {/* ── 外觀 ─────────────────────────────────────── */}
          <div className="settings-section-title">外觀</div>

          <div className="settings-row">
            <div className="settings-row__label">界面主題</div>
            <div className="settings-row__control">
              <button
                className={`settings-theme-btn ${theme === "light" ? "active" : ""}`}
                onClick={() => { if (theme !== "light") toggleTheme(); }}>淺色</button>
              <button
                className={`settings-theme-btn ${theme === "dark" ? "active" : ""}`}
                onClick={() => { if (theme !== "dark") toggleTheme(); }}>深色</button>
            </div>
          </div>

          {/* ── 模型 ─────────────────────────────────────── */}
          <div className="settings-section-title">模型</div>

          <div className="settings-row">
            <div className="settings-row__label">LLM 來源</div>
            <select className="settings-select" value={activeId}
              onChange={(e) => setActive(e.target.value)}>
              {providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>

          <div className="settings-row">
            <div className="settings-row__label">模型名稱</div>
            <input className="settings-input" value={activeProvider?.model ?? ""}
              onChange={(e) => updateProvider(activeId, { model: e.target.value })}
              placeholder="輸入模型名稱" />
          </div>

          {activeProvider && (
            <div className="settings-row">
              <div className="settings-row__label">API 端點</div>
              <input className="settings-input" value={activeProvider.baseUrl}
                onChange={(e) => updateProvider(activeId, { baseUrl: e.target.value })}
                placeholder="http://..." />
            </div>
          )}

          {/* ── 搜尋 ─────────────────────────────────────── */}
          <div className="settings-section-title">搜尋</div>

          <div className="settings-row">
            <div className="settings-row__label">搜尋策略</div>
            <select className="settings-select" value={searchMode}
              onChange={(e) => setSearchMode(e.target.value as typeof searchMode)}>
              {SEARCH_MODES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </div>

          <div className="settings-row">
            <div className="settings-row__label">搜尋深度</div>
            <select className="settings-select" value={searchDepth}
              onChange={(e) => setSearchDepth(e.target.value as typeof searchDepth)}>
              {SEARCH_DEPTHS.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
            </select>
          </div>

          <div className="settings-row">
            <div className="settings-row__label">時間範圍</div>
            <select className="settings-select" value={searchRecency}
              onChange={(e) => setSearchRecency(e.target.value as typeof searchRecency)}>
              {SEARCH_RECENCIES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
            </select>
          </div>

          <div className="settings-row">
            <div className="settings-row__label">限定來源</div>
            <input className="settings-input" value={searchSourcesText}
              onChange={(e) => setSearchSourcesText(e.target.value)}
              placeholder="site: 可逗號分隔，留空不限" />
          </div>

          {/* ── 關於 ─────────────────────────────────────── */}
          <div className="settings-section-title">關於</div>

          <div className="settings-row settings-row--link">
            <div className="settings-row__label">使用者協議</div>
            <span className="settings-row__arrow">›</span>
          </div>

          <div className="settings-row settings-row--link">
            <div className="settings-row__label">隱私政策</div>
            <span className="settings-row__arrow">›</span>
          </div>

          <div className="settings-row">
            <div className="settings-row__label">版本資訊</div>
            <span className="settings-row__value">xChat v1.0 · 云碩科技</span>
          </div>

        </div>
      </div>
    </div>
  );
}
