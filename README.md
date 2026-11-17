# llm-markdown-streamer

A standalone React package for rendering LLM Markdown (including GFM, reasoning,
and token metrics) and accumulating streamed response chunks.

## Install

```bash
bun add llm-markdown-streamer react
```

## Render Markdown

```tsx
import "llm-markdown-streamer/styles.css";
import { LLMMarkdown } from "llm-markdown-streamer";

<LLMMarkdown
  content={content}
  reasoning={reasoning}
  metrics={{ ttft: 0.3, thinking_time: 1.2, tps: 42, total_tokens: 87 }}
/>;
```

The renderer includes copy controls for code blocks and quotes, and a collapsible
reasoning section. Import the package stylesheet once in your application entry.
The package stylesheet contains the compiled Tailwind utilities and the selected
shadcn mauve/pink theme, so consumers do not need to configure Tailwind.

## Accumulate a stream

```tsx
import { useEffect } from "react";
import { LLMMarkdown, useLLMMarkdownStream } from "llm-markdown-streamer";

function Response({ chunks }: { chunks: AsyncIterable<{ token: string; reasoning?: string }> }) {
  const stream = useLLMMarkdownStream();

  useEffect(() => {
    void stream.consume(chunks).catch(console.error);
  }, [chunks, stream.consume]);

  return (
    <LLMMarkdown
      content={stream.content}
      reasoning={stream.reasoning}
      isStreaming={stream.isStreaming}
    />
  );
}
```

`consume` accepts an async iterable of LLM chunks, appending each `token` and
`reasoning` value as it arrives. Its promise rejects if the iterable fails.
`append` can also be used to connect an existing stream loop, and `reset` clears
or replaces the accumulated content.

While streaming, the renderer displays a caret. Updates are batched per animation
frame and Markdown parsing is deferred to keep rendering responsive.

## API

- `useLLMChat({ modelsUrl, completionsUrl, provider?, headers? })` loads
  compatible models and returns the props needed by `LLMChat`. It parses
  OpenAI-compatible, xAI Messages, xAI Responses, and Gemini stream responses.
  Keep private API keys on a server and proxy requests through it. The optional
  `provider` selects a parser when the response does not include the proxy's
  provider header.
- `LLMMarkdown` renders Markdown and optional reasoning and metrics, with a
  streaming caret when `isStreaming` is true.
- `useLLMMarkdownStream` returns `content`, `reasoning`, `append`, `consume`,
  `reset`, and `isStreaming`.
- `LLMChat` renders a reusable chat UI with right-aligned user messages,
  left-aligned Markdown responses, and a streaming composer. Its `onSend`
  callback receives the prompt, full conversation, and optional selected model,
  and returns an `AsyncIterable` of `{ token?, reasoning? }` chunks. The optional
  `models`, `model`, and `onModelChange` props add a model selector. The component
  does not depend on a model provider or backend.
- `LLMMarkdownChunk`, `LLMMarkdownMetrics`, and `LLMMarkdownProps` are exported
  types, along with `LLMChatMessage`, `LLMChatProps`, and `LLMChatResponse`.

## Chat

```tsx
import "llm-markdown-streamer/styles.css";
import { LLMChat, useLLMChat } from "llm-markdown-streamer";

function Chat() {
  const chat = useLLMChat({
    modelsUrl: "/api/models",
    completionsUrl: "/api/chat/completions",
  });

  return (
    <LLMChat
      {...chat}
      initialMessages={[
        { id: "welcome", role: "assistant", content: "How can I help?" },
      ]}
    />
  );
}
```

Press Enter to send and Shift+Enter to add a line break. The component keeps
conversation state internally and passes the updated history to `onSend`.

## Playground appearance

The playground includes light and dark modes, with the selected shadcn theme
applied in either mode. Choose a base color (`Neutral`, `Stone`, `Zinc`, `Mauve`,
`Olive`, `Mist`, or `Taupe`) and a theme palette (`Amber`, `Blue`, `Cyan`,
`Emerald`, `Fuchsia`, `Green`, `Indigo`, `Lime`, `Orange`, `Pink`, `Purple`,
`Red`, `Rose`, `Sky`, `Teal`, `Violet`, `Yellow`, or one of the base colors).

The design preset selector includes the available Vega, Nova, Maia, Lyra, Mira,
Luma, Rhea, and Sera presets for Radix, Base UI, and React Aria. Selecting a
design preset applies its configured base color, theme, and font; these can
then be changed independently. These controls are playground-only and do not
change the package's default mauve/pink stylesheet.

## Completions API development

The playground proxies chat and model-list requests through its Bun server.
Select the provider and configure its API endpoint in `.env`:

```dotenv
LLM_PROVIDER=openai
LLM_API_URL=https://llm.taile72000.ts.net/v1/chat/completions
LLM_MODELS_URL=https://llm.taile72000.ts.net/v1/models
LLM_API_KEY=
```

Supported values are `openai`, `xai-messages`, `xai-responses`, and
`google-gemini`. For xAI Messages, set
`LLM_API_URL=https://api.x.ai/v1/messages`; for xAI Responses, set
`LLM_API_URL=https://api.x.ai/v1/responses`. Both use `/v1/language-models`
when `LLM_MODELS_URL` is omitted, excluding image-generation-only models. For
Gemini, set `LLM_API_URL=https://generativelanguage.googleapis.com/v1beta`; the
adapter builds the model-specific `streamGenerateContent` URL and filters out
models that do not support content generation. `LLM_API_URL` is required, and
`LLM_MODELS_URL` is optional. xAI uses `LLM_API_KEY`; Gemini reads
`GEMINI_API_KEY` or `GOOGLE_API_KEY`, falling back to `LLM_API_KEY`. Keys remain
server-side. Copy `.env.example` to `.env`, then run `bun run dev`. The proxy
maps provider-specific requests and model lists, while the hook normalizes
streamed content and reasoning for `LLMChat`.

## Development

```bash
bun install
bun run dev
bun run typecheck
bun run build
```

`bun run dev` starts the playground with the provider configured in `.env`.
