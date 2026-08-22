import { useMemo } from "react";
import { renderMarkdown } from "../lib/markdownRender";

export default function Markdown({ text, accentColor }: { text: string; accentColor?: string }) {
  const html = useMemo(() => renderMarkdown(text, accentColor), [text, accentColor]);

  return <div className="markdown" dangerouslySetInnerHTML={{ __html: html }} />;
}
