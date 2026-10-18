import { useEffect, useState } from "react";
import type { LicenceStatus, Settings, Skill, StoriesHandoff } from "./lib/types";
import { DEFAULT_SETTINGS } from "./lib/types";
import MontageView from "./components/MontageView";
import VideoStoriesView from "./components/VideoStoriesView";
import SettingsView from "./components/SettingsView";
import LicenceGate from "./components/LicenceGate";

type Screen = "montage" | "motion" | "settings";

/**
 * Отдельная программа «Монтаж».
 *
 * Тот же раздел, что в «Личном чате», только на всё окно и без чата вокруг.
 * Моушн-дизайн («Видео-сторис») — соседней вкладкой: готовый ролик уходит туда
 * одной кнопкой. Настройки — только те, что нужны монтажу: ключ и модель для
 * ИИ-монтажёра, прокси.
 */
export default function MontageApp() {
  const [screen, setScreen] = useState<Screen>("montage");
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [licence, setLicence] = useState<LicenceStatus | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [handoff, setHandoff] = useState<StoriesHandoff | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const lic = await window.api.licenceStatus();
        setLicence(lic);
        if (lic.gated && !lic.ok) {
          setLoaded(true);
          return;
        }
        const [s, sk] = await Promise.all([window.api.getSettings(), window.api.listSkills()]);
        setSettings(s);
        setSkills(sk);
        document.title = "Монтаж";
        // Без ключа агент не заработает — сразу показываем, куда его вставить.
        if (!s.apiKey) setScreen("settings");
        setLoaded(true);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, []);

  if (error) {
    return (
      <div className="loading-screen loading-screen-error">
        <div>
          <p>Не удалось загрузить программу.</p>
          <pre className="startup-error-details">{error}</pre>
          <button className="btn btn-primary" onClick={() => window.location.reload()}>Попробовать снова</button>
        </div>
      </div>
    );
  }
  if (!loaded) return <div className="loading-screen"><div>Загрузка…</div></div>;
  if (licence?.gated && !licence.ok) {
    return <LicenceGate status={licence} onActivated={(next) => { setLicence(next); if (next.ok) window.location.reload(); }} />;
  }

  return (
    <div className="mt-app">
      <header className="mt-app-bar">
        <b className="mt-app-name">✂️ Монтаж</b>
        <button className={screen === "montage" ? "on" : ""} onClick={() => setScreen("montage")}>Монтаж</button>
        <button className={screen === "motion" ? "on" : ""} onClick={() => setScreen("motion")}>✨ Моушн-дизайн</button>
        <div className="mt-spacer" />
        <button className={screen === "settings" ? "on" : ""} onClick={() => setScreen("settings")}>⚙ Настройки</button>
      </header>
      <main className="mt-app-main">
        {/* Монтаж не размонтируется при переходе в настройки: открытый проект и таймлайн остаются как были. */}
        <div style={{ display: screen === "montage" ? "contents" : "none" }}>
          <MontageView
            settings={settings}
            skills={skills}
            onOpenSettings={() => setScreen("settings")}
            onMotionDesign={(h) => {
              setHandoff({ ...h, nonce: Date.now() });
              setScreen("motion");
            }}
          />
        </div>
        {screen === "motion" && <VideoStoriesView settings={settings} skills={skills} onOpenSettings={() => setScreen("settings")} handoff={handoff} />}
        {screen === "settings" && (
          <div className="mt-app-settings">
            <p className="mt-hint">
              Ключ и модель нужны ИИ-монтажёру и моушн-дизайну. Монтаж руками, чистка пауз без агента, эффекты, субтитры и экспорт работают и без них.
            </p>
            <SettingsView settings={settings} onChange={setSettings} />
          </div>
        )}
      </main>
    </div>
  );
}
