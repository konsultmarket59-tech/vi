// Настройки: папка данных, подключение к модели, роли и правила планирования.
//
// Проверка подключения отвечает не кодом ошибки, а по-человечески: «ключ не
// принят», «по этому адресу никто не отвечает», «прокси требует логин». На
// стройке никто не будет расшифровывать 407.

import { useEffect, useState } from "react";
import type { Настройки as ТипНастроек, Справочники } from "../lib/types";
import { рубли } from "../lib/types";

interface Свойства {
  настройки: ТипНастроек;
  справочники: Справочники;
  наИзменение(н: ТипНастроек): void;
  наОшибку(текст: string): void;
}

export default function Настройки(п: Свойства) {
  const [черновик, setЧерновик] = useState<ТипНастроек>(п.настройки);
  const [конфиг, setКонфиг] = useState<{ rootPath: string; поумолчанию: string; запасной?: boolean } | null>(null);
  const [проверка, setПроверка] = useState<{ ok: boolean; причина: string } | null>(null);
  const [сохранено, setСохранено] = useState(false);

  useEffect(() => {
    window.стройка.конфиг().then(setКонфиг).catch(() => setКонфиг(null));
  }, []);

  useEffect(() => setЧерновик(п.настройки), [п.настройки]);

  async function сохранить(правка: Partial<ТипНастроек>) {
    try {
      const новые = await window.стройка.сохранитьНастройки({ ...черновик, ...правка });
      setЧерновик(новые);
      п.наИзменение(новые);
      setСохранено(true);
      setTimeout(() => setСохранено(false), 2000);
    } catch (e) {
      п.наОшибку(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="view view-narrow">
      {сохранено && <div className="успех">Сохранено.</div>}

      <div className="панель">
        <h2>Папка данных</h2>
        <p className="подпись">
          Здесь лежат посёлки, дома, сметы, графики и чаты — обычными файлами. На стройке эту папку
          обычно кладут на общий сетевой диск, чтобы прораб и сметчик работали с одним и тем же, а не
          пересылали друг другу копии.
        </p>
        <div className="путь">{конфиг?.rootPath || "…"}</div>
        {конфиг?.запасной && (
          <div className="внимание">
            «Документы» оказались недоступны (перенесены в отключённое облако или нет прав), поэтому
            данные лежат в служебной папке программы. Укажите нормальный путь.
          </div>
        )}
        <div className="ряд" style={{ marginTop: 8 }}>
          <button
            className="кн"
            onClick={async () => {
              const новый = await window.стройка.выбратьПапкуДанных();
              if (новый) setКонфиг(await window.стройка.конфиг());
            }}
          >
            Сменить папку
          </button>
          <button className="кн" onClick={() => window.стройка.открытьПапкуДанных()}>
            Открыть в проводнике
          </button>
        </div>
      </div>

      <div className="панель">
        <h2>Кто я</h2>
        <div className="поля">
          <label className="поле">
            Имя и фамилия
            <input
              value={черновик.пользователь}
              onChange={(e) => setЧерновик({ ...черновик, пользователь: e.target.value })}
              onBlur={() => сохранить({})}
              placeholder="Синицын И."
            />
          </label>
          <label className="поле">
            Роль
            <select value={черновик.роль} onChange={(e) => сохранить({ роль: e.target.value as ТипНастроек["роль"] })}>
              {п.справочники.роли.map((р) => (
                <option key={р.id} value={р.id}>
                  {р.название}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="подпись мелко" style={{ marginTop: 6 }}>
          Имя попадает в журнал сметы, в историю заявок и в акты — по нему потом видно, кто внёс
          правку.
        </p>
      </div>

      <div className="панель">
        <h2>Компания</h2>
        <p className="подпись">Подставляется в акты и в исполнительную документацию.</p>
        <div className="поля">
          <label className="поле">
            Название
            <input
              value={черновик.компания.название}
              onChange={(e) => setЧерновик({ ...черновик, компания: { ...черновик.компания, название: e.target.value } })}
              onBlur={() => сохранить({})}
            />
          </label>
          <label className="поле">
            ИНН
            <input
              value={черновик.компания.инн}
              onChange={(e) => setЧерновик({ ...черновик, компания: { ...черновик.компания, инн: e.target.value } })}
              onBlur={() => сохранить({})}
            />
          </label>
          <label className="поле">
            Адрес
            <input
              value={черновик.компания.адрес}
              onChange={(e) => setЧерновик({ ...черновик, компания: { ...черновик.компания, адрес: e.target.value } })}
              onBlur={() => сохранить({})}
            />
          </label>
          <label className="поле">
            Руководитель
            <input
              value={черновик.компания.руководитель}
              onChange={(e) => setЧерновик({ ...черновик, компания: { ...черновик.компания, руководитель: e.target.value } })}
              onBlur={() => сохранить({})}
            />
          </label>
        </div>
      </div>

      <div className="панель">
        <h2>Правила планирования</h2>
        <div className="поля">
          <label className="поле">
            Режим работы
            <select value={черновик.режимРаботы} onChange={(e) => сохранить({ режимРаботы: e.target.value })}>
              <option value="5/2">5/2 — будни</option>
              <option value="6/1">6/1 — без воскресенья</option>
              <option value="7/0">7/0 — без выходных</option>
            </select>
          </label>
          <label className="поле">
            Регион (коэффициент к работам)
            <select value={черновик.регион} onChange={(e) => сохранить({ регион: e.target.value })}>
              {п.справочники.регионы.map((р) => (
                <option key={р.id} value={р.id}>
                  {р.название} ×{р.коэффициент}
                </option>
              ))}
            </select>
          </label>
          <label className="поле">
            Сложность проекта
            <select value={черновик.сложность} onChange={(e) => сохранить({ сложность: e.target.value })}>
              {п.справочники.сложность.map((с) => (
                <option key={с.id} value={с.id}>
                  {с.название} ×{с.коэффициент}
                </option>
              ))}
            </select>
          </label>
          <label className="поле">
            Предельный срок хранения на объекте, дней
            <input
              value={черновик.окноХранения}
              onChange={(e) => setЧерновик({ ...черновик, окноХранения: Number(e.target.value) || 0 })}
              onBlur={() => сохранить({})}
            />
          </label>
          <label className="поле">
            Лимит снабженца, ₽
            <input
              value={черновик.лимитСнабженца}
              onChange={(e) => setЧерновик({ ...черновик, лимитСнабженца: Number(e.target.value) || 0 })}
              onBlur={() => сохранить({})}
            />
          </label>
        </div>
        <p className="подпись мелко" style={{ marginTop: 6 }}>
          До {рубли(черновик.лимитСнабженца)} заявку закрывает снабженец, выше — руководитель.
          Срок хранения ограничивает объединение поставок: у каждого материала он ещё и свой
          (товарный бетон — день в день, сухие смеси — десять дней, песок и блоки — месяц).
        </p>

        <h2 style={{ marginTop: 14 }}>Бригад в компании</h2>
        <p className="подпись">
          Две бригады каменщиков кладут вдвое быстрее и работают на двух домах одновременно. Отсюда
          берётся очередь между объектами в сводном плане.
        </p>
        <div className="поля">
          {п.справочники.бригады.map((б) => (
            <label className="поле" key={б.id}>
              {б.название}
              <input
                value={черновик.бригады?.[б.id] ?? б.штук}
                onChange={(e) => setЧерновик({ ...черновик, бригады: { ...черновик.бригады, [б.id]: Number(e.target.value) || 1 } })}
                onBlur={() => сохранить({})}
              />
            </label>
          ))}
        </div>
      </div>

      <div className="панель">
        <h2>Модель</h2>
        <p className="подпись">
          Модель нужна для трёх вещей: разобрать отчёт прораба с фотографиями, посмотреть на готовый
          план поставок и написать отчёт заказчику. Сметы, объёмы, даты и рейсы считает код — модель
          в этих числах не участвует.
        </p>
        <div className="поля">
          <label className="поле">
            Адрес API
            <input value={черновик.baseUrl} onChange={(e) => setЧерновик({ ...черновик, baseUrl: e.target.value })} onBlur={() => сохранить({})} />
          </label>
          <label className="поле">
            Ключ
            <input
              type="password"
              value={черновик.apiKey}
              onChange={(e) => setЧерновик({ ...черновик, apiKey: e.target.value })}
              onBlur={() => сохранить({})}
              placeholder="ключ хранится только на этом компьютере"
            />
          </label>
          <label className="поле">
            Модель
            <input value={черновик.model} onChange={(e) => setЧерновик({ ...черновик, model: e.target.value })} onBlur={() => сохранить({})} />
          </label>
        </div>
        <div className="ряд" style={{ marginTop: 8 }}>
          <button
            className="кн"
            onClick={async () => {
              setПроверка(null);
              try {
                setПроверка(await window.стройка.проверитьМодель());
              } catch (e) {
                setПроверка({ ok: false, причина: e instanceof Error ? e.message : String(e) });
              }
            }}
          >
            Проверить подключение
          </button>
          {проверка && <span className={проверка.ok ? "метка зелёная" : "метка красная"}>{проверка.причина}</span>}
        </div>
      </div>

      <div className="панель">
        <h2>Прокси</h2>
        <div className="поля">
          <label className="поле">
            Откуда брать адрес
            <select value={черновик.proxyMode} onChange={(e) => сохранить({ proxyMode: e.target.value })}>
              <option value="system">из настроек системы</option>
              <option value="manual">указать вручную</option>
              <option value="direct">без прокси</option>
            </select>
          </label>
          {черновик.proxyMode === "manual" && (
            <>
              <label className="поле">
                Адрес
                <input
                  value={черновик.proxyUrl}
                  onChange={(e) => setЧерновик({ ...черновик, proxyUrl: e.target.value })}
                  onBlur={() => сохранить({})}
                  placeholder="http://адрес:порт"
                />
              </label>
              <label className="поле">
                Логин
                <input value={черновик.proxyUsername} onChange={(e) => setЧерновик({ ...черновик, proxyUsername: e.target.value })} onBlur={() => сохранить({})} />
              </label>
              <label className="поле">
                Пароль
                <input type="password" value={черновик.proxyPassword} onChange={(e) => setЧерновик({ ...черновик, proxyPassword: e.target.value })} onBlur={() => сохранить({})} />
              </label>
            </>
          )}
        </div>
        <p className="подпись мелко" style={{ marginTop: 6 }}>
          Логин и пароль вписывайте в отдельные поля, а не внутрь адреса: адрес вида
          http://логин:пароль@хост:порт браузерный движок не принимает.
        </p>
      </div>
    </div>
  );
}
