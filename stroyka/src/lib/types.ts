// Типы того, что приходит из главного процесса.
//
// Мост в preload.cjs отдаёт данные как есть, поэтому описания здесь — это
// описания настоящих файлов на диске, а не отдельная модель для интерфейса.
// Держать их синхронными с модулями electron/ важно ровно по одной причине:
// колонка, которую роль видеть не должна, вырезается на той стороне, и
// необязательное поле здесь — не оформление, а напоминание, что его может не
// быть.

export type РольId = "директор" | "коммерческий" | "снабжение" | "руководитель" | "прораб" | "архитектор" | "заказчик";

export interface Роль {
  id: РольId;
  название: string;
  описание: string;
  лимитОдобрения: number | null;
  разделы: string[];
  действия: string[];
}

export interface Посёлок {
  id: string;
  папка: string;
  название: string;
  адрес: string;
  картаФайл: string;
  улицы: string[];
  домов?: number;
  поСтатусам?: Record<string, number>;
}

export interface Заказчик {
  имя: string;
  телефон: string;
  договор: string;
  чатПуть: string;
}

export interface Дом {
  id: string;
  папка: string;
  посёлокПапка: string;
  улица: string;
  номер: string;
  кадастровый: string;
  площадь: number;
  участок: number;
  статус: "план" | "стройка" | "готов" | "передан";
  точка: { x: number; y: number };
  проектПуть: string;
  проектНазвание: string;
  заказчик: Заказчик;
  прораб: string;
  бригада: string;
  датаНачала: string;
  датаСдачи: string;
}

export interface ПозицияСметы {
  id: string;
  номер: string;
  наименование: string;
  единица: string;
  количество: number;
  вид: "работа" | "материал";
  этап: string;
  источник: string;
  примечание?: string;
  // Денежные колонки приходят не всем ролям — их вырезает сервер приложения.
  ценаЗакупки?: number;
  ценаЗаказчику?: number;
  суммаЗакупки?: number;
  суммаЗаказчику?: number;
  количествоФакт?: number | null;
  суммаФакт?: number | null;
  отклонение?: number | null;
  отклонениеПроцент?: number | null;
  маржа?: number;
}

export interface ЗаписьЖурнала {
  id: string;
  когда: string;
  кто: string;
  роль: string;
  что: string;
  наименование?: string;
  поле?: string;
  было?: unknown;
  стало?: unknown;
  основание?: string;
}

export interface Смета {
  позиции: ПозицияСметы[];
  статус: string;
  журнал: ЗаписьЖурнала[];
  версии: { id: string; когда: string; кто: string; комментарий: string; итог: ИтогСметы }[];
  коэффициенты: Record<string, unknown>;
  согласована: string;
  согласовал: string;
  итог: ИтогСметы;
}

export interface ИтогСметы {
  позиций: number;
  сФактом: number;
  безЦены: number;
  закупка?: number;
  заказчику?: number;
  факт?: number;
  маржа?: number;
  работы?: number;
  материалы?: number;
  рентабельность?: number;
}

export interface Ресурс {
  вид: "работа" | "материал";
  наименование: string;
  единица: string;
  количествоБез: number;
  запас: number;
  количество: number;
  ценаБазовая: number | null;
  коэффициент: number;
  цена: number | null;
  сумма: number | null;
  источникЦены: string;
  вариантыЦены: { наименование: string; цена: number; поставщик: string }[];
}

export interface Расчёт {
  вид: string;
  название: string;
  этап: string;
  единица: string;
  параметры: Record<string, number>;
  объём: number;
  сменБригады: number;
  коэффициентРабот: number;
  ресурсы: Ресурс[];
  итогРабот: number;
  итогМатериалов: number;
  итого: number;
  безЦены: number;
  замечания: string[];
}

export interface ЭтапГрафика {
  id: string;
  название: string;
  бригада: string;
  смен: number;
  начало: string;
  конец: string;
  дней: number;
  ограничитель: string;
  сезонныйСдвиг: number;
  выдержка: number;
  поясВыдержки: string;
  статус: string;
  готовность: number;
  фактНачало: string;
  фактКонец: string;
  критический?: boolean;
  отставание?: number;
  двигаетСдачу?: boolean;
}

export interface График {
  этапы: ЭтапГрафика[];
  начало: string;
  сдача: string;
  срокДней: number;
  режим: string;
  критический: string[];
  сегодня?: string;
  отстают?: number;
  сдвигСдачи?: number;
  прогнозСдачи?: string;
  готовность?: number;
  поПрикидке?: boolean;
  сохранён?: boolean;
}

export interface Приёмка {
  id: string;
  этап: string;
  работа: string;
  вид: string;
  документ: string;
  дата: string;
  участники: string[];
  статус: string;
  кто?: string;
  когда?: string;
}

export interface Поставка {
  id: string;
  улица: string;
  наименование: string;
  единица: string;
  количество: number;
  сумма: number;
  тонн: number;
  дата: string;
  неРаньше: string;
  неПозже: string;
  домов: number;
  дома: { дом: string; домКлюч: string; количество: number; этап: string }[];
  рейсов: number;
  транспортНазвание: string;
  стоимостьДоставки: number;
  хранениеДней: number;
  замечания: string[];
  этапы: string[];
  тяжёлое: boolean;
}

export interface ГрафикПоставок {
  поставки: Поставка[];
  строк: number;
  сумма: number;
  рейсовБезОбъединения: number;
  рейсовСОбъединением: number;
  экономияРейсов: number;
  экономияДоставки: number;
  сЗамечаниями: number;
  вРаспутицу: number;
  поМесяцам: { месяц: string; сумма: number; поставок: number; рейсов: number; доставка: number }[];
  нетГрафика?: boolean;
}

export interface ПланПосёлка {
  пусто: boolean;
  домов?: number;
  сдачи?: { дом: string; ключ: string; папка: string; начало: string; сдача: string; договор: string; этапов: number }[];
  очередь?: { бригада: string; дом: string; этап: string; начало: string; конец: string; смен: number; ждала: string }[];
  загрузка?: { бригада: string; месяц: string; смен: number; объектов: number }[];
  срыв?: { дом: string; договор: string; получается: string; опоздание: number }[];
  ожидание?: number;
  поставки?: ГрафикПоставок;
}

export interface Заявка {
  id: string;
  номер: number;
  дом: string;
  улица: string;
  наименование: string;
  позиции: { наименование: string; единица: string; количество: number; цена: number; сумма: number }[];
  сумма: number;
  поставщик: string;
  нужноКДате: string;
  заказатьДо: string;
  срокПоставки: number;
  основание: string;
  статус: string;
  ждёт: string;
  поясн: string;
  создал: string;
  создана: string;
  причинаОтказа?: string;
  просрочена?: boolean;
  история: { когда: string; кто: string; роль: string; что: string; причина?: string }[];
}

export interface Снабжение {
  заявки: Заявка[];
  сводка: {
    всего: number;
    активных: number;
    сумма: number;
    ждутРуководителя: number;
    ждутСнабженца: number;
    ждутОплаты: number;
    ждутПоставки: number;
    просрочено: { номер: number; наименование: string; заказатьДо: string; нужноКДате: string; опоздание: number }[];
  };
}

export interface Отклонение {
  id: string;
  когда: string;
  дата: string;
  вид: string;
  суть: string;
  насколько: string;
  обоснование: string;
  этап: string;
  сообщение: string;
  кому: string[];
  статус: string;
  комментарий?: string;
}

export interface РазборОтчёта {
  ok: boolean;
  этап: string;
  поФото: string;
  выполнено: { работа: string; объём: string }[];
  готовность: number | null;
  отклонения: { вид: string; суть: string; насколько: string; обоснование: string }[];
  вопросы: string[];
  коротко: string;
  когда?: string;
}

export interface Сообщение {
  id: string;
  когда: string;
  дата: string;
  автор: string;
  роль: string;
  текст: string;
  фото: string[];
  этап: string;
  разбор: РазборОтчёта | null;
  разборПринят: boolean;
  дляЗаказчика?: boolean;
}

export interface ОтчётКлиенту {
  id: string;
  когда: string;
  период: string;
  дом: string;
  текст: string;
  фото: string[];
  статус: "черновик" | "правится" | "одобрен" | "отправлен";
  автор: string;
  одобрил: string;
  отправлен: string;
  файл: string;
}

export interface Чат {
  сообщения: Сообщение[];
  отклонения: Отклонение[];
  уведомления: { id: string; когда: string; роль: string; отклонение: string; заголовок: string; текст: string; прочитано: boolean }[];
  отчёты: ОтчётКлиенту[];
  сводка: { открытых: number; наКритическом: number; поВидам: Record<string, number>; последнее: Отклонение | null };
}

export interface Источник {
  id: string;
  название: string;
  вид: "файл" | "папка";
  ктоУказывает: string;
  право: string;
  подсказка: string;
  путь: string;
  ктоУказал: string;
  когда: string;
  личный: boolean;
  доступен: boolean;
  замечание: string;
  изменён?: string;
}

export interface ВидРабот {
  id: string;
  название: string;
  этап: string;
  единица: string;
  выработка: number;
  параметры: { ключ: string; название: string; единица: string; поумолчанию: number }[];
  сезон: { запрет: number[]; причина: string } | null;
  состав: { вид: string; наименование: string; единица: string; запас: number }[];
}

export interface Справочники {
  роли: Роль[];
  разделы: Record<string, string>;
  видыРабот: ВидРабот[];
  регионы: { id: string; название: string; коэффициент: number }[];
  сложность: { id: string; название: string; коэффициент: number }[];
  этапы: { id: string; после: string[]; выдержка: number; бригада: string; поясВыдержки?: string }[];
  бригады: { id: string; название: string; штук: number }[];
  транспорт: Record<string, { название: string; тонн: number; рейс: number }>;
  распутица: { начало: string; конец: string };
  источники: { id: string; название: string; вид: string; ктоУказывает: string; подсказка: string }[];
  документы: { id: string; название: string; основание: string; наКаждую: string }[];
  маршрутЗаявки: { id: string; описание: string }[];
}

export interface Настройки {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
  роль: РольId;
  пользователь: string;
  режимРаботы: string;
  окноХранения: number;
  лимитСнабженца: number;
  регион: string;
  сложность: string;
  компания: { название: string; инн: string; адрес: string; руководитель: string };
  бригады: Record<string, number>;
  proxyMode: string;
  proxyUrl: string;
  proxyUsername: string;
  proxyPassword: string;
}

export interface КомплектИД {
  созданные: { вид: string; название: string; файл: string; источник: string; незаполненные: string[]; дата: string }[];
  пропущено: { вид: string; причина: string }[];
  папка: string;
  шаблоновНайдено: number;
  требуютВнимания: { файл: string; метки: string[] }[];
}

export interface ПредложениеЛогистики {
  вид: string;
  поставки: string[];
  что: string;
  зачем: string;
  риск: string;
  экономия: string;
}

export interface Api {
  конфиг(): Promise<{ rootPath: string; поумолчанию: string; запасной?: boolean }>;
  выбратьПапкуДанных(): Promise<{ rootPath: string } | null>;
  открытьПапкуДанных(): Promise<string>;
  настройки(): Promise<Настройки>;
  сохранитьНастройки(н: Partial<Настройки>): Promise<Настройки>;
  справочники(): Promise<Справочники>;

  посёлки(): Promise<Посёлок[]>;
  посёлок(папка: string): Promise<Посёлок | null>;
  создатьПосёлок(данные: Partial<Посёлок>): Promise<Посёлок>;
  обновитьПосёлок(папка: string, правка: Partial<Посёлок>): Promise<Посёлок>;
  удалитьПосёлок(папка: string): Promise<void>;
  выбратьКарту(): Promise<string | null>;
  картинка(путь: string): Promise<string>;

  дома(посёлок: string): Promise<Дом[]>;
  дом(посёлок: string, дом: string): Promise<Дом | null>;
  создатьДом(посёлок: string, данные: Partial<Дом>): Promise<Дом>;
  обновитьДом(посёлок: string, дом: string, правка: Partial<Дом>): Promise<Дом>;
  удалитьДом(посёлок: string, дом: string): Promise<void>;
  создатьУлицу(посёлок: string, данные: Record<string, unknown>): Promise<Дом[]>;
  открытьПапкуДома(посёлок: string, дом: string): Promise<string>;

  источники(ключ?: string): Promise<Источник[]>;
  указатьИсточник(вид: string, ключ?: string): Promise<Источник[] | null>;
  убратьИсточник(вид: string, ключ?: string): Promise<Источник[]>;
  открытьПуть(путь: string): Promise<string>;
  проект(ключ?: string): Promise<{
    доступен: boolean;
    замечание: string;
    файлы: { имя: string; путь: string; относительный: string; вид: string; раздел: string; размер: number; изменён: string }[];
    разделы: { раздел: string; файлов: number; чертежей: number; спецификаций: number; изменён: string }[];
    спецификации?: { имя: string; путь: string }[];
    изменён?: string;
  }>;
  прайс(ключ?: string): Promise<{
    доступен: boolean;
    замечание?: string;
    замечания?: string[];
    файл?: string;
    изменён?: string;
    днейСОбновления?: number;
    позиции: { наименование: string; единица: string; цена: number; поставщик: string; срок: number | null }[];
    всегоПозиций?: number;
  }>;
  подобратьВПрайсе(запрос: string, ключ?: string): Promise<{ наименование: string; единица: string; цена: number; поставщик: string; совпадение: number }[]>;

  посчитать(вид: string, параметры: Record<string, number>, ключ?: string): Promise<Расчёт>;
  прикидка(площадь: number, ключ?: string): Promise<{ расчёты: Расчёт[]; итого: number; итогРабот: number; итогМатериалов: number; замечания: string[] }>;

  смета(посёлок: string, дом: string): Promise<Смета>;
  добавитьПозицию(посёлок: string, дом: string, данные: Partial<ПозицияСметы>): Promise<Смета>;
  правитьПозицию(посёлок: string, дом: string, id: string, правка: Record<string, unknown>): Promise<Смета>;
  удалитьПозицию(посёлок: string, дом: string, id: string): Promise<Смета>;
  внестиФакт(посёлок: string, дом: string, id: string, количество: number | null, основание?: string): Promise<Смета>;
  применитьРасчёт(посёлок: string, дом: string, расчёт: Расчёт): Promise<Смета>;
  согласоватьСмету(посёлок: string, дом: string, комментарий: string): Promise<Смета>;
  измененияСметы(посёлок: string, дом: string): Promise<{ версия: string; строки: { вид: string; наименование: string; было?: unknown; стало?: unknown }[]; итогТогда: number; итогСейчас: number; разница: number } | null>;

  график(посёлок: string, дом: string): Promise<График>;
  построитьГрафик(посёлок: string, дом: string): Promise<График>;
  отметитьЭтап(посёлок: string, дом: string, id: string, правка: Record<string, unknown>): Promise<График>;
  приёмка(посёлок: string, дом: string): Promise<{ приёмки: Приёмка[] }>;
  построитьПриёмку(посёлок: string, дом: string): Promise<{ приёмки: Приёмка[] }>;
  отметитьПриёмку(посёлок: string, дом: string, id: string, правка: Record<string, unknown>): Promise<{ приёмки: Приёмка[] }>;

  планПосёлка(посёлок: string): Promise<ПланПосёлка>;
  планДома(посёлок: string, дом: string): Promise<ГрафикПоставок>;

  снабжение(посёлок: string, дом: string): Promise<Снабжение>;
  создатьЗаявку(посёлок: string, дом: string, данные: Record<string, unknown>): Promise<Снабжение>;
  продвинутьЗаявку(посёлок: string, дом: string, id: string, шаг: string, детали?: Record<string, unknown>): Promise<Снабжение>;
  отклонитьЗаявку(посёлок: string, дом: string, id: string, причина: string): Promise<Снабжение>;
  заявкиИзГрафика(посёлок: string, дом: string): Promise<Снабжение & { создано: number }>;

  чат(посёлок: string, дом: string): Promise<Чат>;
  написать(посёлок: string, дом: string, данные: { текст: string; фото?: string[]; этап?: string; дата?: string }): Promise<Сообщение>;
  выбратьФото(): Promise<string[]>;
  разобратьОтчёт(посёлок: string, дом: string, id: string): Promise<РазборОтчёта>;
  принятьРазбор(посёлок: string, дом: string, id: string, правки?: Record<string, unknown>): Promise<Чат & { применено: { этап: string; готовность: number } | null }>;
  закрытьОтклонение(посёлок: string, дом: string, id: string, комментарий: string): Promise<Чат>;
  прочитатьУведомление(посёлок: string, дом: string, id: string): Promise<boolean>;

  отчётКлиенту(посёлок: string, дом: string, период: { от?: string; до?: string }): Promise<ОтчётКлиенту>;
  правитьОтчёт(посёлок: string, дом: string, id: string, текст: string): Promise<ОтчётКлиенту[]>;
  одобритьОтчёт(посёлок: string, дом: string, id: string): Promise<ОтчётКлиенту[]>;
  отправитьОтчёт(посёлок: string, дом: string, id: string): Promise<{ отчёты: ОтчётКлиенту[]; файл: string; вПапкуЗаказчика: string }>;

  шаблоныИД(ключ?: string): Promise<{ папка: string; шаблоны: { имя: string; путь: string; вид: string; расширение: string }[] }>;
  собратьИД(посёлок: string, дом: string, параметры?: { период?: string; только?: string[] }): Promise<КомплектИД>;
  открытьПапкуИД(посёлок: string, дом: string): Promise<string>;

  проверитьМодель(): Promise<{ ok: boolean; причина: string; модели?: string[] }>;
  логистикаАгентом(посёлок: string): Promise<{
    ok: boolean;
    ошибка?: string;
    предложения: ПредложениеЛогистики[];
    риски: { что: string; когда: string; "кого касается": string }[];
    вывод: string;
  }>;
  спецификацияАгентом(файл: string): Promise<{
    ok: boolean;
    позиции: Partial<ПозицияСметы>[];
    пропущено: { строка: string; почему: string }[];
    замечания: string[];
  }>;
  выбратьТаблицу(): Promise<string | null>;
  прочитатьТаблицу(файл: string): Promise<string>;
}

declare global {
  interface Window {
    стройка: Api;
  }
}

/** Деньги — всегда с разделителями разрядов: «1240000» глазом не читается. */
export function рубли(n: number | null | undefined, знак = true): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${Math.round(n).toLocaleString("ru-RU")}${знак ? " ₽" : ""}`;
}

export function число(n: number | null | undefined, знаков = 1): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("ru-RU", { maximumFractionDigits: знаков });
}

export function дата(iso: string | undefined): string {
  if (!iso) return "—";
  const [г, м, д] = String(iso).slice(0, 10).split("-");
  return г ? `${д}.${м}.${г.slice(2)}` : String(iso);
}

export function датаВремя(iso: string | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" });
}
