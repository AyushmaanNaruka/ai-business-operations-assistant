import { describe, expect, it } from 'vitest';
import { columnLetter, dataSheetShape, describeDataSheetLayout, resolveFormula, type DataSheetShape } from './formulas';

const rows = Array.from({ length: 10 }, (_, i) => ({
  campaign_name: `Campaign ${i + 1}`,
  channel: 'Paid Social',
  clicks: 100 + i,
  spend: 1000 + i,
  revenue: 1200 + i,
}));
const shape: DataSheetShape = dataSheetShape(rows); // A..E, data in rows 2 to 11

describe('resolveFormula', () => {
  it('rewrites a whole column referenced by name to its exact A1 range', () => {
    const result = resolveFormula('=SUM(Data!revenue)/SUM(Data!spend)', shape);
    expect(result.errors).toEqual([]);
    expect(result.formula).toBe('=SUM(Data!$E$2:$E$11)/SUM(Data!$D$2:$D$11)');
  });

  it('matches the sheet and the column name case-insensitively, quoted or not', () => {
    expect(resolveFormula("=SUM('data'!Revenue)", shape)).toEqual({ formula: '=SUM(Data!$E$2:$E$11)', errors: [] });
  });

  it('leaves in-bounds A1 references untouched', () => {
    expect(resolveFormula('=SUM(Data!E2:E11)/SUM(Data!$D$2:$D$11)', shape)).toEqual({
      formula: '=SUM(Data!E2:E11)/SUM(Data!$D$2:$D$11)',
      errors: [],
    });
  });

  it('rejects a name that is not a Data column, listing the real columns', () => {
    const { errors } = resolveFormula('=SUM(Data!conversions)', shape);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('Data!conversions');
    expect(errors[0]).toContain('campaign_name, channel, clicks, spend, revenue');
  });

  it('treats a lone three-letter token as a name, not a column (the Data!CPA hole)', () => {
    expect(resolveFormula('=AVERAGE(Data!CPA)', shape).errors).toHaveLength(1);
    expect(resolveFormula('=AVERAGE(Data!CPA)').errors).toHaveLength(1);
  });

  it('rejects ranges outside the Data sheet', () => {
    const { errors } = resolveFormula('=SUM(Data!K2:K1204)', shape);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('A1:E11');
  });

  it('rejects any Data reference when the Data sheet is empty', () => {
    const empty = dataSheetShape([]);
    expect(resolveFormula('=SUM(Data!A2:A10)', empty).errors[0]).toContain('no rows');
    expect(resolveFormula('=SUM(Data!revenue)', empty).errors[0]).toContain('no rows');
  });

  it('rejects bare names and unknown sheets, but not functions, booleans, same-sheet cells or string literals', () => {
    expect(resolveFormula('=SUM(revenue)', shape).errors).toHaveLength(1);
    expect(resolveFormula('=SUM(Campaigns!A2:A10)', shape).errors[0]).toContain('Campaigns');
    expect(resolveFormula('=IF(B2>0,TRUE,FALSE)', shape).errors).toEqual([]);
    expect(resolveFormula('=COUNTIF(Data!B2:B11,"Paid Social")', shape).errors).toEqual([]);
    expect(resolveFormula('=SUM(Data!A:A)', shape).errors).toEqual([]);
    expect(resolveFormula('=1E3*Data!D2', shape).errors).toEqual([]);
  });

  it('without a known Data sheet, accepts A1 references and rejects names', () => {
    expect(resolveFormula('=SUM(Data!H2:H1241)').errors).toEqual([]);
    expect(resolveFormula('=SUM(Data!revenue)').errors).toHaveLength(1);
  });
});

describe('describeDataSheetLayout', () => {
  it('names the columns, the row range and the by-name form', () => {
    const layout = describeDataSheetLayout(rows);
    expect(layout).toContain('rows 2 to 11');
    expect(layout).toContain('A = campaign_name');
    expect(layout).toContain('Data!revenue');
  });

  it('columnLetter wraps past Z', () => {
    expect(columnLetter(1)).toBe('A');
    expect(columnLetter(26)).toBe('Z');
    expect(columnLetter(27)).toBe('AA');
  });
});
