import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { ArrowUp, Check, Copy, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { LLMMarkdown, type LLMMarkdownMetrics } from "./LLMMarkdown";
import {
  useLLMMarkdownStream,
  type LLMMarkdownChunk,
  type LLMMarkdownStreamValue,
} from "../hooks/useLLMMarkdownStream";

export interface LLMChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  reasoning?: string;
  metrics?: LLMMarkdownMetrics;
}

export type LLMChatResponse =
  | AsyncIterable<LLMMarkdownChunk>
  | Promise<AsyncIterable<LLMMarkdownChunk>>;

export interface LLMChatProps {
  onSend: (
    prompt: string,
    messages: readonly LLMChatMessage[],
    model?: string,
  ) => LLMChatResponse;
  initialMessages?: LLMChatMessage[];
  title?: string;
  placeholder?: string;
  className?: string;
  models?: readonly string[];
  model?: string;
  onModelChange?: (model: string) => void;
  modelsLoading?: boolean;
  modelsError?: string;
}

async function* collectChunks(
  chunks: AsyncIterable<LLMMarkdownChunk>,
  result: LLMMarkdownStreamValue,
): AsyncGenerator<LLMMarkdownChunk> {
  for await (const chunk of chunks) {
    result.content += chunk.token ?? "";
    result.reasoning += chunk.reasoning ?? "";
    yield chunk;
  }
}

function messageError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function LLMChat({
  onSend,
  initialMessages = [],
  title = "Chat",
  placeholder = "Message...",
  className,
  models,
  model,
  onModelChange,
  modelsLoading = false,
  modelsError,
}: LLMChatProps) {
  const [messages, setMessages] = useState(initialMessages);
  const [draft, setDraft] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const messageSequence = useRef(0);
  const sending = useRef(false);
  const copyTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messagesViewport = useRef<HTMLDivElement>(null);
  const shouldStickToBottom = useRef(true);
  const {
    content,
    reasoning,
    consume,
    reset,
    isStreaming,
  } = useLLMMarkdownStream();
  const isBusy = isSending || isStreaming;

  useEffect(
    () => () => {
      if (copyTimeout.current) clearTimeout(copyTimeout.current);
    },
    [],
  );

  useEffect(() => {
    const viewport = messagesViewport.current;
    if (!viewport || !shouldStickToBottom.current) return;

    viewport.scrollTo({
      top: viewport.scrollHeight,
      behavior: isBusy ? "auto" : "smooth",
    });
  }, [content, isBusy, messages, reasoning]);

  const handleSubmit = async () => {
    const prompt = draft.trim();
    if (!prompt || sending.current || (models !== undefined && !model)) return;

    sending.current = true;
    setDraft("");
    setError(null);
    setIsSending(true);
    reset();

    const userMessage: LLMChatMessage = {
      id: `message-${Date.now()}-${++messageSequence.current}`,
      role: "user",
      content: prompt,
    };
    const conversation = [...messages, userMessage];
    setMessages(conversation);
    const result: LLMMarkdownStreamValue = { content: "", reasoning: "" };

    try {
      await consume(
        collectChunks(await onSend(prompt, conversation, model), result),
      );
    } catch (sendError) {
      setError(messageError(sendError));
    } finally {
      if (result.content || result.reasoning) {
        setMessages((current) => [
          ...current,
          {
            id: `message-${Date.now()}-${++messageSequence.current}`,
            role: "assistant",
            ...result,
          },
        ]);
      }
      reset();
      sending.current = false;
      setIsSending(false);
    }
  };

  const handleFormSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void handleSubmit();
  };

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  };

  const handleScroll = () => {
    const viewport = messagesViewport.current;
    if (!viewport) return;
    shouldStickToBottom.current =
      viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 48;
  };

  const copyMessage = async (message: LLMChatMessage) => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopiedMessageId(message.id);
      if (copyTimeout.current) clearTimeout(copyTimeout.current);
      copyTimeout.current = setTimeout(() => setCopiedMessageId(null), 2000);
    } catch (copyError) {
      setError(`Could not copy message: ${messageError(copyError)}`);
    }
  };

  return (
    <section
      className={cn(
        "flex h-[min(720px,80vh)] min-h-[420px] w-full flex-col overflow-hidden rounded-xl bg-background text-foreground",
        className,
      )}
    >
      <header className="flex min-h-12 shrink-0 items-center justify-between gap-3 border-b px-4 py-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        {models !== undefined && (
          <select
            aria-label="Model"
            value={model ?? ""}
            onChange={(event) => onModelChange?.(event.currentTarget.value)}
            disabled={modelsLoading || models.length === 0 || !onModelChange}
            className="max-w-[65%] rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <option value="" disabled>
              {modelsLoading
                ? "Loading models..."
                : modelsError
                  ? "Models unavailable"
                  : models.length === 0
                    ? "No models available"
                    : "Select a model"}
            </option>
            {models.map((modelId) => (
              <option key={modelId} value={modelId}>
                {modelId}
              </option>
            ))}
          </select>
        )}
      </header>

      {modelsError && (
        <p role="alert" className="px-4 py-2 text-sm text-destructive">
          {modelsError}
        </p>
      )}

      <div
        ref={messagesViewport}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto"
        aria-live="polite"
      >
        {messages.length === 0 && !isBusy && (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            Send a message to begin.
          </p>
        )}
        {messages.map((message) =>
          message.role === "user" ? (
            <div
              key={message.id}
              className="flex w-full flex-col items-end px-4 py-3 text-foreground"
            >
              <div className="mb-2 flex max-w-[90%] items-start gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => void copyMessage(message)}
                  aria-label={
                    copiedMessageId === message.id ? "Copied" : "Copy message"
                  }
                  title={
                    copiedMessageId === message.id ? "Copied" : "Copy message"
                  }
                  className="size-6 p-1"
                >
                  {copiedMessageId === message.id ? (
                    <Check aria-hidden="true" />
                  ) : (
                    <Copy aria-hidden="true" />
                  )}
                </Button>
                <p className="whitespace-pre-wrap break-words rounded bg-primary p-2 text-primary-foreground">
                  {message.content}
                </p>
              </div>
            </div>
          ) : (
            <div
              key={message.id}
              className="flex w-full flex-col items-start px-4 py-3 text-foreground"
            >
              <LLMMarkdown
                content={message.content}
                reasoning={message.reasoning}
                metrics={message.metrics}
              />
            </div>
          ),
        )}
        {isBusy && (
          <div className="flex w-full flex-col items-start px-4 py-3 text-foreground">
            {content || reasoning ? (
              <LLMMarkdown
                content={content}
                reasoning={reasoning}
                isStreaming
              />
            ) : (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <LoaderCircle
                  className="size-4 animate-spin"
                  aria-hidden="true"
                />
                <span>Thinking...</span>
              </div>
            )}
          </div>
        )}
      </div>

      {error && (
        <p role="alert" className="border-t px-4 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <form onSubmit={handleFormSubmit} className="shrink-0 p-3">
        <div className="flex items-end gap-2 rounded-xl border border-input bg-background p-2 shadow-xs transition-shadow focus-within:ring-[3px] focus-within:ring-ring/20">
          <Textarea
            value={draft}
            onChange={(event) => setDraft(event.currentTarget.value)}
            onKeyDown={handleComposerKeyDown}
            placeholder={placeholder}
            aria-label={placeholder}
            disabled={isBusy}
            rows={1}
            className="max-h-40 min-h-10 flex-1 resize-none border-0 bg-transparent px-2 py-2 shadow-none focus-visible:border-0 focus-visible:ring-0"
          />
          <Button
            type="submit"
            size="icon"
            className="size-9 shrink-0 rounded-full"
            disabled={
              isBusy ||
              !draft.trim() ||
              (models !== undefined && !model)
            }
            aria-label="Send message"
            title="Send message"
          >
            <ArrowUp aria-hidden="true" />
          </Button>
        </div>
        <p className="mt-2 text-center text-xs text-muted-foreground">
          Enter to send, Shift+Enter for a new line
        </p>
      </form>
    </section>
  );
}
