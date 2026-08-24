export type ReviewChecklistStatus = 'unchecked' | 'passed' | 'failed' | 'not-applicable';

export type ReviewChecklistGrade =
  | 'not-started'
  | 'in-review'
  | 'review-complete'
  | 'needs-fix'
  | 'ready-to-consider-transfer';

export interface ReviewChecklistItem {
  id: string;
  label: string;
  required: boolean;
  status: ReviewChecklistStatus;
}

export interface ReviewChecklist {
  schemaVersion: 1;
  id: string;
  title: string;
  targetProfileId?: string;
  targetAlias?: string;
  updatedAt: string;
  userNote: string;
  grade: ReviewChecklistGrade;
  items: ReviewChecklistItem[];
}

export interface ReviewChecklistExportOptions {
  includeFullLocalPaths?: boolean;
}
