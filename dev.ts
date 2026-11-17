import { serve } from "bun";
import index from "./dev.html";


type LLMProvider =
  | "openai"
  | "xai-messages"
  | "xai-responses"
  | "google-gemini";

function isLLMProvider(value: string): value is LLMProvider {
  return (
    value === "openai" ||
    value === "xai-messages" ||
    value === "xai-responses" ||
    value === "google-gemini"
  );
}

const providerValue = Bun.env.LLM_PROVIDER?.trim() || "openai";
if (!isLLMProvider(providerValue)) {
  throw new Error(
    "LLM_PROVIDER must be openai, xai-messages, xai-responses, or google-gemini.",
  );
}
const provider = providerValue;
const apiUrlValue = Bun.env.LLM_API_URL?.trim();
if (!apiUrlValue) {
  throw new Error("LLM_API_URL must be set for the selected provider.");
}
const apiUrl = new URL(apiUrlValue);
const expectedXaiPath =
  provider === "xai-messages"
    ? "/messages"
    : provider === "xai-responses"
      ? "/responses"
      : undefined;
if (expectedXaiPath && !apiUrl.pathname.endsWith(expectedXaiPath)) {
  throw new Error(
    `LLM_API_URL must end in ${expectedXaiPath} for provider "${provider}".`,
  );
}
const apiKey =
  provider === "google-gemini"
    ? Bun.env.GEMINI_API_KEY?.trim() ||
      Bun.env.GOOGLE_API_KEY?.trim() ||
      Bun.env.LLM_API_KEY?.trim()
    : Bun.env.LLM_API_KEY?.trim();
if (provider !== "openai" && !apiKey) {
  const keyName =
    provider === "google-gemini"
      ? "GEMINI_API_KEY, GOOGLE_API_KEY, or LLM_API_KEY"
      : "LLM_API_KEY";
  throw new Error(`${keyName} is required for provider "${provider}".`);
}

function deriveModelsUrl(): URL {
  const configuredUrl = Bun.env.LLM_MODELS_URL?.trim();
  if (configuredUrl) return new URL(configuredUrl);

  const url = new URL(apiUrl);
  if (provider === "google-gemini") {
    url.pathname = `${url.pathname.replace(/\/+$/, "")}/models`;
    url.search = "";
    return url;
  }

  const endpoint =
    provider === "xai-messages"
      ? "/messages"
      : provider === "xai-responses"
        ? "/responses"
        : "/chat/completions";
  if (!url.pathname.endsWith(endpoint)) {
    throw new Error(
      `LLM_API_URL must end in ${endpoint} when LLM_MODELS_URL is not set.`,
    );
  }
  url.pathname = url.pathname.replace(
    new RegExp(`${endpoint.replaceAll("/", "\\/")}$`),
    provider === "xai-messages" || provider === "xai-responses"
      ? "/language-models"
      : "/models",
  );
  url.search = "";
  return url;
}

const modelsUrl = deriveModelsUrl();

function apiHeaders(accept: string, includeJsonContentType = false): Headers {
  const headers = new Headers({ Accept: accept });
  if (includeJsonContentType) {
    headers.set("Content-Type", "application/json");
  }
  if (apiKey) {
    headers.set("Authorization", `Bearer ${apiKey}`);
  }
  if (provider === "google-gemini" && apiKey) {
    headers.set("x-goog-api-key", apiKey);
    headers.delete("Authorization");
  }
  if (provider === "xai-messages" && accept === "text/event-stream") {
    headers.set("anthropic-version", "2023-06-01");
    if (apiKey) headers.set("x-api-key", apiKey);
  }
  return headers;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function modelIds(payload: unknown): string[] {
  const data = record(payload);
  const entries = Array.isArray(payload) ? payload : data?.data ?? data?.models;
  if (!Array.isArray(entries)) {
    throw new Error("The models endpoint did not return a model list.");
  }

  const compatibleEntries = entries.filter((entry) => {
    const model = record(entry);
    if (provider === "google-gemini") {
      const methods = model?.supportedGenerationMethods;
      return (
        !Array.isArray(methods) || methods.includes("generateContent")
      );
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

function upstreamCompletionsUrl(model: string): URL {
  if (provider !== "google-gemini") return apiUrl;

  const url = new URL(apiUrl);
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/models/${encodeURIComponent(model)}:streamGenerateContent`;
  url.search = "";
  url.searchParams.set("alt", "sse");
  return url;
}

function upstreamRequestBody(body: {
  model: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
}): Record<string, unknown> {
  if (provider === "xai-messages") {
    return {
      model: body.model,
      max_tokens: 4096,
      messages: body.messages,
      stream: true,
    };
  }

  if (provider === "xai-responses") {
    return {
      model: body.model,
      input: body.messages.map(({ role, content }) => ({ role, content })),
      max_output_tokens: 4096,
      stream: true,
    };
  }

  if (provider === "google-gemini") {
    return {
      contents: body.messages.map(({ role, content }) => ({
        role: role === "assistant" ? "model" : "user",
        parts: [{ text: content }],
      })),
    };
  }

  return {
    model: body.model,
    messages: body.messages,
    stream: true,
  };
}

function isCompletionRequest(
  value: unknown,
): value is {
  model: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
} {
  const body = record(value);
  return (
    typeof body?.model === "string" &&
    body.model.length > 0 &&
    Array.isArray(body.messages) &&
    body.messages.length > 0 &&
    body.messages.every((message) => {
      const entry = record(message);
      return (
        (entry?.role === "user" || entry?.role === "assistant") &&
        typeof entry.content === "string"
      );
    })
  );
}

function upstreamError(error: unknown): Response {
  const message = error instanceof Error ? error.message : String(error);
  console.error("LLM API proxy failed:", message);
  return Response.json({ error: message }, { status: 502 });
}

const server = serve({
  routes: {
    "/api/readme": {
      GET: async () => {
        const readme = Bun.file("./README.md");
        if (!(await readme.exists())) {
          return new Response("README.md not found.", { status: 404 });
        }

        return new Response(readme, {
          headers: { "Content-Type": "text/markdown; charset=utf-8" },
        });
      },
    },
    "/api/models": {
      GET: async () => {
        try {
          const response = await fetch(modelsUrl, {
            headers: apiHeaders("application/json"),
          });
          if (!response.ok) {
            const body = await response.text();
            return new Response(body || response.statusText, {
              status: response.status,
              headers: {
                "Content-Type":
                  response.headers.get("Content-Type") ?? "text/plain",
              },
            });
          }
          return Response.json(modelIds(await response.json()), {
            headers: { "X-LLM-Provider": provider },
          });
        } catch (error) {
          return upstreamError(error);
        }
      },
    },
    "/api/chat/completions": {
      POST: async (request) => {
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return new Response("Request body must be valid JSON.", {
            status: 400,
          });
        }
        if (!isCompletionRequest(body)) {
          return new Response("A model and chat messages are required.", {
            status: 400,
          });
        }

        try {
          const response = await fetch(upstreamCompletionsUrl(body.model), {
            method: "POST",
            headers: apiHeaders("text/event-stream", true),
            body: JSON.stringify(upstreamRequestBody(body)),
          });
          if (!response.ok || !response.body) {
            const responseBody = await response.text();
            return new Response(
              responseBody || response.statusText || "The API returned no stream.",
              {
                status: response.ok ? 502 : response.status,
                headers: {
                  "Content-Type":
                    response.headers.get("Content-Type") ?? "text/plain",
                },
              },
            );
          }
          return new Response(response.body, {
            headers: {
              "Content-Type":
                response.headers.get("Content-Type") ?? "text/event-stream",
              "Cache-Control": "no-cache, no-transform",
              "X-Accel-Buffering": "no",
              "X-LLM-Provider": provider,
            },
          });
        } catch (error) {
          return upstreamError(error);
        }
      },
    },
    "/*": index,
  },
  development: {
    hmr: true,
    console: true,
  },
});

console.log(`Package playground running at ${server.url}`);
console.log(`LLM provider: ${provider}`);
console.log(`LLM API endpoint: ${apiUrl}`);
