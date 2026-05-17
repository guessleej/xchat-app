import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./app.css";
// 先渲染 React，再非同步載入 xchatAPI shim，避免 shim 任何 throw 拖垮畫面
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// shim 用動態 import 載，並包 try/catch 保險
queueMicrotask(() => {
  import("./lib/xchat-api-shim")
    .then(({ installXchatAPI }) => {
      try {
        installXchatAPI();
      } catch (e) {
        console.error("[main] installXchatAPI threw:", e);
      }
    })
    .catch((e) => {
      console.error("[main] shim module import failed:", e);
    });
});
