import { useCallback, useEffect, useState } from "react";
import type { UsagePeriod, UsageSummary } from "../lib/types";

const PERIODS: { id: UsagePeriod; label: string }[] = [
  { id: "day", label: "День" },
  { id: "week", label: "Неделя" },
  { id: "month", label: "Месяц" },
];

function formatTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + " млн";
  if (n >= 1000) return (n / 1000).toFixed(1) + " тыс.";
  return String(n);
}

function formatCost(cost: number, currency: string): string {
  return cost.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " " + currency;
}

/**
 * Replaces the API-key block in a managed build. The point is that the person
 * using the app can see what their work costs without holding the key.
 *
 * Exact figures and estimates are shown as different things on purpose: an
 * estimate presented as a bill is worse than no number at all.
 */
export default function UsagePanel() {
  const [period, setPeriod] = useState<UsagePeriod>("day");
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async (which: UsagePeriod) => {
    setError("");
    try {
      setSummary(await window.api.usageSummary(which));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    load(period);
  }, [load, period]);

  const totals = summary?.totals;

  return (
    <section className="settings-section">
      <h2>Расход моделей</h2>
      <p className="hint">
        Ключ доступа к моделям встроен в эту сборку — вводить свой не нужно. Здесь видно, что
        именно израсходовано.
      </p>

      <div className="usage-periods">
        {PERIODS.map((p) => (
          <button
            key={p.id}
            type="button"
            className={period === p.id ? "btn btn-sm btn-primary" : "btn btn-sm"}
            onClick={() => setPeriod(p.id)}
          >
            {p.label}
          </button>
        ))}
        <button type="button" className="btn btn-sm" onClick={() => load(period)}>
          Обновить
        </button>
      </div>

      {!summary && !error && <p className="hint">Загрузка…</p>}

      {summary && summary.models.length === 0 && (
        <p className="hint">За этот период запросов не было.</p>
      )}

      {summary && summary.models.length > 0 && (
        <>
          <table className="usage-table">
            <thead>
              <tr>
                <th>Модель</th>
                <th>Запросов</th>
                <th>Токенов</th>
                <th>Стоимость</th>
              </tr>
            </thead>
            <tbody>
              {summary.models.map((row) => (
                <tr key={row.model}>
                  <td className="usage-model">
                    {row.model}
                    {!row.exact && <span className="usage-flag" title="Точный расход сервис не вернул">оценка</span>}
                  </td>
                  <td>{row.calls}</td>
                  <td>{formatTokens(row.tokens)}</td>
                  <td>
                    {row.cost === null ? (
                      <span className="hint">цена не задана</span>
                    ) : (
                      formatCost(row.cost, totals?.currency || "₽")
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            {totals && (
              <tfoot>
                <tr>
                  <th>Итого</th>
                  <th>{totals.calls}</th>
                  <th>{formatTokens(totals.tokens)}</th>
                  <th>
                    {totals.cost === null ? (
                      <span className="hint">не полностью</span>
                    ) : (
                      formatCost(totals.cost, totals.currency)
                    )}
                  </th>
                </tr>
              </tfoot>
            )}
          </table>

          {totals?.estimated && (
            <p className="hint">
              Часть запросов помечена как «оценка»: сервис не вернул точный расход токенов, и он
              посчитан по длине текста. Это ориентир, а не счёт.
            </p>
          )}
          {totals?.cost === null && (
            <p className="hint">
              Итоговая сумма не показана, потому что для части моделей в сборку не заданы цены.
              Сумма без них вводила бы в заблуждение.
            </p>
          )}
        </>
      )}

      {error && <p className="error-text">{error}</p>}
    </section>
  );
}
