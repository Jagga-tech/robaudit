import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { api } from "./_generated/api";

const id = v.id("clarifications");
const OPEN = ["ringing", "answering", "fallback_text"];

export const ask = mutation({
  args: { workItemId: v.string(), question: v.string(), options: v.array(v.string()) },
  handler: async (ctx, args) => {
    const cid = await ctx.db.insert("clarifications", { ...args, status: "ringing" });
    await ctx.scheduler.runAfter(0, api.voice.speakQuestion, { id: cid });
    return cid;
  },
});

export const active = query({
  args: {},
  handler: async (ctx) => {
    // ponytail: full scan newest-first; add a by_status index if the table grows large
    for await (const c of ctx.db.query("clarifications").order("desc")) {
      if (OPEN.includes(c.status)) return c;
    }
    return null;
  },
});

export const byWorkItem = query({
  args: { workItemId: v.string() },
  handler: (ctx, { workItemId }) =>
    ctx.db.query("clarifications").withIndex("by_workItem", (q) => q.eq("workItemId", workItemId)).collect(),
});

export const startAnswer = mutation({
  args: { id },
  handler: (ctx, a) => ctx.db.patch(a.id, { status: "answering" }),
});

export const confirm = mutation({
  args: { id, answer: v.string(), speaker: v.string() },
  handler: async (ctx, { id, answer, speaker }) => {
    const c = await ctx.db.get(id);
    if (!c) throw new Error(`clarification ${id} not found`);
    if (c.status === "confirmed") return; // idempotent: first confirmation wins
    await ctx.db.patch(id, { status: "confirmed", answer, speaker, confirmedAt: Date.now() });
  },
});

export const decline = mutation({
  args: { id, reason: v.string() },
  handler: async (ctx, { id, reason }) => {
    const c = await ctx.db.get(id);
    if (!c || c.status === "confirmed") return;
    await ctx.db.patch(id, { status: "unconfirmed", reason });
  },
});

export const resetOpen = mutation({
  args: {},
  handler: async (ctx) => {
    for await (const c of ctx.db.query("clarifications")) {
      if (OPEN.includes(c.status)) await ctx.db.patch(c._id, { status: "unconfirmed", reason: "reset" });
    }
  },
});

export const fallbackText = mutation({
  args: { id },
  handler: (ctx, a) => ctx.db.patch(a.id, { status: "fallback_text" }),
});

export const generateUploadUrl = mutation({
  args: {},
  handler: (ctx) => ctx.storage.generateUploadUrl(),
});

export const submitAnswerAudio = mutation({
  args: { id, storageId: v.id("_storage") },
  handler: async (ctx, { id, storageId }) => {
    await ctx.scheduler.runAfter(0, api.voice.transcribe, { id, storageId });
  },
});

// internal helpers for voice.ts ("use node" files cannot define queries/mutations)
export const get = internalQuery({ args: { id }, handler: (ctx, a) => ctx.db.get(a.id) });

export const setQuestionAudio = internalMutation({
  args: { id, storageId: v.id("_storage") },
  handler: (ctx, { id, storageId }) => ctx.db.patch(id, { questionAudioId: storageId }),
});

export const addSegment = internalMutation({
  args: { id, storageId: v.id("_storage"), seq: v.number(), text: v.string(), isFinal: v.boolean() },
  handler: async (ctx, { id, storageId, seq, text, isFinal }) => {
    await ctx.db.insert("transcriptSegments", { clarificationId: id, seq, text, isFinal });
    await ctx.db.patch(id, { answerAudioId: storageId });
  },
});
