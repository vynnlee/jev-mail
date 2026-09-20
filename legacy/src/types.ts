export interface EmailItem {
  id: string;
  sender: string;
  subject: string;
  snippet: string;
  date?: string;
  hasAttachment?: boolean;
}

export type TriageActionType =
  | 'KEEP_INBOX_STAR'    // Follow Up (urgent): retain in Inbox and star
  | 'KEEP_INBOX'         // Follow Up (normal): retain in Inbox
  | 'ARCHIVE_LABEL'      // Label and archive immediately
  | 'REVIEW_FALLBACK';   // Low confidence: assign Review label and retain in Inbox

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
