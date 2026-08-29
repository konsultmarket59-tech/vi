import { useEffect, useState } from "react";
import type { Blueprint, DemoKeyInfo, Tester } from "../lib/types";

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
  // Имя копии и ссылка на список отзыва берутся из сборки, а не вводятся здесь
  // второй раз: два места с одними и теми же значениями рано или поздно
  // разъезжаются, и в лицензии оказывается не то, что в установщике.
  const [blueprints, setBlueprints] = useState<Blueprint[]>([]);
  const [blueprintId, setBlueprintId] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([window.api.demoKeyInfo(), window.api.listTesters(), window.api.listBlueprints()])
      .then(([k, t, b]) => {
        setKeyInfo(k);
        setTesters(t);
        setBlueprints(b);
        const gated = b.find((item) => item.demoGated) || b[0];
        if (gated) setBlueprintId(gated.id);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const blueprint = blueprints.find((b) => b.id === blueprintId) || null;
  const productName = blueprint?.productName || "Личный чат";
  const revocationUrl = blueprint?.revocationUrl || "";

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
        <h3 className="card-title">Для какой сборки выдаём</h3>
        <p className="hint">
          Имя копии, ссылка на список отзыва, ключ моделей и набор навыков задаются во вкладке
          «Сборки» — там же, где копия и собирается. Здесь только выбирается, для какой из сборок
          выдаётся доступ, чтобы в файле активации оказалось ровно то, что лежит в установщике.
        </p>
        {blueprints.length === 0 ? (
          <p className="hint">
            Сборок пока нет. Заведите сборку во вкладке «Сборки» — там же вводится ключ Polza для
            группы и выбираются вшиваемые навыки.
          </p>
        ) : (
          <>
            <label className="field-label">Сборка</label>
            <select className="input" value={blueprintId} onChange={(e) => setBlueprintId(e.target.value)}>
              {blueprints.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} — {item.productName}
                  {item.demoGated ? "" : " (без активации)"}
                </option>
              ))}
            </select>
            <p className="hint">
              Имя копии: <b>{productName}</b>. Список отзыва:{" "}
              {revocationUrl ? <code>{revocationUrl}</code> : "не задан — доступ кончится только по дате"}.
            </p>
            {blueprint && !blueprint.demoGated && (
              <p className="hint hint-warn">
                Эта сборка собрана без активации — файл <code>.lic</code> ей не нужен и работать в
                ней не будет. Включите «Копия требует файл активации» во вкладке «Сборки» и соберите
                заново.
              </p>
            )}
          </>
        )}
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
