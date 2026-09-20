/**
 * Jev-Mail: Google Apps Script 24/7 Cloud Automation
 *
 * Runs automatically on Google Cloud infrastructure via time-driven triggers.
 * Triages, labels, prioritizes, and archives incoming emails using TypeSafe Jev.
 *
 * Setup:
 * 1. Open https://script.google.com and create a project named Jev-Mail-Triage.
 * 2. Paste this Code.gs content.
 * 3. In Project Settings, add Script Property: TYPESAFE_API_KEY.
 * 4. Run installTrigger once from the function dropdown.
 */

var CONFIG = {
  actionLabel: 'Follow Up',
  reviewLabel: 'Review',
  labels: {
    pending: 'Pending',
    receipts: 'Receipts',
    newsletter: 'Newsletter',
    notifications: 'Notifications',
  },
  archiveMap: {
    pending: true,
    receipts: true,
    newsletter: true,
    notifications: true,
  },
  thresholds: {
    requiresAction: 0.55,
    isImportant: 0.7,
    minConfidence: 0.6,
  },
  typesafeEndpoint: 'https://api.typesafe.ai/v1/systemone',
  model: 'jev-latest',
  maxBatchSize: 10,
};

/**
 * Installs a time-driven trigger running autoTriageInbox every 5 minutes.
 */
function installTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    ScriptApp.deleteTrigger(triggers[i]);
  }

  ScriptApp.newTrigger('autoTriageInbox')
    .timeBased()
    .everyMinutes(5)
    .create();

  Logger.log('[OK] 24/7 trigger installed successfully (interval: 5 minutes).');
}

/**
 * Validates whether TYPESAFE_API_KEY is configured in Script Properties.
 */
function setApiKey() {
  var key = PropertiesService.getScriptProperties().getProperty('TYPESAFE_API_KEY');
  if (!key) {
    Logger.log('[WARN] Please set TYPESAFE_API_KEY in Script Properties.');
  } else {
    Logger.log('[OK] TYPESAFE_API_KEY is configured.');
  }
}

/**
 * Main trigger function: triages unhandled emails in INBOX.
 */
function autoTriageInbox() {
  var apiKey = PropertiesService.getScriptProperties().getProperty('TYPESAFE_API_KEY');
  if (!apiKey) {
    Logger.log('[ERROR] TYPESAFE_API_KEY script property is missing.');
    return;
  }

  var threads = GmailApp.search('in:inbox', 0, CONFIG.maxBatchSize);
  if (threads.length === 0) {
    Logger.log('[INFO] Inbox empty. Zero-Inbox maintained.');
    return;
  }

  var labelObjects = getOrCreateLabels();

  for (var i = 0; i < threads.length; i++) {
    var thread = threads[i];
    var messages = thread.getMessages();
    var latestMessage = messages[messages.length - 1];

    if (hasAnySystemLabel(thread, labelObjects)) {
      continue;
    }

    var emailData = {
      sender: latestMessage.getFrom(),
      subject: latestMessage.getSubject(),
      snippet: latestMessage.getPlainBody().substring(0, 1000),
      has_attachment: latestMessage.getAttachments().length > 0,
    };

    try {
      var decision = callJevTriage(emailData, apiKey);
      applyDecision(thread, latestMessage, decision, labelObjects);
      Logger.log('[PROCESSED] [' + decision.targetLabel + '] ' + emailData.subject);
    } catch (err) {
      Logger.log('[ERROR] ' + emailData.subject + ': ' + err.toString());
    }
  }
}

/**
 * Historical Zero-Inbox Triage:
 * Re-triages all existing inbox emails without adding Star or Follow Up labels.
 */
function triageHistoricalInbox(maxThreads) {
  maxThreads = maxThreads || 100;
  var apiKey = PropertiesService.getScriptProperties().getProperty('TYPESAFE_API_KEY');
  if (!apiKey) {
    Logger.log('[ERROR] TYPESAFE_API_KEY script property is missing.');
    return;
  }

  var threads = GmailApp.search('in:inbox', 0, maxThreads);
  Logger.log('[INFO] Historical triage initiated: ' + threads.length + ' threads found.');
  if (threads.length === 0) {
    Logger.log('[INFO] Inbox already empty. Zero-Inbox maintained.');
    return;
  }

  var labelObjects = getOrCreateLabels();
  var actionLabelObj = labelObjects[CONFIG.actionLabel];
  var processed = 0;

  for (var i = 0; i < threads.length; i++) {
    var thread = threads[i];
    var messages = thread.getMessages();
    var latestMessage = messages[messages.length - 1];

    if (actionLabelObj && threadHasLabel(thread, actionLabelObj)) {
      thread.removeLabel(actionLabelObj);
    }

    var existingLabel = getExistingCategoryLabel(thread, labelObjects);
    if (existingLabel) {
      thread.moveToArchive();
      processed++;
      Logger.log('[' + processed + '/' + threads.length + '] Existing label archived: [' + existingLabel + '] ' + latestMessage.getSubject());
      continue;
    }

    var emailData = {
      sender: latestMessage.getFrom(),
      subject: latestMessage.getSubject(),
      snippet: latestMessage.getPlainBody().substring(0, 1000),
      has_attachment: latestMessage.getAttachments().length > 0,
    };

    try {
      var decision = callJevHistoricalTriage(emailData, apiKey);
      var label = labelObjects[decision.targetLabel];
      if (label) {
        thread.addLabel(label);
      }
      thread.moveToArchive();

      processed++;
      Logger.log('[' + processed + '/' + threads.length + '] Labeled & archived: [' + decision.targetLabel + '] ' + emailData.subject);
    } catch (err) {
      Logger.log('[ERROR] ' + emailData.subject + ': ' + err.toString());
    }
  }

  Logger.log('[DONE] Historical triage completed: ' + processed + ' threads processed.');
}

/**
 * Calls TypeSafe Jev System One model.
 */
function callJevTriage(emailData, apiKey) {
  var payload = {
    model: CONFIG.model,
    state: {
      email: emailData,
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
        criteria: {
          pending: "Awaiting reply, package delivery tracking, ticket response, or ongoing workflow resolution",
          receipts: "Financial receipts, payment confirmations, Stripe/bank alerts, subscription invoices, tickets, bookings",
          newsletter: "Editorial content, digests, blogs, product release updates, marketing promotions, Substack",
          notifications: "Automated service notices, one-time verification codes, OTPs, password resets, GitHub/Jira mentions, security alerts",
        },
      },
    },
  };

  var options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      Authorization: 'Bearer ' + apiKey,
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  };

  var response = UrlFetchApp.fetch(CONFIG.typesafeEndpoint, options);
  var json = JSON.parse(response.getContentText());

  if (!json.answers) {
    throw new Error('TypeSafe API response error: ' + response.getContentText());
  }

  var answers = json.answers;
  var reqAction = answers.requires_action.noul;
  var isImportant = answers.is_important.noul;
  var bucket = answers.bucket.choice;
  var bucketConf = answers.bucket.confidence || 1.0;

  // 1. Action required: retain in Inbox, star if important
  if (reqAction >= CONFIG.thresholds.requiresAction) {
    var important = isImportant >= CONFIG.thresholds.isImportant;
    return { targetLabel: CONFIG.actionLabel, shouldStar: important, shouldArchive: false };
  }

  // 2. Non-action with low category confidence: fallback to Review
  if (bucketConf < CONFIG.thresholds.minConfidence) {
    return { targetLabel: CONFIG.reviewLabel, shouldStar: false, shouldArchive: false };
  }

  // 3. Non-action: assign category label and check archive policy
  var targetLabel = CONFIG.labels[bucket] || CONFIG.labels['notifications'];
  var shouldArchive = CONFIG.archiveMap[bucket] !== false;

  return { targetLabel: targetLabel, shouldStar: false, shouldArchive: shouldArchive };
}

/**
 * Historical Jev classification (no star, no follow-up).
 */
function callJevHistoricalTriage(emailData, apiKey) {
  var payload = {
    model: CONFIG.model,
    state: {
      email: emailData,
    },
    questions: {
      bucket: {
        type: 'choice',
        instructions:
          'Which category does this historical email belong to?',
        criteria: {
          pending: "Awaiting reply, package delivery tracking, ticket response, or ongoing workflow resolution",
          receipts: "Financial receipts, payment confirmations, Stripe/bank alerts, subscription invoices, tickets, bookings",
          newsletter: "Editorial content, digests, blogs, product release updates, marketing promotions, Substack",
          notifications: "Automated service notices, one-time verification codes, OTPs, password resets, GitHub/Jira mentions, security alerts",
        },
      },
    },
  };

  var options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      Authorization: 'Bearer ' + apiKey,
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  };

  var response = UrlFetchApp.fetch(CONFIG.typesafeEndpoint, options);
  var json = JSON.parse(response.getContentText());

  if (!json.answers || !json.answers.bucket) {
    throw new Error('TypeSafe API response error: ' + response.getContentText());
  }

  var bucket = json.answers.bucket.choice;
  var bucketConf = json.answers.bucket.confidence || 1.0;

  if (bucketConf < CONFIG.thresholds.minConfidence) {
    return { targetLabel: CONFIG.reviewLabel };
  }

  var targetLabel = CONFIG.labels[bucket] || CONFIG.labels['notifications'];
  return { targetLabel: targetLabel };
}

function applyDecision(thread, message, decision, labelObjects) {
  var label = labelObjects[decision.targetLabel];
  if (label) {
    thread.addLabel(label);
  }

  if (decision.shouldStar) {
    message.star();
  }

  if (decision.shouldArchive) {
    thread.moveToArchive();
  }
}

function getOrCreateLabels() {
  var labelMap = {};
  var allLabels = [CONFIG.actionLabel, CONFIG.reviewLabel];
  for (var key in CONFIG.labels) {
    allLabels.push(CONFIG.labels[key]);
  }
  for (var i = 0; i < allLabels.length; i++) {
    var name = allLabels[i];
    var label = GmailApp.getUserLabelByName(name);
    if (!label) {
      label = GmailApp.createLabel(name);
    }
    labelMap[name] = label;
  }
  return labelMap;
}

function hasAnySystemLabel(thread, labelObjects) {
  var threadLabels = thread.getLabels();
  for (var i = 0; i < threadLabels.length; i++) {
    var lName = threadLabels[i].getName();
    if (labelObjects[lName]) {
      return true;
    }
  }
  return false;
}

function threadHasLabel(thread, targetLabel) {
  var labels = thread.getLabels();
  for (var i = 0; i < labels.length; i++) {
    if (labels[i].getName() === targetLabel.getName()) return true;
  }
  return false;
}

function getExistingCategoryLabel(thread, labelObjects) {
  var labels = thread.getLabels();
  for (var i = 0; i < labels.length; i++) {
    var name = labels[i].getName();
    if (name !== CONFIG.actionLabel && labelObjects[name]) {
      return name;
    }
  }
  return null;
}
