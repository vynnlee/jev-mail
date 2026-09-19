export interface EmailItem {
  id: string;
  sender: string;
  subject: string;
  snippet: string;
  date?: string;
  hasAttachment?: boolean;
}

export type TriageActionType =
  | 'KEEP_INBOX_STAR'    // Follow Up (긴급): 인박스 유지 + 별표
  | 'KEEP_INBOX'         // Follow Up (일반): 인박스 유지
  | 'ARCHIVE_LABEL'      // 라벨 부착 후 즉시 아카이브
  | 'REVIEW_FALLBACK';   // 불확실(Confidence 낮음): Review 라벨 부착 후 인박스 보존

export interface TriageResult {
  emailId: string;
  targetLabel: string;
  shouldStar: boolean;
  shouldArchive: boolean;
  actionType: TriageActionType;
  requiresActionScore: number;
  isImportantScore: number;
  chosenBucket: string;
  confidence: number;
  reasoning: string;
}
