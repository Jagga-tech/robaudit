import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { prompt } from "./claude.js"; // also loads .env
import { normalizeFacts } from "./extract.js";
import { Extraction } from "./schemas.js";

export const hasGeminiKey = !!process.env.GEMINI_API_KEY;
if (!hasGeminiKey) console.log("second reader disabled: no GEMINI_API_KEY");
const SYSTEM = prompt("extract");
let ai: GoogleGenAI | undefined;

/** One Gemini call with JSON-schema output, parsed by `schema`. Throws without a key (callers treat that as "off"). */
export async function geminiJson<T>(schema: z.ZodType<T>, system: string, contents: string): Promise<T> {
  if (!hasGeminiKey) throw new Error("no GEMINI_API_KEY");
  ai ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const { $schema: _s, ...responseJsonSchema } = z.toJSONSchema(schema) as Record<string, unknown>;
  const res = await ai.models.generateContent({
    model: process.env.GEMINI_MODEL ?? "gemini-3.5-flash-lite",
    contents,
    config: { responseMimeType: "application/json", responseJsonSchema, systemInstruction: system },
  });
  if (!res.text) throw new Error("Gemini returned no text");
  return schema.parse(JSON.parse(res.text));
}

// No key = no second reader (throw, so extractBoth runs Claude alone); never a mock vote.
export async function extractWithGemini(noteText: string): Promise<Extraction> {
  return normalizeFacts(noteText, await geminiJson(Extraction, SYSTEM, `<note>${noteText}</note>`));
}
