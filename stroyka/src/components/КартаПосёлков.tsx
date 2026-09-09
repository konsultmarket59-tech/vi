// Стартовый экран: карта посёлка с домами.
//
// Метка дома стоит не в пикселях, а в долях ширины и высоты картинки. Из-за
// этого генплан можно заменить на другой файл — свежую подложку, скриншот
// кадастровой карты, аккуратный рендер, — и метки останутся на своих местах.
// Хранить пиксели значило бы переставлять полсотни домов руками после каждой
// замены картинки.
//
// Сама картинка в программу не копируется: как и проект, и прайс, она живёт
// по своему пути на диске и читается при открытии.

import { useCallback, useEffect, useRef, useState } from "react";
import type { Дом, Посёлок, Роль } from "../lib/types";

const ЦВЕТА: Record<string, string> = {
  план: "план",
  стройка: "стройка",
  готов: "готов",
  передан: "передан",
};

interface Свойства {
  посёлки: Посёлок[];
  выбранный: string;
  дома: Дом[];
  роль: Роль;
  наПосёлок(папка: string): void;
  наДом(папка: string): void;
  наПлан(): void;
  обновитьПосёлки(): Promise<Посёлок[]>;
  обновитьДома(): Promise<Дом[]>;
  наОшибку(текст: string): void;
}

export default function КартаПосёлков(п: Свойства) {
  const [картинка, setКартинка] = useState("");
  const [форма, setФорма] = useState<"нет" | "посёлок" | "дом" | "улица">("нет");
  const [перетаскиваемый, setПеретаскиваемый] = useState<string>("");
  const обёртка = useRef<HTMLDivElement>(null);

  const посёлок = п.посёлки.find((x) => x.папка === п.выбранный) || null;
  const можноПравить = п.роль.действия.includes("видетьВсеОбъекты");

  useEffect(() => {
    let живо = true;
    setКартинка("");
    if (посёлок?.картаФайл) {
      window.стройка
        .картинка(посёлок.картаФайл)
        .then((данные) => живо && setКартинка(данные))
        // Карта могла переехать вместе с папкой. Это не повод показывать
        // пустой экран: под метками останется сетка, работать можно.
        .catch(() => живо && setКартинка(""));
    }
    return () => {
      живо = false;
    };
  }, [посёлок?.картаФайл]);

  const перетащить = useCallback(
    async (событие: React.PointerEvent) => {
      if (!перетаскиваемый || !обёртка.current) return;
      const прямоугольник = обёртка.current.getBoundingClientRect();
      const x = Math.min(1, Math.max(0, (событие.clientX - прямоугольник.left) / прямоугольник.width));
      const y = Math.min(1, Math.max(0, (событие.clientY - прямоугольник.top) / прямоугольник.height));
      try {
        await window.стройка.обновитьДом(п.выбранный, перетаскиваемый, { точка: { x, y } });
        await п.обновитьДома();
      } catch (e) {
        п.наОшибку(e instanceof Error ? e.message : String(e));
      }
      setПеретаскиваемый("");
    },
    [перетаскиваемый, п]
  );

  async function выбратьКарту() {
    try {
      const путь = await window.стройка.выбратьКарту();
      if (!путь || !посёлок) return;
      await window.стройка.обновитьПосёлок(посёлок.папка, { картаФайл: путь });
      await п.обновитьПосёлки();
    } catch (e) {
      п.наОшибку(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="view">
      {п.посёлки.length === 0 && (
        <div className="панель">
          <h2>Ни одного посёлка</h2>
          <p className="подпись">
            Посёлок — это карта и дома на ней. Заведите первый: дальше дома можно добавлять по одному
            или сразу улицей.
          </p>
          <ФормаПосёлка
            наГотово={async (данные) => {
              const созданный = await window.стройка.создатьПосёлок(данные);
              await п.обновитьПосёлки();
              п.наПосёлок(созданный.папка);
            }}
            наОшибку={п.наОшибку}
          />
        </div>
      )}

      {посёлок && (
        <>
          <div className="ряд-между" style={{ marginBottom: 10 }}>
            <div>
              <h2 style={{ margin: 0, fontSize: 16 }}>{посёлок.название}</h2>
              <div className="подпись мелко">
                {посёлок.адрес || "адрес не указан"} · домов {п.дома.length}
                {Object.entries(посёлок.поСтатусам || {}).map(([статус, сколько]) => (
                  <span key={статус}>
                    {" · "}
                    {статус}: {сколько}
                  </span>
                ))}
              </div>
            </div>
            <div className="ряд">
              {можноПравить && (
                <>
                  <button className="кн" onClick={() => setФорма(форма === "дом" ? "нет" : "дом")}>
                    Добавить дом
                  </button>
                  <button className="кн" onClick={() => setФорма(форма === "улица" ? "нет" : "улица")}>
                    Добавить улицу
                  </button>
                  <button className="кн" onClick={выбратьКарту}>
                    {посёлок.картаФайл ? "Сменить карту" : "Указать карту"}
                  </button>
                  <button className="кн" onClick={() => setФорма(форма === "посёлок" ? "нет" : "посёлок")}>
                    Новый посёлок
                  </button>
                </>
              )}
              <button className="кн главная" onClick={п.наПлан}>
                Сводный план
              </button>
            </div>
          </div>

          {форма === "посёлок" && (
            <div className="панель">
              <h2>Новый посёлок</h2>
              <ФормаПосёлка
                наГотово={async (данные) => {
                  const созданный = await window.стройка.создатьПосёлок(данные);
                  await п.обновитьПосёлки();
                  п.наПосёлок(созданный.папка);
                  setФорма("нет");
                }}
                наОшибку={п.наОшибку}
              />
            </div>
          )}

          {форма === "дом" && (
            <div className="панель">
              <h2>Новый дом</h2>
              <ФормаДома
                наГотово={async (данные) => {
                  await window.стройка.создатьДом(посёлок.папка, данные);
                  await Promise.all([п.обновитьДома(), п.обновитьПосёлки()]);
                  setФорма("нет");
                }}
                наОшибку={п.наОшибку}
              />
            </div>
          )}

          {форма === "улица" && (
            <div className="панель">
              <h2>Улица домов сразу</h2>
              <p className="подпись">
                Посёлки строятся улицами, а не по одному дому. Метки встанут вдоль линии — потом их
                можно перетащить мышью на свои места.
              </p>
              <ФормаУлицы
                наГотово={async (данные) => {
                  await window.стройка.создатьУлицу(посёлок.папка, данные);
                  await Promise.all([п.обновитьДома(), п.обновитьПосёлки()]);
                  setФорма("нет");
                }}
                наОшибку={п.наОшибку}
              />
            </div>
          )}

          <div
            className="карта-обёртка"
            ref={обёртка}
            onPointerUp={перетащить}
            onPointerLeave={() => setПеретаскиваемый("")}
          >
            {картинка ? (
              <img src={картинка} alt={`Карта посёлка ${посёлок.название}`} draggable={false} />
            ) : (
              <div className="карта-подложка" />
            )}

            {п.дома.map((д) => (
              <button
                key={д.папка}
                className={`метка-дома ${ЦВЕТА[д.статус] || "план"} ${перетаскиваемый === д.папка ? "выбран" : ""}`}
                style={{ left: `${(д.точка?.x ?? 0.5) * 100}%`, top: `${(д.точка?.y ?? 0.5) * 100}%` }}
                title={`${д.улица} ${д.номер} · ${д.статус}${д.датаСдачи ? ` · сдача ${д.датаСдачи}` : ""}`}
                onPointerDown={() => можноПравить && setПеретаскиваемый(д.папка)}
                onClick={() => !перетаскиваемый && п.наДом(д.папка)}
              >
                {д.номер || д.улица}
              </button>
            ))}

            {!картинка && (
              <div style={{ position: "absolute", left: 14, bottom: 12 }} className="подпись мелко">
                {посёлок.картаФайл
                  ? `Файл карты не открылся: ${посёлок.картаФайл} — метки показаны на сетке.`
                  : "Карта не указана — метки стоят на сетке. Кнопка «Указать карту» подставит генплан картинкой; сам файл останется у вас на диске."}
              </div>
            )}
          </div>

          <div className="легенда">
            <span>
              <i style={{ background: "#6b7280" }} />
              план
            </span>
            <span>
              <i style={{ background: "#b5761f" }} />
              стройка
            </span>
            <span>
              <i style={{ background: "#1f7a45" }} />
              готов
            </span>
            <span>
              <i style={{ background: "#3f6fa8" }} />
              передан
            </span>
            {можноПравить && <span className="подпись">метку можно перетащить мышью</span>}
          </div>

          {п.дома.length === 0 && (
            <div className="пусто" style={{ marginTop: 12 }}>
              В посёлке ещё нет домов. Добавьте улицу — это быстрее, чем заводить дома по одному.
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ФормаПосёлка({
  наГотово,
  наОшибку,
}: {
  наГотово(данные: Partial<Посёлок>): Promise<void>;
  наОшибку(т: string): void;
}) {
  const [название, setНазвание] = useState("");
  const [адрес, setАдрес] = useState("");
  return (
    <div className="поля" style={{ alignItems: "end" }}>
      <label className="поле">
        Название
        <input value={название} onChange={(e) => setНазвание(e.target.value)} placeholder="Удачный" />
      </label>
      <label className="поле">
        Адрес
        <input value={адрес} onChange={(e) => setАдрес(e.target.value)} placeholder="Пермский край, Пермский р-н" />
      </label>
      <div>
        <button
          className="кн главная"
          disabled={!название.trim()}
          onClick={async () => {
            try {
              await наГотово({ название: название.trim(), адрес: адрес.trim() });
              setНазвание("");
              setАдрес("");
            } catch (e) {
              наОшибку(e instanceof Error ? e.message : String(e));
            }
          }}
        >
          Создать
        </button>
      </div>
    </div>
  );
}

function ФормаДома({ наГотово, наОшибку }: { наГотово(данные: Partial<Дом>): Promise<void>; наОшибку(т: string): void }) {
  const [улица, setУлица] = useState("");
  const [номер, setНомер] = useState("");
  const [площадь, setПлощадь] = useState("100");
  const [датаНачала, setДатаНачала] = useState("");
  return (
    <div className="поля" style={{ alignItems: "end" }}>
      <label className="поле">
        Улица
        <input value={улица} onChange={(e) => setУлица(e.target.value)} placeholder="Липовая" />
      </label>
      <label className="поле">
        Номер
        <input value={номер} onChange={(e) => setНомер(e.target.value)} placeholder="2" />
      </label>
      <label className="поле">
        Площадь, м²
        <input value={площадь} onChange={(e) => setПлощадь(e.target.value)} inputMode="decimal" />
      </label>
      <label className="поле">
        Начало работ
        <input type="date" value={датаНачала} onChange={(e) => setДатаНачала(e.target.value)} />
      </label>
      <div>
        <button
          className="кн главная"
          disabled={!улица.trim() && !номер.trim()}
          onClick={async () => {
            try {
              await наГотово({ улица: улица.trim(), номер: номер.trim(), площадь: Number(площадь) || 0, датаНачала });
              setНомер("");
            } catch (e) {
              наОшибку(e instanceof Error ? e.message : String(e));
            }
          }}
        >
          Добавить
        </button>
      </div>
    </div>
  );
}

function ФормаУлицы({
  наГотово,
  наОшибку,
}: {
  наГотово(данные: Record<string, unknown>): Promise<void>;
  наОшибку(т: string): void;
}) {
  const [улица, setУлица] = useState("");
  const [сНомера, setСНомера] = useState("2");
  const [доНомера, setДоНомера] = useState("20");
  const [шаг, setШаг] = useState("2");
  const [площадь, setПлощадь] = useState("100");
  const всего = Math.max(0, Math.floor((Number(доНомера) - Number(сНомера)) / Math.max(1, Number(шаг))) + 1);
  return (
    <>
      <div className="поля" style={{ alignItems: "end" }}>
        <label className="поле">
          Улица
          <input value={улица} onChange={(e) => setУлица(e.target.value)} placeholder="Липовая" />
        </label>
        <label className="поле">
          С номера
          <input value={сНомера} onChange={(e) => setСНомера(e.target.value)} inputMode="numeric" />
        </label>
        <label className="поле">
          По номер
          <input value={доНомера} onChange={(e) => setДоНомера(e.target.value)} inputMode="numeric" />
        </label>
        <label className="поле">
          Шаг номеров
          <input value={шаг} onChange={(e) => setШаг(e.target.value)} inputMode="numeric" />
        </label>
        <label className="поле">
          Площадь дома, м²
          <input value={площадь} onChange={(e) => setПлощадь(e.target.value)} inputMode="decimal" />
        </label>
        <div>
          <button
            className="кн главная"
            disabled={!улица.trim() || всего < 1}
            onClick={async () => {
              try {
                await наГотово({
                  улица: улица.trim(),
                  сНомера: Number(сНомера),
                  доНомера: Number(доНомера),
                  шагНомера: Number(шаг),
                  площадь: Number(площадь) || 0,
                  начало: { x: 0.15, y: 0.35 },
                  конец: { x: 0.85, y: 0.45 },
                });
                setУлица("");
              } catch (e) {
                наОшибку(e instanceof Error ? e.message : String(e));
              }
            }}
          >
            Создать {всего} дом(ов)
          </button>
        </div>
      </div>
    </>
  );
}
