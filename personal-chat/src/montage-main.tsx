import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import MontageApp from "./MontageApp.tsx";
import ErrorBoundary from "./components/ErrorBoundary";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <MontageApp />
    </ErrorBoundary>
  </StrictMode>
);
