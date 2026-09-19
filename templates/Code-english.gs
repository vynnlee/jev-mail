/**
 * ============================================================================
 * Jev-Mail: Autonomous 24/7 Zero-Inbox Powered by TypeSafe AI (English Preset)
 * ============================================================================
 *
 * Repository: https://github.com/your-username/jev-mail
 * License: MIT
 *
 * [Setup Instructions]
 * 1. Open https://script.google.com and click 'New project'.
 * 2. Rename the project to 'Jev-Mail-Triage'.
 * 3. Replace all code in Code.gs with this file and save (Cmd+S).
 * 4. Go to Project Settings (gear icon) -> Script Properties -> Add:
 *    - Property: TYPESAFE_API_KEY
 *    - Value: <Your TypeSafe AI API Key>
 * 5. In the toolbar function dropdown, select 'installTrigger' and click 'Run'.
 *    (Complete Google's one-time permission grant)
 * 6. Done! Google Cloud will now automatically triage your inbox every 5 minutes.
 */

var CONFIG = {
  labels: {
    followUp: 'Follow Up',
    pending: 'Pending',
    receipts: 'Receipts',
    newsletter: 'Newsletter',
    notifications: 'Notifications',
    review: 'Review',
  },
  thresholds: {
    requiresAction: 0.55,
    isImportant: 0.70,
    minConfidence: 0.60,
  },
  typesafeEndpoint: 'https://api.typesafe.ai/v1/systemone',
  model: 'jev-latest',
  maxBatchSize: 10,
};

/**
 * Installs a 24/7 background trigger (Run once)
 * Fired every 5 minutes by Google Cloud infrastructure.
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

  Logger.log('✅ 24/7 background trigger successfully installed (Interval: 5 mins).');
}

/**
 * Main Triage Function: Fetches unread/unlabeled inbox threads and processes them.
 */
function autoTriageInbox() {
  var apiKey = PropertiesService.getScriptProperties().getProperty('TYPESAFE_API_KEY');
  if (!apiKey) {
    Logger.log('❌ Error: TYPESAFE_API_KEY script property is not set.');
    return;
  }

  var threads = GmailApp.search('in:inbox', 0, CONFIG.maxBatchSize);
  if (threads.length === 0) {
    Logger.log('Inbox is clear. Zero-Inbox achieved! 🚀');
    return;
  }

  var labelObjects = getOrCreateLabels();

  for (var i = 0; i < threads.length; i++) {
    var thread = threads[i];
    var messages = thread.getMessages();
    var latestMessage = messages[messages.length - 1];

    // Skip if already tagged by system
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
      Logger.log('Processed: [' + decision.targetLabel + '] ' + emailData.subject);
    } catch (err) {
      Logger.log('Error processing (' + emailData.subject + '): ' + err.toString());
    }
  }
}

/**
 * Historical Zero-Inbox Triage
 * - Re-triages backlog emails sitting in INBOX.
 * - Because these are past emails, neither Star (⭐) nor Follow Up labels are ever applied.
 * - Categorizes into Receipts, Newsletter, Notifications, Pending, or Review and archives immediately.
 *
 * @param {number} maxThreads Maximum number of inbox threads to process (default: 100)
 */
function triageHistoricalInbox(maxThreads) {
  maxThreads = maxThreads || 100;
  var apiKey = PropertiesService.getScriptProperties().getProperty('TYPESAFE_API_KEY');
  if (!apiKey) {
    Logger.log('❌ TYPESAFE_API_KEY script property is not set.');
    return;
  }

  var threads = GmailApp.search('in:inbox', 0, maxThreads);
  Logger.log('📥 Historical triage initiated: ' + threads.length + ' inbox threads found');
  if (threads.length === 0) {
    Logger.log('Inbox is already empty. Zero-Inbox achieved!');
    return;
  }

  var labelObjects = getOrCreateLabels();
  var followUpLabel = labelObjects[CONFIG.labels.followUp];
  var processed = 0;

  for (var i = 0; i < threads.length; i++) {
    var thread = threads[i];
    var messages = thread.getMessages();
    var latestMessage = messages[messages.length - 1];

    // Strip any existing Follow Up label since it is a historical email
    if (followUpLabel && threadHasLabel(thread, followUpLabel)) {
      thread.removeLabel(followUpLabel);
    }

    // If it already has another valid category label, simply archive
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
      // Never star past emails, archive immediately to reach Zero-Inbox
      thread.moveToArchive();

      processed++;
      Logger.log('[' + processed + '/' + threads.length + '] Triaged & archived: [' + decision.targetLabel + '] ' + emailData.subject);
    } catch (err) {
      Logger.log('Error (' + emailData.subject + '): ' + err.toString());
    }
  }

  Logger.log('🎉 Historical triage complete: ' + processed + ' emails organized & archived!');
}

/**
 * Calls TypeSafe Jev System One Model
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
          pending: 'Awaiting another person reply, package delivery tracking, ticket response, or ongoing workflow resolution',
          receipts: 'Financial receipts, payment confirmations, Stripe/bank alerts, subscription invoices, tickets, bookings',
          newsletter: 'Editorial content, digests, blogs, product release updates, marketing promotions, Substack',
          notifications: 'Automated service notices, GitHub/Jira mentions, password resets, social media pings, security verification codes',
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
    throw new Error('TypeSafe API Error: ' + response.getContentText());
  }

  var answers = json.answers;
  var reqAction = answers.requires_action.noul;
  var isImportant = answers.is_important.noul;
  var bucket = answers.bucket.choice;
  var bucketConf = answers.bucket.confidence || 1.0;

  // 1. Action Required -> Follow Up (Keep in Inbox, Star if Important)
  if (reqAction >= CONFIG.thresholds.requiresAction) {
    var important = isImportant >= CONFIG.thresholds.isImportant;
    return { targetLabel: CONFIG.labels.followUp, shouldStar: important, shouldArchive: false };
  }

  // 2. Non-action with low category confidence -> Review (Retain in Inbox for user inspection)
  if (bucketConf < CONFIG.thresholds.minConfidence) {
    return { targetLabel: CONFIG.labels.review, shouldStar: false, shouldArchive: false };
  }

  // 3. Non-Action Buckets (Label & Archive immediately for Zero-Inbox)
  var targetLabel = CONFIG.labels.notifications;
  if (bucket === 'pending') targetLabel = CONFIG.labels.pending;
  else if (bucket === 'receipts') targetLabel = CONFIG.labels.receipts;
  else if (bucket === 'newsletter') targetLabel = CONFIG.labels.newsletter;

  return { targetLabel: targetLabel, shouldStar: false, shouldArchive: true };
}

/**
 * Applies labels, stars, and archives according to decision
 */
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
  for (var key in CONFIG.labels) {
    var name = CONFIG.labels[key];
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
    if (
      name === CONFIG.labels.pending ||
      name === CONFIG.labels.receipts ||
      name === CONFIG.labels.newsletter ||
      name === CONFIG.labels.notifications ||
      name === CONFIG.labels.review
    ) {
      return name;
    }
  }
  return null;
}

/**
 * Historical email Jev classification (no star, no follow-up)
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
          pending: 'Awaiting reply, package delivery tracking, ticket response, or ongoing workflow resolution',
          receipts: 'Financial receipts, payment confirmations, Stripe/bank alerts, subscription invoices, tickets, bookings',
          newsletter: 'Editorial content, digests, blogs, product release updates, marketing promotions, Substack',
          notifications: 'Automated service notices, GitHub/Jira mentions, password resets, social media pings, security codes',
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
    throw new Error('TypeSafe API Error: ' + response.getContentText());
  }

  var bucket = json.answers.bucket.choice;
  var bucketConf = json.answers.bucket.confidence || 1.0;

  if (bucketConf < CONFIG.thresholds.minConfidence) {
    return { targetLabel: CONFIG.labels.review };
  }

  var targetLabel = CONFIG.labels.notifications;
  if (bucket === 'pending') targetLabel = CONFIG.labels.pending;
  else if (bucket === 'receipts') targetLabel = CONFIG.labels.receipts;
  else if (bucket === 'newsletter') targetLabel = CONFIG.labels.newsletter;

  return { targetLabel: targetLabel };
}
