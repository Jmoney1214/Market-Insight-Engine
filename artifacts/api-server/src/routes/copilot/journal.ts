import { Router, type IRouter } from "express";
import { db, journalEntriesTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { CreateJournalEntryBody } from "@workspace/api-zod";

const router: IRouter = Router();

/** Stable dedup key from the journaled event snapshot, if it carries one. */
export function eventIdOf(snapshot: unknown): string | null {
  if (snapshot && typeof snapshot === "object" && "eventId" in snapshot) {
    const v = (snapshot as { eventId?: unknown }).eventId;
    if (typeof v === "string" && v.length > 0) return v;
  }
  return null;
}

function serialize(row: typeof journalEntriesTable.$inferSelect) {
  return {
    id: row.id,
    mode: row.mode,
    symbol: row.symbol,
    eventTimestamp: row.eventTimestamp ? row.eventTimestamp.toISOString() : null,
    eventSnapshot: row.eventSnapshot ?? null,
    manualOutcome: row.manualOutcome ?? null,
    notes: row.notes ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

router.get("/journal", async (_req, res) => {
  const rows = await db
    .select()
    .from(journalEntriesTable)
    .orderBy(desc(journalEntriesTable.createdAt))
    .limit(100);
  res.json(rows.map(serialize));
});

router.post("/journal", async (req, res) => {
  const parsed = CreateJournalEntryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid journal entry" });
    return;
  }

  const { mode, symbol, eventTimestamp, eventSnapshot, manualOutcome, notes } = parsed.data;

  let eventTs: Date | null = null;
  if (eventTimestamp) {
    const parsedDate = new Date(eventTimestamp);
    if (Number.isNaN(parsedDate.getTime())) {
      res.status(400).json({ error: "Invalid eventTimestamp" });
      return;
    }
    eventTs = parsedDate;
  }

  const eventId = eventIdOf(eventSnapshot);
  const [inserted] = await db
    .insert(journalEntriesTable)
    .values({
      eventId,
      mode,
      symbol,
      eventTimestamp: eventTs,
      eventSnapshot: eventSnapshot ?? null,
      manualOutcome: manualOutcome ?? null,
      notes: notes ?? null,
    })
    .onConflictDoNothing({ target: journalEntriesTable.eventId })
    .returning();

  if (!inserted) {
    // Idempotent replay: this event was already journaled (double-click / retry). Return the
    // existing row (200) rather than double-counting the outcome into the edge scoreboard.
    const [existing] = eventId
      ? await db.select().from(journalEntriesTable).where(eq(journalEntriesTable.eventId, eventId)).limit(1)
      : [];
    res.status(existing ? 200 : 201).json(existing ? serialize(existing) : { deduped: true });
    return;
  }

  res.status(201).json(serialize(inserted));
});

router.delete("/journal/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid journal entry ID" });
    return;
  }

  await db.delete(journalEntriesTable).where(eq(journalEntriesTable.id, id));
  res.status(204).send();
});

export default router;
