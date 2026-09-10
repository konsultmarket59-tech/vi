// Точка входа демонстрации: подменяем мост к приложению и запускаем то же окно.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "../App";
import { демоApi } from "./api";
import "../index.css";

// Подмена делается ДО отрисовки: окно спрашивает данные в первом же эффекте.
window.стройка = демоApi;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
