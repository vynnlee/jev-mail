/**
 * ============================================================================
 * Jev-Mail: TypeSafe AI 기반 24/7 클라우드 무중단 Zero-Inbox (한국어 라벨 프리셋)
 * ============================================================================
 *
 * Repository: https://github.com/your-username/jev-mail
 * License: MIT
 *
 * [간편 설치 가이드]
 * 1. https://script.google.com 접속 후 '새 프로젝트' 클릭
 * 2. 프로젝트 이름을 'Jev-Mail-Triage'로 변경
 * 3. Code.gs의 기본 내용을 지우고 이 파일 전체를 복사하여 붙여넣고 저장(Cmd+S)
 * 4. 좌측 프로젝트 설정(톱니바퀴) -> '스크립트 속성' -> 속성 추가:
 *    - 속성: TYPESAFE_API_KEY
 *    - 값: <본인의 TypeSafe AI API 키>
 * 5. 상단 함수 선택에서 'installTrigger' 선택 후 [실행] 클릭 (구글 권한 1회 승인)
 * 6. 완료! 컴퓨터가 꺼져 있어도 구글 클라우드가 5분마다 인박스를 자동 분류/아카이브합니다.
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

/**
 * 24/7 자동 실행 트리거 설치 (최초 1회 실행)
 * 매 5분마다 구글 클라우드에서 autoTriageInbox()를 자동 호출합니다.
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

  Logger.log('✅ 24/7 자동 실행 트리거가 성공적으로 설치되었습니다. (주기: 5분)');
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

  var threads = GmailApp.search('in:inbox', 0, CONFIG.maxBatchSize);
  if (threads.length === 0) {
    Logger.log('인박스에 처리할 메일이 없습니다. (Zero-Inbox 상태) 🚀');
    return;
  }

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
      snippet: latestMessage.getPlainBody().substring(0, 1000),
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
  var bucketConf = answers.bucket.confidence || 1.0;

  // 1. 행동 필요 -> 처리할일 (인박스 유지, 중요/긴급 시 Star ON)
  if (reqAction >= CONFIG.thresholds.requiresAction) {
    var important = isImportant >= CONFIG.thresholds.isImportant;
    return { targetLabel: CONFIG.labels.followUp, shouldStar: important, shouldArchive: false };
  }

  // 2. 비액션 중 카테고리 확신도가 낮음 -> 검토필요 (사람 검토를 위해 인박스 보존)
  if (bucketConf < CONFIG.thresholds.minConfidence) {
    return { targetLabel: CONFIG.labels.review, shouldStar: false, shouldArchive: false };
  }

  // 3. 비액션 -> 카테고리 라벨 부착 후 즉시 아카이브 (Zero-Inbox)
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
