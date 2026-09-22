/** A conclusion. Evidence explains how a number was produced; a Finding explains how a conclusion was reached. */

export type Finding = {
  id: string; // "F3"
  statement: string; // "Paid social is buying volume, not revenue"
  evidenceIds: string[]; // the facts it rests on
  reasoning: string; // one line: how those facts lead here
  soWhat: string; // the business implication
  confidence: 'high' | 'medium' | 'low';
  caveats?: string[]; // "two months only", "sample of 47"
  createdAt: string;
};
