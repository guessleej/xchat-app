#!/usr/bin/env bash
#
# release:mac — xChat-app 一鍵 macOS release 建置
#
# 自動排除三個會破壞「乾淨重建可重現性」的坑（詳見專案記憶 xchat-app-tauri-build）：
#   1. cargo 快取殘留外專案（kimi）絕對路徑 → 預設 cargo clean（SKIP_CLEAN=1 可略過）
#   2. DMG 打包對 hdiutil 殭屍掛載敏感        → build 前清掉 xChat 殘留掛載與 rw.*.dmg 暫存
#   3. 更新檔簽章需要私鑰 env                  → 自動帶入 .tauri-signing-key（密碼預設空字串）
#
# 用法：
#   pnpm release:mac              # 完整乾淨建置（含 cargo clean）
#   SKIP_CLEAN=1 pnpm release:mac # 沿用編譯快取、只清掛載/暫存後重建（較快）
#
# 對外發佈（Developer ID 簽章 + 公證 notarization）：
#   Tauri 在偵測到下列 Apple env 時，會於 build 期間原生完成「簽章 → 公證 → staple」。
#   未設定時自動降回 ad-hoc 簽章（僅供本機/內部測試）。
#
#   必填（擇一憑證來源）：
#     APPLE_SIGNING_IDENTITY="Developer ID Application: 公司名 (TEAMID)"   # 憑證已在 keychain
#       或  APPLE_CERTIFICATE / APPLE_CERTIFICATE_PASSWORD                  # base64 的 .p12 + 密碼
#   公證憑證（擇一）：
#     APPLE_API_ISSUER / APPLE_API_KEY / APPLE_API_KEY_PATH                 # App Store Connect API key（建議）
#       或  APPLE_ID / APPLE_PASSWORD（app-specific 密碼）/ APPLE_TEAM_ID
#
#   範例：
#     export APPLE_SIGNING_IDENTITY="Developer ID Application: Cloudinfo (XXXXXXXXXX)"
#     export APPLE_API_ISSUER=... APPLE_API_KEY=... APPLE_API_KEY_PATH=~/keys/AuthKey_XXXX.p8
#     pnpm release:mac
#
set -euo pipefail

# 切到專案根（本腳本位於 <root>/scripts/）
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

BUNDLE_MACOS="src-tauri/target/release/bundle/macos"

echo "▶ [1/4] 清理 hdiutil 殭屍掛載與 rw.*.dmg 暫存..."
hdiutil info 2>/dev/null \
  | awk '/^\/dev\/disk/{d=$1} /image-path/&&/xChat/{print d}' \
  | sort -u \
  | while read -r dev; do
      [ -n "$dev" ] && echo "  detach $dev" && hdiutil detach "$dev" -force >/dev/null 2>&1 || true
    done
rm -f "$BUNDLE_MACOS"/rw.*.dmg 2>/dev/null || true

if [ "${SKIP_CLEAN:-0}" = "1" ]; then
  echo "▶ [2/4] SKIP_CLEAN=1，略過 cargo clean"
else
  echo "▶ [2/4] cargo clean（避免外專案路徑污染快取）..."
  cargo clean --manifest-path src-tauri/Cargo.toml
fi

echo "▶ [3/5] 載入更新檔簽章私鑰 env..."
if [ -z "${TAURI_SIGNING_PRIVATE_KEY:-}" ]; then
  if [ -f src-tauri/.tauri-signing-key ]; then
    export TAURI_SIGNING_PRIVATE_KEY="$(cat src-tauri/.tauri-signing-key)"
    export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}"
    echo "  已從 src-tauri/.tauri-signing-key 載入（密碼：${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:+已設定}${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-空})"
  else
    echo "  ⚠ 找不到 src-tauri/.tauri-signing-key，更新檔簽章可能失敗"
  fi
else
  echo "  使用既有環境變數 TAURI_SIGNING_PRIVATE_KEY"
fi

echo "▶ [4/5] 偵測 Apple 簽章/公證模式..."
NOTARIZE=0
if [ -n "${APPLE_SIGNING_IDENTITY:-}" ] || [ -n "${APPLE_CERTIFICATE:-}" ]; then
  if [ -n "${APPLE_API_KEY:-}" ] || [ -n "${APPLE_ID:-}" ]; then
    NOTARIZE=1
    echo "  ✓ 偵測到 Developer ID 憑證 + 公證憑證 → 將進行正式簽章 + 公證 + staple"
    echo "    簽章身分：${APPLE_SIGNING_IDENTITY:-(來自 APPLE_CERTIFICATE)}"
  else
    echo "  ⚠ 有簽章憑證但缺公證憑證（APPLE_API_KEY 或 APPLE_ID）→ 只會簽章、不公證"
  fi
else
  echo "  ℹ 未設定 Apple 憑證 → ad-hoc 簽章（僅供本機/內部測試）"
  echo "    對外發佈請見本腳本檔頭說明設定 APPLE_* 環境變數。"
fi

echo "▶ [5/5] tauri build..."
pnpm tauri build "$@"

echo ""
echo "✅ 完成。產物："
ls -lh src-tauri/target/release/bundle/dmg/*.dmg "$BUNDLE_MACOS"/xChat.app.tar.gz* 2>/dev/null || true
if [ "$NOTARIZE" = "1" ]; then
  echo "🔏 已完成 Developer ID 簽章 + 公證；DMG 可直接對外發佈。"
else
  echo "ℹ️  App 為 ad-hoc 簽章；對外發佈前仍需 Developer ID 簽章 + notarization（設定 APPLE_* env 後重跑即可）。"
fi
