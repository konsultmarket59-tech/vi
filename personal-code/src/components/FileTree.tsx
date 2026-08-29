import { useMemo, useState } from "react";
import type { TreeNode } from "../lib/types";

interface Props {
  nodes: TreeNode[];
  truncated: boolean;
  activePath: string | null;
  dirtyPaths: Set<string>;
  onOpen: (node: TreeNode) => void;
  onRefresh: () => void;
  onCreateFile: () => void;
  onDelete: (node: TreeNode) => void;
  onRename: (node: TreeNode) => void;
}

/** Directories containing a match are kept so the matched file stays reachable. */
function filterTree(nodes: TreeNode[], query: string): TreeNode[] {
  const needle = query.toLowerCase();
  const walk = (list: TreeNode[]): TreeNode[] => {
    const out: TreeNode[] = [];
    for (const node of list) {
      if (node.type === "dir") {
        const children = walk(node.children ?? []);
        if (children.length || node.name.toLowerCase().includes(needle)) out.push({ ...node, children });
      } else if (node.path.toLowerCase().includes(needle)) {
        out.push(node);
      }
    }
    return out;
  };
  return walk(nodes);
}

function Row({
  node,
  depth,
  expanded,
  onToggle,
  activePath,
  dirtyPaths,
  onOpen,
  onDelete,
  onRename,
}: {
  node: TreeNode;
  depth: number;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  activePath: string | null;
  dirtyPaths: Set<string>;
  onOpen: (node: TreeNode) => void;
  onDelete: (node: TreeNode) => void;
  onRename: (node: TreeNode) => void;
}) {
  const isOpen = expanded.has(node.path);
  const isActive = node.path === activePath;
  const isDirty = dirtyPaths.has(node.path);

  return (
    <>
      <div
        className={`tree-row${isActive ? " tree-row-active" : ""}`}
        style={{ paddingLeft: 8 + depth * 14 }}
      >
        <button
          type="button"
          className="tree-name"
          onClick={() => (node.type === "dir" ? onToggle(node.path) : onOpen(node))}
          title={node.path}
        >
          <span className="tree-icon">{node.type === "dir" ? (isOpen ? "▾" : "▸") : "·"}</span>
          <span className={node.type === "file" && !node.text ? "tree-label tree-label-muted" : "tree-label"}>
            {node.name}
          </span>
          {isDirty && <span className="tree-dirty" title="Есть несохранённые изменения">•</span>}
        </button>
        <span className="tree-actions">
          <button type="button" className="icon-btn" title="Переименовать" onClick={() => onRename(node)}>
            ✎
          </button>
          <button type="button" className="icon-btn icon-btn-danger" title="Удалить" onClick={() => onDelete(node)}>
            ×
          </button>
        </span>
      </div>
      {node.type === "dir" &&
        isOpen &&
        (node.children ?? []).map((child) => (
          <Row
            key={child.path}
            node={child}
            depth={depth + 1}
            expanded={expanded}
            onToggle={onToggle}
            activePath={activePath}
            dirtyPaths={dirtyPaths}
            onOpen={onOpen}
            onDelete={onDelete}
            onRename={onRename}
          />
        ))}
    </>
  );
}

export default function FileTree({
  nodes,
  truncated,
  activePath,
  dirtyPaths,
  onOpen,
  onRefresh,
  onCreateFile,
  onDelete,
  onRename,
}: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");

  const visible = useMemo(() => (query.trim() ? filterTree(nodes, query.trim()) : nodes), [nodes, query]);

  // While filtering, every folder is opened — otherwise the matches stay hidden
  // inside collapsed directories and the filter looks broken.
  const effectiveExpanded = useMemo(() => {
    if (!query.trim()) return expanded;
    const all = new Set<string>();
    const walk = (list: TreeNode[]) => {
      for (const node of list) {
        if (node.type === "dir") {
          all.add(node.path);
          walk(node.children ?? []);
        }
      }
    };
    walk(visible);
    return all;
  }, [query, expanded, visible]);

  function toggle(path: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  return (
    <div className="file-tree">
      <div className="file-tree-head">
        <input
          className="input input-sm"
          placeholder="Фильтр по имени"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button type="button" className="icon-btn" title="Новый файл" onClick={onCreateFile}>
          +
        </button>
        <button type="button" className="icon-btn" title="Обновить" onClick={onRefresh}>
          ⟳
        </button>
      </div>
      {truncated && <p className="hint hint-warn">Проект очень большой — показана часть файлов.</p>}
      <div className="file-tree-body">
        {visible.length === 0 && <p className="hint">Ничего не найдено.</p>}
        {visible.map((node) => (
          <Row
            key={node.path}
            node={node}
            depth={0}
            expanded={effectiveExpanded}
            onToggle={toggle}
            activePath={activePath}
            dirtyPaths={dirtyPaths}
            onOpen={onOpen}
            onDelete={onDelete}
            onRename={onRename}
          />
        ))}
      </div>
    </div>
  );
}
