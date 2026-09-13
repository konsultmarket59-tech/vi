import { useEffect, useMemo, useRef, useState } from "react";

/**
 * Поле ввода, в котором `@` зовёт референсы, а `/` — короткие команды.
 *
 * Смысл не в украшении, а в том, что иначе объяснить задачу нельзя. Когда
 * референс один и безымянный, сказать «ракурс возьми отсюда, а плашку отсюда»
 * не получается: модель не знает, к чему относится какое указание. Список,
 * который открывается по `@` прямо в тексте, — самый короткий путь от мысли
 * до промпта: не надо ни вспоминать имена, ни уходить из поля.
 *
 * Список открывается только когда знак стоит в начале слова: адрес почты в
 * тексте не должен внезапно превращаться в обращение к референсу.
 */

export interface MentionItem {
  id: string;
  /** Что подставится в текст, без ведущего знака. */
  insert: string;
  title: string;
  hint?: string;
  /** Заголовок раздела, под которым пункт стоит в списке. */
  group?: string;
}

interface Props {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  rows?: number;
  /** Что показывать по «@». */
  mentions: MentionItem[];
  /** Что показывать по «/». */
  commands: MentionItem[];
  emptyMentionHint?: string;
}

interface Open {
  sign: "@" | "/";
  /** Где в тексте стоит сам знак. */
  at: number;
  query: string;
}

export default function MentionBox({
  value,
  onChange,
  placeholder,
  rows = 5,
  mentions,
  commands,
  emptyMentionHint,
}: Props) {
  const area = useRef<HTMLTextAreaElement>(null);
  const [open, setOpen] = useState<Open | null>(null);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const list = useMemo(() => {
    if (!open) return [];
    const source = open.sign === "@" ? mentions : commands;
    const q = open.query.trim().toLowerCase();
    const found = q
      ? source.filter(
          (i) =>
            i.insert.toLowerCase().includes(q) ||
            i.title.toLowerCase().includes(q) ||
            (i.hint || "").toLowerCase().includes(q)
        )
      : source;
    // Список НЕ обрезается. Раньше показывались первые тридцать, и половина
    // команд просто не существовала для человека: он открывал список, видел
    // конец на «/i» и считал, что остального нет. Длину держит прокрутка, а не
    // отсечение, а найти нужное помогает поиск и заголовки разделов.
    return found;
  }, [open, mentions, commands]);

  useEffect(() => setActive(0), [open?.query, open?.sign]);

  // Выбранное стрелками обязано быть видно: в списке из ста пунктов подсветка
  // за краем окна — это подсветка, которой нет.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(".mention-item.on");
    el?.scrollIntoView({ block: "nearest" });
  }, [active, open?.query]);

  /** Что набрано между знаком и кареткой. */
  function look(text: string, caret: number): Open | null {
    for (let i = caret - 1; i >= 0 && caret - i <= 40; i--) {
      const ch = text[i];
      if (ch === "@" || ch === "/") {
        const before = i === 0 ? " " : text[i - 1];
        // Знак считается вызовом списка только в начале слова: иначе адрес
        // почты и путь к файлу открывали бы список на каждом символе.
        if (!/\s|^$/.test(before)) return null;
        const query = text.slice(i + 1, caret);
        if (/\s/.test(query)) return null;
        return { sign: ch, at: i, query };
      }
      if (/\s/.test(ch)) return null;
    }
    return null;
  }

  function choose(item: MentionItem) {
    if (!open) return;
    const el = area.current;
    const caret = el ? el.selectionStart : value.length;
    const next = value.slice(0, open.at) + open.sign + item.insert + " " + value.slice(caret);
    onChange(next);
    setOpen(null);
    // Каретка встаёт после подставленного имени, чтобы можно было сразу
    // писать указание — ради этого список и открывался.
    const to = open.at + item.insert.length + 2;
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(to, to);
    });
  }

  return (
    <div className="mention-box">
      <textarea
        ref={area}
        rows={rows}
        value={value}
        placeholder={placeholder}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(look(e.target.value, e.target.selectionStart));
        }}
        onClick={(e) => setOpen(look(value, e.currentTarget.selectionStart))}
        onBlur={() => window.setTimeout(() => setOpen(null), 150)}
        onKeyDown={(e) => {
          if (!open || !list.length) {
            if (e.key === "Escape") setOpen(null);
            return;
          }
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => (a + 1) % list.length);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => (a - 1 + list.length) % list.length);
          } else if (e.key === "Enter" || e.key === "Tab") {
            e.preventDefault();
            choose(list[active]);
          } else if (e.key === "Escape") {
            e.preventDefault();
            setOpen(null);
          }
        }}
      />
      {open && (
        <div className="mention-list" ref={listRef}>
          {list.length ? (
            <>
              <p className="mention-count">
                {list.length === 1 ? "1 пункт" : `Пунктов: ${list.length}`} — прокрутите или
                продолжите набирать, чтобы отфильтровать
              </p>
              {list.map((item, i) => (
                <div key={item.id}>
                  {/* Заголовок раздела — только там, где раздел меняется:
                      сто пунктов подряд без разделителей не просматриваются. */}
                  {item.group && item.group !== list[i - 1]?.group && (
                    <p className="mention-group">{item.group}</p>
                  )}
                  <button
                    className={i === active ? "mention-item on" : "mention-item"}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => choose(item)}
                  >
                    <b>
                      {open.sign}
                      {item.insert}
                    </b>
                    <span>{item.title}</span>
                    {item.hint && <span className="mention-hint">{item.hint}</span>}
                  </button>
                </div>
              ))}
            </>
          ) : (
            <p className="mention-empty">
              {open.sign === "@"
                ? emptyMentionHint || "Референсов пока нет — добавьте их кнопкой ниже."
                : "Такой команды нет."}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
