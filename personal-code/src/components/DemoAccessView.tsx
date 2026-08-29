import { useEffect, useState } from "react";
import type { DemoKeyInfo, Tester } from "../lib/types";

const EMPTY: Partial<Tester> = { name: "", displayName: "", machineCode: "", note: "" };

function formatDate(iso: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("ru-RU");
}

function daysLeft(iso: string): number | null {
  if (!iso) return null;
  const end = Date.parse(iso);
  if (!Number.isFinite(end)) return null;
  return Math.ceil((end - Date.now()) / 86400000);
}

export default function DemoAccessView() {
  const [keyInfo, setKeyInfo] = useState<DemoKeyInfo | null>(null);
  const [testers, setTesters] = useState<Tester[]>([]);
  const [draft, setDraft] = useState<Partial<Tester>>(EMPTY);
  const [days, setDays] = useState(30);
  const [productName, setProductName] = useState("Личный чат");
  const [revocationUrl, setRevocationUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("https://polza.ai/api/v1");
  const [pricesText, setPricesText] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([window.api.demoKeyInfo(), window.api.listTesters()])
      .then(([k, t]) => {
        setKeyInfo(k);
        setTesters(t);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  async function act<T>(fn: () => Promise<T>, success = "") {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await fn();
      if (success) setNotice(success);
      return result;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      setBusy(false);
    }
  }

  const hasKey = Boolean(keyInfo?.exists);

  return (
    <div className="settings-view">
      <h2 className="view-title">Демо-доступ</h2>
      <p className="hint">
        Выдача и отключение демо-копий «Личного чата» для тестовой группы. Каждая копия
        привязывается к одному компьютеру и работает до указанной даты; отозвать доступ можно и
        раньше.
      </p>

      <section className="card">
        <h3 className="card-title">Ключ подписи</h3>
        {!hasKey && (
          <>
            <p className="hint">
              Ключ создаётся один раз на этом компьютере. Им подписываются файлы активации — без
              него их невозможно ни выдать, ни подделать. Закрытая половина ключа остаётся здесь и
              никуда не отправляется; в сборку попадает только открытая, которая умеет проверять
              подпись, но не ставить её.
            </p>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy}
              onClick={() => act(async () => setKeyInfo(await window.api.demoCreateKeys()), "Ключ создан.")}
            >
              Создать ключ
            </button>
          </>
        )}
        {hasKey && (
          <>
            <p className="hint">Ключ создан {formatDate(keyInfo!.createdAt)}. Файл: {keyInfo!.path}</p>
            <p className="hint hint-warn">
              Не удаляйте и не пересоздавайте его: все уже выданные файлы активации подписаны
              именно им и перестанут работать. Сделайте копию этого файла в надёжном месте.
            </p>
          </>
        )}
      </section>

      <section className="card">
        <h3 className="card-title">Настройки сборки</h3>
        <p className="hint">
          Эти значения записываются в демо-сборку «Личного чата». Адрес списка отзыва —
          необязательный: без него доступ всё равно закончится по дате, но отозвать его досрочно
          не получится.
        </p>

        <label className="field-label">Название демо-версии</label>
        <input className="input" value={productName} onChange={(e) => setProductName(e.target.value)} />

        <label className="field-label">Адрес списка отзыва (необязательно)</label>
        <input
          className="input"
          placeholder="https://ваш-адрес/revoked.json"
          value={revocationUrl}
          onChange={(e) => setRevocationUrl(e.target.value)}
        />
        <p className="hint">
          Это должен быть обычный файл, лежащий по постоянной ссылке. Приложение читает его раз в
          12 часов; если ссылка недоступна, копия продолжает работать до конца срока.
        </p>

        <label className="field-label">Ключ Polza для тестовой группы</label>
        <input
          className="input"
          type="password"
          placeholder="оставьте пустым, чтобы каждый вводил свой ключ"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
        />
        <p className="hint">
          Если ключ задан, в демо-сборке поле ключа не показывается — вместо него тестировщик
          видит свой расход по моделям. Заведите для группы <strong>отдельный ключ с небольшим
          балансом</strong>: ключ физически лежит внутри приложения на чужом компьютере, и тот, кто
          умеет распаковывать установщик, его достанет. Возможность отозвать такой ключ — и есть
          настоящая защита, а не то, что поле спрятано.
        </p>

        <label className="field-label">Адрес API</label>
        <input className="input" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />

        <label className="field-label">Цены моделей (по строке на модель)</label>
        <textarea
          className="textarea"
          rows={4}
          placeholder={"anthropic/claude-sonnet-5 300 1500\nopenai/gpt-5 250 1000"}
          value={pricesText}
          onChange={(e) => setPricesText(e.target.value)}
        />
        <p className="hint">
          Формат: модель, цена за миллион входящих токенов, цена за миллион исходящих. Модель без
          цены показывается тестировщику с токенами, но без суммы — придумывать стоимость нельзя.
        </p>

        <button
          type="button"
          className="btn"
          disabled={busy || !hasKey}
          onClick={() =>
            act(async () => {
              const result = await window.api.exportLicenceConfig({
                revocationUrl,
                productName,
                apiKey,
                baseUrl,
                pricesText,
              });
              if (!result) return;
              if (result.priceProblems?.length) {
                setError("Цены разобраны не полностью:\n" + result.priceProblems.join("\n"));
              }
              setNotice(
                `Записан ${result.file}.` +
                  (result.managed ? " Ключ встроен в сборку." : " Ключ не задан — каждый вводит свой.") +
                  " Теперь соберите «Личный чат» заново."
              );
            })
          }
        >
          Записать настройки в сборку
        </button>
      </section>

      <section className="card">
        <h3 className="card-title">Тестировщики ({testers.length})</h3>

        {testers.length === 0 && <p className="hint">Пока никого.</p>}

        {testers.map((tester) => {
          const left = daysLeft(tester.expiresAt);
          const expired = left !== null && left <= 0;
          return (
            <div key={tester.id} className="tester-row">
              <div className="tester-main">
                <strong>{tester.name}</strong>
                {tester.displayName && <span className="hint">копия: {tester.displayName}</span>}
                <code className="tester-code">{(tester.machineCode.match(/.{1,5}/g) || []).join("-")}</code>
                <span className="hint">
                  {!tester.licenceId && "файл активации ещё не выдан"}
                  {tester.licenceId && tester.revoked && "доступ отозван"}
                  {tester.licenceId && !tester.revoked && expired && `истёк ${formatDate(tester.expiresAt)}`}
                  {tester.licenceId && !tester.revoked && !expired &&
                    `до ${formatDate(tester.expiresAt)} · осталось ${left} дн.`}
                </span>
                {tester.note && <span className="hint">{tester.note}</span>}
              </div>
              <div className="tester-actions">
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={busy}
                  onClick={() =>
                    act(async () => {
                      const result = await window.api.issueLicence(tester.id, {
                        days,
                        productName,
                        revocationUrl,
                      });
                      if (result) {
                        setTesters(result.all);
                        setNotice(`Файл активации сохранён: ${result.file}. Отправьте его тестировщику.`);
                      }
                    })
                  }
                >
                  {tester.licenceId ? "Выдать заново" : "Выдать доступ"}
                </button>
                {tester.licenceId && (
                  <button
                    type="button"
                    className={tester.revoked ? "btn btn-sm" : "btn btn-sm btn-danger"}
                    disabled={busy}
                    onClick={() =>
                      act(async () => {
                        setTesters(await window.api.setTesterRevoked(tester.id, !tester.revoked));
                        setNotice(
                          tester.revoked
                            ? "Отзыв снят. Не забудьте выгрузить список отзыва заново."
                            : "Отмечено как отозванное. Выгрузите список отзыва и обновите файл по вашей ссылке."
                        );
                      })
                    }
                  >
                    {tester.revoked ? "Вернуть доступ" : "Отозвать"}
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={busy}
                  onClick={() => setDraft(tester)}
                >
                  Изменить
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-danger"
                  disabled={busy}
                  onClick={() => {
                    if (!confirm(`Удалить «${tester.name}» из списка? Уже выданный файл активации при этом не отзывается.`))
                      return;
                    act(async () => setTesters(await window.api.deleteTester(tester.id)));
                  }}
                >
                  Удалить
                </button>
              </div>
            </div>
          );
        })}

        <div className="row">
          <div className="col">
            <label className="field-label">Срок доступа, дней</label>
            <input
              className="input"
              type="number"
              min={1}
              max={365}
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
            />
          </div>
          <div className="col">
            <button
              type="button"
              className="btn"
              disabled={busy || !hasKey}
              onClick={() =>
                act(async () => {
                  const result = await window.api.exportRevocations();
                  if (result) setNotice(`Список отзыва сохранён: ${result.file}. Загрузите его по вашей ссылке.`);
                })
              }
            >
              Выгрузить список отзыва
            </button>
          </div>
        </div>
      </section>

      <section className="card">
        <h3 className="card-title">{draft.id ? "Изменение" : "Новый тестировщик"}</h3>

        <label className="field-label">Имя</label>
        <input
          className="input"
          value={draft.name ?? ""}
          onChange={(e) => setDraft((p) => ({ ...p, name: e.target.value }))}
        />

        <label className="field-label">Название копии</label>
        <input
          className="input"
          placeholder={`${productName} ${draft.name || "Виктории"}`}
          value={draft.displayName ?? ""}
          onChange={(e) => setDraft((p) => ({ ...p, displayName: e.target.value }))}
        />
        <p className="hint">
          Так копия будет подписана у тестировщика в окне. Пусто — соберём из названия и имени.
        </p>

        <label className="field-label">Код компьютера</label>
        <input
          className="input"
          placeholder="ABCDE-FGHIJ-KLMNO-PQRST"
          value={draft.machineCode ?? ""}
          onChange={(e) => setDraft((p) => ({ ...p, machineCode: e.target.value }))}
        />
        <p className="hint">
          Этот код тестировщик видит на экране активации и присылает вам. Можно вставить как есть,
          с чёрточками.
        </p>

        <label className="field-label">Заметка</label>
        <input
          className="input"
          value={draft.note ?? ""}
          onChange={(e) => setDraft((p) => ({ ...p, note: e.target.value }))}
        />

        <div className="sticky-actions">
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={() =>
              act(async () => {
                const { all } = await window.api.saveTester(draft);
                setTesters(all);
                setDraft(EMPTY);
              }, "Сохранено.")
            }
          >
            Сохранить
          </button>
          {draft.id && (
            <button type="button" className="btn" onClick={() => setDraft(EMPTY)}>
              Отмена
            </button>
          )}
          {notice && <span className="notice-text">{notice}</span>}
          {error && <span className="error-text">{error}</span>}
        </div>
      </section>

      <section className="card">
        <h3 className="card-title">Насколько это надёжно</h3>
        <p className="hint">
          Привязка к компьютеру и срок действия проверяются внутри самого приложения — значит, всё
          нужное для проверки лежит на компьютере тестировщика. Человек с техническими навыками
          может распаковать установщик и убрать проверку. Это защищает от того, чтобы копию просто
          передали дальше или запустили на втором компьютере, но не от целенаправленного взлома —
          и ничто, работающее на чужой машине, от этого защитить не может.
        </p>
        <p className="hint">
          Для группы из десяти известных вам людей этого достаточно. Настоящая защита на этапе
          фокус-группы — не техническая: расписка о неразглашении и то, что вы знаете каждого
          в лицо.
        </p>
      </section>
    </div>
  );
}
