import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { App } from "./App";
import { StoreProvider } from "./state/store";
import { UnlockProvider } from "./unlock/UnlockProvider";
import { LangProvider } from "./i18n";

createRoot(document.getElementById("app")!).render(
  <StrictMode>
    <LangProvider>
      <StoreProvider>
        <UnlockProvider>
          <App />
        </UnlockProvider>
      </StoreProvider>
    </LangProvider>
  </StrictMode>,
);
