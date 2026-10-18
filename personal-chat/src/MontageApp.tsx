import { useEffect, useState } from "react";
import type { LicenceStatus, Settings, Skill } from "./lib/types";
import { DEFAULT_SETTINGS } from "./lib/types";
import MontageView from "./components/MontageView";
import SettingsView from "./components/SettingsView";
import LicenceGate from "./components/LicenceGate";

/**
 * Отдельная программа «Монтаж».
 *
 * Открывается сразу редактор: моушн, титры, ИИ-монтажёр и аватар — внутри
 * него, вкладками слева. Настройки (ключ и модель для ИИ, прокси) — окном
 * поверх редактора: открытый проект и таймлайн остаются как были.
 */
export default function MontageApp() {
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [licence, setLicence] = useState<LicenceStatus | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        if (!s.apiKey) setShowSettings(true);
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
      <main className="mt-app-main">
        <MontageView settings={settings} skills={skills} onOpenSettings={() => setShowSettings(true)} />
        {showSettings && (
          <div className="mt-overlay" onMouseDown={() => setShowSettings(false)}>
            <div className="mt-overlay-card mt-app-settings" onMouseDown={(e) => e.stopPropagation()}>
              <div className="mt-row">
                <h3 className="mt-panel-title">Настройки</h3>
                <div className="mt-spacer" />
                <button className="btn btn-primary" onClick={() => setShowSettings(false)}>Готово</button>
              </div>
              <p className="mt-hint">
                Ключ и модель нужны ИИ: моушн-дизайну и монтажёру. Монтаж руками, титры, чистка пауз, эффекты, субтитры и экспорт работают и без них.
              </p>
              <StabilitySettings />
              <SettingsView settings={settings} onChange={setSettings} />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

/** Аппаратное ускорение и журнал — то, что спасает при зависаниях на конкретной видеокарте. */
function StabilitySettings() {
  const [flags, setFlags] = useState<{ noGpu?: boolean; noGpuReason?: string; logPath: string } | null>(null);
  useEffect(() => {
    window.api.montageFlags().then(setFlags).catch(() => {});
  }, []);
  if (!flags) return null;
  return (
    <div className="mt-stability">
      <label className="mt-check">
        <input
          type="checkbox"
          checked={!flags.noGpu}
          onChange={async (e) => setFlags({ ...flags, ...(await window.api.montageSetFlags({ noGpu: !e.target.checked })) })}
        />
        Аппаратное ускорение видео (если окно белеет или зависает — выключите и перезапустите программу)
      </label>
      {flags.noGpu && flags.noGpuReason && <p className="mt-hint">Выключено автоматически после сбоя графики: {flags.noGpuReason}</p>}
      <button className="btn btn-secondary" onClick={() => window.api.montageOpenLog()}>Журнал (прислать разработчику)</button>
    </div>
  );
}
