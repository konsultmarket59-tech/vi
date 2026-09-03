import { useEffect, useState } from "react";
import type {
  Conversation,
  CostKind,
  FinComputed,
  FinModelInput,
  FinRates,
  FinScenario,
  Settings,
  Skill,
  TaxRegime,
} from "../lib/types";
import { uid } from "../lib/promptBuilder";
import ChatView from "./ChatView";

interface Props {
  settings: Settings;
  skills: Skill[];
  onOpenSettings: () => void;
}

/** Что сейчас делает агент. Разговоры разные, и путать их нельзя: в первом он
 *  достаёт допущения из данных, во втором — читает уже посчитанную модель. */
type AgentMode = "params" | "advice";

const MONTHS_SHORT = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

const money = (v: number | null | undefined) =>
  v === null || v === undefined || !Number.isFinite(v)
    ? "—"
    : new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(Math.round(v));

const pct = (v: number | null) => (v === null ? "не определяется" : `${(v * 100).toFixed(1)}%`);

const fileName = (p: string) => (p ? p.split(/[\\/]/).pop() || p : "");

/** Список чисел ↔ строка: сезонность и раскрутку удобнее править текстом. */
const listToText = (list: number[]) => list.map((n) => String(Number(n.toFixed(3)))).join(", ");
const textToList = (text: string) =>
  text
    .split(/[,;\s]+/)
    .map((s) => Number(s.replace(",", ".")))
    .filter((n) => Number.isFinite(n));

export default function FinModelView({ settings, skills, onOpenSettings }: Props) {
  const [regimes, setRegimes] = useState<TaxRegime[]>([]);
  const [costKinds, setCostKinds] = useState<CostKind[]>([]);
  const [defaultRates, setDefaultRates] = useState<FinRates | null>(null);

  const [projectName, setProjectName] = useState("");
  const [productName, setProductName] = useState("");
  const [price, setPrice] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [baseVolume, setBaseVolume] = useState("");
  const [startYear, setStartYear] = useState(String(new Date().getFullYear()));
  const [startMonth, setStartMonth] = useState("1");
  const [horizonYears, setHorizonYears] = useState("5");
  const [regime, setRegime] = useState("usn6");
  const [patentYear, setPatentYear] = useState("");
  const [ipWithoutStaff, setIpWithoutStaff] = useState(false);
  const [seasonality, setSeasonality] = useState<number[]>(Array(12).fill(1));
  const [rampText, setRampText] = useState("0.3, 0.5, 0.7, 0.85, 1");
  const [inflationText, setInflationText] = useState("");
  const [minWage, setMinWage] = useState("");
  const [notes, setNotes] = useState("");

  const [payroll, setPayroll] = useState([{ role: "", count: "", salary: "", percentOfSales: "" }]);
  const [fixedCosts, setFixedCosts] = useState([{ name: "", monthly: "" }]);
  const [variableCosts, setVariableCosts] = useState([{ name: "", kind: "month", value: "" }]);
  const [investments, setInvestments] = useState([{ name: "", amount: "" }]);

  const [dataPaths, setDataPaths] = useState<string[]>([]);
  const [outputDir, setOutputDir] = useState("");

  const [mode, setMode] = useState<AgentMode | null>(null);
  const [systemPrompt, setSystemPrompt] = useState("");
  const [conv, setConv] = useState<Conversation | null>(null);
  const [computed, setComputed] = useState<FinComputed | null>(null);
  const [advice, setAdvice] = useState("");
  const [sources, setSources] = useState<{ inflation?: string; minWage?: string }>({});
  const [applied, setApplied] = useState("");
  const [savedPath, setSavedPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    window.api.finmodelOptions().then((o) => {
      setRegimes(o.regimes);
      setCostKinds(o.costKinds);
      setDefaultRates(o.rates);
      setMinWage(String(o.rates.minWage));
      setInflationText(String(o.rates.inflation * 100));
    });
  }, []);

  const horizon = Math.max(1, Number(horizonYears) || 5);
  const activeRegime = regimes.find((r) => r.id === regime);

  /** Форма в том виде, в каком её ждёт расчёт. */
  function buildInput(): Partial<FinModelInput> {
    const inflList = textToList(inflationText).map((v) => (Math.abs(v) > 1 ? v / 100 : v));
    return {
      projectName,
      productName,
      price: Number(price) || 0,
      unitCost: Number(unitCost) || 0,
      baseVolume: Number(baseVolume) || 0,
      startYear: Number(startYear) || new Date().getFullYear(),
      startMonth: Number(startMonth) || 1,
      horizonYears: horizon,
      seasonality,
      rampUp: textToList(rampText),
      inflation: inflList.length ? inflList : undefined,
      tax: {
        regime,
        patentYear: Number(patentYear) || 0,
        npdLegal: true,
        priceIncludesVat: false,
        ipWithoutStaff,
      },
      payroll: payroll.map((p) => ({
        role: p.role,
        count: Number(p.count) || 0,
        salary: Number(p.salary) || 0,
        percentOfSales: Number(p.percentOfSales) || 0,
      })),
      fixedCosts: fixedCosts.map((c) => ({ name: c.name, monthly: Number(c.monthly) || 0 })),
      variableCosts: variableCosts.map((c) => ({
        name: c.name,
        kind: c.kind as "month" | "unit" | "revenue",
        value: Number(c.value) || 0,
      })),
      investments: investments.map((c) => ({ name: c.name, amount: Number(c.amount) || 0 })),
      rates: defaultRates ? { ...defaultRates, minWage: Number(minWage) || defaultRates.minWage } : undefined,
      notes,
    } as Partial<FinModelInput>;
  }

  function newConversation(title: string): Conversation {
    const now = Date.now();
    return { id: uid(), projectId: "", title, messages: [], createdAt: now, updatedAt: now };
  }

  /** Первый проход: агент читает статистику и ищет официальные ставки. */
  async function askParams() {
    setError(null);
    setBusy(true);
    try {
      const prepared = await window.api.prepareFinmodelParams({
        input: buildInput(),
        dataPaths,
        searchRates: true,
      });
      setSystemPrompt(prepared.prompt);
      setMode("params");
      setConv(newConversation("Допущения модели"));
      setApplied("");
      if (prepared.problems.length) setError(prepared.problems.join("; "));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  /** Ответ агента в режиме допущений — подставляем в форму и говорим, что взяли. */
  async function onAssistantMessage(content: string) {
    if (mode === "advice") {
      setAdvice(content.trim());
      return;
    }
    if (mode !== "params") return;
    const parsed = await window.api.parseFinmodelParams(content, buildInput()).catch(() => null);
    if (!parsed) {
      setApplied(
        "Агент ответил, но не прислал блок с допущениями — форма не изменилась. " +
          "Попросите его повторить ответ в нужном формате."
      );
      return;
    }
    const took: string[] = [];
    if (parsed.baseVolume) {
      setBaseVolume(String(Math.round(parsed.baseVolume)));
      took.push(`базовый объём ${Math.round(parsed.baseVolume)} ед./мес`);
    }
    if (parsed.seasonality) {
      setSeasonality(parsed.seasonality);
      took.push("сезонность по месяцам");
    }
    if (parsed.rampUp) {
      setRampText(listToText(parsed.rampUp));
      took.push("кривую раскрутки");
    }
    if (parsed.inflation) {
      setInflationText(parsed.inflation.map((v) => (v * 100).toFixed(1)).join(", "));
      took.push("инфляцию по годам");
    }
    if (parsed.minWage) {
      setMinWage(String(Math.round(parsed.minWage)));
      took.push(`МРОТ ${Math.round(parsed.minWage)} ₽`);
    }
    setSources({ inflation: parsed.sources.inflation, minWage: parsed.sources.minWage });
    setApplied(
      took.length
        ? `Подставлено в форму: ${took.join(", ")}. ${parsed.comment || ""}`.trim()
        : "Агент прислал блок, но полезных чисел в нём не оказалось."
    );
  }

  async function calculate() {
    setError(null);
    setBusy(true);
    try {
      setComputed(await window.api.computeFinmodel(buildInput()));
      setSavedPath("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  /** Второй проход: заключение по уже посчитанным числам. */
  async function askAdvice() {
    setError(null);
    setBusy(true);
    try {
      const prompt = await window.api.prepareFinmodelAdvice(buildInput());
      setSystemPrompt(prompt);
      setMode("advice");
      setConv(newConversation("Заключение экономиста"));
      setAdvice("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setError(null);
    if (!outputDir) {
      const dir = await window.api.pickCleanupFolder();
      if (!dir) return;
      setOutputDir(dir);
      return;
    }
    setBusy(true);
    try {
      const file = await window.api.saveFinmodel({
        input: buildInput(),
        destDir: outputDir,
        fileName: `Финмодель — ${projectName || "проект"}`,
        advice,
        sources,
      });
      setSavedPath(file);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  // --- строки списков ---
  const rowsEditor = <T extends Record<string, string>>(
    rows: T[],
    setRows: (r: T[]) => void,
    blank: T,
    fields: { key: keyof T; label: string; width?: number; kind?: "select" }[]
  ) => (
    <div className="fin-rows">
      <div className="fin-row fin-row-head">
        {fields.map((f) => (
          <span key={String(f.key)} style={{ flex: f.width || 1 }}>
            {f.label}
          </span>
        ))}
        <span className="fin-row-x" />
      </div>
      {rows.map((row, i) => (
        <div className="fin-row" key={i}>
          {fields.map((f) =>
            f.kind === "select" ? (
              <select
                key={String(f.key)}
                style={{ flex: f.width || 1 }}
                value={row[f.key] as string}
                onChange={(e) => {
                  const next = [...rows];
                  next[i] = { ...row, [f.key]: e.target.value };
                  setRows(next);
                }}
              >
                {costKinds.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.name}
                  </option>
                ))}
              </select>
            ) : (
              <input
                key={String(f.key)}
                style={{ flex: f.width || 1 }}
                value={row[f.key] as string}
                onChange={(e) => {
                  const next = [...rows];
                  next[i] = { ...row, [f.key]: e.target.value };
                  setRows(next);
                }}
              />
            )
          )}
          <button
            className="fin-row-x"
            title="Убрать строку"
            onClick={() => setRows(rows.filter((_, j) => j !== i))}
          >
            ✕
          </button>
        </div>
      ))}
      <button className="btn btn-secondary btn-small" onClick={() => setRows([...rows, { ...blank }])}>
        + строка
      </button>
    </div>
  );

  const scenarioRow = (label: string, get: (s: FinScenario) => string) =>
    computed && (
      <tr>
        <td>{label}</td>
        <td>{get(computed.pess)}</td>
        <td className="fin-base">{get(computed.base)}</td>
        <td>{get(computed.opt)}</td>
      </tr>
    );

  return (
    <div className="view">
      <div className="view-head">
        <h2>💹 Финмодель</h2>
        <p className="muted">
          Считает модель формулами, а не на глаз. Агент нужен для двух вещей: достать кривую спроса
          из вашей статистики и написать заключение по уже посчитанным числам.
        </p>
      </div>

      {!settings.apiKey && (
        <div className="warning-banner">
          API-ключ не задан — расчёт и книга Excel работают и без него, но собрать допущения и
          написать заключение агент не сможет.{" "}
          <button className="link-btn" onClick={onOpenSettings}>
            Открыть настройки
          </button>
        </div>
      )}

      <div className="fin-columns">
        <div className="fin-form">
          <section className="fin-block">
            <h3>Проект и продукт</h3>
            <label>
              Название проекта
              <input value={projectName} onChange={(e) => setProjectName(e.target.value)} />
            </label>
            <label>
              Продукт
              <input
                value={productName}
                onChange={(e) => setProductName(e.target.value)}
                placeholder="Если продуктов несколько — опишите усреднённый"
              />
            </label>
            <div className="fin-pair">
              <label>
                Цена за единицу, ₽
                <input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" />
              </label>
              <label>
                Себестоимость единицы, ₽
                <input value={unitCost} onChange={(e) => setUnitCost(e.target.value)} inputMode="decimal" />
              </label>
            </div>
            <div className="fin-pair">
              <label>
                Базовый объём, ед./мес
                <input value={baseVolume} onChange={(e) => setBaseVolume(e.target.value)} inputMode="decimal" />
              </label>
              <label>
                Горизонт, лет
                <input value={horizonYears} onChange={(e) => setHorizonYears(e.target.value)} inputMode="numeric" />
              </label>
            </div>
            <div className="fin-pair">
              <label>
                Старт — месяц
                <select value={startMonth} onChange={(e) => setStartMonth(e.target.value)}>
                  {MONTHS_SHORT.map((m, i) => (
                    <option key={m} value={i + 1}>
                      {m}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Старт — год
                <input value={startYear} onChange={(e) => setStartYear(e.target.value)} inputMode="numeric" />
              </label>
            </div>
          </section>

          <section className="fin-block">
            <h3>Налоги</h3>
            <label>
              Система налогообложения
              <select value={regime} onChange={(e) => setRegime(e.target.value)}>
                {regimes.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>
            {activeRegime && <p className="fin-hint">{activeRegime.hint}</p>}
            {regime === "psn" && (
              <label>
                Стоимость патента за год, ₽
                <input value={patentYear} onChange={(e) => setPatentYear(e.target.value)} inputMode="decimal" />
              </label>
            )}
            {regime === "usn6" && (
              <label className="fin-check">
                <input
                  type="checkbox"
                  checked={ipWithoutStaff}
                  onChange={(e) => setIpWithoutStaff(e.target.checked)}
                />
                ИП без работников — налог уменьшается на взносы полностью, а не наполовину
              </label>
            )}
            <label>
              МРОТ, ₽
              <input value={minWage} onChange={(e) => setMinWage(e.target.value)} inputMode="decimal" />
            </label>
            <p className="fin-hint">
              Ставки и МРОТ попадают в книгу отдельными ячейками — их видно и можно поправить прямо
              в Excel, не трогая приложение.
            </p>
          </section>

          <section className="fin-block">
            <h3>ФОТ</h3>
            {rowsEditor(
              payroll,
              setPayroll,
              { role: "", count: "", salary: "", percentOfSales: "" },
              [
                { key: "role", label: "Должность", width: 2 },
                { key: "count", label: "Человек" },
                { key: "salary", label: "Оклад, ₽" },
                { key: "percentOfSales", label: "% от продаж" },
              ]
            )}
          </section>

          <section className="fin-block">
            <h3>Постоянные расходы (в месяц)</h3>
            {rowsEditor(fixedCosts, setFixedCosts, { name: "", monthly: "" }, [
              { key: "name", label: "Статья", width: 2 },
              { key: "monthly", label: "Сумма, ₽" },
            ])}
          </section>

          <section className="fin-block">
            <h3>Переменные расходы</h3>
            {rowsEditor(variableCosts, setVariableCosts, { name: "", kind: "month", value: "" }, [
              { key: "name", label: "Статья", width: 2 },
              { key: "kind", label: "Как считается", width: 2, kind: "select" },
              { key: "value", label: "Значение" },
            ])}
          </section>

          <section className="fin-block">
            <h3>Инвестиции</h3>
            {rowsEditor(investments, setInvestments, { name: "", amount: "" }, [
              { key: "name", label: "Статья", width: 2 },
              { key: "amount", label: "Сумма, ₽" },
            ])}
          </section>

          <section className="fin-block">
            <h3>Спрос</h3>
            <label>
              Сезонность по месяцам
              <div className="fin-season">
                {seasonality.map((v, i) => (
                  <span key={i}>
                    <em>{MONTHS_SHORT[i]}</em>
                    <input
                      value={String(v)}
                      onChange={(e) => {
                        const next = [...seasonality];
                        next[i] = Number(e.target.value.replace(",", ".")) || 0;
                        setSeasonality(next);
                      }}
                    />
                  </span>
                ))}
              </div>
            </label>
            <label>
              Раскрутка — доля от базового объёма по месяцам
              <input value={rampText} onChange={(e) => setRampText(e.target.value)} />
            </label>
            <label>
              Инфляция по годам, % (первый год базовый)
              <input value={inflationText} onChange={(e) => setInflationText(e.target.value)} />
            </label>
            <label>
              Особенности бизнес-модели
              <textarea
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Что важно знать про этот бизнес: как приходят клиенты, есть ли предоплата, от чего зависит спрос"
              />
            </label>

            <div className="fin-files">
              <button
                className="btn btn-secondary btn-small"
                onClick={async () => {
                  const files = await window.api.pickFiles();
                  if (files?.length) setDataPaths([...dataPaths, ...files]);
                }}
              >
                + статистика или Вордстат
              </button>
              {dataPaths.map((p) => (
                <span className="fin-file" key={p}>
                  {fileName(p)}
                  <button onClick={() => setDataPaths(dataPaths.filter((x) => x !== p))}>✕</button>
                </span>
              ))}
            </div>
            <p className="fin-hint">
              Файлы читаются по пути и внутрь приложения не копируются. Если продаж ещё не было,
              подойдёт выгрузка Вордстата: из динамики запросов агент выведет форму кривой спроса.
            </p>
          </section>

          <div className="fin-actions">
            <button className="btn btn-secondary" onClick={askParams} disabled={busy}>
              Собрать допущения агентом
            </button>
            <button className="btn" onClick={calculate} disabled={busy}>
              Рассчитать
            </button>
          </div>
          {applied && <div className="fin-applied">{applied}</div>}
          {error && <div className="fin-error">{error}</div>}
        </div>

        <div className="fin-result">
          {computed ? (
            <>
              <h3>Сценарии</h3>
              <table className="fin-table">
                <thead>
                  <tr>
                    <th>Показатель</th>
                    <th>Пессим.</th>
                    <th className="fin-base">Базовый</th>
                    <th>Оптим.</th>
                  </tr>
                </thead>
                <tbody>
                  {scenarioRow("Выручка за горизонт, ₽", (s) => money(s.totalRevenue))}
                  {scenarioRow("Чистая прибыль, ₽", (s) => money(s.totalNet))}
                  {scenarioRow("Выручка 1-го года, ₽", (s) => money(s.years[0]?.revenue))}
                  {scenarioRow("Чистая 1-го года, ₽", (s) => money(s.years[0]?.net))}
                  {scenarioRow("Налоги 1-го года, ₽", (s) => money((s.years[0]?.tax || 0) + (s.years[0]?.vat || 0)))}
                  {scenarioRow("Окупаемость", (s) =>
                    !s.payback
                      ? "за горизонт не наступает"
                      : s.investment === 0
                        ? "инвестиций нет"
                        : `${s.payback.months} мес. — ${s.payback.label}`
                  )}
                  {scenarioRow("NPV, ₽", (s) => money(s.npv))}
                  {scenarioRow("IRR годовая", (s) => pct(s.irr))}
                  {scenarioRow("Точка безубыточности, ед./мес", (s) =>
                    s.breakEvenUnits === null
                      ? "не достигается"
                      : s.breakEvenUnits < 1
                        ? "постоянных расходов нет"
                        : money(s.breakEvenUnits)
                  )}
                </tbody>
              </table>
              <p className="fin-hint">
                Инвестиции: {money(computed.base.investment)} ₽. Маржа после переменных расходов:{" "}
                {money(computed.base.marginPerUnit)} ₽ с единицы.
              </p>

              <div className="fin-actions">
                <button className="btn btn-secondary" onClick={askAdvice} disabled={busy}>
                  Заключение экономиста
                </button>
                <button className="btn" onClick={save} disabled={busy}>
                  {outputDir ? "Сохранить в Excel" : "Выбрать папку…"}
                </button>
              </div>
              {outputDir && <p className="fin-hint">Папка: {outputDir}</p>}
              {advice && <p className="fin-hint">Заключение готово — попадёт в книгу отдельным листом.</p>}
              {savedPath && <div className="fin-saved">Сохранено: {savedPath}</div>}
            </>
          ) : (
            <p className="muted">
              Заполните форму и нажмите «Рассчитать». Расчёт делается формулами, поэтому его видно
              целиком: книга сохраняется с живыми формулами, и в ней можно менять цену или объём.
            </p>
          )}
        </div>
      </div>

      {conv && (
        <div className="fin-agent">
          <div className="fin-agent-head">
            <strong>{mode === "advice" ? "Заключение экономиста" : "Допущения модели"}</strong>
            <button className="btn btn-secondary btn-small" onClick={() => setConv(null)}>
              Закрыть
            </button>
          </div>
          <ChatView
            conversation={conv}
            systemPrompt={systemPrompt}
            settings={settings}
            skills={skills}
            onUpdate={setConv}
            onSave={async () => {}}
            emptyHint={
              mode === "advice"
                ? "Напишите «дай заключение» — агент уже видит посчитанные числа."
                : "Напишите «собери допущения» — агент прочитает файлы и поищет официальные ставки."
            }
            onAssistantMessage={onAssistantMessage}
          />
        </div>
      )}
    </div>
  );
}
