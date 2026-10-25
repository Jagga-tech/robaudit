import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { prompt } from "./claude.js"; // also loads .env
import { normalizeFacts } from "./extract.js";
import { Extraction } from "./schemas.js";

export const hasGeminiKey = !!process.env.GEMINI_API_KEY;
if (!hasGeminiKey) console.log("second reader disabled: no GEMINI_API_KEY");
const SYSTEM = prompt("extract");
const { $schema: _, ...SCHEMA } = z.toJSONSchema(Extraction);
let ai: GoogleGenAI | undefined;

// No key = no second reader (throw, so extractBoth runs Claude alone); never a mock vote.
export async function extractWithGemini(noteText: string): Promise<Extraction> {
  if (!hasGeminiKey) throw new Error("no GEMINI_API_KEY");
  ai ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const res = await ai.models.generateContent({
    model: process.env.GEMINI_MODEL ?? "gemini-3.5-flash-lite",
    contents: `<note>${noteText}</note>`,
    config: { responseMimeType: "application/json", responseJsonSchema: SCHEMA, systemInstruction: SYSTEM },
  });
  if (!res.text) throw new Error("Gemini returned no text");
  return normalizeFacts(noteText, Extraction.parse(JSON.parse(res.text)));
}
