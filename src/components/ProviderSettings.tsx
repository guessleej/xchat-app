import { useState } from "react";
import { useProviderStore, type Provider } from "../store/providerStore";

interface Props {
  open: boolean;
  onClose: () => void;
}

export function ProviderSettings({ open, onClose }: Props) {
  const { providers, activeId, setActive, updateProvider, addCustomProvider, removeProvider, resetBuiltin } = useProviderStore();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  if (!open) return null;

  return (
    <div className="provider-settings-overlay" onClick={onClose}>
      <div className="provider-settings-drawer" onClick={(e) => e.stopPropagation()}>
        <div className="provider-settings-header">
          <div className="provider-settings-title">本地 LLM 服務設定</div>
          <button className="provider-settings-close" onClick={onClose}>✕</button>
        </div>

        <div className="provider-settings-hint">
          選擇要使用的本地推理服務。API key 加密儲存於 macOS Keychain。
        </div>

        <div className="provider-settings-list">
          {providers.map((p) => (
            <ProviderCard
              key={p.id}
              p={p}
              isActive={p.id === activeId}
              expanded={expanded === p.id}
              onToggleExpand={() => setExpanded(expanded === p.id ? null : p.id)}
              onActivate={() => setActive(p.id)}
              onUpdate={(patch) => updateProvider(p.id, patch)}
              onRemove={p.isBuiltin ? undefined : () => removeProvider(p.id)}
              onReset={p.isBuiltin ? () => resetBuiltin(p.id) : undefined}
            />
          ))}

          {showAdd ? (
            <AddProviderForm
              onSubmit={(p) => { addCustomProvider(p); setShowAdd(false); }}
              onCancel={() => setShowAdd(false)}
            />
          ) : (
            <button className="provider-add-btn" onClick={() => setShowAdd(true)}>
              + 新增自訂 OpenAI-compatible 端點
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function ProviderCard({
  p, isActive, expanded, onToggleExpand, onActivate, onUpdate, onRemove, onReset,
}: {
  p: Provider;
  isActive: boolean;
  expanded: boolean;
  onToggleExpand: () => void;
  onActivate: () => void;
  onUpdate: (patch: Partial<Provider>) => void;
  onRemove?: () => void;
  onReset?: () => void;
}) {
  return (
    <div className={`provider-card ${isActive ? "provider-card--active" : ""}`}>
      <div className="provider-card-row">
        <input type="radio" checked={isActive} onChange={onActivate} className="provider-card-radio" />
        <div className="provider-card-info" onClick={onToggleExpand}>
          <div className="provider-card-name">{p.name}</div>
          {p.description && <div className="provider-card-desc">{p.description}</div>}
          <div className="provider-card-sub">{p.model || "(未設定 model)"} · {shortUrl(p.baseUrl)}</div>
        </div>
        <button className="provider-card-toggle" onClick={onToggleExpand}>{expanded ? "▾" : "▸"}</button>
      </div>

      {expanded && (
        <div className="provider-card-body">
          <label className="provider-card-field">
            <span>Base URL {p.isBuiltin && "（可調整）"}</span>
            <input type="text" value={p.baseUrl} onChange={(e) => onUpdate({ baseUrl: e.target.value })} />
          </label>
          <label className="provider-card-field">
            <span>API Key（多數地端不需要）</span>
            <input type="password" value={p.apiKey} placeholder="留空 / not-required / EMPTY ..."
              onChange={(e) => onUpdate({ apiKey: e.target.value })} />
          </label>
          <label className="provider-card-field">
            <span>Model 名稱</span>
            <input type="text" value={p.model} placeholder="如 llama3.3 / mistral-small-4"
              onChange={(e) => onUpdate({ model: e.target.value })} />
          </label>
          <div className="provider-card-actions">
            {onReset && <button className="provider-card-btn" onClick={onReset}>恢復內建</button>}
            {onRemove && <button className="provider-card-btn provider-card-btn--danger" onClick={onRemove}>刪除</button>}
          </div>
        </div>
      )}
    </div>
  );
}

function AddProviderForm({ onSubmit, onCancel }: {
  onSubmit: (p: Omit<Provider, "isBuiltin">) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("http://localhost:");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");

  const canSubmit = name.trim() && baseUrl.trim() && model.trim();

  return (
    <div className="provider-card provider-card--add">
      <div className="provider-card-body" style={{ padding: 12 }}>
        <label className="provider-card-field">
          <span>名稱</span>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="例：本機 TGI / Bedrock proxy" />
        </label>
        <label className="provider-card-field">
          <span>Base URL（OpenAI-compatible /v1）</span>
          <input type="text" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
        </label>
        <label className="provider-card-field">
          <span>API Key（可空）</span>
          <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
        </label>
        <label className="provider-card-field">
          <span>Model 名稱</span>
          <input type="text" value={model} onChange={(e) => setModel(e.target.value)} />
        </label>
        <div className="provider-card-actions">
          <button className="provider-card-btn" onClick={onCancel}>取消</button>
          <button className="provider-card-btn provider-card-btn--primary" disabled={!canSubmit}
            onClick={() => onSubmit({
              id: `custom-${Date.now()}`,
              name: name.trim(),
              kind: "local-openai",
              baseUrl: baseUrl.trim(),
              apiKey: apiKey.trim(),
              model: model.trim(),
            })}>新增</button>
        </div>
      </div>
    </div>
  );
}

function shortUrl(url: string) {
  try {
    const u = new URL(url);
    return u.host + (u.pathname.length > 1 ? u.pathname : "");
  } catch {
    return url;
  }
}
