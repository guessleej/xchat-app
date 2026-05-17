# xChat — Tauri 2.x PoC

從 `xchat-desktop`（Electron）遷移到 Tauri 2.x 的 1 週概念驗證專案。

## 目標

- ✅ 用 Tauri 2.x 殼包現有 Vite + React renderer
- ✅ macOS / iOS 雙平台啟動
- ⏳ 驗證 WKWebView 對 chat / SSE / Mermaid / 檔案下載相容性
- ⏳ 確認沒有 blocker，再進入正式 monorepo 改造

## 結構

```
xchat-tauri-poc/
├── index.html              # SPA 入口
├── package.json            # Vite + Tauri CLI
├── vite.config.ts          # Tauri-aware Vite 設定
├── tsconfig.json
├── src/                    # React renderer（從 xchat-desktop/src/renderer 複製）
│   ├── App.tsx
│   ├── main.tsx
│   ├── app.css
│   ├── api/
│   ├── components/
│   └── store/
└── src-tauri/              # Rust 後端 + Tauri 設定
    ├── Cargo.toml
    ├── tauri.conf.json
    ├── build.rs
    ├── icons/              # 從 xchat-desktop/build/icons 複製
    ├── src/
    │   ├── main.rs
    │   └── lib.rs
    └── capabilities/
        └── default.json
```

## 命令

### Desktop（macOS）

```bash
pnpm install            # 第一次需要
pnpm tauri:dev          # 開發模式（hot reload + Rust 重編譯）
pnpm tauri:build        # 打包成 .app + .dmg
```

第一次 `pnpm tauri:dev` 會花幾分鐘編譯 Rust 依賴（約 200+ crate）。

### iOS

```bash
pnpm tauri:ios:init     # 初始化 Xcode 專案（一次性）
pnpm tauri:ios:dev      # iOS 模擬器運行
pnpm tauri:ios:build    # 產出 .ipa
```

iOS 需要 macOS + Xcode。實機部署需 Apple Developer 帳號 + Provisioning Profile。

## 後端設定

renderer 仍然指向 xllmapp gateway：

```
VITE_API_URL=http://<backend-host>:8280/api/v1
```

如改 .env，重啟 dev server 即可。

## 已知 PoC 限制

- `window.xchatAPI` 相關 Electron preload 呼叫尚未替換為 Tauri invoke（會 no-op）
- 自動更新、系統托盤、深色模式偵測 暫時失效
- 這些將在 Phase 2（bridge 改寫）逐步補齊
