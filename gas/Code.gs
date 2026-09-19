/**
 * Jev Mail - Google Apps Script 24/7 Cloud Automation
 *
 * 내 컴퓨터의 전원이 꺼져 있어도 구글 클라우드 서버에서 1~5분마다 자동으로
 * Gmail 인박스를 확인하고, TypeSafe Jev 모델의 판정에 따라 분류/아카이브/별표를 처리합니다.
 *
 * [설치 및 실행 방법]
 * 1. https://script.google.com 접속 -> '새 프로젝트' 생성
 * 2. 이 파일(Code.gs)의 내용을 복사하여 붙여넣기
 * 3. 좌측 '프로젝트 설정(톱니바퀴)' -> '스크립트 속성'에 TYPESAFE_API_KEY 추가
 * 4. 상단 함수 선택에서 'installTrigger' 선택 후 [실행] 클릭 (1회만 실행하면 영구 자동화 완료!)
 */

// ==========================================
// 1. 라벨 및 설정 정의
// ==========================================
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
    requiresAction: 0.65,
    isImportant: 0.70,
    minConfidence: 0.60,
  },
  typesafeEndpoint: 'https://api.typesafe.ai/v1/systemone',
  model: 'jev-latest',
  maxBatchSize: 10, // 1회 실행 시 처리할 최대 메일 수
};

/**
 * 24/7 자동 실행 트리거 설치 (최초 1회 실행)
 * 매 5분마다 구글 클라우드에서 autoTriageInbox()를 자동 호출합니다.
 */
function installTrigger() {
  // 기존 트리거 정리
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    ScriptApp.deleteTrigger(triggers[i]);
  }

  // 매 5분마다 실행되는 새 트리거 등록
  ScriptApp.newTrigger('autoTriageInbox')
    .timeBased()
    .everyMinutes(5)
    .create();

  Logger.log('✅ 24/7 자동 실행 트리거가 성공적으로 설치되었습니다. (주기: 5분)');
}

/**
 * TypeSafe API 키를 스크립트 속성에 등록하는 함수 (필요 시 실행)
 */
function setApiKey() {
  var key = PropertiesService.getScriptProperties().getProperty('TYPESAFE_API_KEY');
  if (!key) {
    Logger.log('⚠️ 스크립트 속성에 TYPESAFE_API_KEY를 설정해 주세요.');
  } else {
    Logger.log('✅ TYPESAFE_API_KEY가 이미 설정되어 있습니다.');
  }
}

/**
 * 메인 트리거 함수: 인박스 내 읽지 않은 메일 자동 분류
 */
function autoTriageInbox() {
  var apiKey = PropertiesService.getScriptProperties().getProperty('TYPESAFE_API_KEY');
  if (!apiKey) {
    Logger.log('❌ TYPESAFE_API_KEY 스크립트 속성이 설정되지 않았습니다.');
    return;
  }

  // 받은편지함(INBOX)의 최신 메일 10건 검색
  var threads = GmailApp.search('in:inbox', 0, CONFIG.maxBatchSize);
  if (threads.length === 0) {
    Logger.log('인박스에 처리할 메일이 없습니다. (Zero-Inbox 상태)');
    return;
  }

  // 필요한 라벨 캐시 및 생성
  var labelObjects = getOrCreateLabels();

  for (var i = 0; i < threads.length; i++) {
    var thread = threads[i];
    var messages = thread.getMessages();
    var latestMessage = messages[messages.length - 1];

    // 이미 시스템 라벨 중 하나라도 붙어있다면 건너뜀 (중복 처리 방지)
    if (hasAnySystemLabel(thread, labelObjects)) {
      continue;
    }

    var emailData = {
      sender: latestMessage.getFrom(),
      subject: latestMessage.getSubject(),
      snippet: latestMessage.getPlainBody().substring(0, 1000), // 본문 앞 1000자
      has_attachment: latestMessage.getAttachments().length > 0,
    };

    try {
      var decision = callJevTriage(emailData, apiKey);
      applyDecision(thread, latestMessage, decision, labelObjects);
      Logger.log('처리 완료: [' + decision.targetLabel + '] ' + emailData.subject);
    } catch (err) {
      Logger.log('에러 발생 (' + emailData.subject + '): ' + err.toString());
    }
  }
}

/**
 * TypeSafe Jev 모델 호출
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
    throw new Error('TypeSafe API 응답 오류: ' + response.getContentText());
  }

  var answers = json.answers;
  var reqAction = answers.requires_action.noul;
  var isImportant = answers.is_important.noul;
  var bucket = answers.bucket.choice;
  var minConf = Math.min(
    answers.requires_action.confidence || 1.0,
    answers.bucket.confidence || 1.0
  );

  // 1. 낮은 확신도 -> Review
  if (minConf < CONFIG.thresholds.minConfidence) {
    return { targetLabel: CONFIG.labels.review, shouldStar: false, shouldArchive: false };
  }

  // 2. 행동 필요 -> Follow Up (중요/긴급 시 Star ON)
  if (reqAction >= CONFIG.thresholds.requiresAction) {
    var important = isImportant >= CONFIG.thresholds.isImportant;
    return { targetLabel: CONFIG.labels.followUp, shouldStar: important, shouldArchive: false };
  }

  // 3. 비액션 -> 카테고리 라벨 부착 후 즉시 아카이브
  var targetLabel = CONFIG.labels.notifications;
  if (bucket === 'pending') targetLabel = CONFIG.labels.pending;
  else if (bucket === 'receipts') targetLabel = CONFIG.labels.receipts;
  else if (bucket === 'newsletter') targetLabel = CONFIG.labels.newsletter;

  return { targetLabel: targetLabel, shouldStar: false, shouldArchive: true };
}

/**
 * 판정 결과에 따른 Gmail 실제 조작 실행
 */
function applyDecision(thread, message, decision, labelObjects) {
  var label = labelObjects[decision.targetLabel];
  if (label) {
    thread.addLabel(label);
  }

  // 별표(Star) 적용 여부
  if (decision.shouldStar) {
    message.star();
  }

  // 아카이브(Archive) 적용 여부
  if (decision.shouldArchive) {
    thread.moveToArchive(); // INBOX 라벨 제거 -> Zero-Inbox 달성!
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
