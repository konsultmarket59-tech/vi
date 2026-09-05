/**
 * Ответ на вопрос «подключилось или нет».
 *
 * Раньше и успех, и ошибка выводились одинаковым серым текстом, и понять,
 * работает ли подключение, можно было только вчитавшись. Здесь у ответа есть
 * состояние, и оно видно с одного взгляда: зелёная галочка — подключилось,
 * красный крест с описанием — нет и почему.
 *
 * Отдельное состояние `stale` — «данные изменили, прежняя проверка больше ничего
 * не значит». Без него зелёная галочка от старого ключа висела бы над новым,
 * непроверенным, и врала.
 */
export type ConnectionState = "idle" | "checking" | "ok" | "error" | "stale";

export interface ConnectionStatusValue {
  state: ConnectionState;
  message: string;
}

export const CHECKING: ConnectionStatusValue = { state: "checking", message: "Проверяю соединение…" };
export const STALE: ConnectionStatusValue = { state: "stale", message: "Данные изменились — соединение не проверено." };

export function ok(message: string): ConnectionStatusValue {
  return { state: "ok", message };
}

export function failed(message: string): ConnectionStatusValue {
  return { state: "error", message };
}

/**
 * Технические коды сбоя и что они значат на самом деле.
 *
 * Тот же список, что в electron/connectionError.cjs, но для окна: часть
 * запросов уходит прямо из интерфейса (fetch), и до главного процесса, где
 * живёт перевод, они не доходят. Браузерный fetch к тому же почти всегда
 * говорит только «Failed to fetch» — без порта, адреса и причины, — поэтому
 * без разбора здесь человек остался бы с английской строкой ни о чём.
 */
const CODES: [RegExp, string][] = [
  [/ERR_UNSAFE_PORT/, "Браузерный движок не пускает на этот порт — он в списке небезопасных. Укажите другой порт."],
  [
    /ERR_CONNECTION_REFUSED|ECONNREFUSED/,
    "По этому адресу никто не отвечает — соединение отклонено. Проверьте адрес и порт.",
  ],
  [
    /ERR_NAME_NOT_RESOLVED|ENOTFOUND|EAI_AGAIN/,
    "Адрес не найден: имя сервера не удалось разрешить. Проверьте, нет ли опечатки.",
  ],
  [/ERR_PROXY_CONNECTION_FAILED/, "Не удалось подключиться к прокси: адрес или порт прокси недоступны."],
  [/ERR_TUNNEL_CONNECTION_FAILED/, "Прокси не пропустил соединение до этого адреса."],
  [/ERR_TOO_MANY_RETRIES/, "Прокси отклоняет логин и пароль. Проверьте, что это логин от прокси, а не от сервиса моделей."],
  [
    /ERR_NO_SUPPORTED_PROXIES/,
    "Такой адрес прокси не поддерживается. Уберите логин и пароль из самого адреса и впишите их в отдельные поля.",
  ],
  [/ERR_TIMED_OUT|ETIMEDOUT|AbortError|aborted/i, "Сервис не ответил вовремя. Обычно это медленная сеть, прокси или VPN."],
  [/ERR_INTERNET_DISCONNECTED|ENETUNREACH/, "Нет подключения к интернету."],
  [
    /ERR_CERT|CERT_|SELF_SIGNED|UNABLE_TO_VERIFY/,
    "Не удалось проверить сертификат этого адреса. Так бывает за корпоративным прокси.",
  ],
  [/ERR_INVALID_URL|Invalid URL|Failed to construct/i, "Адрес написан неправильно. Он должен начинаться с http:// или https://."],
  [/ERR_EMPTY_RESPONSE/, "Сервис оборвал соединение, ничего не ответив."],
  [/ERR_SSL|EPROTO/, "Не удалось установить защищённое соединение. Проверьте, верно ли указан http:// или https://."],
  [
    // Последним: fetch в окне сводит все сетевые сбои к одной этой фразе, и она
    // перекрыла бы более точные объяснения выше.
    /Failed to fetch|NetworkError|Network request failed/i,
    "Не удалось соединиться с этим адресом. Проверьте адрес и порт, а если выходите через прокси — его настройки.",
  ],
];

/** Ответ сервера, который сам по себе объясняет отказ. */
function fromStatus(status: number, what: string): string {
  if (status === 401 || status === 403) {
    return "Ключ не принят: сервис ответил, что он неверный или у него нет доступа. Проверьте, что ключ скопирован целиком.";
  }
  if (status === 407) {
    return "Прокси требует логин и пароль, а те, что указаны, он не принял. Проверьте, что это логин от прокси, а не от сервиса моделей.";
  }
  if (status === 404) {
    return "Адрес отвечает, но по нему нет нужного раздела API. Проверьте Base URL — обычно он заканчивается на /v1.";
  }
  if (status === 429) {
    return "Слишком много запросов подряд — сервис попросил подождать. Попробуйте через минуту.";
  }
  if (status >= 500) {
    return `${what} отвечает ошибкой на своей стороне (${status}). Обычно это временно — попробуйте позже.`;
  }
  return "";
}

/**
 * Приводит что угодно к тексту ошибки для человека.
 *
 * Ошибка из главного процесса приходит обёрнутой Electron'ом: «Error invoking
 * remote method 'models:list': Error: …». Внутреннее имя метода человеку ничего
 * не говорит и только прячет настоящую причину — снимаем обёртку здесь, разом
 * для всех подключений, а затем объясняем код сбоя, если он опознан.
 *
 * Неопознанное возвращаем как есть: выдумывать причину хуже, чем показать
 * техническую.
 */
export function errorText(e: unknown, what = "Сервис"): string {
  const raw = (e instanceof Error ? e.message : String(e))
    .replace(/Error invoking remote method '[^']*':\s*/gi, "")
    .replace(/^(Error|Uncaught \(in promise\)|TypeError):\s*/i, "")
    .trim();

  if (!raw) return `${what} не ответил, причина неизвестна.`;

  for (const [pattern, message] of CODES) {
    if (pattern.test(raw)) {
      const code = raw.match(/(net::)?ERR_[A-Z_]+|E[A-Z]{3,}/)?.[0];
      return code ? `${message} (${code})` : message;
    }
  }

  const status = raw.match(/\b(4\d\d|5\d\d)\b/);
  if (status) {
    const byStatus = fromStatus(Number(status[1]), what);
    if (byStatus) return byStatus;
  }

  return raw;
}

export default function ConnectionStatus({ status }: { status: ConnectionStatusValue | null }) {
  if (!status || status.state === "idle") return null;

  const mark = status.state === "ok" ? "✓" : status.state === "error" ? "✕" : "…";
  return (
    <p className={`conn-status conn-${status.state}`} role="status">
      <span className="conn-mark" aria-hidden="true">
        {mark}
      </span>
      <span className="conn-text">{status.message}</span>
    </p>
  );
}
