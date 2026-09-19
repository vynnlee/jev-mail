import { CONFIG } from './config.js';
import type { EmailItem, TriageResult } from './types.js';

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
          'Does `email` clearly require the recipient to directly reply, make a decision, approve an item, or perform a manual task?',
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
        criteria: {
          pending: {
            what: "Awaiting another person's reply, package delivery tracking, support ticket response, or ongoing workflow resolution",
            examples: [
              "We received your inquiry and will respond soon",
              "Your order has shipped and is on the way",
            ],
          },
          receipts: {
            what: "Financial receipts, payment confirmations, Stripe/bank alerts, subscription invoices, tickets, bookings",
            examples: [
              "Your receipt from Acme Inc",
              "Payment confirmation for subscription",
            ],
          },
          newsletter: {
            what: "Editorial content, digests, blogs, product release updates, marketing promotions, Substack",
            examples: [
              "This week in Tech Digest",
              "Introducing our new feature v2.0",
            ],
          },
          notifications: {
            what: "Automated service notices, GitHub/Jira mentions, password resets, social media pings, security verification codes",
            examples: [
              "Security alert: New login detected",
              "[GitHub] Pull request #123 merged",
            ],
          },
        },
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

  // 1. 후속 조치(Follow Up) 메일: 인박스 유지 + 중요/긴급 시 별표(⭐)
  if (reqActionNoul >= CONFIG.thresholds.requiresAction) {
    const isImportant = isImportantNoul >= CONFIG.thresholds.isImportant;
    return {
      emailId: email.id,
      targetLabel: CONFIG.labels.followUp,
      shouldStar: isImportant,
      shouldArchive: false, // 인박스 유지
      actionType: isImportant ? 'KEEP_INBOX_STAR' : 'KEEP_INBOX',
      requiresActionScore: reqActionNoul,
      isImportantScore: isImportantNoul,
      chosenBucket: bucketChoice,
      confidence: reqActionNoul,
      reasoning: isImportant
        ? '중요/긴급 업무 (Follow Up + ⭐ Star)'
        : '일반 후속 조치 (Follow Up)',
    };
  }

  // 2. 비액션 메일 중 카테고리 신뢰도가 낮은 경우: 사람에게 Review 위임 (인박스 보존)
  if (bucketConfidence < CONFIG.thresholds.minConfidence) {
    return {
      emailId: email.id,
      targetLabel: CONFIG.labels.review,
      shouldStar: false,
      shouldArchive: false, // 인박스 보존
      actionType: 'REVIEW_FALLBACK',
      requiresActionScore: reqActionNoul,
      isImportantScore: isImportantNoul,
      chosenBucket: bucketChoice,
      confidence: bucketConfidence,
      reasoning: `낮은 카테고리 신뢰도 (${(bucketConfidence * 100).toFixed(0)}%)로 인해 Review 위임`,
    };
  }

  // 3. 비액션 메일: 카테고리별 라벨 부여 후 즉시 아카이브 (Zero-Inbox)
  let targetLabel: string;
  switch (bucketChoice) {
    case 'pending':
      targetLabel = CONFIG.labels.pending;
      break;
    case 'receipts':
      targetLabel = CONFIG.labels.receipts;
      break;
    case 'newsletter':
      targetLabel = CONFIG.labels.newsletter;
      break;
    case 'notifications':
    default:
      targetLabel = CONFIG.labels.notifications;
      break;
  }

  return {
    emailId: email.id,
    targetLabel,
    shouldStar: false,
    shouldArchive: true, // 즉시 아카이브 (Zero-Inbox 달성)
    actionType: 'ARCHIVE_LABEL',
    requiresActionScore: reqActionNoul,
    isImportantScore: isImportantNoul,
    chosenBucket: bucketChoice,
    confidence: bucketConfidence,
    reasoning: `보관 대상 분류 (${targetLabel}) -> 즉시 아카이브`,
  };
}

/**
 * 과거 메일 전수 정리용 페이로드 빌더
 * (Star/Follow-Up 제외, 순수 카테고리 분류 목적)
 */
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
        criteria: {
          pending: {
            what: "Awaiting another person's reply, package delivery tracking, support ticket response, or ongoing workflow resolution",
            examples: [
              "We received your inquiry and will respond soon",
              "Your order has shipped and is on the way",
            ],
          },
          receipts: {
            what: "Financial receipts, payment confirmations, Stripe/bank alerts, subscription invoices, tickets, bookings",
            examples: [
              "Your receipt from Acme Inc",
              "Payment confirmation for subscription",
            ],
          },
          newsletter: {
            what: "Editorial content, digests, blogs, product release updates, marketing promotions, Substack",
            examples: [
              "This week in Tech Digest",
              "Introducing our new feature v2.0",
            ],
          },
          notifications: {
            what: "Automated service notices, GitHub/Jira mentions, password resets, social media pings, security verification codes",
            examples: [
              "Security alert: New login detected",
              "[GitHub] Pull request #123 merged",
            ],
          },
        },
      },
    },
  };
}

/**
 * 과거 메일 판정 평가:
 * - Star: 무조건 false
 * - Follow Up: 미부여
 * - Archive: 무조건 true (인박스 정리)
 */
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
      targetLabel: CONFIG.labels.review,
      shouldStar: false,
      shouldArchive: true,
      actionType: 'ARCHIVE_LABEL',
      requiresActionScore: 0,
      isImportantScore: 0,
      chosenBucket: bucketChoice,
      confidence: bucketConfidence,
      reasoning: `과거 메일 신뢰도 낮음 -> Review 라벨 후 아카이브`,
    };
  }

  let targetLabel: string;
  switch (bucketChoice) {
    case 'pending':
      targetLabel = CONFIG.labels.pending;
      break;
    case 'receipts':
      targetLabel = CONFIG.labels.receipts;
      break;
    case 'newsletter':
      targetLabel = CONFIG.labels.newsletter;
      break;
    case 'notifications':
    default:
      targetLabel = CONFIG.labels.notifications;
      break;
  }

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
    reasoning: `과거 메일 정리 (${targetLabel}) -> 아카이브`,
  };
}
