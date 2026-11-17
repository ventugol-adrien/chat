import { useCallback, useEffect, useRef, useState } from "react";

export interface LLMMarkdownChunk {
  token?: string;
  reasoning?: string;
}

export interface LLMMarkdownStreamValue {
  content: string;
  reasoning: string;
}

type ScheduledFlush =
  | { kind: "frame"; id: number }
  | { kind: "timeout"; id: ReturnType<typeof setTimeout> };

const emptyValue = (): LLMMarkdownStreamValue => ({
  content: "",
  reasoning: "",
});

export function useLLMMarkdownStream(initialValue = emptyValue()) {
  const [value, setValue] = useState(initialValue);
  const [isStreaming, setIsStreaming] = useState(false);
  const pending = useRef<LLMMarkdownStreamValue>(emptyValue());
  const scheduledFlush = useRef<ScheduledFlush | null>(null);
  const activeConsumers = useRef(0);

  const cancelScheduledFlush = useCallback(() => {
    const scheduled = scheduledFlush.current;
    if (!scheduled) return;

    if (scheduled.kind === "frame") cancelAnimationFrame(scheduled.id);
    else clearTimeout(scheduled.id);
    scheduledFlush.current = null;
  }, []);

  const flush = useCallback(() => {
    cancelScheduledFlush();
    const batch = pending.current;
    pending.current = emptyValue();
    if (!batch.content && !batch.reasoning) return;

    setValue((previous) => ({
      content: previous.content + batch.content,
      reasoning: previous.reasoning + batch.reasoning,
    }));
  }, [cancelScheduledFlush]);

  const append = useCallback(
    (chunk: LLMMarkdownChunk) => {
      const token = chunk.token ?? "";
      const reasoning = chunk.reasoning ?? "";
      if (!token && !reasoning) return;

      pending.current = {
        content: pending.current.content + token,
        reasoning: pending.current.reasoning + reasoning,
      };

      if (scheduledFlush.current) return;
      if (typeof requestAnimationFrame === "function") {
        scheduledFlush.current = {
          kind: "frame",
          id: requestAnimationFrame(flush),
        };
      } else {
        scheduledFlush.current = {
          kind: "timeout",
          id: setTimeout(flush, 16),
        };
      }
    },
    [flush],
  );

  const consume = useCallback(
    async (chunks: AsyncIterable<LLMMarkdownChunk>) => {
      activeConsumers.current += 1;
      setIsStreaming(true);

      try {
        for await (const chunk of chunks) append(chunk);
      } finally {
        flush();
        activeConsumers.current -= 1;
        setIsStreaming(activeConsumers.current > 0);
      }
    },
    [append, flush],
  );

  const reset = useCallback(
    (nextValue: LLMMarkdownStreamValue = emptyValue()) => {
      cancelScheduledFlush();
      pending.current = emptyValue();
      setValue(nextValue);
    },
    [cancelScheduledFlush],
  );

  useEffect(() => cancelScheduledFlush, [cancelScheduledFlush]);

  return { ...value, isStreaming, append, consume, reset };
}
