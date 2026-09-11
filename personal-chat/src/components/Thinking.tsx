import { useEffect, useState } from "react";

/**
 * Что агент делает прямо сейчас.
 *
 * Процента выполнения здесь сознательно нет: модель не сообщает, сколько ей
 * осталось, и любая полоска «53%» была бы придуманной. Зато честно известны три
 * вещи — сколько идёт работа, на какой она стадии и сколько текста уже написано.
 * Этого хватает, чтобы отличить «работает» от «зависло», а именно этот вопрос и
 * возникает у человека перед неподвижным экраном.
 */
export type ThinkingStage =
  | { kind: "sending" }
  | { kind: "thinking" }
  | { kind: "writing"; chars: number }
  | { kind: "tool"; label: string };

/** После этого времени молчание перестаёт быть нормальным и об этом стоит сказать. */
const SLOW_AFTER_MS = 45000;

function clock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const min = Math.floor(total / 60);
  const sec = total % 60;
  return `${min}:${String(sec).padStart(2, "0")}`;
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

export default function Thinking({ stage, since }: { stage: ThinkingStage; since: number }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, []);

  const elapsed = now - since;
  const slow = elapsed > SLOW_AFTER_MS;

  let text: string;
  if (stage.kind === "sending") text = "Отправляю запрос";
  else if (stage.kind === "tool") text = stage.label;
  else if (stage.kind === "writing") {
    const n = stage.chars;
    text = `Пишет ответ · ${n} ${plural(n, "знак", "знака", "знаков")}`;
  } else text = "Думает над ответом";

  return (
    <div className="thinking" role="status" aria-live="polite">
      <span className="thinking-spinner" aria-hidden="true" />
      <span className="thinking-text">{text}</span>
      <span className="thinking-clock">{clock(elapsed)}</span>
      {slow && stage.kind !== "writing" && (
        <span className="thinking-slow">
          дольше обычного — модель ещё работает, можно подождать или остановить
        </span>
      )}
    </div>
  );
}
