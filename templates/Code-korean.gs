/**
 * Jev-Mail: Google Apps Script 24/7 Cloud Automation (한국어 라벨 템플릿)
 *
 * 구글 클라우드에서 시간 기반 트리거로 상시 구동됩니다.
 * TypeSafe Jev 모델의 판정에 따라 수신 메일을 분류, 라벨링, 아카이브 처리합니다.
 *
 * 설치 방법:
 * 1. https://script.google.com 접속 후 Jev-Mail-Triage 프로젝트 생성
 * 2. Code.gs 파일에 이 내용을 붙여넣기
 * 3. 좌측 프로젝트 설정의 스크립트 속성에 TYPESAFE_API_KEY 추가
 * 4. 상단 함수 선택에서 installTrigger 선택 후 실행 클릭
 */

var CONFIG = {
  labels: {
    followUp: '처리할일',
    pending: '회신대기',
    receipts: '결제영수증',
    newsletter: '뉴스레터',
    notifications: '시스템알림',
    review: '검토필요',
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

function installTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    ScriptApp.deleteTrigger(triggers[i]);
  }

  ScriptApp.newTrigger('autoTriageInbox')
    .timeBased()
    .everyMinutes(5)
    .create();

  Logger.log('[OK] 24/7 자동 실행 트리거 설치 완료 (주기: 5분)');
}

function setApiKey() {
  var key = PropertiesService.getScriptProperties().getProperty('TYPESAFE_API_KEY');
  if (!key) {
    Logger.log('[WARN] 스크립트 속성에 TYPESAFE_API_KEY를 설정해 주세요.');
  } else {
    Logger.log('[OK] TYPESAFE_API_KEY가 설정되어 있습니다.');
  }
}

function autoTriageInbox() {
  var apiKey = PropertiesService.getScriptProperties().getProperty('TYPESAFE_API_KEY');
  if (!apiKey) {
    Logger.log('[ERROR] TYPESAFE_API_KEY 스크립트 속성이 없습니다.');
    return;
  }

  var threads = GmailApp.search('in:inbox', 0, CONFIG.maxBatchSize);
  if (threads.length === 0) {
    Logger.log('[INFO] 인박스가 비어 있습니다.');
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

function triageHistoricalInbox(maxThreads) {
  maxThreads = maxThreads || 100;
  var apiKey = PropertiesService.getScriptProperties().getProperty('TYPESAFE_API_KEY');
  if (!apiKey) {
    Logger.log('[ERROR] TYPESAFE_API_KEY 스크립트 속성이 없습니다.');
    return;
  }

  var threads = GmailApp.search('in:inbox', 0, maxThreads);
  Logger.log('[INFO] 과거 메일 재분류 시작: 총 ' + threads.length + '개 스레드 발견');
  if (threads.length === 0) {
    Logger.log('[INFO] 인박스가 비어 있습니다.');
    return;
  }

  var labelObjects = getOrCreateLabels();
  var followUpLabel = labelObjects[CONFIG.labels.followUp];
  var processed = 0;

  for (var i = 0; i < threads.length; i++) {
    var thread = threads[i];
    var messages = thread.getMessages();
    var latestMessage = messages[messages.length - 1];

    if (followUpLabel && threadHasLabel(thread, followUpLabel)) {
      thread.removeLabel(followUpLabel);
    }

    var existingLabel = getExistingCategoryLabel(thread, labelObjects);
    if (existingLabel) {
      thread.moveToArchive();
      processed++;
      Logger.log('[' + processed + '/' + threads.length + '] 기존 라벨 유지 및 아카이브: [' + existingLabel + '] ' + latestMessage.getSubject());
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
      Logger.log('[' + processed + '/' + threads.length + '] 분류 및 아카이브 완료: [' + decision.targetLabel + '] ' + emailData.subject);
    } catch (err) {
      Logger.log('[ERROR] ' + emailData.subject + ': ' + err.toString());
    }
  }

  Logger.log('[DONE] 과거 메일 총 ' + processed + '건 재분류 및 아카이브 완료.');
}

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

  if (!json.answers) {
    throw new Error('TypeSafe API 응답 오류: ' + response.getContentText());
  }

  var answers = json.answers;
  var reqAction = answers.requires_action.noul;
  var isImportant = answers.is_important.noul;
  var bucket = answers.bucket.choice;
  var bucketConf = answers.bucket.confidence || 1.0;

  if (reqAction >= CONFIG.thresholds.requiresAction) {
    var important = isImportant >= CONFIG.thresholds.isImportant;
    return { targetLabel: CONFIG.labels.followUp, shouldStar: important, shouldArchive: false };
  }

  if (bucketConf < CONFIG.thresholds.minConfidence) {
    return { targetLabel: CONFIG.labels.review, shouldStar: false, shouldArchive: false };
  }

  var targetLabel = CONFIG.labels.notifications;
  if (bucket === 'pending') targetLabel = CONFIG.labels.pending;
  else if (bucket === 'receipts') targetLabel = CONFIG.labels.receipts;
  else if (bucket === 'newsletter') targetLabel = CONFIG.labels.newsletter;

  return { targetLabel: targetLabel, shouldStar: false, shouldArchive: true };
}

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
    throw new Error('TypeSafe API 응답 오류: ' + response.getContentText());
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
