import fs from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";

// ponytail: minimal .env loader (KEY=VALUE lines), never overrides real env, never prints values
try {
  for (const line of fs.readFileSync(new URL("../../../.env", import.meta.url), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && m[2] && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {}

export const hasKey = !!process.env.ANTHROPIC_API_KEY;
if (!hasKey) console.log("MOCK: anthropic");

export const prompt = (name: string) => fs.readFileSync(new URL(`../prompts/${name}.txt`, import.meta.url), "utf8");

let client: Anthropic | undefined;

export async function structured<S extends z.ZodType>(schema: S, system: string, userText: string): Promise<z.infer<S>> {
  client ??= new Anthropic({ timeout: 30_000, maxRetries: 1 });
  const res = await client.beta.messages.parse({
    model: "claude-opus-5-5",
    max_tokens: 2048,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: userText }],
    output_config: { effort: "low", format: betaZodOutputFormat(schema) },
  });
  if (res.stop_reason === "refusal") throw new Error(`Claude refused: ${res.stop_details?.category ?? "unknown"} ${res.stop_details?.explanation ?? ""}`.trim());
  if (res.parsed_output == null) throw new Error(`Claude output did not parse (stop_reason=${res.stop_reason})`);
  return res.parsed_output as z.infer<S>;
}
