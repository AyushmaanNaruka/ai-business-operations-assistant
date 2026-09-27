---
name: excel-workbook
description: How to structure a business Excel workbook so it is usable, not just a data dump. Load when the requested artifact is a spreadsheet.
---

# Excel workbook

Inherits `evidence-citation`.

## Summary sheet header

Before the headline numbers: the workbook title, the client or company name, the date range the data covers, and the date the workbook was generated. A reviewer opening the file cold should not have to ask what this is or how current it is. The generated date is stamped by the renderer at build time; do not author one. Leave the client name out if the evidence does not give it, never write a placeholder like "[Client Name]".

## The five sheet convention

| Sheet | Contains |
|---|---|
| **Summary** | The headline numbers and the two or three findings that matter. Fits on one screen |
| **Recommendations** | One row per finding: statement, rationale, supporting data reference, confidence |
| **Data** | The underlying rows. Frozen header, filters on |
| **Calculations** | The derived metrics, as **live formulas** referencing Data |
| **Sources** | One row per evidence entry: ID, claim, source, locator, method |

## The rule that matters most

**Calculations contain formulas, not values.** Write `=SUM(Data!J2:J1204)/SUM(Data!I2:I1204)` (or `Data!conversions`, which the renderer resolves to its exact range), not `0.040`. A reviewer who clicks a cell must see how it was derived.

Reference the Data sheet only as the given layout describes it: an A1 range inside its bounds, or a whole column by its exact name (`=SUM(Data!revenue)/SUM(Data!spend)`), which the renderer converts to that column's A1 range. Any other name opens as #NAME? and fails validation. A workbook is only built when there are underlying rows for the Data sheet.

This is the single clearest proof the file was constructed rather than transcribed, and it is what the brief means by "meaningful, usable content".

## Formatting

- Percentages formatted as percentages, currency as currency, never raw floats
- Frozen header row on Data
- Column widths set, no truncated headers
- No merged cells anywhere; they break filtering and every downstream tool
- A chart image on Summary only where it adds something. Excel charts must be embedded as images, no JavaScript library writes native ones. This differs from `client-presentation`, where charts must be native; the two renderers use different libraries with different capabilities, not different standards

## Recommendations sheet shape

```
Finding | Recommendation | Rationale | Supporting data | Confidence
F2      | Cap paid social| Spend up 60% since June   | Data!A340:K512 | Medium
        | spend at       | while revenue is flat     |                |
        | current level  | [E4, E5]                  |                |
```

The supporting data column is a real range reference so the reader can jump to the rows.

## Do not

- Put prose paragraphs in cells. This is a spreadsheet
- Create a sheet per channel or per segment. Use one Data sheet with filters
- Include a row whose numbers are not in the evidence
