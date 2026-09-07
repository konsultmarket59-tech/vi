import { memo, useEffect, useRef, useState } from "react";

/**
 * Таблица каталога в том виде, в каком её ждёт магазин, с правкой любой ячейки.
 *
 * Двести позиций на двадцать семь колонок — это больше пяти тысяч ячеек, и
 * устройство здесь подчинено одному: набор текста не должен зависеть от размера
 * таблицы. Поэтому редактор открыт ровно один, набираемое значение живёт ВНУТРИ
 * него и наверх не поднимается до подтверждения. Иначе каждая буква
 * перерисовывала бы все пять тысяч ячеек — ровно та беда, что была в чате.
 */

interface Props {
  columns: string[];
  rows: Record<string, string>[];
  edits: Record<string, Record<string, string>>;
  /**
   * Библиотека описаний. `fits` — к скольким домам описание подошло само;
   * `error` — почему файл не прочитался. И то и другое показываем в списке
   * выбора: без этого человек выбирает вслепую.
   */
  library: { id: string; label: string; text: string; fits: number; error: string }[];
  onEdit: (sku: string, column: string, value: string) => void;
  onReset: (sku: string, column: string) => void;
  /** Подставить один текст во все дома, у которых описания нет. */
  onFillEmpty: (text: string) => void;
}

/** Колонки, которые почти всегда пусты: прячем их, чтобы таблица читалась. */
const QUIET_COLUMNS = ["Brand", "Quantity", "Price Old", "Editions", "Modifications", "Parent UID", "FB title", "FB descr"];

/** Колонки, куда кладётся текст описания: в них выбор из библиотеки уместен. */
const TEXT_COLUMNS = ["Text", "Description"];

function Editor({
  value,
  library,
  column,
  onCommit,
  onCancel,
}: {
  value: string;
  library: Props["library"];
  column: string;
  onCommit: (v: string) => void;
  onCancel: () => void;
}) {
  // Выбор из библиотеки предлагается и в Text, и в Description: в магазине это
  // разные поля — длинное описание и строчка под названием, — и человек сам
  // решает, куда лечь заготовке.
  const pickable = TEXT_COLUMNS.includes(column);
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  return (
    <div className="cat-editor">
      {pickable && library.length > 0 && (
        <select
          className="cat-editor-pick"
          value=""
          onChange={(e) => {
            const item = library.find((l) => l.id === e.target.value);
            if (item) setDraft(item.text);
          }}
        >
          <option value="">выбрать из библиотеки…</option>
          {library.map((l) => (
            <option key={l.id} value={l.id} disabled={!l.text}>
              {l.label}
              {!l.text
                ? ` — текст не прочитан${l.error ? ": " + l.error : ""}`
                : l.fits
                  ? ` — подошла к ${l.fits} домам сама`
                  : " — сама ни к одному дому не подошла"}
            </option>
          ))}
        </select>
      )}
      <textarea
        ref={ref}
        value={draft}
        rows={pickable ? 8 : 2}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onCancel();
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) onCommit(draft);
        }}
      />
      <div className="cat-editor-actions">
        <button className="btn btn-primary btn-small" onClick={() => onCommit(draft)}>
          Сохранить
        </button>
        <button className="btn btn-secondary btn-small" onClick={onCancel}>
          Отмена
        </button>
        <span className="hint">Ctrl+Enter — сохранить, Esc — отмена</span>
      </div>
    </div>
  );
}

const Row = memo(function Row({
  row,
  columns,
  rowEdits,
  active,
  onOpen,
  onReset,
}: {
  row: Record<string, string>;
  columns: string[];
  rowEdits: Record<string, string> | undefined;
  active: string | null;
  onOpen: (sku: string, column: string) => void;
  onReset: (sku: string, column: string) => void;
}) {
  return (
    <tr>
      {columns.map((column) => {
        const edited = rowEdits && column in rowEdits;
        const value = row[column] || "";
        return (
          <td
            key={column}
            className={
              (edited ? "cat-cell cat-cell-edited" : "cat-cell") + (active === column ? " cat-cell-active" : "")
            }
            title={value}
            onClick={() => onOpen(row.SKU, column)}
          >
            {column === "Text" && !value ? (
              // Пустое описание — не «ничего нет», а «выберите». Иначе человек
              // видит пустоту и не знает, что с ней можно сделать.
              <span className="cat-cell-pick">выбрать описание</span>
            ) : (
              <span className="cat-cell-text">{value}</span>
            )}
            {edited && (
              <button
                className="cat-cell-reset"
                title="Вернуть собранное значение"
                onClick={(e) => {
                  e.stopPropagation();
                  onReset(row.SKU, column);
                }}
              >
                ↺
              </button>
            )}
          </td>
        );
      })}
    </tr>
  );
});

export default function CatalogTable({ columns, rows, edits, library, onEdit, onReset, onFillEmpty }: Props) {
  const [open, setOpen] = useState<{ sku: string; column: string } | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [bulk, setBulk] = useState("");
  // Дома без описания. Участки сюда не попадают: их текст собирается из площади
  // и кадастрового номера и пустым не бывает. По ярлыку готовности отбирать
  // нельзя — он у дома тоже бывает пустым, и такой дом выпал бы из счёта.
  const emptyText = rows.filter((r) => !r.Text).length;
  const usable = library.filter((l) => l.text);

  const shown = showAll ? columns : columns.filter((c) => !QUIET_COLUMNS.includes(c));
  const openRow = open ? rows.find((r) => r.SKU === open.sku) : null;
  const openValue = open && openRow ? openRow[open.column] || "" : "";

  return (
    <div className="cat-table-wrap">
      <div className="cat-table-bar">
        {emptyText > 0 && usable.length > 0 && (
          <div className="cat-fill">
            <span>Без описания: {emptyText}</span>
            <select value={bulk} onChange={(e) => setBulk(e.target.value)}>
              <option value="">подставить описание…</option>
              {usable.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label}
                </option>
              ))}
            </select>
            <button
              className="btn btn-secondary btn-small"
              disabled={!bulk}
              onClick={() => {
                const item = library.find((l) => l.id === bulk);
                if (!item) return;
                onFillEmpty(item.text);
                setBulk("");
              }}
            >
              Подставить во все пустые
            </button>
          </div>
        )}
        <label className="vs-check">
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
          Показывать все колонки, включая всегда пустые
        </label>
        <span className="hint">Нажмите на ячейку, чтобы поправить. Правки помечены и переживают пересборку.</span>
      </div>

      {open && openRow && (
        <div className="cat-editor-panel">
          <div className="cat-editor-head">
            <strong>{open.column}</strong>
            <span className="hint">{openRow.Title}</span>
          </div>
          <Editor
            key={`${open.sku}|${open.column}`}
            value={openValue}
            library={library}
            column={open.column}
            onCommit={(v) => {
              onEdit(open.sku, open.column, v);
              setOpen(null);
            }}
            onCancel={() => setOpen(null)}
          />
        </div>
      )}

      <div className="cat-table-scroll">
        <table className="cat-table">
          <thead>
            <tr>
              {shown.map((c) => (
                <th key={c}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <Row
                key={row.SKU}
                row={row}
                columns={shown}
                rowEdits={edits[row.SKU]}
                active={open && open.sku === row.SKU ? open.column : null}
                onOpen={(sku, column) => setOpen({ sku, column })}
                onReset={onReset}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
