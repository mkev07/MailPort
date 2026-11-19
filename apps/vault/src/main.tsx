import React from "react";
import ReactDOM from "react-dom/client";
import { initAppearance } from "./features/settings/model/appearance";
import App from "./App";
import "allo-font";
import "./styles/index.css";
import "./styles/vault.css";

initAppearance();

const root = ReactDOM.createRoot(
  document.getElementById("root") as HTMLElement,
);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// Opaque HTML cover until React paints; fade it out once the first frame is up.
requestAnimationFrame(() =>
  requestAnimationFrame(() => {
    const splash = document.getElementById("boot-splash");
    if (!splash) return;
    splash.classList.add("boot-splash-out");
    setTimeout(() => splash.remove(), 200);
  }),
);
