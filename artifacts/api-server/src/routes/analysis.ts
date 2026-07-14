import { Router } from "express";
import { db, reportsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { AnalyzeTickerBody, GetReportParams, DeleteReportParams } from "@workspace/api-zod";
import { buildReport, NoLiveDataError } from "../lib/buildReport.js";

const router = Router();

router.post("/analyze", async (req, res) => {
  const parsed = AnalyzeTickerBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request: ticker is required" });
    return;
  }

  const { ticker } = parsed.data;
  const tickerUpper = ticker.toUpperCase().trim();

  if (!tickerUpper || tickerUpper.length > 6) {
    res.status(400).json({ error: "Invalid ticker symbol" });
    return;
  }

  let report: Awaited<ReturnType<typeof buildReport>>;
  try {
    report = await buildReport(tickerUpper, 0);
  } catch (err) {
    if (err instanceof NoLiveDataError) {
      // Fail closed: without providers we return an error, never a fabricated report.
      res.status(503).json({ error: err.message });
      return;
    }
    throw err;
  }

  const [inserted] = await db
    .insert(reportsTable)
    .values({
      ticker: tickerUpper,
      companyName: report.companyName,
      sector: report.sector,
      industry: report.industry,
      overallRating: report.overallRating,
      source: report.dataSource ?? "unknown",
      reportData: report as unknown as Record<string, unknown>,
    })
    .returning();

  const fullReport = {
    ...(inserted.reportData as Record<string, unknown>),
    id: inserted.id,
    generatedAt: inserted.generatedAt.toISOString(),
  };

  res.status(201).json(fullReport);
});

router.get("/reports", async (req, res) => {
  const reports = await db
    .select({
      id: reportsTable.id,
      ticker: reportsTable.ticker,
      companyName: reportsTable.companyName,
      sector: reportsTable.sector,
      overallRating: reportsTable.overallRating,
      source: reportsTable.source,
      generatedAt: reportsTable.generatedAt,
    })
    .from(reportsTable)
    .orderBy(desc(reportsTable.generatedAt))
    .limit(20);

  res.json(
    reports.map((r) => ({
      ...r,
      generatedAt: r.generatedAt.toISOString(),
    }))
  );
});

router.get("/reports/:id", async (req, res) => {
  const parsed = GetReportParams.safeParse({ id: Number(req.params.id) });
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid report ID" });
    return;
  }

  const [report] = await db
    .select()
    .from(reportsTable)
    .where(eq(reportsTable.id, parsed.data.id));

  if (!report) {
    res.status(404).json({ error: "Report not found" });
    return;
  }

  const fullReport = {
    ...(report.reportData as Record<string, unknown>),
    id: report.id,
    generatedAt: report.generatedAt.toISOString(),
  };

  res.json(fullReport);
});

router.delete("/reports/:id", async (req, res) => {
  const parsed = DeleteReportParams.safeParse({ id: Number(req.params.id) });
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid report ID" });
    return;
  }

  await db.delete(reportsTable).where(eq(reportsTable.id, parsed.data.id));
  res.status(204).send();
});

export default router;
