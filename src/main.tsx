// 入口：按 URL 参数决定起哪个窗口。
//
// Tauri 的第二个窗口用 url 指向同一份前端，带 ?window=guide。
// 这样两个窗口共享同一份构建产物，不用配两套。

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import GuideApp from "./GuideApp";
import "./styles/app.css";
import "./styles/guide.css";

const isGuide = new URLSearchParams(location.search).get("window") === "guide";

createRoot(document.getElementById("root")!).render(
  <StrictMode>{isGuide ? <GuideApp /> : <App />}</StrictMode>,
);
