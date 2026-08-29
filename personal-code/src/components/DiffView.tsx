import type { ProposalFile } from "../lib/types";

const ACTION_LABEL: Record<ProposalFile["action"], string> = {
  replace: "правка",
  write: "запись",
  delete: "удаление",
  rename: "переименование",
};

export default function DiffView({ file }: { file: ProposalFile }) {
  const added = file.diff.filter((r) => r.type === "add").length;
  const removed = file.diff.filter((r) => r.type === "del").length;

  return (
    <div className="diff-file">
      <div className="diff-head">
        <span className="diff-path">
          {file.path}
          {file.action === "rename" && file.to ? ` → ${file.to}` : ""}
        </span>
        <span className="diff-meta">
          {file.isNew ? "новый файл · " : ""}
          {ACTION_LABEL[file.action]}
          {file.action !== "rename" && (added || removed) ? ` · +${added} −${removed}` : ""}
        </span>
      </div>
      {file.action === "rename" ? (
        <p className="hint diff-note">Содержимое не меняется.</p>
      ) : (
        <pre className="diff-body">
          {file.diff.map((row, index) => (
            <div key={index} className={`diff-row diff-${row.type}`}>
              <span className="diff-sign">
                {row.type === "add" ? "+" : row.type === "del" ? "−" : row.type === "gap" ? "" : " "}
              </span>
              <span className="diff-text">{row.text || " "}</span>
            </div>
          ))}
        </pre>
      )}
    </div>
  );
}
