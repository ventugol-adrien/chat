/// <reference path="./src/styles.d.ts" />

import { createRoot } from "react-dom/client";
import { useState } from "react";
import { LLMChat, useLLMChat } from "./src";
import {
  SHADCN_BASE_COLORS,
  SHADCN_DESIGN_PRESETS,
  SHADCN_THEME_PRESETS,
} from "./src/themePresets";
import "./src/styles.css";

type BaseColor = (typeof SHADCN_BASE_COLORS)[number];
type ThemeName = keyof typeof SHADCN_THEME_PRESETS;
type ThemeMode = "light" | "dark";

const themeNames = Object.keys(SHADCN_THEME_PRESETS) as ThemeName[];
const fontFamilies: Record<string, string> = {
  inter: "Inter, ui-sans-serif, system-ui, sans-serif",
  geist: "Geist, ui-sans-serif, system-ui, sans-serif",
  figtree: "Figtree, ui-sans-serif, system-ui, sans-serif",
  "jetbrains-mono": '"JetBrains Mono", ui-monospace, monospace',
  "noto-sans": '"Noto Sans", ui-sans-serif, system-ui, sans-serif',
};

function App() {
  const chat = useLLMChat({
    modelsUrl: "/api/models",
    completionsUrl: "/api/chat/completions",
  });
  const [mode, setMode] = useState<ThemeMode>("light");
  const [baseColor, setBaseColor] = useState<BaseColor>("mauve");
  const [themeName, setThemeName] = useState<ThemeName>("mauve");
  const [designPresetName, setDesignPresetName] = useState("radix-vega");
  const designPreset =
    SHADCN_DESIGN_PRESETS.find(({ name }) => name === designPresetName) ??
    SHADCN_DESIGN_PRESETS[0];
  const themeTokens = {
    ...SHADCN_THEME_PRESETS[baseColor][mode],
    ...SHADCN_THEME_PRESETS[themeName][mode],
  };
  const themeStyle = Object.fromEntries(
    Object.entries(themeTokens).map(([name, value]) => [`--${name}`, value]),
  ) as React.CSSProperties;

  const handleDesignPresetChange = (value: string) => {
    const preset = SHADCN_DESIGN_PRESETS.find(({ name }) => name === value);
    if (!preset) return;

    const nextBaseColor = SHADCN_BASE_COLORS.find(
      (color) => color === preset.baseColor,
    );
    const nextTheme = themeNames.find((name) => name === preset.theme);
    if (!nextBaseColor || !nextTheme) return;

    setDesignPresetName(preset.name);
    setBaseColor(nextBaseColor);
    setThemeName(nextTheme);
  };

  return (
    <main
      className={`mx-auto flex min-h-screen max-w-4xl flex-col justify-center gap-4 bg-background px-4 py-8 text-foreground transition-colors duration-200 ${
        mode === "dark" ? "dark" : ""
      }`}
      data-design-system={designPreset.base}
      data-design-style={designPreset.style}
      style={{
        ...themeStyle,
        colorScheme: mode,
        fontFamily: fontFamilies[designPreset.font] ?? "ui-sans-serif, system-ui, sans-serif",
      }}
    >
      <section
        aria-label="Theme settings"
        className="rounded-xl border bg-card p-4 text-card-foreground shadow-sm"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-sm font-semibold">Appearance</h1>
            <p className="text-xs text-muted-foreground">
              shadcn themes and design presets
            </p>
          </div>
          <div
            aria-label="Color scheme"
            className="inline-flex rounded-lg border bg-background p-1"
            role="group"
          >
            {(["light", "dark"] as const).map((themeMode) => (
              <button
                key={themeMode}
                aria-pressed={mode === themeMode}
                className={`rounded-md px-3 py-1.5 text-sm capitalize transition-colors ${
                  mode === themeMode
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                onClick={() => setMode(themeMode)}
                type="button"
              >
                {themeMode}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <label className="grid gap-1.5 text-xs font-medium">
            Base color
            <select
              aria-label="Base color"
              className="h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              value={baseColor}
              onChange={(event) => {
                const nextColor = SHADCN_BASE_COLORS.find(
                  (color) => color === event.currentTarget.value,
                );
                if (nextColor) setBaseColor(nextColor);
              }}
            >
              {SHADCN_BASE_COLORS.map((color) => (
                <option key={color} value={color}>
                  {SHADCN_THEME_PRESETS[color].label}
                </option>
              ))}
            </select>
          </label>

          <label className="grid gap-1.5 text-xs font-medium">
            Theme
            <select
              aria-label="Theme"
              className="h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              value={themeName}
              onChange={(event) => {
                const nextTheme = themeNames.find(
                  (name) => name === event.currentTarget.value,
                );
                if (nextTheme) setThemeName(nextTheme);
              }}
            >
              {themeNames.map((name) => (
                <option key={name} value={name}>
                  {SHADCN_THEME_PRESETS[name].label}
                </option>
              ))}
            </select>
          </label>

          <label className="grid gap-1.5 text-xs font-medium">
            Design preset
            <select
              aria-label="Design preset"
              className="h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              value={designPresetName}
              onChange={(event) =>
                handleDesignPresetChange(event.currentTarget.value)
              }
            >
              {SHADCN_DESIGN_PRESETS.map((preset) => (
                <option key={preset.name} value={preset.name}>
                  {preset.title}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <LLMChat
        {...chat}
        className="max-h-[720px]"
        title="LLM Markdown Streamer"
        placeholder="Send a message..."
        initialMessages={[
          {
            id: "welcome",
            role: "assistant",
            content: "Choose a model and send a message to stream a completion.",
          },
        ]}
      />
    </main>
  );
}

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Missing playground root element.");

createRoot(rootElement).render(<App />);
