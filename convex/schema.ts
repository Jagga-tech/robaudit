import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const status = v.union(
  v.literal("ringing"),
  v.literal("answering"),
  v.literal("confirmed"),
  v.literal("unconfirmed"),
  v.literal("fallback_text"),
);

export default defineSchema({
  ...authTables,
  clarifications: defineTable({
    workItemId: v.string(),
    question: v.string(),
    options: v.array(v.string()),
    status,
    answer: v.optional(v.string()),
    speaker: v.optional(v.string()),
    speakerUserId: v.optional(v.id("users")), // Convex Auth session that confirmed
    reason: v.optional(v.string()),
    questionAudioId: v.optional(v.id("_storage")),
    answerAudioId: v.optional(v.id("_storage")),
    confirmedAt: v.optional(v.number()),
  }).index("by_workItem", ["workItemId"]),
  transcriptSegments: defineTable({
    clarificationId: v.id("clarifications"),
    seq: v.number(),
    text: v.string(),
    isFinal: v.boolean(),
  }).index("by_clarification", ["clarificationId", "seq"]),
  managers: defineTable({ name: v.string(), joinedAt: v.number(), active: v.boolean() }),
});
