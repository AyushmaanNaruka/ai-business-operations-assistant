---
name: excel-workbook
description: How to structure a business Excel workbook so it is usable, not just a data dump. Load when the requested artifact is a spreadsheet.
---

# Excel workbook

Inherits `evidence-citation`.

## The five sheet convention

| Sheet | Contains |
|---|---|
| **Summary** | The headline numbers and the two or three findings that matter. Fits on one screen |
| **Recommendations** | One row per finding: statement, rationale, supporting data reference, confidence |
| **Data** | The underlying rows. Frozen header, filters on |
| **Calculations** | The derived metrics, as **live formulas** referencing Data |
| **Sources** | One row per evidence entry: ID, claim, source, locator, method |

## The rule that matters most

**Calculations contain formulas, not values.** Write `=SUM(Data!H2:H1241)/SUM(Data!G2:G1241)`, not `0.042`. A reviewer who clicks a cell must see how it was derived.

This is the single clearest proof the file was constructed rather than transcribed, and it is what the brief means by "meaningful, usable content".

## Formatting

- Percentages formatted as percentages, currency as currency, never raw floats
- Frozen header row on Data
- Column widths set, no truncated headers
- No merged cells anywhere; they break filtering and every downstream tool
- A chart image on Summary only where it adds something. Excel charts must be embedded as images, no JavaScript library writes native ones

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
