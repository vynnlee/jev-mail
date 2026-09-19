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
      is_urgent: {
        type: 'noul',
        instructions:
          'If action is required, does `email` imply urgency that needs handling within today (24 hours) or express critical time sensitivity?',
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
    requires_action: { noul: number; confidence?: number };
    is_urgent: { noul: number; confidence?: number };
    bucket: { choice: string; confidence?: number };
  }
): TriageResult {
  const reqActionNoul = answers.requires_action.noul;
  const isUrgentNoul = answers.is_urgent.noul;
  const bucketChoice = answers.bucket.choice;
  const minConf = Math.min(
    answers.requires_action.confidence ?? 1.0,
    answers.bucket.confidence ?? 1.0
  );

  // 1. 안전망: Confidence가 너무 낮으면 사람에게 Review 위임
  if (minConf < CONFIG.thresholds.minConfidence) {
    return {
      emailId: email.id,
      targetLabel: CONFIG.labels.review,
      shouldStar: false,
      shouldArchive: false, // 인박스 보존
      actionType: 'REVIEW_FALLBACK',
      requiresActionScore: reqActionNoul,
      isUrgentScore: isUrgentNoul,
      chosenBucket: bucketChoice,
      confidence: minConf,
      reasoning: `낮은 신뢰도 (${(minConf * 100).toFixed(0)}%)로 인해 수동 검토 라벨 부여`,
    };
  }

  // 2. 후속 조치(Follow Up) 메일: 인박스 유지 + 긴급 시 별표
  if (reqActionNoul >= CONFIG.thresholds.requiresAction) {
    const isTodayUrgent = isUrgentNoul >= CONFIG.thresholds.isUrgent;
    return {
      emailId: email.id,
      targetLabel: CONFIG.labels.followUp,
      shouldStar: isTodayUrgent,
      shouldArchive: false, // 인박스 유지
      actionType: isTodayUrgent ? 'KEEP_INBOX_STAR' : 'KEEP_INBOX',
      requiresActionScore: reqActionNoul,
      isUrgentScore: isUrgentNoul,
      chosenBucket: bucketChoice,
      confidence: minConf,
      reasoning: isTodayUrgent
        ? '오늘 중 처리 필요 (Follow Up + ⭐ Star)'
        : '일반 후속 조치 필요 (Follow Up)',
    };
  }

  // 3. 비액션 메일: 카테고리별 라벨 부여 후 즉시 아카이브
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
    isUrgentScore: isUrgentNoul,
    chosenBucket: bucketChoice,
    confidence: minConf,
    reasoning: `보관 대상 분류 (${targetLabel}) -> 즉시 아카이브`,
  };
}
