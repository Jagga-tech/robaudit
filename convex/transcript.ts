import { v } from "convex/values";
import { query } from "./_generated/server";

export const byClarification = query({
  args: { id: v.id("clarifications") },
  handler: (ctx, { id }) =>
    ctx.db.query("transcriptSegments").withIndex("by_clarification", (q) => q.eq("clarificationId", id)).collect(),
});
