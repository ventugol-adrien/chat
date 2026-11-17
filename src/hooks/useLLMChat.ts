import { useCallback, useEffect, useState } from "react";
import type {
  LLMChatMessage,
  LLMChatProps,
  LLMChatResponse,
} from "../components/LLMChat";
import type { LLMMarkdownChunk } from "./useLLMMarkdownStream";

export type LLMChatProvider =
  | "openai"
  | "xai-messages"
  | "xai-responses"
  | "google-gemini";

export interface UseLLMChatOptions {
  modelsUrl: string | URL;
  completionsUrl: string | URL;
  provider?: LLMChatProvider;
  headers?: HeadersInit;
}

type UseLLMChatResult = Pick<
  LLMChatProps,
  | "models"
  | "model"
  | "onModelChange"
  | "modelsLoading"
  | "modelsError"
  | "onSend"
>;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function modelIds(
  payload: unknown,
  provider?: LLMChatProvider,
): string[] {
  const data = record(payload);
  const entries = Array.isArray(payload) ? payload : data?.data ?? data?.models;
  if (!Array.isArray(entries)) {
    throw new Error("The models endpoint did not return a model list.");
  }

  const compatibleEntries = entries.filter((entry) => {
    const model = record(entry);
    if (provider === "google-gemini") {
      const methods = model?.supportedGenerationMethods;
      return !Array.isArray(methods) || methods.includes("generateContent");
    }

    if (provider === "xai-messages" || provider === "xai-responses") {
      if (typeof model?.completion_text_token_price === "number") return true;
      if (typeof model?.image_price === "number") return false;
      if (typeof entry === "string") {
        return !/(?:imagine.*image|image.*generation)/i.test(entry);
      }
    }

    return true;
  });
  if (compatibleEntries.length === 0) {
    throw new Error("No models are available for the selected API endpoint.");
  }

  return compatibleEntries.map((entry) => {
    const model = record(entry);
    const id =
      typeof entry === "string"
        ? entry
        : model?.id ?? model?.baseModelId ??
          (typeof model?.name === "string"
            ? model.name.replace(/^models\//, "")
            : undefined);
    if (typeof id !== "string" || !id) {
      throw new Error("The models endpoint returned an entry without an id.");
    }
    return id;
  });
}

function isProvider(value: string | null): value is LLMChatProvider {
  return (
    value === "openai" ||
    value === "xai-messages" ||
    value === "xai-responses" ||
    value === "google-gemini"
  );
}

function responseProvider(value: string | null): LLMChatProvider | undefined {
  if (!value) return;
  if (!isProvider(value)) {
    throw new Error(`Unsupported LLM provider "${value}".`);
  }
  return value;
}

function parseCompletionEvent(
  frame: string,
  provider: LLMChatProvider,
): LLMMarkdownChunk | "done" | undefined {
  const data = frame
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n")
    .trim();
  if (!data) return;
  if (data === "[DONE]") return "done";

  const payload = record(JSON.parse(data));
  if (!payload) throw new Error("The completion API returned an invalid event.");
  if (payload.error || payload.type === "error") {
    const error = record(payload.error);
    throw new Error(
      typeof error?.message === "string"
        ? error.message
        : typeof payload.error === "string"
          ? payload.error
          : typeof payload.message === "string"
            ? payload.message
            : "The completion API returned an error.",
    );
  }

  if (provider === "xai-responses") {
    if (payload.type === "response.completed") return "done";
    if (
      payload.type === "response.output_text.delta" &&
      typeof payload.delta === "string"
    ) {
      return { token: payload.delta };
    }
    if (
      payload.type === "response.reasoning_summary_text.delta" &&
      typeof payload.delta === "string"
    ) {
      return { reasoning: payload.delta };
    }
    if (payload.type === "response.failed") {
      const response = record(payload.response);
      const error = record(response?.error);
      throw new Error(
        typeof error?.message === "string"
          ? error.message
          : "The xAI Responses API failed to generate a response.",
      );
    }
    return;
  }

  if (provider === "xai-messages") {
    if (payload.type === "message_stop") return "done";
    if (payload.type !== "content_block_delta") return;

    const delta = record(payload.delta);
    if (delta?.type === "text_delta" && typeof delta.text === "string") {
      return { token: delta.text };
    }
    if (
      delta?.type === "thinking_delta" &&
      typeof delta.thinking === "string"
    ) {
      return { reasoning: delta.thinking };
    }
    return;
  }

  if (provider === "google-gemini") {
    const candidates = Array.isArray(payload.candidates)
      ? payload.candidates
      : [];
    let token = "";
    let reasoning = "";

    for (const candidate of candidates) {
      const content = record(record(candidate)?.content);
      if (!Array.isArray(content?.parts)) continue;
      for (const part of content.parts) {
        const value = record(part);
        if (typeof value?.text !== "string") continue;
        if (value.thought === true) reasoning += value.text;
        else token += value.text;
      }
    }

    return token || reasoning ? { token, reasoning } : undefined;
  }

  const choices = payload.choices;
  const choice = record(Array.isArray(choices) ? choices[0] : undefined);
  const delta = record(choice?.delta);
  if (!delta) return;

  const token = typeof delta.content === "string" ? delta.content : "";
  const reasoningValue = delta.reasoning_content ?? delta.reasoning;
  const reasoning = typeof reasoningValue === "string" ? reasoningValue : "";
  return token || reasoning ? { token, reasoning } : undefined;
}

async function* streamCompletion(
  response: Response,
  provider: LLMChatProvider,
): AsyncGenerator<LLMMarkdownChunk> {
  if (!response.body) {
    throw new Error("The completion API response did not contain a stream.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const frames = buffer.split(/\r?\n\r?\n/);
      buffer = frames.pop() ?? "";

      for (const frame of frames) {
        const chunk = parseCompletionEvent(frame, provider);
        if (chunk === "done") return;
        if (chunk) yield chunk;
      }

      if (done) {
        if (buffer.trim()) {
          const chunk = parseCompletionEvent(buffer, provider);
          if (chunk && chunk !== "done") yield chunk;
        }
        return;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function requestHeaders(
  headers: HeadersInit | undefined,
  accept: string,
  contentType?: string,
): Headers {
  const result = new Headers(headers);
  if (!result.has("Accept")) result.set("Accept", accept);
  if (contentType && !result.has("Content-Type")) {
    result.set("Content-Type", contentType);
  }
  return result;
}

async function* createCompletionStream(
  url: string | URL,
  model: string,
  messages: readonly LLMChatMessage[],
  headers?: HeadersInit,
  fallbackProvider?: LLMChatProvider,
): AsyncGenerator<LLMMarkdownChunk> {
  const response = await fetch(url, {
    method: "POST",
    headers: requestHeaders(headers, "text/event-stream", "application/json"),
    body: JSON.stringify({
      model,
      messages: messages.map(({ role, content }) => ({ role, content })),
      stream: true,
    }),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Completion request failed (${response.status}).`);
  }

  const selectedProvider =
    responseProvider(response.headers.get("X-LLM-Provider")) ??
    fallbackProvider ??
    "openai";
  yield* streamCompletion(response, selectedProvider);
}

export function useLLMChat({
  modelsUrl,
  completionsUrl,
  provider,
  headers,
}: UseLLMChatOptions): UseLLMChatResult {
  const [models, setModels] = useState<string[]>([]);
  const [model, setModel] = useState("");
  const [modelsLoading, setModelsLoading] = useState(true);
  const [modelsError, setModelsError] = useState<string>();

  useEffect(() => {
    const controller = new AbortController();
    setModelsLoading(true);
    setModelsError(undefined);

    const loadModels = async () => {
      try {
        const response = await fetch(modelsUrl, {
          headers: requestHeaders(headers, "application/json"),
          signal: controller.signal,
        });
        if (!response.ok) {
          const detail = await response.text();
          throw new Error(
            detail || `Failed to load models (${response.status}).`,
          );
        }

        const selectedProvider =
          responseProvider(response.headers.get("X-LLM-Provider")) ?? provider;
        const nextModels = modelIds(
          await response.json(),
          selectedProvider,
        );
        setModels(nextModels);
        setModel(nextModels[0] ?? "");
      } catch (error) {
        if (!controller.signal.aborted) {
          setModelsError(
            error instanceof Error ? error.message : String(error),
          );
        }
      } finally {
        if (!controller.signal.aborted) setModelsLoading(false);
      }
    };

    void loadModels();
    return () => controller.abort();
  }, [headers, modelsUrl]);

  const onSend = useCallback(
    (
      _prompt: string,
      messages: readonly LLMChatMessage[],
      selectedModel?: string,
    ): LLMChatResponse => {
      if (!selectedModel) throw new Error("Choose a model before sending.");
      return createCompletionStream(
        completionsUrl,
        selectedModel,
        messages,
        headers,
        provider,
      );
    },
    [completionsUrl, headers, provider],
  );

  return {
    models,
    model,
    onModelChange: setModel,
    modelsLoading,
    modelsError,
    onSend,
  };
}
