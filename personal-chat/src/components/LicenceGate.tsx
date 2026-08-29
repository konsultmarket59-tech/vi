import { useState } from "react";
import type { LicenceStatus } from "../lib/types";

interface Props {
  status: LicenceStatus;
  onActivated: (status: LicenceStatus) => void;
}

const HEADINGS: Record<string, string> = {
  missing: "Активация",
  machine: "Файл выдан для другого компьютера",
  expired: "Срок демо-доступа истёк",
  revoked: "Доступ отозван",
  signature: "Файл активации не подходит",
  config: "Ошибка настроек",
};

/**
 * Shown instead of the app when a demo build has no valid licence. The tester's
 * job here is exactly one thing — send the code, receive a file, open it — so
 * the screen says only that.
 */
export default function LicenceGate({ status, onActivated }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  async function pick() {
    setBusy(true);
    setError("");
    try {
      const next = await window.api.pickLicenceFile();
      if (next) onActivated(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(status.machineCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Не удалось скопировать — выделите код мышью и скопируйте вручную.");
    }
  }

  const canRetry = status.reason === "expired" || status.reason === "revoked";

  return (
    <div className="licence-gate">
      <div className="licence-card">
        <div className="licence-product">{status.productName || "Личный чат"} — демо-версия</div>
        <h1 className="licence-heading">{HEADINGS[status.reason] || "Активация"}</h1>

        {status.message && <p className="licence-message">{status.message}</p>}

        {status.reason === "revoked" && (
          <p className="hint">
            Так бывает, когда тестирование закончилось или копию попросили вернуть. Если это
            неожиданно — напишите автору приложения.
          </p>
        )}

        {status.reason !== "revoked" && status.reason !== "config" && (
          <>
            <p className="licence-step">
              <strong>1.</strong> Отправьте автору код этого компьютера:
            </p>
            <div className="licence-code-row">
              <code className="licence-code">{status.machineCode}</code>
              <button type="button" className="btn" onClick={copyCode}>
                {copied ? "Скопировано" : "Копировать"}
              </button>
            </div>
            <p className="hint">
              Код составлен из технического идентификатора вашей Windows. По нему нельзя узнать
              ни имя, ни файлы, ни что-либо ещё о компьютере — он нужен только чтобы файл
              активации подошёл именно к нему.
            </p>

            <p className="licence-step">
              <strong>2.</strong> В ответ придёт файл <code>.lic</code>. Откройте его здесь:
            </p>
            <button type="button" className="btn btn-primary" onClick={pick} disabled={busy}>
              {canRetry ? "Открыть новый файл активации" : "Выбрать файл активации"}
            </button>
          </>
        )}

        {error && <p className="error-text licence-error">{error}</p>}

        {status.tester && <p className="hint licence-footer">Выдано: {status.tester}</p>}
      </div>
    </div>
  );
}
