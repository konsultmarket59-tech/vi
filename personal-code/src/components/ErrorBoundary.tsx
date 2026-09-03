import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";

/**
 * Последняя защита от белого экрана.
 *
 * Ошибка при отрисовке уносит в React всё дерево целиком: окно остаётся пустым,
 * без единой кнопки и без намёка на причину. Так и случилось при нажатии
 * «Собрать» — эффект вернул Promise вместо функции очистки, и приложение
 * исчезло. Одна опечатка не должна выглядеть как «программа сломалась
 * насовсем», поэтому здесь ошибка превращается в экран, с которого можно уйти:
 * текст причины, кнопка «Скопировать» (чтобы прислать разработчику) и
 * «Перезагрузить окно».
 *
 * Ошибка ещё и уходит в журнал приложения — тот, что попадает в отчёт о
 * проблеме: рассказ по памяти «всё пропало» никому не помогает.
 */
interface State {
  error: Error | null;
  info: string;
  copied: boolean;
}

export default class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null, info: "", copied: false };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    const where = (info.componentStack || "").trim().split("\n").slice(0, 6).join("\n");
    this.setState({ info: where });
    try {
      // Журнал есть не у обоих приложений, поэтому обращаемся осторожно: показать
      // ошибку человеку важнее, чем записать её.
      const api = (window as unknown as { api?: { logProblem?: (level: string, message: string) => unknown } }).api;
      api?.logProblem?.("error", `Интерфейс упал: ${error.message}\n${where}`);
    } catch {
      // Журнал — не условие показа ошибки человеку.
    }
  }

  render() {
    const { error, info, copied } = this.state;
    if (!error) return this.props.children;

    const text = `${error.message}\n\n${error.stack || ""}\n\n${info}`;
    return (
      <div className="crash-screen">
        <h2>Что-то сломалось в интерфейсе</h2>
        <p>
          Приложение продолжает работать — перезагрузите окно. Данные на диске не пострадали: всё,
          что было сохранено, останется на месте.
        </p>
        <pre className="crash-text">{text.trim()}</pre>
        <div className="row">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => window.location.reload()}
          >
            Перезагрузить окно
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              void navigator.clipboard.writeText(text).then(() => this.setState({ copied: true }));
            }}
          >
            {copied ? "Скопировано" : "Скопировать текст ошибки"}
          </button>
        </div>
      </div>
    );
  }
}
