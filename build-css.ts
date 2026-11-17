import tailwind from "bun-plugin-tailwind";

const result = await Bun.build({
  entrypoints: ["src/styles.css"],
  outdir: "dist",
  plugins: [tailwind],
  target: "browser",
  minify: true,
});

if (!result.success) {
  console.error(...result.logs);
  throw new Error("Failed to build Tailwind styles.");
}
