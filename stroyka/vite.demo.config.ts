import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Отдельная сборка для демонстрации в браузере.
//
// Отдельная, а не вторая страница в основной сборке, ровно по одной причине:
// в приложение, которое ставят на компьютер, не должно попасть ничего из
// демонстрации — ни зашитого прайса, ни заготовленных ответов «агента».
// Разные конфигурации гарантируют это на уровне сборки, а не аккуратности.
export default defineConfig({
  base: "./",
  plugins: [react()],
  build: {
    outDir: "dist-demo",
    rollupOptions: { input: "demo.html" },
    // Расчётные модули лежат в electron/ и написаны на CommonJS. По умолчанию
    // rollup разбирает CommonJS только в node_modules — без этой строки импорт
    // движков собирается в пустоту, и демонстрация открывается белым экраном.
    commonjsOptions: { include: [/node_modules/, /electron[\\/].+\.cjs$/] },
  },
  optimizeDeps: { include: [] },
});
