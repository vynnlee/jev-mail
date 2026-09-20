import { CONFIG } from './config.js';
import type { EmailItem, TriageResult } from './types.js';

function buildCriteriaMap() {
  const criteria: Record<string, { what: string; examples: string[] }> = {};
  for (const cat of CONFIG.categories) {
    criteria[cat.key] = {
      what: cat.description,
      examples: cat.examples,
    };
  }
  return criteria;
}

export function buildJevPayload(email: EmailItem) {
  return {
    model: CONFIG.typesafe.model,
    state: {
      email: {
        sender: email.sender,
        subject: email.subject,
        snippet: email.snippet,
        has_attachment: email.hasAttachment ?? false,
      },
    },
    questions: {
      requires_action: {
        type: 'noul',
        instructions:
          'Does `email` clearly require the recipient to directly reply, make a decision, approve an item, or perform an ongoing task? Note: one-time verification codes, OTPs, login alerts, and automated notices do not require task follow-up.',
      },
      is_important: {
        type: 'noul',
        instructions:
          'Is this email high-priority, time-sensitive (handling needed within 24 hours), or from an important stakeholder requiring urgent attention?',
      },
      bucket: {
        type: 'choice',
        instructions:
          'If this email does not require direct action, which category does it primarily belong to?',
        criteria: buildCriteriaMap(),
      },
    },
  };
}

export function evaluateTriageDecision(
  email: EmailItem,
  answers: {
    requires_action: { noul: number };
    is_important: { noul: number };
    bucket: { choice: string; confidence?: number };
  }
): TriageResult {
  const reqActionNoul = answers.requires_action.noul;
  const isImportantNoul = answers.is_important.noul;
  const bucketChoice = answers.bucket.choice;
  const bucketConfidence = answers.bucket.confidence ?? 1.0;

  // 1. Action item: retain in Inbox, star if important
  if (reqActionNoul >= CONFIG.thresholds.requiresAction) {
    const isImportant = isImportantNoul >= CONFIG.thresholds.isImportant;
    return {
      emailId: email.id,
      targetLabel: CONFIG.actionLabel,
      shouldStar: isImportant,
      shouldArchive: false,
      actionType: isImportant ? 'KEEP_INBOX_STAR' : 'KEEP_INBOX',
      requiresActionScore: reqActionNoul,
      isImportantScore: isImportantNoul,
      chosenBucket: bucketChoice,
      confidence: reqActionNoul,
      reasoning: isImportant
        ? 'High-priority action item: retain in Inbox and star'
        : 'Action item: retain in Inbox',
    };
  }

  // 2. Non-action with low category confidence: fallback to Review
  if (bucketConfidence < CONFIG.thresholds.minConfidence) {
    return {
      emailId: email.id,
      targetLabel: CONFIG.reviewLabel,
      shouldStar: false,
      shouldArchive: false,
      actionType: 'REVIEW_FALLBACK',
      requiresActionScore: reqActionNoul,
      isImportantScore: isImportantNoul,
      chosenBucket: bucketChoice,
      confidence: bucketConfidence,
      reasoning: `Low category confidence (${(bucketConfidence * 100).toFixed(0)}%): routed to ${CONFIG.reviewLabel}`,
    };
  }

  // 3. Non-action: assign category label and apply archive policy
  const categoryDef = CONFIG.categories.find((c) => c.key === bucketChoice);
  const targetLabel = categoryDef ? categoryDef.label : CONFIG.categories[CONFIG.categories.length - 1].label;
  const shouldArchive = categoryDef ? categoryDef.archive : true;

  return {
    emailId: email.id,
    targetLabel,
    shouldStar: false,
    shouldArchive,
    actionType: shouldArchive ? 'ARCHIVE_LABEL' : 'KEEP_INBOX',
    requiresActionScore: reqActionNoul,
    isImportantScore: isImportantNoul,
    chosenBucket: bucketChoice,
    confidence: bucketConfidence,
    reasoning: `${shouldArchive ? 'Archived into' : 'Retained in'} ${targetLabel}`,
  };
}

export function buildHistoricalJevPayload(email: EmailItem) {
  return {
    model: CONFIG.typesafe.model,
    state: {
      email: {
        sender: email.sender,
        subject: email.subject,
        snippet: email.snippet,
        has_attachment: email.hasAttachment ?? false,
      },
    },
    questions: {
      bucket: {
        type: 'choice',
        instructions:
          'Which category does this historical email primarily belong to?',
        criteria: buildCriteriaMap(),
      },
    },
  };
}

export function evaluateHistoricalTriageDecision(
  email: EmailItem,
  answers: {
    bucket: { choice: string; confidence?: number };
  }
): TriageResult {
  const bucketChoice = answers.bucket.choice;
  const bucketConfidence = answers.bucket.confidence ?? 1.0;

  if (bucketConfidence < CONFIG.thresholds.minConfidence) {
    return {
      emailId: email.id,
      targetLabel: CONFIG.reviewLabel,
      shouldStar: false,
      shouldArchive: true,
      actionType: 'ARCHIVE_LABEL',
      requiresActionScore: 0,
      isImportantScore: 0,
      chosenBucket: bucketChoice,
      confidence: bucketConfidence,
      reasoning: `Low confidence historical email: labeled ${CONFIG.reviewLabel} and archived`,
    };
  }

  const categoryDef = CONFIG.categories.find((c) => c.key === bucketChoice);
  const targetLabel = categoryDef ? categoryDef.label : CONFIG.categories[CONFIG.categories.length - 1].label;

  return {
    emailId: email.id,
    targetLabel,
    shouldStar: false,
    shouldArchive: true,
    actionType: 'ARCHIVE_LABEL',
    requiresActionScore: 0,
    isImportantScore: 0,
    chosenBucket: bucketChoice,
    confidence: bucketConfidence,
    reasoning: `Historical email labeled ${targetLabel} and archived`,
  };
}
