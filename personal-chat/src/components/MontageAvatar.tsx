import { useEffect, useState } from "react";
import type { MontageAvatarKeys, MontageConfig, MontageOptions } from "../lib/types";
import { fileName } from "../lib/montage";

interface Props {
  options: MontageOptions;
  config: MontageConfig;
  onDone: (path: string) => void;
}

const STAGES: Record<string, string> = {
  sample: "вырезаю из видео чистую речь для голоса",
  clone: "клонирую голос в ElevenLabs",
  speech: "озвучиваю текст вашим голосом",
  prepare: "готовлю видео для губ",
  lipsync: "синхронизирую губы под новую речь — обычно несколько минут",
  heygen: "HeyGen делает ролик — обычно несколько минут",
  download: "скачиваю результат",
  done: "готово",
};

/**
 * Аватар: вы говорите новый текст своим голосом и лицом.
 *
 * Честно о главном прямо в окне: синтез — не съёмка, и «на сто процентов»
 * не бывает ни у кого. Похожесть решают исходник и голосовой образец, поэтому
 * советы, как снять исходник, стоят рядом с кнопкой, а не в справке.
 */
export default function MontageAvatar({ options, config, onDone }: Props) {
  const [mode, setMode] = useState<"own" | "heygen">("own");
  const [keys, setKeys] = useState<MontageAvatarKeys | null>(null);
  const [draftKeys, setDraftKeys] = useState({ eleven: "", fal: "", heygen: "" });
  const [videoPath, setVideoPath] = useState("");
  const [voicePath, setVoicePath] = useState("");
  const [from, setFrom] = useState("0");
  const [text, setText] = useState("");
  const [title, setTitle] = useState("");
  const [model, setModel] = useState(options.lipsyncModels[0]?.id || "");
  const [speed, setSpeed] = useState(1);
  const [heygen, setHeygen] = useState<{ avatars: { id: string; name: string; preview: string; photo?: boolean }[]; voices: { id: string; name: string; language: string }[] } | null>(null);
  const [avatarId, setAvatarId] = useState("");
  const [voiceId, setVoiceId] = useState("");
  const [stage, setStage] = useState<{ stage: string; status?: string; queue?: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ path: string; audio?: string } | null>(null);

  useEffect(() => {
    window.api.montageAvatarKeys().then(setKeys).catch(() => {});
    return window.api.onMontageAvatar(setStage);
  }, []);

  async function saveKeys() {
    setKeys(await window.api.montageSaveAvatarKeys(draftKeys));
    setDraftKeys({ eleven: "", fal: "", heygen: "" });
  }

  async function loadHeygen() {
    setError(null);
    try {
      const list = await window.api.montageHeygenList();
      setHeygen(list);
      if (list.avatars[0]) setAvatarId(list.avatars[0].id);
      const ru = list.voices.find((v) => /russian|рус/i.test(v.language));
      if (ru || list.voices[0]) setVoiceId((ru || list.voices[0]).id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function run() {
    setError(null);
    setResult(null);
    setBusy(true);
    try {
      const chosen = heygen?.avatars.find((a) => a.id === avatarId);
      const r = await window.api.montageAvatarRun({
        mode, text, title, videoPath, voicePath: voicePath || undefined, from: Number(from) || 0, model, speed,
        avatarId, voiceId, photo: !!chosen?.photo, preset: config.preset,
      });
      setResult(r);
      onDone(r.path);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setStage(null);
    }
  }

  const words = text.trim() ? text.trim().split(/\s+/).length : 0;

  return (
    <div className="mt-avatar">
      <section className="mt-card">
        <h3>Аватар: новый текст вашим голосом и лицом</h3>
        <div className="mt-tabs small">
          <button className={mode === "own" ? "on" : ""} onClick={() => setMode("own")}>Из моего видео</button>
          <button className={mode === "heygen" ? "on" : ""} onClick={() => setMode("heygen")}>Мой двойник в HeyGen</button>
        </div>
        {mode === "own" ? (
          <p className="mt-hint">
            Приложение вырезает из вашего видео чистую речь и клонирует по ней голос (ElevenLabs), озвучивает новый текст, а затем переделывает
            рот в вашем же видео под новую озвучку (sync.so через fal.ai). Лицо, свет, одежда и фон — настоящие, меняются только губы.
          </p>
        ) : (
          <p className="mt-hint">
            Если в HeyGen уже сделан цифровой двойник (Instant Avatar) и клон голоса — приложение отправит текст и заберёт готовый ролик в формате
            проекта.
          </p>
        )}
      </section>

      <div className="mt-avatar-grid">
        <section className="mt-card">
          <h3>Ключи сервисов</h3>
          <p className="mt-hint">Хранятся только на этом компьютере, в системной папке приложения. Материал уходит в эти сервисы — это ваше решение.</p>
          {mode === "own" ? (
            <>
              <label className="mt-field">
                <span>ElevenLabs {keys?.eleven ? "✓ задан" : ""}</span>
                <input type="password" placeholder={keys?.eleven ? "оставьте пустым, чтобы не менять" : "ключ с elevenlabs.io"} value={draftKeys.eleven} onChange={(e) => setDraftKeys({ ...draftKeys, eleven: e.target.value })} />
              </label>
              <label className="mt-field">
                <span>fal.ai {keys?.fal ? "✓ задан" : ""}</span>
                <input type="password" placeholder={keys?.fal ? "оставьте пустым, чтобы не менять" : "ключ с fal.ai/dashboard/keys"} value={draftKeys.fal} onChange={(e) => setDraftKeys({ ...draftKeys, fal: e.target.value })} />
              </label>
            </>
          ) : (
            <label className="mt-field">
              <span>HeyGen {keys?.heygen ? "✓ задан" : ""}</span>
              <input type="password" placeholder={keys?.heygen ? "оставьте пустым, чтобы не менять" : "ключ с app.heygen.com/settings/api"} value={draftKeys.heygen} onChange={(e) => setDraftKeys({ ...draftKeys, heygen: e.target.value })} />
            </label>
          )}
          <div className="mt-row">
            <button className="btn btn-secondary" disabled={!draftKeys.eleven && !draftKeys.fal && !draftKeys.heygen} onClick={saveKeys}>Сохранить ключи</button>
            {mode === "own" && keys && keys.voices > 0 && (
              <button className="link-btn" title="Голос клонируется один раз на запись. Сбросить — клонировать заново при следующем запуске." onClick={async () => setKeys(await window.api.montageSaveAvatarKeys({ forgetVoices: true }))}>
                забыть клоны голоса ({keys.voices})
              </button>
            )}
          </div>

          {mode === "own" ? (
            <>
              <h3>Ваше видео</h3>
              <div className="mt-row">
                <button
                  className="btn btn-secondary"
                  onClick={async () => {
                    const f = await window.api.montagePickFile("video");
                    if (f) setVideoPath(f);
                  }}
                >
                  {videoPath ? fileName(videoPath) : "Выбрать видео…"}
                </button>
                <label className="mt-field mt-num">
                  <span>С секунды</span>
                  <input value={from} onChange={(e) => setFrom(e.target.value)} inputMode="decimal" />
                </label>
              </div>
              <div className="mt-row">
                <button
                  className="btn btn-secondary"
                  onClick={async () => {
                    const f = await window.api.montagePickFile("audio");
                    if (f) setVoicePath(f);
                  }}
                  title="Если в видео шумно или играет музыка, дайте отдельную чистую запись голоса — клон выйдет точнее."
                >
                  {voicePath ? `Голос: ${fileName(voicePath)}` : "Отдельная запись голоса (по желанию)"}
                </button>
                {voicePath && <button className="link-btn" onClick={() => setVoicePath("")}>убрать</button>}
              </div>
              <label className="mt-field">
                <span>Модель губ</span>
                <select value={model} onChange={(e) => setModel(e.target.value)}>
                  {options.lipsyncModels.map((m) => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
              </label>
              <details className="mt-tips">
                <summary>Как снять исходник, чтобы было похоже</summary>
                <ul>
                  <li>30–120 секунд, смотрите в камеру, голова почти неподвижна, руки не перед лицом.</li>
                  <li>Ровный свет на лицо, рот хорошо виден, без микрофона перед губами.</li>
                  <li>Звук чистый: без музыки, эха и чужих голосов. Говорите в своей обычной манере — клон повторит и её.</li>
                  <li>Видео короче текста — модель прокрутит его вперёд-назад; поэтому лучше спокойный кадр, чем прогулка.</li>
                </ul>
              </details>
            </>
          ) : (
            <>
              <h3>Двойник и голос</h3>
              <button className="btn btn-secondary" disabled={!keys?.heygen} onClick={loadHeygen}>Загрузить из HeyGen</button>
              {heygen && (
                <>
                  <label className="mt-field">
                    <span>Двойник</span>
                    <select value={avatarId} onChange={(e) => setAvatarId(e.target.value)}>
                      {heygen.avatars.map((a) => (
                        <option key={a.id} value={a.id}>{a.name}{a.photo ? " (фото)" : ""}</option>
                      ))}
                    </select>
                  </label>
                  <label className="mt-field">
                    <span>Голос</span>
                    <select value={voiceId} onChange={(e) => setVoiceId(e.target.value)}>
                      {heygen.voices.map((v) => (
                        <option key={v.id} value={v.id}>{v.name}{v.language ? ` · ${v.language}` : ""}</option>
                      ))}
                    </select>
                  </label>
                </>
              )}
            </>
          )}
        </section>

        <section className="mt-card">
          <h3>Текст нового ролика</h3>
          <input placeholder="Название (для имени файла)" value={title} onChange={(e) => setTitle(e.target.value)} />
          <textarea rows={12} placeholder="Что должен сказать аватар. Пишите так, как говорите: короткие фразы, без канцелярита." value={text} onChange={(e) => setText(e.target.value)} />
          <small className="mt-hint">
            Слов: {words} · примерно {Math.round(words / 2.3)} сек речи
          </small>
          {mode === "own" && (
            <label className="mt-field">
              <span>Темп речи <b>×{speed.toFixed(2)}</b></span>
              <input type="range" min={0.8} max={1.2} step={0.01} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} />
            </label>
          )}
          <div className="mt-row">
            <button className="btn btn-primary" disabled={busy || !text.trim() || (mode === "own" ? !videoPath : !avatarId)} onClick={run}>
              🧑 Сделать ролик
            </button>
          </div>
          {stage && (
            <div className="mt-progress">
              {STAGES[stage.stage] || stage.stage}
              {stage.status ? ` · ${stage.status}` : ""}
              {stage.queue ? ` · в очереди: ${stage.queue}` : ""}
            </div>
          )}
          {error && <div className="mt-error">{error}</div>}
          {result && (
            <div className="mt-ok">
              Готово: {fileName(result.path)}
              <button className="link-btn" onClick={() => window.api.montageShowItem(result.path)}>показать в папке</button>
              <button className="link-btn" onClick={() => window.api.montageOpenPath(result.path)}>открыть</button>
              {result.audio && <div className="mt-hint">Озвучка отдельно: {fileName(result.audio)}</div>}
              <div className="mt-hint">Ролик уже лежит в «Медиа» нового проекта — откройте его в редакторе, чтобы добавить субтитры и надписи.</div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
