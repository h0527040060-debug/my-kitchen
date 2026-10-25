import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import KitchenApp from "./kitchen/App.tsx";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {window.location.pathname === "/legacy" ? <App /> : <KitchenApp />}
  </StrictMode>,
);

if ("serviceWorker" in navigator && window.isSecureContext) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}
