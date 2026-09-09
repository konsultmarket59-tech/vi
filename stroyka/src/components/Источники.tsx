// Источники данных: программа хранит пути, а не файлы.
//
// Экран отвечает на один вопрос — «откуда берутся цифры» — и отвечает честно:
// вот путь, вот кто его указал и когда, вот открывается он сейчас или нет.
// Доступность проверяется при каждом показе: путь, который работал в
// понедельник, во вторник может оказаться отключённым сетевым диском, и узнать
// об этом лучше здесь, чем посреди расчёта сметы.

import { useCallback, useEffect, useState } from "react";
import type { Источник, Роль, Справочники } from "../lib/types";
import { дата, датаВремя, рубли } from "../lib/types";

interface Свойства {
  роль: Роль;
  справочники: Справочники;
  наОшибку(текст: string): void;
}

export default function Источники(п: Свойства) {
  const [источники, setИсточники] = useState<Источник[]>([]);
  const [прайс, setПрайс] = useState<Awaited<ReturnType<Window["стройка"]["прайс"]>> | null>(null);
  const [проект, setПроект] = useState<Awaited<ReturnType<Window["стройка"]["проект"]>> | null>(null);
  const [занято, setЗанято] = useState("");

  const загрузить = useCallback(() => {
    window.стройка
      .источники()
      .then(setИсточники)
      .catch((e) => п.наОшибку(String(e.message || e)));
  }, [п]);

  useEffect(загрузить, [загрузить]);

  return (
    <div className="view view-narrow">
      <div className="панель">
        <h2>Откуда программа берёт данные</h2>
        <p className="подпись">
          Ничего из перечисленного не копируется внутрь программы. Проект остаётся у архитектора,
          прайс — у снабжения, шаблоны — у руководителя. Здесь только пути: так копия не устаревает
          молча и данные не разъезжаются по трём местам.
        </p>

        {источники.map((и) => (
          <div className="источник" key={и.id}>
            <div className="кто">
              <b>{и.название}</b>
              <div className="подпись мелко">указывает: {и.ктоУказывает}</div>
            </div>
            <div style={{ flex: 1 }}>
              {и.путь ? (
                <>
                  <div className="путь">{и.путь}</div>
                  <div className="ряд мелко" style={{ marginTop: 4 }}>
                    <span className={`метка ${и.доступен ? "зелёная" : "красная"}`}>
                      {и.доступен ? "путь открывается" : и.замечание}
                    </span>
                    {и.ктоУказал && <span className="подпись">указал {и.ктоУказал}</span>}
                    {и.когда && <span className="подпись">{датаВремя(и.когда)}</span>}
                    {и.изменён && <span className="подпись">файл правили {дата(и.изменён)}</span>}
                  </div>
                </>
              ) : (
                <div className="подпись">{и.подсказка}</div>
              )}
            </div>
            <div className="ряд">
              {п.роль.действия.includes(и.право) ? (
                <>
                  <button
                    className="кн"
                    disabled={занято === и.id}
                    onClick={async () => {
                      setЗанято(и.id);
                      try {
                        const итог = await window.стройка.указатьИсточник(и.id);
                        if (итог) setИсточники(итог);
                      } catch (e) {
                        п.наОшибку(e instanceof Error ? e.message : String(e));
                      } finally {
                        setЗанято("");
                      }
                    }}
                  >
                    {и.путь ? "Сменить" : "Указать"}
                  </button>
                  {и.путь && (
                    <button
                      className="ссылка"
                      onClick={async () => {
                        try {
                          setИсточники(await window.стройка.убратьИсточник(и.id));
                        } catch (e) {
                          п.наОшибку(e instanceof Error ? e.message : String(e));
                        }
                      }}
                    >
                      убрать
                    </button>
                  )}
                </>
              ) : (
                <span className="подпись мелко">не ваша роль</span>
              )}
              {и.путь && и.доступен && (
                <button className="ссылка" onClick={() => window.стройка.открытьПуть(и.путь).catch((e) => п.наОшибку(String(e.message || e)))}>
                  открыть
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="колонки">
        <div className="панель">
          <div className="ряд-между">
            <h2>Прайс</h2>
            <button
              className="кн"
              onClick={async () => {
                try {
                  setПрайс(await window.стройка.прайс());
                } catch (e) {
                  п.наОшибку(e instanceof Error ? e.message : String(e));
                }
              }}
            >
              Прочитать
            </button>
          </div>
          {!прайс && <p className="подпись">Нажмите «Прочитать», чтобы проверить, как разбирается файл цен.</p>}
          {прайс && !прайс.доступен && <div className="ошибка">{прайс.замечание}</div>}
          {прайс?.доступен && (
            <>
              <p className="подпись">
                Позиций {прайс.всегоПозиций}. Файл правили {дата(прайс.изменён)}
                {прайс.днейСОбновления != null && ` — ${прайс.днейСОбновления} дн. назад`}.
                {(прайс.днейСОбновления ?? 0) > 30 && " Проверьте цены: прайс старше месяца."}
              </p>
              {прайс.замечания?.map((з, i) => (
                <div className="внимание" key={i}>
                  {з}
                </div>
              ))}
              <table className="таблица">
                <thead>
                  <tr>
                    <th>Позиция</th>
                    <th style={{ width: 56 }}>Ед.</th>
                    <th className="ч" style={{ width: 90 }}>Цена</th>
                  </tr>
                </thead>
                <tbody>
                  {прайс.позиции.slice(0, 12).map((поз, i) => (
                    <tr key={i}>
                      <td>
                        {поз.наименование}
                        {поз.поставщик && <div className="подпись мелко">{поз.поставщик}</div>}
                      </td>
                      <td>{поз.единица}</td>
                      <td className="ч">{рубли(поз.цена, false)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {(прайс.всегоПозиций ?? 0) > 12 && <p className="подпись мелко">…и ещё {(прайс.всегоПозиций ?? 0) - 12} позиций.</p>}
            </>
          )}
        </div>

        <div className="панель">
          <div className="ряд-между">
            <h2>Проект</h2>
            <button
              className="кн"
              onClick={async () => {
                try {
                  setПроект(await window.стройка.проект());
                } catch (e) {
                  п.наОшибку(e instanceof Error ? e.message : String(e));
                }
              }}
            >
              Прочитать
            </button>
          </div>
          {!проект && <p className="подпись">Покажет, что лежит в папке проекта: разделы, чертежи, спецификации.</p>}
          {проект && !проект.доступен && <div className="ошибка">{проект.замечание}</div>}
          {проект?.доступен && (
            <>
              <p className="подпись">
                Файлов {проект.файлы.length}, спецификаций {проект.спецификации?.length ?? 0}. {проект.замечание}
              </p>
              <table className="таблица">
                <thead>
                  <tr>
                    <th>Раздел</th>
                    <th className="ч" style={{ width: 70 }}>Файлов</th>
                    <th className="ч" style={{ width: 96 }}>Правили</th>
                  </tr>
                </thead>
                <tbody>
                  {проект.разделы.slice(0, 12).map((р) => (
                    <tr key={р.раздел}>
                      <td>{р.раздел}</td>
                      <td className="ч">{р.файлов}</td>
                      <td className="ч">{дата(р.изменён)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
