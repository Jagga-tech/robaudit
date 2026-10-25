import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../_generated/api";

function convexUrl() {
  if (process.env.CONVEX_URL) return process.env.CONVEX_URL;
  try {
    return readFileSync(new URL("../../.env.local", import.meta.url), "utf8").match(/^CONVEX_URL=(.+)$/m)?.[1].trim();
  } catch {
    return undefined;
  }
}
const url = convexUrl();
if (!url) console.warn("SKIP convex e2e: CONVEX_URL unset (run `npx convex dev --once` to create .env.local)");

describe.skipIf(!url)("clarification channel e2e", () => {
  const c = url ? new ConvexHttpClient(url) : (null as never);
  const workItemId = `test-${Date.now()}`;

  it("ask -> ring -> audio -> confirm (idempotent) -> fallback", async () => {
    const id = await c.mutation(api.clarifications.ask, {
      workItemId,
      question: "Is this invoice additional or a duplicate?",
      options: ["additional", "duplicate"],
    });
    const ringing = await c.query(api.clarifications.active, {});
    expect(ringing?._id).toBe(id);
    expect(ringing?.status).toBe("ringing");

    let row = ringing;
    for (const end = Date.now() + 10_000; !row?.questionAudioId && Date.now() < end; ) {
      await new Promise((r) => setTimeout(r, 250));
      [row] = await c.query(api.clarifications.byWorkItem, { workItemId });
    }
    expect(row?.questionAudioId).toBeTruthy();

    await c.mutation(api.clarifications.confirm, { id, answer: "it's additional", speaker: "owner" });
    await c.mutation(api.clarifications.confirm, { id, answer: "it's a duplicate", speaker: "someone" });
    [row] = await c.query(api.clarifications.byWorkItem, { workItemId });
    expect(row).toMatchObject({ status: "confirmed", answer: "it's additional", speaker: "owner" });

    const id2 = await c.mutation(api.clarifications.ask, { workItemId, question: "Which vendor?", options: [] });
    await c.mutation(api.clarifications.fallbackText, { id: id2 });
    const active = await c.query(api.clarifications.active, {});
    expect(active).toMatchObject({ _id: id2, status: "fallback_text" });
    await c.mutation(api.clarifications.decline, { id: id2, reason: "test cleanup" });
  }, 20_000);

  it("submitAnswerAudio -> transcript segment", async () => {
    const id = await c.mutation(api.clarifications.ask, { workItemId, question: "Additional?", options: [] });
    const uploadUrl = await c.mutation(api.clarifications.generateUploadUrl, {});
    const res = await fetch(uploadUrl, { method: "POST", headers: { "Content-Type": "audio/wav" }, body: new Uint8Array(44 + 3200) });
    const { storageId } = await res.json();
    await c.mutation(api.clarifications.submitAnswerAudio, { id, storageId });
    let segs: { text: string; isFinal: boolean }[] = [];
    for (const end = Date.now() + 15_000; !segs.length && Date.now() < end; ) {
      await new Promise((r) => setTimeout(r, 250));
      segs = await c.query(api.transcript.byClarification, { id });
    }
    expect(segs.length).toBe(1);
    expect(segs[0].isFinal).toBe(true);
    await c.mutation(api.clarifications.decline, { id, reason: "test cleanup" }); // leave nothing open
  }, 20_000);

  it("resetOpen clears the active clarification", async () => {
    await c.mutation(api.clarifications.ask, { workItemId, question: "Reset me?", options: [] });
    expect(await c.query(api.clarifications.active, {})).not.toBeNull();
    await c.mutation(api.clarifications.resetOpen, {});
    expect(await c.query(api.clarifications.active, {})).toBeNull();
  });
});
