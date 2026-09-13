import { useCallback, useEffect, useRef, useState } from "react";
import type { Site, SiteBlock, SiteFile, SitesConfig, SiteSummary } from "../lib/types";
import Splitter from "./Splitter";

/**
 * Сайты: сборка лендинга или многостраничника из материалов на компьютере.
 *
 * Устройство раздела подчинено одному обстоятельству: API Тильды работает
 * только на чтение. Значит, готовый сайт всё равно переносит человек, и раздел
 * обязан сделать перенос удобным — блок за блоком, с готовым к вставке кодом и
 * предупреждениями о том, что на Тильде поведёт себя не так, как в просмотре.
 */

const SOURCE_FIELDS = [
  { id: "text", label: "Текст и материалы", hint: "О чём сайт: тексты, брифы, прайсы" },
  { id: "images", label: "Изображения", hint: "Фотографии и картинки" },
  { id: "references", label: "Референсы", hint: "Скриншоты и примеры того, как должно выглядеть" },
  { id: "design", label: "Дизайн-система", hint: "Цвета, шрифты, компоненты — Figma, Pixso, Claude Design" },
  { id: "logos", label: "Логотипы", hint: "Варианты под разные фоны" },
] as const;

export default function SitesView() {
  const [config, setConfig] = useState<SitesConfig | null>(null);
  const [scan, setScan] = useState<{ files: Record<string, SiteFile[]>; problems: string[] } | null>(null);
  const [list, setList] = useState<SiteSummary[]>([]);
  const [site, setSite] = useState<Site | null>(null);
  const [openBlock, setOpenBlock] = useState<string | null>(null);
  const [tab, setTab] = useState<"setup" | "site">("setup");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [copied, setCopied] = useState("");

  const [brief, setBrief] = useState({ title: "", kind: "лендинг", goal: "", audience: "", extra: "", maxImages: 6 });

  useEffect(() => {
    window.api.sitesConfig().then(setConfig);
    window.api.sitesList().then(setList);
  }, []);

  const refreshScan = useCallback(async () => {
    try {
      setScan(await window.api.sitesScan());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    if (config && Object.values(config.sources || {}).some(Boolean)) void refreshScan();
  }, [config, refreshScan]);

  async function patch(changes: Partial<SitesConfig>) {
    setConfig(await window.api.sitesSaveConfig(changes));
  }

  async function pick(kind: string, label: string) {
    const dir = await window.api.sitesPickFolder(`Папка: ${label}`);
    if (!dir) return;
    await patch({ sources: { ...(config?.sources || {}), [kind]: dir } });
  }

  /** Сборка сайта. Долгая — поэтому кнопка гаснет и говорит, что идёт работа. */
  const running = useRef(false);
  async function generate() {
    if (running.current) return;
    running.current = true;
    setError("");
    setSaved("");
    setBusy(true);
    try {
      const made = await window.api.sitesGenerate({
        ...brief,
        title: brief.title || "Новый сайт",
      });
      setSite(made);
      setTab("site");
      setList(await window.api.sitesList());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  async function open(id: string) {
    const loaded = await window.api.sitesGet(id);
    if (loaded) {
      setSite(loaded);
      setTab("site");
    }
  }

  async function copyBlock(block: SiteBlock) {
    const html = await window.api.sitesBlockHtml(block);
    await navigator.clipboard.writeText(html);
    setCopied(block.id);
    setTimeout(() => setCopied(""), 1500);
  }

  async function exportSite() {
    if (!site) return;
    setError("");
    setBusy(true);
    try {
      const result = await window.api.sitesExport(site);
      setSaved(`${result.blocks.length} блоков · ${result.previewFile}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const short = (p: string) => (p ? p.split(/[\\/]/).pop() : "не выбрана");
  const count = (kind: string) => scan?.files?.[kind]?.length ?? 0;
  const openedBlock = site?.blocks.find((b) => b.id === openBlock) || null;

  return (
    <div className="ops-view">
      <div className="ops-app">
        <div className="cat-tabs">
          <button className={tab === "setup" ? "vs-tab on" : "vs-tab"} onClick={() => setTab("setup")}>
            Материалы и задание
          </button>
          <button className={tab === "site" ? "vs-tab on" : "vs-tab"} onClick={() => setTab("site")} disabled={!site}>
            Сайт {site ? `(${site.blocks.length})` : ""}
          </button>
          <div className="cat-tabs-actions">
            <button className="btn btn-primary btn-small" disabled={busy} onClick={generate}>
              {busy ? "Собираю…" : "Собрать сайт"}
            </button>
            <button className="btn btn-secondary btn-small" disabled={busy || !site} onClick={exportSite}>
              Выгрузить в папку
            </button>
          </div>
        </div>
        {error && <p className="vs-warn cat-bar-note">{error}</p>}
        {saved && <div className="vs-saved cat-bar-note">Сохранено: {saved}</div>}

        <div className="vs-body" hidden={tab !== "setup"}>
          <div className="vs-form">
            <p className="vs-lead">
              Покажите папки с материалами, опишите задачу — агент разберёт материалы, составит план,
              напишет тексты и соберёт сайт блоками, готовыми к переносу в Тильду.
            </p>

            <section className="vs-block">
              <h3>Материалы</h3>
              {SOURCE_FIELDS.map((f) => (
                <div key={f.id} className="vs-row cat-village">
                  <button className="btn btn-secondary btn-small" onClick={() => pick(f.id, f.label)}>
                    {f.label}
                  </button>
                  <span className="vs-path" title={config?.sources?.[f.id] || ""}>
                    {short(config?.sources?.[f.id] || "")}
                  </span>
                  {count(f.id) > 0 && <span className="hint">{count(f.id)} файл(ов)</span>}
                </div>
              ))}
              <p className="vs-hint">{SOURCE_FIELDS.map((f) => f.hint).join(" · ")}</p>
              {!!scan?.problems?.length && (
                <ul className="vs-warn">
                  {scan.problems.map((p, i) => (
                    <li key={i}>{p}</li>
                  ))}
                </ul>
              )}
              <p className="vs-hint">
                Текстовые материалы агент читает целиком. <b>Референсы, логотипы и образцы дизайн-системы
                он видит</b> — они уходят картинками, и приёмы берутся с них. Нужна модель, которая
                понимает изображения; если выбранная не понимает, запрос вернётся ошибкой.
              </p>
              <label className="vs-field">
                Сколько картинок показать агенту: {brief.maxImages}
                <input
                  type="range"
                  min={0}
                  max={12}
                  value={brief.maxImages}
                  onChange={(e) => setBrief({ ...brief, maxImages: Number(e.target.value) })}
                />
              </label>
              <p className="vs-hint">
                Каждая картинка — это примерно тысяча токенов. Референсы идут первыми, потом логотипы,
                потом образцы дизайн-системы. Фотографии для самих страниц сюда не входят: их подставляет
                сток.
              </p>
            </section>

            <section className="vs-block">
              <h3>Задание</h3>
              <label className="vs-field">
                Название
                <input value={brief.title} onChange={(e) => setBrief({ ...brief, title: e.target.value })} placeholder="Как назвать сайт" />
              </label>
              <label className="vs-field">
                Тип
                <select value={brief.kind} onChange={(e) => setBrief({ ...brief, kind: e.target.value })}>
                  <option value="лендинг">Лендинг — одна страница</option>
                  <option value="многостраничник">Многостраничник</option>
                </select>
              </label>
              <label className="vs-field">
                Целевое действие
                <input
                  value={brief.goal}
                  onChange={(e) => setBrief({ ...brief, goal: e.target.value })}
                  placeholder="Например: оставить заявку на просмотр дома"
                />
              </label>
              <label className="vs-field">
                Аудитория
                <input
                  value={brief.audience}
                  onChange={(e) => setBrief({ ...brief, audience: e.target.value })}
                  placeholder="Кто приходит на сайт и с каким вопросом"
                />
              </label>
              <label className="vs-field">
                Пожелания
                <textarea
                  rows={3}
                  value={brief.extra}
                  onChange={(e) => setBrief({ ...brief, extra: e.target.value })}
                  placeholder="Тон, обязательные экраны, чего точно не должно быть"
                />
              </label>
            </section>


            <section className="vs-block">
              <h3>Куда выгружать</h3>
              <div className="vs-row">
                <button
                  className="btn btn-secondary btn-small"
                  onClick={async () => {
                    const dir = await window.api.sitesPickFolder("Куда выгружать сайты");
                    if (dir) await patch({ outputDir: dir });
                  }}
                >
                  Папка выгрузки
                </button>
                <span className="vs-path" title={config?.outputDir}>
                  {short(config?.outputDir || "")}
                </span>
              </div>
            </section>

            {!!list.length && (
              <section className="vs-block">
                <h3>Собранные сайты</h3>
                {list.map((s) => (
                  <div key={s.id} className="vs-row cat-village">
                    <button className="link-btn" onClick={() => open(s.id)}>
                      {s.title}
                    </button>
                    <span className="hint">
                      {s.kind} · {s.blocks} блоков
                    </span>
                  </div>
                ))}
              </section>
            )}
          </div>
        </div>

        {tab === "site" && site && (
          <div className="vs-body site-body">
            <div className="vs-form site-list">
              {!!site.problems?.length && (
                <section className="vs-block">
                  <h3>Замечания</h3>
                  <ul className="vs-warn">
                    {site.problems.map((p, i) => (
                      <li key={i}>{p}</li>
                    ))}
                  </ul>
                </section>
              )}

              {site.plan && (
                <section className="vs-block">
                  <h3>План</h3>
                  <pre className="site-plan">{site.plan}</pre>
                </section>
              )}

              <section className="vs-block">
                <h3>Блоки</h3>
                <p className="vs-hint">
                  Каждый блок вставляется в блок «HTML-код» (T123) на странице Тильды. Стили уже
                  ограничены самим блоком — соседние блоки страницы он не тронет.
                </p>
                {site.blocks.map((b) => (
                  <div key={b.id} className={openBlock === b.id ? "site-block on" : "site-block"}>
                    <div className="site-block-head">
                      <button className="link-btn" onClick={() => setOpenBlock(openBlock === b.id ? null : b.id)}>
                        {b.title}
                      </button>
                      <span className="hint">{b.page}</span>
                      <button className="btn btn-secondary btn-small" onClick={() => copyBlock(b)}>
                        {copied === b.id ? "Скопировано" : "Скопировать код"}
                      </button>
                    </div>
                    {b.purpose && <p className="vs-hint">{b.purpose}</p>}
                  </div>
                ))}
              </section>

              {!!site.forms.length && (
                <section className="vs-block">
                  <h3>Формы</h3>
                  <p className="vs-hint">
                    Формы свёрстаны и оформлены — это часть прототипа. Но заявки они пока не отправляют:
                    приём в Тильде работает через её собственные блоки формы. В коде рядом с каждой формой
                    стоит пометка <b>ТИЛЬДА-ФОРМА</b> — по ней ИИ Тильды переподключит форму, сохранив вид.
                  </p>
                  {site.forms.map((f) => (
                    <pre key={f.id} className="site-plan">
                      {f.spec}
                    </pre>
                  ))}
                </section>
              )}

              {!!site.shownImages?.length && (
                <section className="vs-block">
                  <h3>Что агент видел</h3>
                  <p className="vs-hint">
                    {site.shownImages.map((im) => `${im.role}: ${im.name}`).join(" · ")}
                  </p>
                </section>
              )}

              {!!site.tokens?.vars?.length && (
                <section className="vs-block">
                  <h3>Дизайн-система</h3>
                  <p className="vs-hint">
                    Из материалов взято {site.tokens.vars.length} переменных
                    {site.tokens.colours.length ? `, ${site.tokens.colours.length} цветов` : ""}
                    {site.tokens.fonts.length ? `, шрифты: ${site.tokens.fonts.join(" · ")}` : ""}. Агенту
                    они заданы как обязательные, а не как пожелание.
                  </p>
                </section>
              )}

              {!!site.photos?.length && (
                <section className="vs-block">
                  <h3>Фотографии со стока</h3>
                  <p className="vs-hint">
                    Подставлены вместо меток, чтобы прототип можно было оценить. В Тильде замените их
                    своими — адреса видны в коде блока.
                  </p>
                  <div className="site-photos">
                    {site.photos.map((ph) => (
                      <a key={ph.url} href={ph.page} target="_blank" rel="noreferrer" title={`${ph.query} · ${ph.author}`}>
                        <img src={ph.thumb} alt={ph.query} />
                      </a>
                    ))}
                  </div>
                </section>
              )}

              {!!site.notes.length && (
                <section className="vs-block">
                  <h3>Что уточнить</h3>
                  <ul className="vs-hint">
                    {site.notes.map((n, i) => (
                      <li key={i}>{n}</li>
                    ))}
                  </ul>
                </section>
              )}
            </div>

            <Splitter
              id="сайты-просмотр"
              variable="--site-left-width"
              fallback={380}
              min={240}
              max={760}
              side="left"
              label="Граница списка блоков"
            />

            <div className="vs-right site-stage">
              <h3>Просмотр</h3>
              {openedBlock ? (
                <BlockPreview block={openedBlock} />
              ) : (
                <p className="vs-hint">Нажмите на название блока, чтобы посмотреть его и код.</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Просмотр блока в отдельном окне документа.
 *
 * Именно в iframe, а не вставкой в страницу: блок несёт свои стили и скрипт, и
 * вставленный в интерфейс приложения он будет драться с его оформлением —
 * увиденное перестанет соответствовать тому, что окажется на сайте.
 */
function BlockPreview({ block }: { block: SiteBlock }) {
  const [html, setHtml] = useState("");
  const [mode, setMode] = useState<"view" | "code">("view");

  useEffect(() => {
    let alive = true;
    window.api.sitesBlockHtml(block).then((h) => {
      if (alive) setHtml(h);
    });
    return () => {
      alive = false;
    };
  }, [block]);

  return (
    <div className="site-preview">
      <div className="vs-row">
        <button className={mode === "view" ? "vs-tab on" : "vs-tab"} onClick={() => setMode("view")}>
          Как выглядит
        </button>
        <button className={mode === "code" ? "vs-tab on" : "vs-tab"} onClick={() => setMode("code")}>
          Код для Тильды
        </button>
      </div>
      {mode === "view" ? (
        <iframe className="site-frame" title={block.title} sandbox="allow-scripts" srcDoc={html} />
      ) : (
        <textarea className="site-code" readOnly value={html} />
      )}
    </div>
  );
}
