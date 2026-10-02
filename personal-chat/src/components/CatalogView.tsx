import { useCallback, useEffect, useRef, useState } from "react";
import type {
  CatalogConfig,
  CatalogDescription,
  CatalogEdits,
  CatalogPageConfig,
  CatalogPagesPreview,
  CatalogSeries,
  CatalogTable as CatalogTableData,
} from "../lib/types";
import CatalogTable from "./CatalogTable";
import Splitter from "./Splitter";

/**
 * Каталог: пересборка выгрузки 1С в файл для магазина Тильды.
 *
 * Ручная работа, которую заменяет раздел, занимает часы после каждой выгрузки:
 * заголовки, категории, длинные описания по вариациям, SEO по каждой позиции.
 * Раздел устроен так, чтобы человек видел, ЧТО получится, до того как файл
 * уедет на сайт: сначала предпросмотр и замечания, потом сохранение.
 */

const CLADDINGS = [
  { id: "", name: "любая (общая заготовка на метраж)" },
  { id: "кирпич", name: "кирпич" },
  { id: "сайдинг", name: "сайдинг" },
  { id: "сайдинг-под-кирпич", name: "сайдинг «под кирпич»" },
  { id: "штукатурка-планкен", name: "штукатурка с планкеном" },
  { id: "профлист-планкен", name: "профлист с планкеном" },
  { id: "штукатурка", name: "штукатурка" },
  { id: "планкен", name: "планкен" },
];

function uid() {
  return "d" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

export default function CatalogView() {
  const [config, setConfig] = useState<CatalogConfig | null>(null);
  const [library, setLibrary] = useState<CatalogDescription[]>([]);
  const [preview, setPreview] = useState<CatalogTableData | null>(null);
  const [edits, setEdits] = useState<CatalogEdits>({});
  const [tab, setTab] = useState<"table" | "pages" | "setup">("setup");
  // Страницы домов собираются отдельной кнопкой: это сорок файлов по тридцать
  // килобайт, и делать это при каждой пересборке каталога незачем.
  const [pages, setPages] = useState<CatalogPagesPreview | null>(null);
  const [pagesSaved, setPagesSaved] = useState("");
  // Настройки поменялись, а таблица собрана по прежним: об этом надо сказать,
  // иначе человек выгрузит вчерашний каталог, будучи уверенным в обратном.
  const [stale, setStale] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  // Какие колонки-ключи не попали в файл: от этого зависит, что выбрать
  // «уникальной колонкой» в окне импорта магазина.
  const [dropped, setDropped] = useState<string[]>([]);

  useEffect(() => {
    window.api.catalogConfig().then(setConfig);
    window.api.catalogLibrary().then(setLibrary);
    window.api.catalogEdits().then(setEdits);
  }, []);

  /**
   * Пересборка каталога.
   *
   * Запускается ТОЛЬКО по кнопке и один раз при выборе выгрузки. Раньше она
   * висела на каждой правке настроек и библиотеки: одна набранная буква в имени
   * посёлка пересобирала все двести позиций, кнопки на это время гасли, а вид
   * перескакивал на вкладку с таблицей. Со стороны это выглядело так, будто
   * раздел не работает вовсе.
   */
  const running = useRef(false);
  const refresh = useCallback(async (showTable = true) => {
    if (running.current) return;
    running.current = true;
    setError("");
    setBusy(true);
    try {
      const table = await window.api.catalogTable();
      setPreview(table);
      if (showTable) setTab("table");
    } catch (e) {
      setPreview(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      running.current = false;
      setBusy(false);
    }
  }, []);

  /**
   * Настройка сохраняется сразу, а каталог — нет.
   *
   * Пересборка тут была бы не помощью, а помехой: человек ещё печатает.
   * Исключение одно — выбор самой выгрузки: без неё показывать нечего, и
   * первый разбор уместен сразу.
   */
  async function patch(changes: Partial<CatalogConfig>, rebuild = false) {
    const next = await window.api.catalogSaveConfig(changes);
    setConfig(next);
    setStale(true);
    if (rebuild && next.exportPath) void refresh();
  }

  async function patchLibrary(items: CatalogDescription[]) {
    setLibrary(items);
    setStale(true);
    await window.api.catalogSaveLibrary(items);
  }

  async function build() {
    if (stale) {
      setError("Настройки изменились после сборки — нажмите «Пересобрать», иначе выгрузится прежний каталог.");
      return;
    }
    setError("");
    setSaved("");
    setBusy(true);
    try {
      const result = await window.api.catalogBuild();
      setSaved(`${result.rows} позиций · ${result.csvFile} · ${result.xlsxFile}`);
      setDropped(result.dropped || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  /**
   * Серия вариации: один клик — и серию получают все дома этого метража с этой
   * облицовкой. В настоящей выгрузке домов шестьдесят шесть, а вариаций
   * тринадцать; проставить тринадцать раз человек может, шестьдесят шесть — нет.
   */
  async function setVariantSeries(variant: string, series: CatalogSeries) {
    if (!config) return;
    const next = { ...config.series };
    if (series) next[variant] = series;
    else delete next[variant];
    setConfig({ ...config, series: next });
    await window.api.catalogSaveConfig({ series: next });
    setStale(true);
  }

  /** Серия отдельному дому — поверх вариации. Исключения бывают. */
  async function setHouseSeries(cadastral: string, series: CatalogSeries) {
    if (!config) return;
    const next = { ...config.houseSeries };
    if (series) next[cadastral] = series;
    else delete next[cadastral];
    setConfig({ ...config, houseSeries: next });
    await window.api.catalogSaveConfig({ houseSeries: next });
    setStale(true);
  }

  /** Настройки страниц правятся по одному полю и сразу сохраняются. */
  async function setPage(patch: Partial<CatalogPageConfig>) {
    if (!config) return;
    const next = { ...config, pages: { ...config.pages, ...patch } };
    setConfig(next);
    await window.api.catalogSaveConfig({ pages: next.pages });
    // Собранные страницы собраны по прежним настройкам — показывать их дальше
    // значило бы показывать не то, что выгрузится.
    setPages(null);
  }

  async function previewPages() {
    setError("");
    setPagesSaved("");
    setBusy(true);
    try {
      setPages(await window.api.catalogPagesPreview({}));
      setTab("pages");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function buildPages() {
    setError("");
    setPagesSaved("");
    setBusy(true);
    try {
      const r = await window.api.catalogBuildPages();
      setPagesSaved(
        `${r.pages} страниц · ${r.dir}` +
          (r.tooLong ? ` · ${r.tooLong} не поместились в ячейку и лежат только файлами` : "") +
          (r.stylesFile ? " · общий стиль отдельным файлом" : "")
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const short = (p: string) => (p ? p.split(/[\\/]/).pop() : "не выбран");
  const fitsOf = (id: string) => preview?.library.find((l) => l.id === id)?.fits ?? 0;
  const errorOf = (id: string) => preview?.library.find((l) => l.id === id)?.error || "";

  /** Правка ячейки: сохраняется сразу и на диск, чтобы не потеряться. */
  async function editCell(sku: string, column: string, value: string) {
    const next: CatalogEdits = { ...edits, [sku]: { ...(edits[sku] || {}), [column]: value } };
    setEdits(next);
    setPreview((prev) =>
      prev ? { ...prev, rows: prev.rows.map((r) => (r.SKU === sku ? { ...r, [column]: value } : r)) } : prev
    );
    await window.api.catalogSaveEdits(next);
  }

  /**
   * Одно описание во все дома, у которых его нет.
   *
   * Это ручная правка, а не подбор: она помечается как правка и снимается тем
   * же способом. Участков не касается — им длинный текст не положен.
   */
  async function fillEmptyDescriptions(text: string) {
    if (!preview) return;
    const next: CatalogEdits = { ...edits };
    const touched: string[] = [];
    for (const row of preview.rows) {
      if (!row.Mark || row.Text) continue;
      next[row.SKU] = { ...(next[row.SKU] || {}), Text: text };
      touched.push(row.SKU);
    }
    if (!touched.length) return;
    setEdits(next);
    setPreview({
      ...preview,
      rows: preview.rows.map((r) => (touched.includes(r.SKU) ? { ...r, Text: text } : r)),
    });
    await window.api.catalogSaveEdits(next);
  }

  /** Вернуть собранное значение: правка снимается, ячейка пересобирается. */
  async function resetCell(sku: string, column: string) {
    const forRow = { ...(edits[sku] || {}) };
    delete forRow[column];
    const next: CatalogEdits = { ...edits };
    if (Object.keys(forRow).length) next[sku] = forRow;
    else delete next[sku];
    setEdits(next);
    await window.api.catalogSaveEdits(next);
    await refresh(false);
  }

  return (
    <div className="ops-view">
      <div className="ops-app">
        <div className="cat-tabs">
          <button className={tab === "setup" ? "vs-tab on" : "vs-tab"} onClick={() => setTab("setup")}>
            Настройка
          </button>
          <button
            className={tab === "table" ? "vs-tab on" : "vs-tab"}
            onClick={() => setTab("table")}
            disabled={!preview}
          >
            Таблица {preview ? `(${preview.rows.length})` : ""}
          </button>
          <button
            className={tab === "pages" ? "vs-tab on" : "vs-tab"}
            onClick={() => setTab("pages")}
            disabled={!preview}
          >
            Страницы домов {pages ? `(${pages.total})` : ""}
          </button>
          <div className="cat-tabs-actions">
            <button
              className={stale ? "btn btn-primary btn-small" : "btn btn-secondary btn-small"}
              disabled={busy || !config?.exportPath}
              onClick={async () => {
                await refresh();
                setStale(false);
              }}
            >
              {busy ? "Собираю…" : stale ? "Пересобрать (настройки изменились)" : "Пересобрать"}
            </button>
            <button className="btn btn-primary btn-small" disabled={busy || !preview} onClick={build}>
              Выгрузить в Excel и CSV
            </button>
          </div>
        </div>
        {error && <p className="vs-warn cat-bar-note">{error}</p>}
        {saved && (
          <div className="vs-saved cat-bar-note">
            Сохранено: {saved}
            {!!dropped.length && (
              <div className="cat-uniq">
                Каталог заливается заново, номеров позиций магазина ещё нет — колонки{" "}
                {dropped.map((d) => `«${d}»`).join(" и ")} в файл не попали. Так и нужно: если
                оставить их пустыми, магазин выберет пустую колонку уникальной и отклонит все
                позиции («Empty Uniq column: uid»). В окне импорта уникальной колонкой выберите{" "}
                <b>SKU</b> — там кадастровый номер, он заполнен у всех и не повторяется.
              </div>
            )}
          </div>
        )}

        {tab === "table" && preview && (
          <CatalogTable
            columns={preview.columns}
            rows={preview.rows}
            edits={edits}
            library={preview.library}
            onEdit={editCell}
            onReset={resetCell}
            onFillEmpty={fillEmptyDescriptions}
          />
        )}

        {tab === "pages" && config && (
          <div className="vs-body">
            <div className="vs-form">
              <p className="vs-lead">
                По каждому дому из каталога собирается готовая страница: тот же адрес, та же цена и те
                же фото, что на витрине, — расходиться им неоткуда. В код страницы вписана
                микроразметка: поисковик читает из неё дом, площадь, цену и наличие. Код вставляется в
                Тильду блоком «HTML-код» (T123).
              </p>

              <div className="vs-field">
                <label>Адрес сайта</label>
                <input
                  className="input"
                  placeholder="https://example.ru"
                  value={config.pages.site}
                  onChange={(e) => setPage({ site: e.target.value })}
                />
                <p className="hint">
                  Нужен для ссылок и хлебных крошек в разметке. Пустой — разметка соберётся без них;
                  выдумывать адрес приложение не станет.
                </p>
              </div>

              <div className="vs-field">
                <label>Правило адреса страницы дома</label>
                <input
                  className="input"
                  placeholder="https://example.ru/house/{id}"
                  value={config.pages.pageUrl}
                  onChange={(e) => setPage({ pageUrl: e.target.value })}
                />
                <p className="hint">
                  {"{id}"} — External ID позиции, {"{sku}"} — кадастровый номер. По этому правилу в
                  разметке появится ссылка на саму страницу.
                </p>
              </div>

              <div className="vs-field">
                <label>Название компании</label>
                <input
                  className="input"
                  value={config.pages.organization}
                  onChange={(e) => setPage({ organization: e.target.value })}
                />
              </div>

              <div className="vs-row">
                <div className="vs-field">
                  <label>Телефон</label>
                  <input
                    className="input"
                    value={config.pages.phone}
                    onChange={(e) => setPage({ phone: e.target.value })}
                  />
                </div>
                <div className="vs-field">
                  <label>Регион</label>
                  <input
                    className="input"
                    placeholder="Пермский край"
                    value={config.pages.region}
                    onChange={(e) => setPage({ region: e.target.value })}
                  />
                </div>
              </div>

              <div className="vs-row">
                <div className="vs-field">
                  <label>Попап записи в Тильде</label>
                  <input
                    className="input"
                    value={config.pages.bookingPopup}
                    onChange={(e) => setPage({ bookingPopup: e.target.value })}
                  />
                  <p className="hint">
                    Кнопки «Записаться на просмотр» открывают этот попап. Заведите в его форме скрытое
                    поле <b>house</b> — туда подставится адрес дома, и будет видно, по какому дому заявка.
                  </p>
                </div>
                <div className="vs-field">
                  <label>Карта посёлка</label>
                  <input
                    className="input"
                    placeholder="https://…"
                    value={config.pages.mapSrc}
                    onChange={(e) => setPage({ mapSrc: e.target.value })}
                  />
                </div>
              </div>

              <div className="vs-row">
                <div className="vs-field">
                  <label>Ставка ипотеки, %</label>
                  <input
                    className="input"
                    type="number"
                    step="0.1"
                    value={config.pages.mortgage.rate}
                    onChange={(e) => setPage({ mortgage: { ...config.pages.mortgage, rate: Number(e.target.value) } })}
                  />
                </div>
                <div className="vs-field">
                  <label>Срок, лет</label>
                  <input
                    className="input"
                    type="number"
                    value={config.pages.mortgage.termYears}
                    onChange={(e) =>
                      setPage({ mortgage: { ...config.pages.mortgage, termYears: Number(e.target.value) } })
                    }
                  />
                </div>
                <div className="vs-field">
                  <label>Первый взнос, %</label>
                  <input
                    className="input"
                    type="number"
                    value={config.pages.mortgage.downPercent}
                    onChange={(e) =>
                      setPage({ mortgage: { ...config.pages.mortgage, downPercent: Number(e.target.value) } })
                    }
                  />
                </div>
              </div>

              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={config.pages.sharedStyles}
                  onChange={(e) => setPage({ sharedStyles: e.target.checked })}
                />
                Общий стиль отдельным файлом
              </label>
              <p className="hint">
                Восемнадцать килобайт стиля одинаковы у всех домов. Отдельным файлом их вставляют в
                Тильде один раз — «Настройки сайта → Ещё → HTML-код внутрь HEAD», — и тогда код дома
                помещается в ячейку таблицы. Без галочки каждая страница самостоятельна, но длиннее
                ячейки Excel.
              </p>

              <div className="folder-row">
                <button className="btn btn-secondary" disabled={busy || !preview} onClick={previewPages}>
                  {busy ? "Собираю…" : "Собрать и посмотреть"}
                </button>
                <button className="btn btn-primary" disabled={busy || !pages} onClick={buildPages}>
                  Выгрузить страницы и таблицу
                </button>
              </div>

              {pagesSaved && <div className="vs-saved">Сохранено: {pagesSaved}</div>}

              {pages && (
                <>
                  {!!pages.problems.length && (
                    <div className="cat-uniq">
                      {pages.problems.map((p, i) => (
                        <p key={i}>{p}</p>
                      ))}
                    </div>
                  )}

                  <div className="direct-table-wrap">
                    <table className="direct-table">
                      <thead>
                        <tr>
                          <th>Адрес</th>
                          <th>Кадастровый</th>
                          <th>Файл</th>
                          <th>Размер кода</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pages.list.map((p) => (
                          <tr key={p.cadastral || p.file}>
                            <td>{p.address}</td>
                            <td>{p.cadastral}</td>
                            <td>{p.file}</td>
                            <td className="num" title={p.fits ? "" : "Длиннее ячейки Excel — только файлом"}>
                              {(p.bytes / 1024).toFixed(1)} КБ{p.fits ? "" : " ⚠"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {pages.sample && (
                    <div className="vs-field">
                      <label>Как выглядит страница: {pages.sample.address}</label>
                      <iframe
                        className="cat-page-preview"
                        title={`Страница дома: ${pages.sample.address}`}
                        sandbox=""
                        srcDoc={pages.sample.html}
                      />
                      <div className="folder-row">
                        <button
                          className="btn btn-secondary btn-small"
                          onClick={() => {
                            navigator.clipboard.writeText(pages.sample?.html || "");
                            setPagesSaved("Код страницы скопирован — вставьте его в блок «HTML-код» Тильды.");
                          }}
                        >
                          Скопировать код этой страницы
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        <div className="vs-body" hidden={tab !== "setup"}>
          <div className="vs-form">
            <p className="vs-lead">
              Выгрузка из 1С пересобирается в файл для магазина: заголовки, категории, описания по
              вариациям, фото и SEO по каждой позиции. Готовые дома идут первыми.
            </p>

            <section className="vs-block">
              <h3>Файлы</h3>
              <div className="vs-row">
                <button
                  className="btn btn-secondary btn-small"
                  onClick={async () => {
                    const f = await window.api.catalogPick("export");
                    if (f) await patch({ exportPath: f }, true);
                  }}
                >
                  Выгрузка из 1С
                </button>
                <span className="vs-path" title={config?.exportPath}>
                  {short(config?.exportPath || "")}
                </span>
              </div>
              <div className="vs-row">
                <button
                  className="btn btn-secondary btn-small"
                  onClick={async () => {
                    const f = await window.api.catalogPick("previous");
                    if (f) await patch({ previousPath: f }, true);
                  }}
                >
                  Прошлый каталог
                </button>
                <span className="vs-path" title={config?.previousPath}>
                  {short(config?.previousPath || "")}
                </span>
              </div>
              <p className="vs-hint">
                Прошлый файл каталога нужен не для красоты: из него берутся номера позиций магазина.
                Без них магазин заведёт вторые экземпляры вместо обновления, и каталог удвоится.
                Оттуда же берётся, как посёлки названы на витрине.
              </p>
              <div className="vs-row">
                <button
                  className="btn btn-secondary btn-small"
                  onClick={async () => {
                    const d = await window.api.catalogPick("outputDir");
                    if (d) await patch({ outputDir: d });
                  }}
                >
                  Куда сохранить
                </button>
                <span className="vs-path" title={config?.outputDir}>
                  {config?.outputDir || "не выбрана"}
                </span>
              </div>
              <label className="vs-check">
                <input
                  type="checkbox"
                  checked={config?.photoMode === "all"}
                  onChange={(e) => patch({ photoMode: e.target.checked ? "all" : "first" })}
                />
                Все фото из выгрузки, а не только первое
              </label>
              <label className="vs-check">
                <input
                  type="checkbox"
                  checked={(config?.photoSource || "tilda") === "tilda"}
                  onChange={(e) => patch({ photoSource: e.target.checked ? "tilda" : "export" })}
                />
                Фото из прошлого каталога, если позиция нашлась по кадастровому номеру
              </label>
              <p className="vs-hint">
                {(config?.photoSource || "tilda") === "tilda"
                  ? "Снимки из прошлого каталога уже загружены в магазин и заведомо открываются на витрине. Ссылки из 1С ведут на сторонний сайт — они могут работать, а могут и нет, и проверить это отсюда нечем. Где совпадения нет, берутся фото из 1С, а затем рендеры заготовки."
                  : "Первыми идут фото из 1С. Из прошлого каталога снимок берётся только там, где в выгрузке его нет."}
                {preview
                  ? ` Сейчас перенесено из прошлого каталога: ${preview.counts.photosCarried} позиц.`
                  : ""}
              </p>
              <label className="vs-check">
                <input
                  type="checkbox"
                  checked={!!config?.carryIds}
                  onChange={(e) => patch({ carryIds: e.target.checked })}
                />
                Обновляю каталог на сайте, а не заливаю заново
              </label>
              <p className="vs-hint">
                {config?.carryIds
                  ? "Номера позиций из прошлого файла переносятся — магазин обновит существующие товары."
                  : "Номера позиций не переносятся: каталог на сайте удаляется и заливается заново, старые номера указывали бы на удалённые товары."}
              </p>
            </section>

            <section className="vs-block">
              <h3>Соответствие посёлков</h3>
              <p className="vs-hint">
                В 1С и на витрине посёлки называются по-разному. Взято из прошлого каталога, можно
                поправить.
              </p>
              {preview &&
                Object.entries(preview.villages).map(([from, to]) => (
                  <div key={from} className="vs-row cat-village">
                    <span>{from}</span>
                    <span className="cat-arrow">→</span>
                    <input
                      value={to}
                      onChange={(e) =>
                        patch({ villages: { ...(config?.villages || {}), [from]: e.target.value } })
                      }
                    />
                  </div>
                ))}
              {!preview && <p className="vs-hint">Выберите выгрузку — соответствие подтянется само.</p>}
            </section>

            <section className="vs-block">
              <h3>Септик по посёлкам</h3>
              <p className="vs-hint">
                Заготовка описания одна на вариацию дома, а септик в посёлках разный — в общем
                тексте он превращается в отговорку «по посёлку». Здесь тип задаётся посёлку, и при
                сборке подменяет пункт «Канализация» в описании. Пункт ищется по заголовку, а не по
                слову: упоминание канализационного выхода в планировке не пострадает.
              </p>
              {preview &&
                Object.keys(preview.villages).map((from) => (
                  <div key={from} className="vs-row cat-village">
                    <span>{from}</span>
                    <span className="cat-arrow">→</span>
                    <input
                      value={config?.septics?.[from] || ""}
                      placeholder="например: станция биологической очистки «Топас-5»"
                      onChange={(e) =>
                        patch({ septics: { ...(config?.septics || {}), [from]: e.target.value } })
                      }
                    />
                  </div>
                ))}
              {!preview && <p className="vs-hint">Выберите выгрузку — список посёлков подтянется сам.</p>}
            </section>

            <section className="vs-block">
              <h3>Кварталы: имя по улице</h3>
              <p className="vs-hint">
                Если в одном посёлке 1С несколько кварталов с разными названиями на сайте — правило
                на улицу важнее правила на посёлок. Без этого весь посёлок уедет под одним именем.
              </p>
              {(config?.streetNames || []).map((rule, i) => (
                <div key={i} className="vs-row cat-village">
                  <select
                    value={rule.village}
                    onChange={(e) => {
                      const next = [...(config?.streetNames || [])];
                      next[i] = { ...rule, village: e.target.value, street: "" };
                      patch({ streetNames: next });
                    }}
                  >
                    <option value="">посёлок…</option>
                    {Object.keys(preview?.streets || {}).map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                  <select
                    value={rule.street}
                    onChange={(e) => {
                      const next = [...(config?.streetNames || [])];
                      next[i] = { ...rule, street: e.target.value };
                      patch({ streetNames: next });
                    }}
                  >
                    <option value="">улица…</option>
                    {(preview?.streets?.[rule.village] || []).map((st) => (
                      <option key={st} value={st}>
                        {st}
                      </option>
                    ))}
                  </select>
                  <span className="cat-arrow">→</span>
                  <input
                    value={rule.name}
                    placeholder="имя на витрине"
                    onChange={(e) => {
                      const next = [...(config?.streetNames || [])];
                      next[i] = { ...rule, name: e.target.value };
                      patch({ streetNames: next });
                    }}
                  />
                  <button
                    onClick={() => patch({ streetNames: (config?.streetNames || []).filter((_, n) => n !== i) })}
                  >
                    ✕
                  </button>
                </div>
              ))}
              <button
                className="btn btn-secondary btn-small"
                onClick={() => patch({ streetNames: [...(config?.streetNames || []), { village: "", street: "", name: "" }] })}
              >
                + Правило по улице
              </button>
            </section>

            <section className="vs-block">
              <h3>Библиотека описаний</h3>
              <p className="vs-hint">
                Заготовка описывает <b>вариацию</b>, а не отдельный дом: «дом 100 м² с облицовкой
                кирпич». Облицовку приложение берёт из выгрузки 1С и подставляет описание само.
                Одна заготовка обслуживает все такие дома. Текст читается из файла при каждой
                сборке — поправите файл, и правка сама попадёт в следующий каталог; разбивка на
                абзацы сохраняется. Оставьте метраж пустым, чтобы заготовка подошла к любому
                метражу с этой облицовкой.
              </p>
              {library.map((item) => (
                <div key={item.id} className="cat-card">
                  <div className="vs-row">
                    <label className="vs-field">
                      Площадь, м²
                      <input
                        type="number"
                        value={item.area || ""}
                        onChange={(e) =>
                          patchLibrary(
                            library.map((x) => (x.id === item.id ? { ...x, area: Number(e.target.value) } : x))
                          )
                        }
                      />
                    </label>
                    <label className="vs-field">
                      Облицовка
                      <select
                        value={item.cladding}
                        onChange={(e) =>
                          patchLibrary(
                            library.map((x) => (x.id === item.id ? { ...x, cladding: e.target.value } : x))
                          )
                        }
                      >
                        {CLADDINGS.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      className="link-btn"
                      onClick={() => patchLibrary(library.filter((x) => x.id !== item.id))}
                    >
                      удалить
                    </button>
                  </div>
                  <div className="vs-row">
                    <button
                      className="btn btn-secondary btn-small"
                      onClick={async () => {
                        const f = await window.api.catalogPick("text");
                        if (f) patchLibrary(library.map((x) => (x.id === item.id ? { ...x, textPath: f } : x)));
                      }}
                    >
                      Файл описания
                    </button>
                    <span className="vs-path" title={item.textPath}>
                      {short(item.textPath)}
                    </span>
                  </div>
                  <div className="vs-row">
                    <button
                      className="btn btn-secondary btn-small"
                      onClick={async () => {
                        const f = await window.api.catalogPick("render");
                        if (f)
                          patchLibrary(
                            library.map((x) =>
                              x.id === item.id ? { ...x, renderPaths: [...(x.renderPaths || []), f] } : x
                            )
                          );
                      }}
                    >
                      + Рендер с компьютера
                    </button>
                    <span className="vs-path">
                      {item.renderPaths?.length ? `${item.renderPaths.length} файл(ов)` : "нет"}
                    </span>
                    {!!item.renderPaths?.length && (
                      <button
                        className="link-btn"
                        onClick={() => patchLibrary(library.map((x) => (x.id === item.id ? { ...x, renderPaths: [] } : x)))}
                      >
                        очистить
                      </button>
                    )}
                  </div>
                  {!!item.renderPaths?.length && (
                    <p className="vs-hint cat-render-note">
                      Эти файлы <b>в каталог не попадут</b>: магазин забирает картинки по адресу, а путь с
                      компьютера превратится на сайте в пустое место. Загрузите их в магазин и вставьте
                      полученные адреса ниже — пути здесь остаются напоминанием, что именно грузить.
                    </p>
                  )}
                  {preview && (
                    <p className={fitsOf(item.id) ? "vs-hint" : "vs-warn"}>
                      {fitsOf(item.id)
                        ? `Подходит к ${fitsOf(item.id)} домам в выгрузке.`
                        : "Ни к одному дому не подошла — проверьте метраж и облицовку."}
                      {errorOf(item.id) ? ` ${errorOf(item.id)}` : ""}
                    </p>
                  )}
                  <label className="vs-field">
                    Ссылки на рендеры — по одной в строке
                    <textarea
                      rows={2}
                      value={item.renderUrls.join("\n")}
                      placeholder="https://static.tildacdn.com/…"
                      onChange={(e) =>
                        patchLibrary(
                          library.map((x) =>
                            x.id === item.id
                              ? { ...x, renderUrls: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean) }
                              : x
                          )
                        )
                      }
                    />
                  </label>
                </div>
              ))}
              {preview && !!preview.variants.length && (
                <div className="cat-series">
                  <strong>Серии домов</strong>
                  <p className="vs-hint">
                    В выгрузке из 1С серии нет — это название линейки на витрине, а не учётное поле.
                    Отметьте серию у вариации, и её получат все дома этого метража с этой облицовкой.
                    Тогда в категории товара вместо «дом 85 м2» встанет «Классик 85», рядом появится
                    отдельная категория «Серия», и серия войдёт в SEO-заголовок. Без отметки всё
                    остаётся как было.
                  </p>
                  {preview.variants.map((v) => {
                    const ключ = `${v.area}|${v.cladding}`;
                    const текущая = config?.series[ключ] ?? "";
                    return (
                      <div key={ключ} className="cat-series-row">
                        <span className="cat-series-name">
                          <b>{v.count}</b> {v.area ? `${v.area} м²` : "метраж не указан"} ·{" "}
                          {v.claddingLabel || "облицовка не указана"}
                        </span>
                        <span className="cat-series-pick">
                          {[
                            { id: "", name: "не задана" },
                            { id: "классик", name: "Классик" },
                            { id: "смарт", name: "Смарт" },
                          ].map((вариант) => (
                            <button
                              key={вариант.id || "нет"}
                              className={текущая === вариант.id ? "chip active" : "chip"}
                              onClick={() => setVariantSeries(ключ, вариант.id as CatalogSeries)}
                            >
                              {вариант.name}
                            </button>
                          ))}
                        </span>
                      </div>
                    );
                  })}

                  {!!preview.houses.length && (
                    <details className="cat-series-houses">
                      <summary>Отдельные дома ({preview.houses.filter((h) => !h.series).length} без серии)</summary>
                      <p className="vs-hint">
                        Здесь серия ставится конкретному дому и перекрывает серию вариации. Нужно
                        только для исключений: если весь метраж одной серии, проще отметить вариацию выше.
                      </p>
                      {preview.houses.map((h) => (
                        <div key={h.cadastral} className="cat-series-row">
                          <span className="cat-series-name">
                            {h.title || h.cadastral}
                            <span className="vs-hint">
                              {" "}
                              {h.area ? `${h.area} м²` : "метраж не указан"}
                              {h.ownSeries ? " · отмечен лично" : h.series ? " · по вариации" : " · серии нет"}
                            </span>
                          </span>
                          <span className="cat-series-pick">
                            {[
                              { id: "", name: "по вариации" },
                              { id: "классик", name: "Классик" },
                              { id: "смарт", name: "Смарт" },
                            ].map((вариант) => (
                              <button
                                key={вариант.id || "нет"}
                                className={h.ownSeries === вариант.id ? "chip active" : "chip"}
                                onClick={() => setHouseSeries(h.cadastral, вариант.id as CatalogSeries)}
                              >
                                {вариант.name}
                              </button>
                            ))}
                          </span>
                        </div>
                      ))}
                    </details>
                  )}
                </div>
              )}

              {preview && !!preview.variants.length && (
                <div className="cat-variants">
                  <strong>Что есть в выгрузке</strong>
                  <p className="vs-hint">Нажмите, чтобы завести заготовку под эту вариацию.</p>
                  {preview.variants.map((v) => (
                    <button
                      key={`${v.area}|${v.cladding}`}
                      className="cat-variant"
                      disabled={!v.area || !v.cladding}
                      title={!v.area || !v.cladding ? "В выгрузке не хватает данных — заготовку не подобрать" : ""}
                      onClick={() =>
                        patchLibrary([
                          ...library,
                          {
                            id: uid(), name: "", area: v.area, cladding: v.cladding,
                            textPath: "", renderUrls: [], renderPaths: [],
                          },
                        ])
                      }
                    >
                      <b>{v.count}</b> {v.area ? `${v.area} м²` : "метраж не указан"} ·{" "}
                      {v.claddingLabel || "облицовка не указана"}
                      {library.some((l) => l.area === v.area && l.cladding === v.cladding) ? " ✓" : ""}
                    </button>
                  ))}
                </div>
              )}
              <button
                className="btn btn-secondary btn-small"
                onClick={() =>
                  patchLibrary([
                    ...library,
                    { id: uid(), name: "", area: 100, cladding: "кирпич", textPath: "", renderUrls: [], renderPaths: [] },
                  ])
                }
              >
                + Новое описание
              </button>
              <p className="vs-hint">
                Рендеры указываются <b>ссылками</b>, а не файлами с компьютера: магазин забирает
                картинки по адресу, и локальный путь на сайте превратится в пустое место. Загрузите
                рендеры на сайт один раз и вставьте сюда полученные адреса.
              </p>
            </section>
          </div>

          <Splitter
            id="каталог-агент"
            variable="--vs-right-width"
            fallback={340}
            min={240}
            max={760}
            side="right"
            label="Граница окна агента"
          />
          <div className="vs-right vs-right-agent">
            <section className="vs-block">
              <h3>Что получится</h3>
              {preview ? (
                <>
                  <p className="vs-hint">
                    Позиций: <b>{preview.rows.length}</b> — домов {preview.counts.houses}, участков{" "}
                    {preview.counts.plots}.
                  </p>
                  <p className="vs-hint">
                    Описание подставлено из библиотеки у <b>{preview.counts.described}</b> домов из{" "}
                    {preview.counts.houses}. Облицовка берётся из выгрузки 1С; где подходящей
                    заготовки нет, описание остаётся пустым — чужой текст туда не ставится.
                  </p>
                  <p className="vs-hint">
                    Правок вручную: <b>{Object.values(edits).reduce((n, row) => n + Object.keys(row).length, 0)}</b>.
                    Они переживают пересборку: привязаны к кадастровому номеру, а не к номеру строки.
                  </p>
                </>
              ) : (
                <p className="vs-hint">Выберите выгрузку и нажмите «Пересобрать».</p>
              )}
            </section>

            {preview && preview.problems.length > 0 && (
              <section className="vs-block cat-problems">
                <h3>Замечания ({preview.problems.length})</h3>
                <p className="vs-hint">
                  Файл соберётся и с ними — но лучше знать заранее, чем увидеть на витрине.
                </p>
                <ul className="doc-list">
                  {preview.problems.map((p, i) => (
                    <li key={i}>{p}</li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
