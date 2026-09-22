import { describe, expect, it } from 'vitest';
import { validateSql } from './validateSql';

function expectRejected(sql: string) {
  const result = validateSql(sql);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error.code).toBe('QUERY_INVALID');
  return result;
}

describe('validateSql', () => {
  it('accepts a plain SELECT', () => {
    expect(validateSql('SELECT * FROM campaigns').ok).toBe(true);
  });

  it('accepts a realistic analytical query: CTE, join, window function, CASE, date_trunc, aggregates', () => {
    const sql = `
      WITH monthly AS (
        SELECT
          date_trunc('month', c.start_date) AS month,
          c.channel,
          SUM(c.revenue) AS revenue,
          SUM(c.spend) AS spend,
          CASE WHEN SUM(c.clicks) = 0 THEN 0 ELSE SUM(c.conversions)::DOUBLE / SUM(c.clicks) END AS cvr,
          RANK() OVER (PARTITION BY c.channel ORDER BY SUM(c.revenue) DESC) AS revenue_rank
        FROM campaigns c
        JOIN segments s ON s.channel = c.channel
        GROUP BY 1, 2
      )
      SELECT * FROM monthly WHERE revenue_rank = 1
    `;
    const result = validateSql(sql);
    expect(result.ok).toBe(true);
  });

  it('rejects a statement not starting with SELECT or WITH', () => {
    expectRejected('EXPLAIN SELECT * FROM campaigns');
  });

  it('rejects more than one statement', () => {
    expectRejected('SELECT 1; SELECT 2');
  });

  it('accepts a single trailing semicolon', () => {
    expect(validateSql('SELECT 1;').ok).toBe(true);
  });

  it('does not miscount a semicolon inside a string literal', () => {
    const result = validateSql("SELECT * FROM campaigns WHERE campaign_name = 'Launch; Phase 2'");
    expect(result.ok).toBe(true);
  });

  it('does not miscount a semicolon inside a line comment', () => {
    const result = validateSql('SELECT 1 -- trailing comment; not a real statement');
    expect(result.ok).toBe(true);
  });

  it('does not miscount a semicolon inside a block comment', () => {
    const result = validateSql('SELECT 1 /* a comment ; with a semicolon */');
    expect(result.ok).toBe(true);
  });

  it('catches a second statement hidden after a comment', () => {
    expectRejected('SELECT 1 -- looks like one statement\n; DROP TABLE campaigns');
  });

  it('catches a second statement hidden inside a block comment boundary', () => {
    expectRejected('SELECT 1; /* comment */ DROP TABLE campaigns');
  });

  it('rejects an unterminated string literal', () => {
    expectRejected("SELECT * FROM campaigns WHERE x = 'unterminated");
  });

  const bannedStatements: Array<[string, string]> = [
    ['INSERT', "INSERT INTO campaigns VALUES (1)"],
    ['UPDATE', "UPDATE campaigns SET revenue = 0"],
    ['DELETE', "DELETE FROM campaigns"],
    ['DROP', "DROP TABLE campaigns"],
    ['CREATE', "CREATE TABLE evil (x INT)"],
    ['ATTACH', "ATTACH 'evil.db' AS evil"],
    ['COPY', "COPY campaigns TO 'out.csv'"],
    ['INSTALL', "INSTALL 'httpfs'"],
    ['LOAD', "LOAD 'httpfs'"],
    ['PRAGMA', "PRAGMA table_info('campaigns')"],
    ['SET', "SET enable_external_access = true"],
  ];

  for (const [label, sql] of bannedStatements) {
    it(`rejects ${label}`, () => {
      expectRejected(sql);
    });
  }

  it('does not reject a column whose name merely contains a banned word as a substring', () => {
    const result = validateSql('SELECT delete_date, inserted_by FROM campaigns');
    expect(result.ok).toBe(true);
  });

  it('does not reject a banned word appearing only inside a string literal', () => {
    const result = validateSql("SELECT * FROM campaigns WHERE campaign_name = 'Delete Old Leads'");
    expect(result.ok).toBe(true);
  });

  it('rejects read_csv pointing at a filesystem path', () => {
    expectRejected("SELECT * FROM read_csv('/etc/passwd')");
  });

  it('rejects read_csv_auto pointing at a filesystem path', () => {
    expectRejected("SELECT * FROM read_csv_auto('/etc/passwd')");
  });

  it('rejects read_parquet pointing at a filesystem path', () => {
    expectRejected("SELECT * FROM read_parquet('/etc/shadow.parquet')");
  });

  it('rejects read_json pointing at a filesystem path', () => {
    expectRejected("SELECT * FROM read_json('/etc/secrets.json')");
  });

  it('rejects an empty query', () => {
    expectRejected('   ');
  });
});
