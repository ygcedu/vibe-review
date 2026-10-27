import { z } from "zod";

const baseTab = { id: z.string(), path: z.string() };
export const savedDiffSchema = z.object({
  tabs: z.array(z.discriminatedUnion("source", [
    z.object({ ...baseTab, source: z.literal("compare"), hash: z.string(), status: z.string() }),
    z.object({ ...baseTab, source: z.literal("history"), hash: z.string(), status: z.string() }),
    z.object({ ...baseTab, source: z.literal("shelf"), entryId: z.string(), label: z.string(), status: z.string().optional() }),
    z.object({ ...baseTab, source: z.literal("working"), staged: z.boolean(), status: z.string().optional() }),
  ])),
  activeTabId: z.string().nullable(),
});
export const emptySavedDiff: z.infer<typeof savedDiffSchema> = { tabs: [], activeTabId: null };

/** Compare schema-normalized values, never caller-dependent property order. */
export function serializeSavedDiff(value: unknown): string {
  return JSON.stringify(savedDiffSchema.parse(value));
}
