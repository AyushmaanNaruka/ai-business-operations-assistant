/**
 * Every figure in the video is real: computed from samples/campaigns.xlsx on
 * 26 Sep 2026 (exact duplicate rows dropped, missing revenue excluded, not filled).
 * If the sample data is regenerated, recompute these rather than editing by hand.
 */

export const DATASET = {
  rawRows: 1203,
  rows: 1189,
  duplicates: 14,
  missingRevenue: 36,
  columns: 11,
  dateFormats: 3,
};

/** Revenue per 1 unit of spend, and conversion rate, by channel. */
export const CHANNELS = [
  { name: "Email", roas: 214.3, cvr: 9.93 },
  { name: "Webinar", roas: 178.4, cvr: 11.8 },
  { name: "Partner", roas: 88.5, cvr: 5.44 },
  { name: "Content", roas: 45.9, cvr: 3.07 },
  { name: "Paid Search", roas: 33.3, cvr: 4.03 },
  { name: "Paid Social", roas: 26.1, cvr: 3.0 },
];

/** Paid Social by month, Dec 2024 to Jul 2026: [spend, revenue]. */
export const PAID_SOCIAL_MONTHLY: [number, number][] = [
  [13299, 366333], [12198, 599033], [15855, 294241], [13566, 714851], [13954, 514736],
  [15902, 303331], [10372, 314387], [11459, 334455], [13383, 521964], [17929, 403842],
  [11024, 289438], [18342, 639540], [18666, 240155], [19776, 417106], [19667, 344277],
  [21872, 582987], [13128, 454606], [16947, 445271], [23656, 257913], [21730, 374067],
];

/** Last 8 months against the 12 before them. */
export const PAID_SOCIAL_SHIFT = { spendPct: 39, revenuePct: -12 };

/** The highest converting row, which is too small to rank. */
export const SMALL_SAMPLE = { name: "Webinar · Enterprise UK #716", clicks: 15, conversions: 3, cvr: 20 };

export const NOTES_QUOTE =
  "General mood is that paid social has been the strongest performing channel for us this year.";

export const REPO_URL = "github.com/AyushmaanNaruka/ai-business-operations-assistant";
