export const CONFIG = {
  // Standard labels without numeric prefixes or emojis
  labels: {
    followUp: 'Follow Up',
    pending: 'Pending',
    receipts: 'Receipts',
    newsletter: 'Newsletter',
    notifications: 'Notifications',
    review: 'Review',
  },

  // Decision thresholds
  thresholds: {
    // Requires direct human action (0.0 to 1.0)
    requiresAction: 0.55,
    // High priority urgency for starring (0.0 to 1.0)
    isImportant: 0.70,
    // Safety confidence floor below which Review is assigned
    minConfidence: 0.60,
  },

  // TypeSafe API endpoint and model
  typesafe: {
    apiEndpoint: 'https://api.typesafe.ai/v1/systemone',
    model: 'jev-latest',
  },
} as const;
