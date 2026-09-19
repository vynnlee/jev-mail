export const CONFIG = {
  // 사용자가 확정한 5대 표준 라벨 (숫자, 이모지 없음)
  labels: {
    followUp: 'Follow Up',
    pending: 'Pending',
    receipts: 'Receipts',
    newsletter: 'Newsletter',
    notifications: 'Notifications',
    review: 'Review', // 안전망 라벨
  },

  // 의사결정 임계치 (Thresholds)
  thresholds: {
    // 직접 조치 필요 여부 (0.0 ~ 1.0, 0.55 이상이면 사람의 응답/조치 필요)
    requiresAction: 0.55,
    // 최우선 중요/긴급 여부 (별표 표시 기준, 0.0 ~ 1.0)
    isImportant: 0.70,
    // 모델 신뢰도 안전망 (이보다 낮으면 사람에게 Review 위임)
    minConfidence: 0.60,
  },

  // TypeSafe API 엔드포인트 및 모델
  typesafe: {
    apiEndpoint: 'https://api.typesafe.ai/v1/systemone',
    model: 'jev-latest',
  },
} as const;
