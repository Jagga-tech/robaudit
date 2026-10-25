import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { prompt } from "./claude.js"; // also loads .env
import { mockExtract, normalizeFacts } from "./extract.js";
import { Extraction } from "./schemas.js";

const hasGeminiKey = !!process.env.GEMINI_API_KEY;
if (!hasGeminiKey) console.log("MOCK: gemini");
const SYSTEM = prompt("extract");
const { $schema: _, ...SCHEMA } = z.toJSONSchema(Extraction);
let ai: GoogleGenAI | undefined;

export async function extractWithGemini(noteText: string): Promise<Extraction> {
  if (!hasGeminiKey) return mockExtract(noteText);
  ai ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const res = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: `<note>${noteText}</note>`,
    config: { responseMimeType: "application/json", responseJsonSchema: SCHEMA, systemInstruction: SYSTEM },
  });
  if (!res.text) throw new Error("Gemini returned no text");
  return normalizeFacts(noteText, Extraction.parse(JSON.parse(res.text)));
}
