import {
  Children,
  isValidElement,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface LLMMarkdownMetrics {
  ttft?: number;
  thinking_time?: number;
  tps?: number;
  total_tokens?: number;
}

export interface LLMMarkdownProps {
  content: string;
  reasoning?: string;
  metrics?: LLMMarkdownMetrics;
  isStreaming?: boolean;
  className?: string;
  components?: Components;
}

const extractText = (children: ReactNode): string => {
  let text = "";

  const walk = (node: ReactNode): void => {
    if (typeof node === "string" || typeof node === "number") {
      text += node;
    } else if (isValidElement<{ children?: ReactNode }>(node)) {
      Children.forEach(node.props.children, walk);
    }
  };

  Children.forEach(children, walk);
  return text;
};

function CopyButton({ children, label }: { children: ReactNode; label: string }) {
  const [copied, setCopied] = useState(false);
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timeout.current) clearTimeout(timeout.current);
    },
    [],
  );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(extractText(children));
      setCopied(true);
      if (timeout.current) clearTimeout(timeout.current);
      timeout.current = setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error("Failed to copy Markdown text:", error);
    }
  };

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="absolute right-2 top-2 opacity-70 transition-opacity group-hover:opacity-100"
      onClick={copy}
      aria-label={copied ? "Copied" : label}
      title={copied ? "Copied" : label}
    >
      {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
    </Button>
  );
}

function CopyablePre({
  children,
  className,
  node: _node,
  ...props
}: ComponentPropsWithoutRef<"pre"> & { node?: unknown }) {
  return (
    <div className="group relative max-w-full">
      <pre
        {...props}
        className={cn(
          "my-3 max-w-full overflow-x-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3 pr-12 text-foreground",
          className,
        )}
      >
        {children}
      </pre>
      <CopyButton label="Copy code">{children}</CopyButton>
    </div>
  );
}

function CopyableBlockquote({
  children,
  node: _node,
  ...props
}: ComponentPropsWithoutRef<"blockquote"> & { node?: unknown }) {
  return (
    <div className="group relative max-w-full">
      <blockquote
        {...props}
        className="my-3 border-l-2 border-border pl-4 text-muted-foreground"
      >
        {children}
      </blockquote>
      <CopyButton label="Copy quote">{children}</CopyButton>
    </div>
  );
}

const defaultComponents: Components = {
  pre: CopyablePre,
  blockquote: CopyableBlockquote,
};

const metricLabels: Array<[keyof LLMMarkdownMetrics, string]> = [
  ["ttft", "ttft"],
  ["thinking_time", "thinking_time"],
  ["tps", "tps"],
  ["total_tokens", "total_tokens"],
];

export function LLMMarkdown({
  content,
  reasoning,
  metrics,
  isStreaming = false,
  className,
  components,
}: LLMMarkdownProps) {
  const deferredContent = useDeferredValue(content);
  const deferredReasoning = useDeferredValue(reasoning ?? "");
  const markdownComponents = useMemo(
    () => ({ ...defaultComponents, ...components }),
    [components],
  );

  return (
    <section
      className={cn("llm-markdown w-full text-sm text-foreground", className)}
      aria-busy={isStreaming}
    >
      <div
        className={cn(
          "llm-markdown__body prose prose-neutral max-w-none break-words dark:prose-invert prose-p:my-3 prose-headings:font-semibold prose-a:text-primary",
          isStreaming && "llm-markdown__body--streaming",
        )}
      >
        {deferredReasoning && (
          <details className="mb-3 text-xs text-muted-foreground">
            <summary className="cursor-pointer select-none">Reasoning</summary>
            <div className="mt-2 border-l border-border pl-3 opacity-80">
              <Markdown
                remarkPlugins={[remarkGfm]}
                components={markdownComponents}
              >
                {deferredReasoning}
              </Markdown>
            </div>
          </details>
        )}
        <Markdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
          {deferredContent}
        </Markdown>
      </div>
      {metrics && (
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {metricLabels.map(([key, label]) => {
            const value = metrics[key];
            return value === undefined ? null : (
              <sub key={key}>
                {label}: {value.toFixed(2)}
              </sub>
            );
          })}
        </div>
      )}
    </section>
  );
}
