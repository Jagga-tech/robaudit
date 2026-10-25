"use node";
import { v } from "convex/values";
import WebSocket from "ws";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";

const VERSION = "2026-08-14";
let warned = false;
function key() {
  const k = process.env.CARTESIA_API_KEY;
  if (!k && !warned) {
    console.log("MOCK: CARTESIA_API_KEY unset, using silent TTS and canned STT");
    warned = true;
  }
  return k;
}

// 44-byte RIFF header + mono PCM16 samples
function wav(pcm: Buffer, rate: number) {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write("WAVEfmt ", 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); // PCM
  h.writeUInt16LE(1, 22); // mono
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

export const speakQuestion = action({
  args: { id: v.id("clarifications") },
  handler: async (ctx, { id }) => {
    const c = await ctx.runQuery(internal.clarifications.get, { id });
    if (!c) throw new Error(`clarification ${id} not found`);
    const k = key();
    let audio: Blob;
    if (!k) {
      audio = new Blob([wav(Buffer.alloc(24000), 24000)], { type: "audio/wav" }); // 0.5 s @ 24 kHz s16
    } else {
      const res = await fetch("https://api.cartesia.ai/tts/bytes", {
        method: "POST",
        headers: { Authorization: `Bearer ${k}`, "Cartesia-Version": VERSION, "Content-Type": "application/json" },
        body: JSON.stringify({
          model_id: "sonic-3.6",
          transcript: c.question,
          voice: { id: process.env.CARTESIA_VOICE_ID ?? "694f9389-aac1-45b6-b726-9d9369183238" },
          output_format: { container: "wav", encoding: "pcm_s16le", sample_rate: 24000 },
        }),
      });
      if (!res.ok) throw new Error(`Cartesia TTS ${res.status}: ${await res.text()}`);
      audio = new Blob([await res.arrayBuffer()], { type: "audio/wav" });
    }
    const storageId = await ctx.storage.store(audio);
    await ctx.runMutation(internal.clarifications.setQuestionAudio, { id, storageId });
  },
});

function stt(pcm: Buffer, apiKey: string): Promise<string> {
  const url = `wss://api.cartesia.ai/stt/websocket?model=ink-2&encoding=pcm_s16le&sample_rate=16000&cartesia_version=${VERSION}`;
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { headers: { "X-API-Key": apiKey } });
    let text = "";
    let done = false;
    const timer = setTimeout(() => (ws.terminate(), reject(new Error("Cartesia STT timeout"))), 60_000);
    const finish = (err?: Error) => {
      clearTimeout(timer);
      ws.close();
      err ? reject(err) : resolve(text);
    };
    ws.on("open", () => {
      for (let i = 0; i < pcm.length; i += 3200) ws.send(pcm.subarray(i, i + 3200)); // 100 ms chunks
      ws.send("finalize");
      ws.send("close");
    });
    ws.on("message", (data, isBinary) => {
      if (isBinary) return;
      let m;
      try {
        m = JSON.parse(data.toString());
      } catch (e) {
        return finish(e as Error);
      }
      if (m.type === "transcript" && m.is_final) text += m.text ?? "";
      else if (m.type === "done") (done = true, finish());
      else if (m.type === "error") finish(new Error(`Cartesia STT error: ${JSON.stringify(m)}`));
    });
    ws.on("error", (e) => finish(e));
    ws.on("close", (code) => finish(done || code === 1000 ? undefined : new Error(`Cartesia STT closed early (${code})`)));
  });
}

export const transcribe = action({
  args: { id: v.id("clarifications"), storageId: v.id("_storage") },
  handler: async (ctx, { id, storageId }) => {
    const k = key();
    let text = "MOCK: it's additional";
    if (k) {
      const blob = await ctx.storage.get(storageId);
      if (!blob) throw new Error(`audio ${storageId} not found`);
      text = await stt(Buffer.from(await blob.arrayBuffer()).subarray(44), k); // strip WAV header
    }
    await ctx.runMutation(internal.clarifications.addSegment, { id, storageId, seq: 0, text, isFinal: true });
  },
});
