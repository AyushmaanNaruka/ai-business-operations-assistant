/** One fact, with its origin and its method. Nothing reaches a user answer or an artifact without one. */

export type EvidenceKind = 'computed' | 'document' | 'web';

/** Normalised key that makes two evidence entries comparable, and so enables conflict detection. */
export type MetricKey = {
  name: string; // normalised: "conversion_rate"
  scope: string; // normalised: "channel=email"
  unit: 'ratio' | 'currency' | 'count' | 'duration';
};

export type Evidence = {
  id: string; // "E7"
  claim: string; // human readable
  kind: EvidenceKind;
  sourceId: string;
  sourceName: string;
  locator: string; // "page 2, Positioning" | "https://..." | "campaigns"
  method?: string; // the SQL, for computed evidence
  value?: number | string;
  confidence: 'high' | 'medium' | 'low'; // assigned by rule, never passed in by a caller
  retrievedAt?: string; // web only
  metric?: MetricKey; // set when comparable, enables conflict detection
  createdAt: string;
};
