/** A generated business deliverable. Artifacts are versioned: a revision keeps earlier versions downloadable. */

export type ArtifactKind = 'xlsx' | 'pptx' | 'docx' | 'pdf';

export type Artifact = {
  id: string; // "art_1"
  version: number; // revisions keep earlier versions downloadable
  kind: ArtifactKind;
  skillUsed: string; // "client-presentation"
  title: string;
  path: string;
  downloadUrl: string;
  findingIds: string[];
  evidenceIds: string[];
  createdAt: string;
};
