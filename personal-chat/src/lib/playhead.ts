import { useSyncExternalStore } from "react";

/**
 * Бегунок — отдельным хранилищем, а не состоянием редактора.
 *
 * Пока ролик играет, время меняется 60 раз в секунду. Будь оно состоянием
 * редактора, каждый кадр перерисовывал бы всё: таймлайн со всеми кусками,
 * панели, инспектор, текст ролика на тысячи слов — отсюда и тормоза на
 * длинном видео. Теперь на каждый кадр подписаны только кадр предпросмотра,
 * линия бегунка и часы; остальное узнаёт время, когда ролик стоит.
 */
export interface Playhead {
  get: () => number;
  set: (t: number) => void;
  subscribe: (cb: () => void) => () => void;
}

export function createPlayhead(initial = 0): Playhead {
  let t = initial;
  const subs = new Set<() => void>();
  return {
    get: () => t,
    set: (v: number) => {
      if (v === t) return;
      t = v;
      subs.forEach((cb) => cb());
    },
    subscribe: (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
  };
}

/** Время бегунка — перерисовка на каждом кадре. */
export function usePlayhead(p: Playhead): number {
  return useSyncExternalStore(p.subscribe, p.get, p.get);
}

/** Значение от времени — перерисовка только когда оно меняется (например, номер слова). */
export function usePlayheadSelect<T>(p: Playhead, select: (t: number) => T): T {
  return useSyncExternalStore(
    p.subscribe,
    () => select(p.get()),
    () => select(p.get())
  );
}
