/**
 * Generates samples/campaigns.xlsx: the demo dataset every later phase is tested
 * against. Spec: docs/08-DEMO-SCENARIOS.md, "Sample files to create".
 *
 * The messiness below is deliberate and load bearing, not noise:
 *   - ~3% nulls in revenue                          -> exercises quality warnings
 *   - start_date in three different string formats   -> exercises date parsing
 *   - 12-18 exact duplicate rows                      -> exercises duplicate detection
 *   - one campaign at 47 clicks / 6 conversions       -> exercises the small sample guard
 *   - Paid Social spend climbing from month 12,
 *     revenue staying flat                            -> the finding the demo should surface
 *
 * Run with `npm run samples`. Deterministic: seeded RNG, same output every run.
 */
import ExcelJS from 'exceljs';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

// ---------------------------------------------------------------------------
// Seeded RNG so the dataset is identical across runs, which matters when other
// modules and tests are written against specific values in it.
// ---------------------------------------------------------------------------
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20240922);
const randInt = (min: number, max: number) => Math.floor(rand() * (max - min + 1)) + min;
const randFloat = (min: number, max: number) => rand() * (max - min) + min;
const pick = <T,>(items: readonly T[]): T => items[randInt(0, items.length - 1)]!;
const round2 = (n: number) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------------------
// Domain
// ---------------------------------------------------------------------------
const CHANNELS = ['Email', 'Paid Search', 'Paid Social', 'Content', 'Webinar', 'Partner'] as const;
const SEGMENTS = ['SMB', 'Mid-Market', 'Enterprise'] as const;
const REGIONS = ['NA', 'UK'] as const;
type Channel = (typeof CHANNELS)[number];
type Segment = (typeof SEGMENTS)[number];
type Region = (typeof REGIONS)[number];

type Row = {
  campaign_name: string;
  channel: Channel;
  segment: Segment;
  region: Region;
  start_date: string;
  end_date: string;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  revenue: number | null;
};

// Realistic-ish per channel behaviour: how many impressions a typical campaign
// buys, what fraction click, what fraction of clicks convert, and cost per click.
const CHANNEL_PROFILE: Record<Channel, { impressions: [number, number]; ctr: [number, number]; convRate: [number, number]; cpc: [number, number] }> = {
  Email: { impressions: [2000, 6000], ctr: [0.03, 0.05], convRate: [0.08, 0.12], cpc: [0.5, 1.5] },
  'Paid Search': { impressions: [20000, 60000], ctr: [0.02, 0.03], convRate: [0.03, 0.05], cpc: [1.5, 3.5] },
  'Paid Social': { impressions: [15000, 45000], ctr: [0.015, 0.025], convRate: [0.02, 0.04], cpc: [1.0, 2.5] },
  Content: { impressions: [5000, 15000], ctr: [0.01, 0.02], convRate: [0.02, 0.04], cpc: [0.8, 1.8] },
  Webinar: { impressions: [1000, 3000], ctr: [0.04, 0.07], convRate: [0.1, 0.15], cpc: [1.0, 2.0] },
  Partner: { impressions: [3000, 9000], ctr: [0.02, 0.04], convRate: [0.04, 0.07], cpc: [1.0, 2.2] },
};

// Enterprise: low volume, high AOV. SMB: high volume, low AOV. Mid-Market: the average.
const SEGMENT_PROFILE: Record<Segment, { volumeMult: number; aov: [number, number] }> = {
  SMB: { volumeMult: 1.3, aov: [150, 400] },
  'Mid-Market': { volumeMult: 1.0, aov: [800, 2000] },
  Enterprise: { volumeMult: 0.4, aov: [5000, 15000] },
};

const REGION_VOLUME_MULT: Record<Region, number> = { NA: 1.0, UK: 0.6 };

// 20 months, ending before "today" in the fictional Northwind Analytics timeline.
const NUM_MONTHS = 20;
const START_MONTH = new Date(Date.UTC(2024, 11, 1)); // Dec 2024 -> Jul 2026
const MONTHS = Array.from({ length: NUM_MONTHS }, (_, i) => {
  const d = new Date(START_MONTH);
  d.setUTCMonth(d.getUTCMonth() + i);
  return d;
});
const MONTH_LABEL = (d: Date) => d.toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });

type DateFormat = 'iso' | 'us' | 'text';
function formatDate(d: Date, format: DateFormat): string {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  const pad = (n: number) => String(n).padStart(2, '0');
  if (format === 'iso') return `${y}-${pad(m)}-${pad(day)}`;
  if (format === 'us') return `${pad(m)}/${pad(day)}/${y}`;
  const monthName = d.toLocaleString('en-US', { month: 'long', timeZone: 'UTC' });
  return `${monthName} ${day}, ${y}`;
}

function randomDayInMonth(month: Date): Date {
  const daysInMonth = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), randInt(1, daysInMonth)));
}

const dateFormatCounts: Record<DateFormat, number> = { iso: 0, us: 0, text: 0 };
function pickDateFormat(): DateFormat {
  // Roughly even split across the three formats, as if three different people
  // had been filling in this spreadsheet by hand over two years.
  const format = pick(['iso', 'us', 'text'] as const);
  dateFormatCounts[format] += 1;
  return format;
}

let campaignCounter = 0;
function makeRow(monthIndex: number, channel: Channel): Row {
  const month = MONTHS[monthIndex]!;
  const segment = pick(SEGMENTS);
  const region = pick(REGIONS);

  const chan = CHANNEL_PROFILE[channel];
  const seg = SEGMENT_PROFILE[segment];
  const regionMult = REGION_VOLUME_MULT[region];

  const impressions = Math.round(randFloat(...chan.impressions) * seg.volumeMult * regionMult);
  const ctr = randFloat(...chan.ctr);
  const clicks = Math.round(impressions * ctr * randFloat(0.85, 1.15));
  const convRate = randFloat(...chan.convRate);
  const conversions = Math.max(0, Math.round(clicks * convRate * randFloat(0.7, 1.3)));
  const cpc = randFloat(...chan.cpc);
  let spend = round2(clicks * cpc * randFloat(0.9, 1.1));

  // Paid Social: from month 12 onward, spend climbs steadily while the demand
  // generation it buys (clicks/conversions/revenue) does not. Rising cost of
  // acquisition on a channel that looks fine on spend alone.
  if (channel === 'Paid Social' && monthIndex >= 11) {
    const monthsIntoClimb = monthIndex - 10; // 1, 2, 3, ...
    spend = round2(spend * (1 + 0.12 * monthsIntoClimb));
  }

  const aov = randFloat(...seg.aov);
  const revenue = round2(conversions * aov * randFloat(0.8, 1.2));

  const startDate = randomDayInMonth(month);
  const endDate = new Date(startDate);
  endDate.setUTCDate(endDate.getUTCDate() + randInt(14, 45));

  campaignCounter += 1;
  return {
    campaign_name: `${channel} - ${segment} ${region} - ${MONTH_LABEL(month)} #${campaignCounter}`,
    channel,
    segment,
    region,
    start_date: formatDate(startDate, pickDateFormat()),
    end_date: formatDate(endDate, 'iso'),
    spend,
    impressions,
    clicks,
    conversions,
    revenue,
  };
}

// How many campaigns run per channel each month. Paid Social and Paid Search
// get a deliberately larger, steadier sample than the others: the Paid Social
// spend/revenue story is a monthly trend, and a trend needs enough campaigns
// per month that random per-campaign noise averages out instead of dominating.
const CHANNEL_MONTHLY_COUNT: Record<Channel, [number, number]> = {
  Email: [5, 9],
  'Paid Search': [11, 18],
  'Paid Social': [13, 20],
  Content: [7, 11],
  Webinar: [3, 7],
  Partner: [6, 10],
};

function makeRows(): Row[] {
  const rows: Row[] = [];
  for (let m = 0; m < NUM_MONTHS; m++) {
    for (const channel of CHANNELS) {
      const [min, max] = CHANNEL_MONTHLY_COUNT[channel];
      const count = randInt(min, max);
      for (let i = 0; i < count; i++) rows.push(makeRow(m, channel));
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Build the dataset
// ---------------------------------------------------------------------------
async function main() {
  const rows = makeRows();

  // The small sample trap: a campaign with a high conversion RATE (6/47 = 12.8%,
  // well above every channel's normal range) but far too few clicks and
  // conversions to be reportable. M2's smallSample guard flags under 100 clicks
  // or under 30 conversions; this row trips both.
  const trapMonth = MONTHS[14]!;
  const trapStart = randomDayInMonth(trapMonth);
  const trapEnd = new Date(trapStart);
  trapEnd.setUTCDate(trapEnd.getUTCDate() + 21);
  const smallSampleRow: Row = {
    campaign_name: `Webinar - Enterprise NA - ${MONTH_LABEL(trapMonth)} #SPECIAL`,
    channel: 'Webinar',
    segment: 'Enterprise',
    region: 'NA',
    start_date: formatDate(trapStart, pickDateFormat()),
    end_date: formatDate(trapEnd, 'iso'),
    spend: 840.0,
    impressions: 2350,
    clicks: 47,
    conversions: 6,
    revenue: 19200.0,
  };
  rows.push(smallSampleRow);

  // ~3% null revenue, never touching the small sample trap row so the demo
  // point stays legible.
  let nullCount = 0;
  const nullTargetCount = Math.round(rows.length * 0.03);
  const nullEligible = rows.filter((r) => r !== smallSampleRow);
  for (let i = 0; i < nullTargetCount; i++) {
    const row = pick(nullEligible);
    if (row.revenue !== null) {
      row.revenue = null;
      nullCount += 1;
    }
  }

  // 12-18 exact duplicate rows. Excludes the small sample trap row: the brief
  // requires exactly ONE campaign with 47 clicks and 6 conversions.
  const duplicateCount = randInt(12, 18);
  const duplicateCandidates = rows.filter((r) => r !== smallSampleRow);
  const duplicatedRows: Row[] = [];
  for (let i = 0; i < duplicateCount; i++) {
    duplicatedRows.push({ ...pick(duplicateCandidates) });
  }
  rows.push(...duplicatedRows);

  // ---------------------------------------------------------------------------
  // Write the workbook
  // ---------------------------------------------------------------------------
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('campaigns');
  sheet.columns = [
    { header: 'campaign_name', key: 'campaign_name', width: 42 },
    { header: 'channel', key: 'channel', width: 14 },
    { header: 'segment', key: 'segment', width: 12 },
    { header: 'region', key: 'region', width: 8 },
    { header: 'start_date', key: 'start_date', width: 16 },
    { header: 'end_date', key: 'end_date', width: 14 },
    { header: 'spend', key: 'spend', width: 12 },
    { header: 'impressions', key: 'impressions', width: 13 },
    { header: 'clicks', key: 'clicks', width: 10 },
    { header: 'conversions', key: 'conversions', width: 12 },
    { header: 'revenue', key: 'revenue', width: 12 },
  ];
  for (const row of rows) sheet.addRow(row);

  const outPath = resolve(process.cwd(), 'samples/campaigns.xlsx');
  await mkdir(dirname(outPath), { recursive: true });
  await workbook.xlsx.writeFile(outPath);

  // ---------------------------------------------------------------------------
  // Verification summary. Every planted problem must show up here; if one
  // doesn't, fix the generator, not the summary.
  // ---------------------------------------------------------------------------
  console.log(`\nWrote ${rows.length} rows to samples/campaigns.xlsx\n`);
  console.log(`Revenue nulls: ${rows.filter((r) => r.revenue === null).length} (${((rows.filter((r) => r.revenue === null).length / rows.length) * 100).toFixed(1)}%)`);
  console.log(`Date formats used: ISO=${dateFormatCounts.iso}, US=${dateFormatCounts.us}, text-month=${dateFormatCounts.text}`);
  console.log(`Planted exact duplicate rows: ${duplicatedRows.length}`);
  console.log(
    `Small sample trap: "${smallSampleRow.campaign_name}" -> ${smallSampleRow.clicks} clicks, ` +
      `${smallSampleRow.conversions} conversions (${((smallSampleRow.conversions / smallSampleRow.clicks) * 100).toFixed(1)}% rate), ` +
      `revenue $${smallSampleRow.revenue}`,
  );

  console.log('\nPaid Social: spend vs revenue by month (climb starts month 12)');
  console.log('month       spend        revenue');
  for (let m = 0; m < NUM_MONTHS; m++) {
    const monthRows = rows.filter((r) => r.channel === 'Paid Social' && formatMonthMatches(r, MONTHS[m]!));
    const spend = monthRows.reduce((s, r) => s + r.spend, 0);
    const revenue = monthRows.reduce((s, r) => s + (r.revenue ?? 0), 0);
    const marker = m >= 11 ? '  <- climbing' : '';
    console.log(`${MONTH_LABEL(MONTHS[m]!).padEnd(11)} $${spend.toFixed(0).padStart(8)}   $${revenue.toFixed(0).padStart(8)}${marker}`);
  }
}

// start_date carries three different string formats, so re-derive the month by
// re-parsing whichever format this row happens to use.
function formatMonthMatches(row: Row, month: Date): boolean {
  const parsed = parseAnyDate(row.start_date);
  return parsed !== null && parsed.getUTCFullYear() === month.getUTCFullYear() && parsed.getUTCMonth() === month.getUTCMonth();
}

function parseAnyDate(value: string): Date | null {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (iso) return new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));

  const us = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  if (us) return new Date(Date.UTC(Number(us[3]), Number(us[1]) - 1, Number(us[2])));

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
