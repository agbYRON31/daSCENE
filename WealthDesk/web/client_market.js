// Client Mode's plain-language market summary, built from the published RoRo model.
// The JavaScript twin of ClientMarketView in Sources/WealthDesk/ClientMode.swift.
// It adds no arithmetic of its own: every number is read straight from the model the
// app's Swift RoRo engine produced, and each reading gets a word using the model's own
// ±20 lines. It deliberately leaves out the posture label, playbook text and allocation
// tilts, which read as recommendations. Tested by web/client-market-check.mjs.

/** The model's Offense / Defense lines, used here only to choose a word. */
export const LINE = 20;

/** "Supportive" at +20 or above, "Stressed" at −20 or below, "Mixed" between. */
export function marketWord(v) {
  if (v === null || v === undefined || Number.isNaN(v)) return "No reading";
  return v >= LINE ? "Supportive" : v <= -LINE ? "Stressed" : "Mixed";
}

/** CSS tone matching the Advisor RoRo colours (pos / neu / neg). */
export function marketTone(v) {
  if (v === null || v === undefined || Number.isNaN(v)) return "";
  return v >= LINE ? "pos" : v <= -LINE ? "neg" : "neu";
}

export const BUCKET_PLAIN = {
  MACRO: "The economy: jobs, production, housing",
  MONETARY: "Interest rates and financial conditions",
  TECHNICALS: "Stock market trend and breadth",
  CREDIT: "Corporate borrowing costs",
  VOL: "Market volatility",
  CROSS: "Risk appetite across markets",
};

const HORIZON_PLAIN = [
  { name: "Fast-moving signals", desc: "Weighted toward market prices and volatility" },
  { name: "Medium-term signals", desc: "A balance of market and economic data" },
  { name: "Slow-moving signals", desc: "Weighted toward the economy and interest rates" },
];

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * Everything Client Mode shows, taken from one RoRo model (data/roro.json).
 * Returns null when there is no model to summarize.
 */
export function clientMarketSummary(m) {
  if (!m || !Array.isArray(m.horizons) || m.horizons.length === 0) return null;
  const horizons = m.horizons.map((z, i) => {
    const value = num(z.value);
    return { ...(HORIZON_PLAIN[i] ?? { name: z.label, desc: "" }), label: z.label, value, word: marketWord(value) };
  });
  // The overall reading is the medium-term dial, the one the model's own posture follows.
  const overall = horizons[1] ?? horizons[0];
  const buckets = (m.buckets || []).map((b) => {
    const value = num(b.score);
    return { key: b.key, label: BUCKET_PLAIN[b.key] ?? b.name, value, word: marketWord(value) };
  });
  const dates = m.history?.dates ?? [];
  const series = m.history?.intermediate ?? [];
  const points = [];
  for (let i = 0; i < Math.min(dates.length, series.length); i++) {
    const v = num(series[i]);
    if (v !== null) points.push({ x: dates[i], y: v });
  }
  return {
    asof: m.asof ?? null,
    indicators: num(m.n_live) ?? 0,
    overall: { value: overall.value, word: overall.word },
    headline: `Overall, the indicators read “${overall.word.toLowerCase()}” right now.`,
    horizons, buckets, history: points,
  };
}
