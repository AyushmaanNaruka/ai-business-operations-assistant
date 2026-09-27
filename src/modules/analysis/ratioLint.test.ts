import { describe, expect, it } from 'vitest';
import { lintRatioAverages } from './ratioLint';

describe('lintRatioAverages', () => {
  it('flags AVG over a per-row ratio, whatever its spelling', () => {
    for (const sql of [
      'SELECT channel, AVG(conversions / clicks) AS cr FROM campaigns GROUP BY channel',
      'SELECT avg(conversions::DOUBLE/clicks) FROM campaigns',
      'SELECT AVG ( CAST(conversions AS DOUBLE) / NULLIF(clicks, 0) ) FROM campaigns',
      'SELECT AVG(CASE WHEN clicks > 0 THEN conversions * 100.0 / clicks END) FROM campaigns',
      'SELECT MEAN(revenue / spend) AS roas FROM campaigns',
      'SELECT channel, ROUND(AVG(spend / conversions), 2) FROM campaigns GROUP BY 1',
    ]) {
      const warnings = lintRatioAverages(sql);
      expect(warnings, sql).toHaveLength(1);
      expect(warnings[0], sql).toContain('SUM(numerator) / SUM(denominator)');
    }
  });

  it('flags AVG over a ratio computed per row in a CTE or subquery', () => {
    const cte = lintRatioAverages(
      'WITH r AS (SELECT channel, conversions / clicks AS rate FROM campaigns) SELECT channel, AVG(rate) FROM r GROUP BY channel',
    );
    expect(cte).toHaveLength(1);
    expect(cte[0]).toContain('"rate"');

    const sub = lintRatioAverages(
      'SELECT AVG(t.ctr) FROM (SELECT campaign_id, clicks, SUM(clicks) / SUM(impressions) AS ctr FROM c GROUP BY 1, 2) t',
    );
    expect(sub).toHaveLength(1);
  });

  it('passes ratios of sums, plain averages and scaling by a constant', () => {
    for (const sql of [
      'SELECT AVG(spend) FROM campaigns',
      'SELECT channel, SUM(conversions) / SUM(clicks) AS cr FROM campaigns GROUP BY channel',
      'SELECT SUM(conversions)::DOUBLE / NULLIF(SUM(clicks), 0) FROM campaigns',
      'SELECT AVG(spend / 1000) AS spend_k, AVG(clicks // 2.5e1) FROM campaigns',
      'SELECT AVG(spend) / AVG(clicks) FROM campaigns',
      'SELECT AVG(spend) FILTER (WHERE conversions / clicks > 0.1) FROM campaigns',
      'WITH r AS (SELECT spend AS cost, conversions / clicks AS rate FROM campaigns) SELECT AVG(cost), MAX(rate) FROM r',
      'SELECT CAST(spend AS DOUBLE) AS s, AVG(clicks) FROM campaigns GROUP BY 1',
    ]) {
      expect(lintRatioAverages(sql), sql).toEqual([]);
    }
  });

  it('ignores the pattern inside string literals, quoted identifiers and comments', () => {
    for (const sql of [
      "SELECT AVG(spend) FROM campaigns WHERE campaign_name = 'AVG(conversions / clicks)'",
      'SELECT AVG("conversions / clicks") FROM campaigns',
      'SELECT AVG(spend) -- not AVG(conversions / clicks)\nFROM campaigns',
      'SELECT /* AVG(a / b) */ AVG(spend) FROM campaigns',
    ]) {
      expect(lintRatioAverages(sql), sql).toEqual([]);
    }
  });

  it('never throws on malformed SQL', () => {
    expect(lintRatioAverages('SELECT AVG(a / b')).toEqual([]);
    expect(lintRatioAverages('')).toEqual([]);
  });
});
