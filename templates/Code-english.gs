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
