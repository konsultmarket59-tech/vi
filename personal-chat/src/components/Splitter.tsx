import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Раздвижная граница между блоками.
 *
 * Окна у всех разные, и работа у одного и того же раздела бывает разная: то
 * нужен широкий список проектов, то наоборот — весь экран под таблицу. Вместо
 * того чтобы подбирать одну ширину «на всех», граница делается подвижной.
 *
 * Ширина живёт в переменной CSS на корне документа, а не в состоянии React.
 * Это сделано намеренно: при перетаскивании значение меняется десятки раз в
 * секунду, и будь оно в состоянии — каждое движение мыши перерисовывало бы всё
 * поддерево (в таблице каталога это тысячи ячеек). Переменную же меняет браузер
 * без участия React.
 *
 * Значение запоминается на этом компьютере. Двойной щелчок возвращает исходное.
 */

interface Props {
  /** Под каким именем запоминается ширина. */
  id: string;
  /** Имя переменной CSS, которую двигаем. */
  variable: string;
  /** Ширина по умолчанию, в пикселях. */
  fallback: number;
  min: number;
  max: number;
  /**
   * С какой стороны от границы лежит блок, ширину которого меняем. Для левой
   * колонки тянем вправо — ширина растёт; для правой наоборот.
   */
  side: "left" | "right";
  /** Что это за граница — для подсказки и для чтения с экрана. */
  label: string;
}

function storageKey(id: string) {
  return `граница:${id}`;
}

/** Прочитанное значение может быть мусором из прошлой версии — проверяем. */
function readSaved(id: string, min: number, max: number): number | null {
  try {
    const raw = localStorage.getItem(storageKey(id));
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n >= min && n <= max ? n : null;
  } catch {
    // Приватное окно или запрет на хранение: не повод ломать раздел.
    return null;
  }
}

export default function Splitter({ id, variable, fallback, min, max, side, label }: Props) {
  const [dragging, setDragging] = useState(false);
  const width = useRef(fallback);

  const apply = useCallback(
    (value: number) => {
      width.current = value;
      document.documentElement.style.setProperty(variable, `${value}px`);
    },
    [variable]
  );

  // Запомненную ширину ставим до первой отрисовки соседей, иначе видно скачок.
  useEffect(() => {
    apply(readSaved(id, min, max) ?? fallback);
  }, [apply, id, min, max, fallback]);

  const save = useCallback(
    (value: number) => {
      try {
        localStorage.setItem(storageKey(id), String(Math.round(value)));
      } catch {
        // Не сохранилось — граница всё равно работает до конца сеанса.
      }
    },
    [id]
  );

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = width.current;
    const bar = e.currentTarget;
    bar.setPointerCapture(e.pointerId);
    setDragging(true);

    const move = (ev: PointerEvent) => {
      const delta = side === "left" ? ev.clientX - startX : startX - ev.clientX;
      apply(Math.min(max, Math.max(min, startWidth + delta)));
    };
    const up = () => {
      bar.releasePointerCapture(e.pointerId);
      bar.removeEventListener("pointermove", move);
      bar.removeEventListener("pointerup", up);
      bar.removeEventListener("pointercancel", up);
      setDragging(false);
      save(width.current);
    };
    bar.addEventListener("pointermove", move);
    bar.addEventListener("pointerup", up);
    bar.addEventListener("pointercancel", up);
  }

  /** Двойной щелчок — вернуть исходную ширину. */
  function onDoubleClick() {
    apply(fallback);
    try {
      localStorage.removeItem(storageKey(id));
    } catch {
      // см. выше
    }
  }

  /**
   * Стрелками — по пикселю, с Shift — по десять.
   *
   * Не «для галочки»: мышью попасть в нужную ширину до пикселя трудно, а
   * границу иногда двигают именно чтобы поместилась колонка таблицы.
   */
  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const step = e.shiftKey ? 10 : 1;
    let next = width.current;
    if (e.key === "ArrowLeft") next += side === "left" ? -step : step;
    else if (e.key === "ArrowRight") next += side === "left" ? step : -step;
    else if (e.key === "Home") next = fallback;
    else return;
    e.preventDefault();
    apply(Math.min(max, Math.max(min, next)));
    save(width.current);
  }

  return (
    <div
      className={dragging ? "splitter dragging" : "splitter"}
      role="separator"
      aria-orientation="vertical"
      aria-label={`${label} — потяните, чтобы изменить ширину`}
      tabIndex={0}
      title={`${label}: потяните мышью, двойной щелчок — вернуть как было`}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      onKeyDown={onKeyDown}
    />
  );
}
