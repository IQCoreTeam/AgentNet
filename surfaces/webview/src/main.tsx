import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { App } from "./App";
import { StoreProvider } from "./state/store";
import { UnlockProvider } from "./unlock/UnlockProvider";

createRoot(document.getElementById("app")!).render(
  <StrictMode>
    <StoreProvider>
      <UnlockProvider>
        <App />
      </UnlockProvider>
    </StoreProvider>
  </StrictMode>,
);
