# Jev-Mail (한국어)

> TypeSafe Jev System One 기반의 Gmail 24/7 자동 Zero-Inbox 분류기.

[English](README.md) | [한국어](README.ko.md)

Jev-Mail은 Google Apps Script(GAS) 기반으로 구글 클라우드에서 상시 구동되는 자동 이메일 분류 시스템입니다. 컴퓨터 전원이 꺼져 있어도 5분마다 새 메일을 확인하고 분류, 라벨링, 아카이브를 수행합니다.

느리고 비용이 많이 드는 일반 생성형 LLM 텍스트 프롬프트 대신, TypeSafe AI의 System One 모델(`Jev`)을 활용합니다. 단 한 번의 API 호출(250ms 이하)로 조치 필요 여부(`Noul`), 긴급도(`Noul`), 카테고리(`Choice`)를 병렬 확률로 판정합니다.

---

## 의사결정 파이프라인

Jev-Mail은 메일의 수명 주기(Lifecycle)와 내용(Content)을 2축으로 분리하여 처리합니다.

```
                  수신 이메일
                      │
                      ▼
             TypeSafe Jev 추론
           (병렬 질의: Noul + Choice)
                      │
        ┌─────────────┴─────────────┐
        ▼                           ▼
requires_action >= 0.55     requires_action < 0.55
  (직접 조치 필요 메일)        (정보성, 비액션 메일)
        │                           │
        ▼                           ▼
  라벨: Follow Up             신뢰도 >= 0.60?
  인박스 보존                        │
        │                     ┌─────┴─────┐
        ▼                     ▼           ▼
is_important >= 0.70?        예           아니오
  예: 별표(Star) ON           │           │
  아니오: 별표 OFF             ▼           ▼
                       카테고리 라벨      라벨: Review
                       - Receipts         인박스 보존
                       - Newsletter
                       - Notifications
                       - Pending
                              │
                              ▼
                        즉시 아카이브
                        (Zero-Inbox)
```

### 라벨 및 처리 기준

| 라벨명 | 대상 및 성격 | 판정 기준 | 별표 정책 | 인박스 보존 여부 |
| :--- | :--- | :--- | :---: | :---: |
| `Follow Up` | 직접 회신, 승인, 수동 작업이 필요한 업무 | 조치 필요 확률 0.55 이상 | 긴급 건(24시간 내)만 ON | 인박스 유지 |
| `Pending` | 회신 대기, 배송 추적, 티켓 처리 대기 | 외부 결과 대기 중인 상태 | OFF | 즉시 아카이브 |
| `Receipts` | 결제 영수증, 세금계산서, SaaS 인보이스 | 재무, 정산, 증빙 서류 | OFF | 즉시 아카이브 |
| `Newsletter` | 기술 블로그, 아티클, 주간 다이제스트 | 지식 및 정보성 읽을거리 | OFF | 즉시 아카이브 |
| `Notifications` | 깃허브 알림, CI/CD 빌드, 보안 인증번호, OTP | 기계 생성 시스템 알림 | OFF | 즉시 아카이브 |
| `Review` | 모델 신뢰도가 0.60 미만인 경계 케이스 | 수동 확인 필요 건 | OFF | 인박스 유지 |

---

## AI 코딩 에이전트를 통한 1-Shot 배포

Claude Code, Antigravity, Cursor, Codex 등의 코딩 에이전트를 사용 중이라면 아래 프롬프트를 에이전트에게 전달하십시오:

```markdown
https://github.com/vynnlee/jev-mail 의 AGENTS.md 를 읽고 내 Gmail 계정에 Jev-Mail을 세팅해줘.
내 TypeSafe API 키는 다음과 같아: <본인의_TYPESAFE_API_KEY>

AGENTS.md 에 정의된 절차를 따라 다음을 수행해:
1. 로컬 빌드 및 npm run simulate 검증
2. Google Apps Script 코드를 내 계정에 반영
3. Script Properties에 TYPESAFE_API_KEY 설정
4. installTrigger 함수를 실행해 24/7 클라우드 트리거 등록
5. Zero-Inbox 유지를 위한 Gmail 설정 안내
```

에이전트가 [AGENTS.md](AGENTS.md)를 읽고 전체 설치를 자동으로 완료합니다.

---

## 3분 수동 설치 가이드

### 1단계: TypeSafe API 키 발급
[TypeSafe AI 콘솔](https://typesafe.ai)에서 API 키를 발급받습니다.

### 2단계: Google Apps Script 프로젝트 생성
1. [script.google.com/home](https://script.google.com/home)에 접속하여 **새 프로젝트**를 생성합니다.
2. 프로젝트 이름을 `Jev-Mail-Triage`로 변경합니다.
3. `Code.gs` 내용을 [gas/Code.gs](gas/Code.gs) 또는 한국어 라벨용 [templates/Code-korean.gs](templates/Code-korean.gs)의 코드로 교체합니다.
4. 저장(`Cmd+S` 또는 `Ctrl+S`)합니다.

### 3단계: 스크립트 속성에 API 키 추가
1. 좌측 메뉴에서 **프로젝트 설정**(톱니바퀴 아이콘)을 클릭합니다.
2. 하단 **스크립트 속성**에서 **스크립트 속성 추가**를 누릅니다.
3. 다음 값을 입력합니다:
   - 속성: `TYPESAFE_API_KEY`
   - 값: `<발급받은_API_키>`
4. **스크립트 속성 저장**을 클릭합니다.

### 4단계: 24/7 자동 실행 트리거 설치
1. 좌측 메뉴에서 **편집기**(`< >` 아이콘)로 돌아옵니다.
2. 상단 툴바의 함수 드롭다운에서 `installTrigger`를 선택하고 **실행**을 누릅니다.
3. 구글 권한 승인 창이 뜨면 승인을 완료합니다.
4. 실행 로그에 `[OK] 24/7 trigger installed successfully`가 출력되면 설치가 완료된 것입니다. 구글 클라우드가 5분마다 자동 실행됩니다.

### 5단계: (선택 사항) 과거 메일 일괄 정리 킥오프
현재 받은편지함(INBOX)에 기존 메일들이 쌓여 있다면:
1. 함수 드롭다운에서 `triageHistoricalInbox`를 선택합니다.
2. **실행**을 누릅니다.
3. 인박스의 기존 메일들이 분석되어 각 카테고리 라벨 부착 후 즉시 아카이브됩니다. 과거 메일에는 별표나 Follow Up 라벨이 붙지 않습니다.

---

## 권장 Gmail 설정: 중요 편지함 비활성화

구글의 기본 중요 편지함 예측은 오분류가 빈번합니다.

1. Gmail 설정(톱니바퀴) -> **모든 설정 보기** -> **받은편지함**으로 이동합니다.
2. **중요도 표시** 항목에서 **마커 표시 안함**을 선택합니다.
3. **이전 작업에 따라 중요도 예측 안함**을 체크합니다.
4. 변경사항을 저장합니다.

Jev-Mail은 긴급도가 높은 건(`is_important >= 0.70`)에만 별표(Star)를 부여하므로, 별표 편지함을 오늘의 우선순위 집중 큐로 사용하십시오.

---

## 로컬 시뮬레이션 및 검증

배포 전 로컬 환경에서 모의 메일 데이터로 판정 로직을 테스트할 수 있습니다:

```bash
git clone https://github.com/vynnlee/jev-mail.git
cd jev-mail
npm install
npm run build
TYPESAFE_API_KEY="본인의_API_키" npm run simulate
```

---

## 보안 및 개인정보 보호

- 이메일 영구 저장 없음: 외부 데이터베이스에 메일 본문이나 메타데이터를 일절 저장하지 않습니다.
- 개인 구글 계정의 Apps Script 샌드박스 내부에서만 동작합니다.
- API 키는 구글 Script Properties에 암호화 보관됩니다.
- 판정 시 발신자, 제목, 앞부분 1000자 요약만 TypeSafe 추론 엔드포인트로 전송됩니다.

---

## 라이선스

MIT License. 상세 내용은 [LICENSE](LICENSE)를 참고하십시오.
작성자: [Vynn Lee](https://github.com/vynnlee).
