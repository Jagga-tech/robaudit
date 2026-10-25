import { z } from "zod";

export const Extraction = z.object({
  facts: z.array(z.object({
    kind: z.enum(["remaining_update", "cost", "milestone", "other"]),
    amountText: z.string(),
    quote: z.string(),
    charStart: z.number().int(),
    charEnd: z.number().int(),
  })),
  ambiguity: z.object({
    flag: z.boolean(),
    kind: z.enum(["additional_vs_total", "none", "other"]),
    question: z.string(),
    options: z.array(z.string()),
  }),
});
export type Extraction = z.infer<typeof Extraction>;

export const Explanation = z.object({ summary: z.string(), whyRevenueMoved: z.string(), whatDidNotChange: z.string() });
export type Explanation = z.infer<typeof Explanation>;

export const Conventions = z.object({
  proposals: z.array(z.object({
    template: z.string(), key: z.string(), value: z.string(), rationale: z.string(),
    exampleSourceIds: z.array(z.number().int()),
  })),
});
export type Conventions = z.infer<typeof Conventions>;
