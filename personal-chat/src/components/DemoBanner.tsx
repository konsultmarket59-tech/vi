import { useEffect, useState } from "react";
import type { LicenceStatus } from "../lib/types";

/**
 * Сколько осталось от демо-доступа — видно всё время, а не в последнюю неделю.
 *
 * Раньше строка появлялась только за семь дней до конца, и человек, которому
 * выдали пять, узнавал о сроке из письма, а не из программы. Здесь сразу сказано
 * и на сколько выдана копия, и сколько осталось, — с обратным отсчётом, потому
 * что в последний день «остался 1 день» и «осталось 40 минут» это очень разные
 * новости.
 */
function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

export function timeLeftText(msLeft: number): string {
  if (msLeft <= 0) return "срок закончился";
  const totalMinutes = Math.floor(msLeft / 60000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) {
    return `осталось ${days} ${plural(days, "день", "дня", "дней")} ${hours} ч`;
  }
  if (hours > 0) return `осталось ${hours} ч ${String(minutes).padStart(2, "0")} мин`;
  const seconds = Math.floor((msLeft % 60000) / 1000);
  return `осталось ${minutes}:${String(seconds).padStart(2, "0")}`;
}

export default function DemoBanner({ status }: { status: LicenceStatus }) {
  const [now, setNow] = useState(() => Date.now());

  const expiresAt = status.expiresAt ? Date.parse(status.expiresAt) : NaN;
  const msLeft = Number.isFinite(expiresAt) ? expiresAt - now : NaN;
  // В последний час отсчёт идёт по секундам, до этого раз в минуту чаще не нужно.
  const tick = Number.isFinite(msLeft) && msLeft < 3600000 ? 1000 : 30000;

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), tick);
    return () => clearInterval(timer);
  }, [tick]);

  if (!status.gated || !status.ok || !Number.isFinite(msLeft)) return null;

  const days = status.days || 0;
  const ending = msLeft < 24 * 3600000;
  return (
    <div className={`licence-banner${ending ? " licence-banner-ending" : ""}`}>
      {days > 0 ? `Ваша демо-версия на ${days} ${plural(days, "день", "дня", "дней")}` : "Демо-версия"}
      {" · "}
      {timeLeftText(msLeft)}
      {status.tester ? ` · ${status.tester}` : ""}
    </div>
  );
}
