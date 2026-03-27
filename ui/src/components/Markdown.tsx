import ReactMarkdown from "react-markdown";

export function Markdown({ content, className = "" }: { content: string; className?: string }) {
  return (
    <div className={`prose ${className}`}>
      <ReactMarkdown>{content}</ReactMarkdown>
    </div>
  );
}
