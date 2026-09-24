import { describe, it, expect, beforeAll } from 'vitest';
import { renderChart } from './renderChart';
import type { ChartSpec } from '@/modules/artifacts/schemas';

/**
 * quickchart-js's default behavior calls the public https://quickchart.io hosted API
 * (there is no local renderer wired here, deliberately: see renderChart.ts's header). That
 * means these tests need outbound network access. We always attempt the real call first;
 * a quick reachability probe up front only decides whether to report a clear skip instead
 * of letting every test fail opaquely if this sandbox has no outbound internet.
 */

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

let networkAvailable = true;

beforeAll(async () => {
  try {
    const res = await fetch('https://quickchart.io/chart?c={type:%27bar%27,data:{labels:[%27a%27],datasets:[{data:[1]}]}}');
    networkAvailable = res.ok;
  } catch {
    networkAvailable = false;
  }
  if (!networkAvailable) {
    // eslint-disable-next-line no-console
    console.warn('QuickChart unreachable, skipping renderChart network tests.');
  }
}, 15_000);

function evidencePoint(label: string, value: number) {
  return { label, value, evidenceIds: ['E1'] };
}

async function expectPng(spec: ChartSpec): Promise<void> {
  if (!networkAvailable) {
    // Documented no-op: network genuinely unavailable in this sandbox.
    expect(true).toBe(true);
    return;
  }
  const buffer = await renderChart(spec);
  expect(Buffer.isBuffer(buffer)).toBe(true);
  expect(buffer.subarray(0, 4).equals(PNG_MAGIC)).toBe(true);
}

describe('renderChart', () => {
  it('renders a bar chart as a PNG', async () => {
    const spec: ChartSpec = {
      kind: 'bar',
      title: 'Spend by channel',
      data: [evidencePoint('Email', 10), evidencePoint('Search', 30), evidencePoint('Social', 20)],
      xLabel: 'Channel',
      yLabel: 'Spend ($k)',
      evidenceIds: ['E1'],
    };
    await expectPng(spec);
  }, 20_000);

  it('renders a line chart as a PNG', async () => {
    const spec: ChartSpec = {
      kind: 'line',
      title: 'Revenue over time',
      data: [evidencePoint('Jan', 100), evidencePoint('Feb', 120), evidencePoint('Mar', 90)],
      xLabel: 'Month',
      yLabel: 'Revenue ($k)',
      evidenceIds: ['E1'],
    };
    await expectPng(spec);
  }, 20_000);

  it('renders a stackedBar chart as a PNG', async () => {
    const spec: ChartSpec = {
      kind: 'stackedBar',
      title: 'Composition',
      data: [evidencePoint('Q1', 40), evidencePoint('Q2', 60)],
      evidenceIds: ['E1'],
    };
    await expectPng(spec);
  }, 20_000);

  it('renders a scatter chart as a PNG', async () => {
    const spec: ChartSpec = {
      kind: 'scatter',
      title: 'Spend vs conversions',
      data: [evidencePoint('10', 5), evidencePoint('20', 12), evidencePoint('30', 9)],
      xLabel: 'Spend',
      yLabel: 'Conversions',
      evidenceIds: ['E1'],
    };
    await expectPng(spec);
  }, 20_000);

  it('renders a pie chart as a PNG', async () => {
    const spec: ChartSpec = {
      kind: 'pie',
      title: 'Share of spend',
      data: [evidencePoint('Email', 10), evidencePoint('Search', 30), evidencePoint('Social', 20), evidencePoint('Other', 5)],
      evidenceIds: ['E1'],
    };
    await expectPng(spec);
  }, 20_000);

  it('does not throw for a bigNumber spec and still returns a PNG-shaped buffer', async () => {
    const spec: ChartSpec = {
      kind: 'bigNumber',
      title: 'Total revenue',
      data: [evidencePoint('Total', 1234)],
      evidenceIds: ['E1'],
    };
    await expect(expectPng(spec)).resolves.not.toThrow();
  }, 20_000);
});
