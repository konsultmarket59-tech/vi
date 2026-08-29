import { useEffect, useState } from "react";
import type { ReportInfo } from "../lib/types";

/**
 * The whole feedback loop for the test group, in one place: what version they
 * are on, and one button that turns "у меня всё сломалось" into a file with the
 * actual error lines in it.
 *
 * Nothing is sent anywhere automatically — the tester sends the file themselves.
 * That is deliberate: a demo on someone's work computer should not be quietly
 * transmitting anything.
 */
export default function ProblemReport() {
  const [info, setInfo] = useState<ReportInfo | null>(null);
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [written, setWritten] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    window.api
      .reportInfo()
      .then(setInfo)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  async function create() {
    setBusy(true);
    setError("");
    try {
      const result = await window.api.writeReport(description);
      setWritten(result.file);
      setDescription("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="settings-section">
      <h2>О программе и отчёт о проблеме</h2>

      {info && (
        <p className="hint">
          {info.productName}, версия {info.version}
          {info.tester && ` · выдано: ${info.tester}`}
          {info.expiresAt && ` · доступ до ${new Date(info.expiresAt).toLocaleDateString("ru-RU")}`}
        </p>
      )}

      <p className="hint">
        Если что-то не работает — опишите, что вы делали, и нажмите кнопку. На рабочем столе
        появится файл с описанием и техническими подробностями (версия, система, последние ошибки
        приложения). Отправьте этот файл — по нему видно, что именно сломалось.
      </p>
      <p className="hint">
        В файл не попадают ваши проекты, тексты, документы и ключ доступа к моделям. Приложение
        ничего не отправляет само — файл уходит только тогда, когда вы его перешлёте.
      </p>

      <label className="field-label">Что произошло</label>
      <textarea
        className="textarea"
        rows={4}
        placeholder="Например: открыла таблицу продаж, нажала «Пересчитать» — окно побелело и ничего не происходит."
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />

      <div className="row">
        <button type="button" className="btn btn-primary" onClick={create} disabled={busy}>
          Создать отчёт о проблеме
        </button>
        {info?.log?.errors ? (
          <span className="hint">Записано ошибок за сеанс: {info.log.errors}</span>
        ) : null}
      </div>

      {written && (
        <p className="notice-text">
          Файл сохранён: {written}{" "}
          <button type="button" className="btn btn-sm" onClick={() => window.api.revealReport(written)}>
            Показать в папке
          </button>
        </p>
      )}
      {error && <p className="error-text">{error}</p>}
    </section>
  );
}
