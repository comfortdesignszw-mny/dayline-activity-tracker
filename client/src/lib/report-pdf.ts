// Weekly / monthly PDF report. jsPDF is imported lazily so the ~350 KB library
// never lands in the main bundle — the export page is the only thing that needs
// it, and only when the user actually clicks Download.
import type { ReportModel } from "@shared/export";
import { formatDuration, formatLongDay } from "@shared/analytics";

const INK = [28, 25, 23] as const;
const MUTED = [120, 113, 108] as const;
const HAIRLINE = [231, 225, 217] as const;
const TERRA = [194, 65, 12] as const;
const CANVAS = [250, 247, 242] as const;

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  const full =
    clean.length === 3
      ? clean
          .split("")
          .map((c) => c + c)
          .join("")
      : clean;
  const n = Number.parseInt(full, 16);
  if (!Number.isFinite(n)) return [120, 113, 108];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Renders the report and returns the jsPDF instance. The caller decides whether
 * to save or open it, which keeps this function testable and side-effect free
 * apart from the document it builds.
 */
export async function buildReportPdf(model: ReportModel) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "a4" });

  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 48;
  const contentW = W - M * 2;
  let y = 0;

  const setFill = (c: readonly [number, number, number]) => doc.setFillColor(c[0], c[1], c[2]);
  const setText = (c: readonly [number, number, number]) => doc.setTextColor(c[0], c[1], c[2]);
  const setDraw = (c: readonly [number, number, number]) => doc.setDrawColor(c[0], c[1], c[2]);

  // ── Header band ────────────────────────────────────────────────────────────
  setFill(CANVAS);
  doc.rect(0, 0, W, 132, "F");

  setFill(TERRA);
  doc.roundedRect(M, 40, 26, 26, 7, 7, "F");
  setText([250, 247, 242]);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text("D", M + 8.5, 58);

  setText(INK);
  doc.setFontSize(11);
  doc.text("Dayline", M + 36, 58);

  setText(MUTED);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(model.title, M, 88);

  setText(INK);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  const rangeLabel =
    model.from === model.to
      ? formatLongDay(model.from)
      : `${formatLongDay(model.from)} — ${formatLongDay(model.to)}`;
  doc.text(rangeLabel, M, 112);

  setText(MUTED);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.text(`Generated ${formatLongDay(model.generatedOn)}`, W - M, 58, { align: "right" });

  y = 168;

  // ── Stat row ───────────────────────────────────────────────────────────────
  const stats: [string, string][] = [
    ["Total tracked", formatDuration(model.totalMinutes)],
    ["Entries", String(model.entryCount)],
    ["Daily average", formatDuration(model.dailyAverageMinutes)],
    ["Active days", `${model.activeDays} / ${model.dayCount}`],
    ["Current streak", `${model.streak.current}d`],
  ];
  const gap = 8;
  const cardW = (contentW - gap * (stats.length - 1)) / stats.length;

  stats.forEach(([label, value], i) => {
    const x = M + i * (cardW + gap);
    setFill([255, 255, 255]);
    setDraw(HAIRLINE);
    doc.setLineWidth(0.7);
    doc.roundedRect(x, y, cardW, 58, 6, 6, "FD");

    setText(MUTED);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.8);
    doc.text(label.toUpperCase(), x + 9, y + 18);

    setText(INK);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.text(value, x + 9, y + 40);
  });

  y += 58 + 30;

  // ── Section heading helper ─────────────────────────────────────────────────
  const heading = (text: string, sub?: string) => {
    setText(INK);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(text, M, y);
    if (sub) {
      setText(MUTED);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.text(sub, M, y + 12);
      y += 12;
    }
    y += 16;
  };

  // ── Daily bar chart ────────────────────────────────────────────────────────
  heading("Time per day", "Minutes tracked, by day");

  const chartH = 96;
  const chartTop = y;
  const maxDay = Math.max(1, ...model.days.map((d) => d.totalMinutes));
  const slot = contentW / Math.max(1, model.days.length);
  const barW = Math.min(26, slot * 0.55);

  // baseline
  setDraw(HAIRLINE);
  doc.setLineWidth(0.7);
  doc.line(M, chartTop + chartH, M + contentW, chartTop + chartH);

  model.days.forEach((d, i) => {
    const h = (d.totalMinutes / maxDay) * chartH;
    const x = M + slot * i + (slot - barW) / 2;
    if (h > 0) {
      setFill(TERRA);
      doc.roundedRect(x, chartTop + chartH - h, barW, h, 2, 2, "F");
    } else {
      setFill([238, 233, 226]);
      doc.rect(x, chartTop + chartH - 2, barW, 2, "F");
    }
    setText(MUTED);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.5);
    // Only label every other day on a month, so the axis stays readable.
    if (model.days.length <= 10 || i % 2 === 0) {
      doc.text(d.label.slice(0, 3), x + barW / 2, chartTop + chartH + 11, { align: "center" });
    }
  });

  y = chartTop + chartH + 30;

  // ── Category breakdown ─────────────────────────────────────────────────────
  if (model.categories.length > 0) {
    heading("Where the time went", "Share of tracked time by category");

    const rowH = 17;
    const labelW = 96;
    const barMaxW = contentW - labelW - 96;

    model.categories.slice(0, 10).forEach((c) => {
      const rgb = hexToRgb(c.color);
      setFill(rgb);
      doc.circle(M + 3, y - 3, 2.6, "F");

      setText(INK);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      doc.text(c.label, M + 12, y);

      const w = Math.max(1, c.share * barMaxW);
      setFill([240, 235, 228]);
      doc.roundedRect(M + labelW, y - 7, barMaxW, 7, 2, 2, "F");
      setFill(rgb);
      doc.roundedRect(M + labelW, y - 7, w, 7, 2, 2, "F");

      setText(MUTED);
      doc.setFontSize(8);
      doc.text(
        `${formatDuration(c.minutes)}  ·  ${Math.round(c.share * 100)}%`,
        M + contentW,
        y,
        { align: "right" },
      );
      y += rowH;
    });
    y += 14;
  }

  // ── Goals ──────────────────────────────────────────────────────────────────
  if (model.goals.length > 0) {
    if (y > H - 200) {
      doc.addPage();
      y = 64;
    }
    heading("Goals", "Progress against your targets");

    model.goals.forEach((g) => {
      const rgb = hexToRgb(g.color);
      setText(INK);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      doc.text(g.label, M, y);

      setText(MUTED);
      doc.setFontSize(8);
      doc.text(
        `${formatDuration(g.actual)} of ${formatDuration(g.target)}${g.met ? "  ✓ met" : ""}`,
        M + contentW,
        y,
        { align: "right" },
      );

      const ratio = Math.min(1, g.actual / Math.max(1, g.target));
      setFill([240, 235, 228]);
      doc.roundedRect(M, y + 5, contentW, 5, 2, 2, "F");
      setFill(rgb);
      doc.roundedRect(M, y + 5, Math.max(1, ratio * contentW), 5, 2, 2, "F");
      y += 24;
    });
    y += 10;
  }

  // ── Entry table ────────────────────────────────────────────────────────────
  if (model.entries.length > 0) {
    if (y > H - 160) {
      doc.addPage();
      y = 64;
    }
    heading("Entries", `${model.entries.length} logged in this period`);

    const cols = [
      { key: "date", label: "Date", w: 62 },
      { key: "time", label: "Start", w: 42 },
      { key: "category", label: "Category", w: 74 },
      { key: "title", label: "Activity", w: contentW - 62 - 42 - 74 - 52 },
      { key: "duration", label: "Duration", w: 52 },
    ] as const;

    const drawHeader = () => {
      setFill([246, 242, 236]);
      doc.rect(M, y - 10, contentW, 18, "F");
      setText(MUTED);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7);
      let x = M + 6;
      for (const c of cols) {
        doc.text(c.label.toUpperCase(), x, y + 2);
        x += c.w;
      }
      y += 18;
    };

    drawHeader();

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.8);

    for (const e of model.entries) {
      if (y > H - 56) {
        doc.addPage();
        y = 64;
        drawHeader();
        doc.setFont("helvetica", "normal");
        doc.setFontSize(7.8);
      }

      const values = [
        e.activityDate.slice(5),
        e.startTime ?? "—",
        model.categories.find((c) => c.category === e.category)?.label ?? e.category,
        e.title,
        formatDuration(e.durationMinutes),
      ];

      let x = M + 6;
      values.forEach((v, i) => {
        const col = cols[i];
        setText(i === 3 ? INK : MUTED);
        const text = doc.splitTextToSize(String(v), col.w - 8)[0] ?? "";
        doc.text(text, x, y);
        x += col.w;
      });

      setDraw([242, 238, 232]);
      doc.setLineWidth(0.5);
      doc.line(M, y + 5, M + contentW, y + 5);
      y += 15;
    }
  }

  // ── Footer on every page ───────────────────────────────────────────────────
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    setDraw(HAIRLINE);
    doc.setLineWidth(0.6);
    doc.line(M, H - 40, W - M, H - 40);
    setText(MUTED);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.text("Dayline · daily activity report", M, H - 26);
    doc.text(`${p} / ${pages}`, W - M, H - 26, { align: "right" });
  }

  return doc;
}

/** Builds the PDF and triggers a download. */
export async function downloadReportPdf(model: ReportModel, filename: string) {
  const doc = await buildReportPdf(model);
  doc.save(filename);
}
