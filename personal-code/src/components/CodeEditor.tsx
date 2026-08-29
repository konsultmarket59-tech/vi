import { useEffect, useRef } from "react";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, highlightActiveLine } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { bracketMatching, indentOnInput, foldGutter, syntaxHighlighting, defaultHighlightStyle } from "@codemirror/language";
import { closeBrackets, closeBracketsKeymap, autocompletion, completionKeymap } from "@codemirror/autocomplete";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";

interface Props {
  value: string;
  language: string;
  onChange: (value: string) => void;
  onSave: () => void;
}

function languageExtension(language: string): Extension[] {
  switch (language) {
    case "typescript":
      return [javascript({ typescript: true, jsx: true })];
    case "javascript":
      return [javascript({ jsx: true })];
    case "python":
      return [python()];
    case "html":
      return [html()];
    case "css":
      return [css()];
    case "json":
      return [json()];
    case "markdown":
      return [markdown()];
    default:
      return [];
  }
}

const theme = EditorView.theme({
  "&": { fontSize: "13px", height: "100%", backgroundColor: "#ffffff", color: "#0a0a0a" },
  ".cm-scroller": {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    lineHeight: "1.55",
  },
  ".cm-gutters": { backgroundColor: "#fafaf8", color: "#8a9099", border: "none", borderRight: "1px solid #e5e2dc" },
  ".cm-activeLine": { backgroundColor: "#f7f6f3" },
  ".cm-activeLineGutter": { backgroundColor: "#f2f1ed" },
  "&.cm-focused": { outline: "none" },
  ".cm-selectionBackground, ::selection": { backgroundColor: "#ffd9e4 !important" },
  ".cm-cursor": { borderLeftColor: "#0a0a0a" },
});

/**
 * The manual-editing half of the app: a real editor, not a textarea, so a
 * developer can work here directly instead of only through the agent.
 *
 * The view is created once and kept; content and language changes are pushed in
 * as transactions rather than by rebuilding, so switching files does not lose
 * scroll position or undo history mid-edit.
 */
export default function CodeEditor({ value, language, onChange, onSave }: Props) {
  const host = useRef<HTMLDivElement | null>(null);
  const view = useRef<EditorView | null>(null);
  // Kept in refs so the CodeMirror extensions, created once, always call the
  // current handlers instead of the ones captured on first render.
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);

  useEffect(() => {
    onChangeRef.current = onChange;
    onSaveRef.current = onSave;
  }, [onChange, onSave]);

  useEffect(() => {
    if (!host.current) return;
    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        foldGutter(),
        history(),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        autocompletion(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        keymap.of([
          {
            key: "Mod-s",
            preventDefault: true,
            run: () => {
              onSaveRef.current();
              return true;
            },
          },
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...historyKeymap,
          ...searchKeymap,
          ...completionKeymap,
          indentWithTab,
        ]),
        EditorView.lineWrapping,
        theme,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) onChangeRef.current(update.state.doc.toString());
        }),
        ...languageExtension(language),
      ],
    });
    const instance = new EditorView({ state, parent: host.current });
    view.current = instance;
    return () => {
      instance.destroy();
      view.current = null;
    };
    // Language is part of the initial state, so a language change rebuilds the
    // editor. That only happens when a different file is opened.
  }, [language]);

  useEffect(() => {
    const instance = view.current;
    if (!instance) return;
    const current = instance.state.doc.toString();
    if (current === value) return;
    instance.dispatch({ changes: { from: 0, to: current.length, insert: value } });
  }, [value]);

  return <div className="code-editor" ref={host} />;
}
