import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const join = mutation({
  args: { name: v.string() },
  handler: async (ctx, { name }) => {
    for (const m of await ctx.db.query("managers").collect()) if (m.active) await ctx.db.patch(m._id, { active: false });
    return ctx.db.insert("managers", { name, joinedAt: Date.now(), active: true });
  },
});

export const leave = mutation({
  args: { id: v.id("managers") },
  handler: (ctx, { id }) => ctx.db.patch(id, { active: false }),
});

export const current = query({
  args: {},
  handler: async (ctx) => {
    const m = (await ctx.db.query("managers").collect()).filter((x) => x.active).sort((a, b) => b.joinedAt - a.joinedAt)[0];
    return m ? { _id: m._id, name: m.name, joinedAt: m.joinedAt } : null;
  },
});
