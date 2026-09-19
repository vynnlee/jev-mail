# Jev Mail: TypeSafe AI 기반 Zero-Inbox 자동화 시스템

TypeSafe의 초고속 System One 모델인 **Jev**와 Gmail을 결합하여, 수신 메일을 실시간 분류하고 보관/별표를 자동화하는 **Zero-Inbox 파이프라인**입니다.

---

## 1. 분류 및 아카이브 체계 (Taxonomy)

사용자가 확인해야 할 메일과 보관할 메일을 명확히 분리하여, **받은편지함(INBOX)에는 오직 오늘 처리할 메일만 남기는 것**을 목표로 합니다.

### 라벨 및 액션 매트릭스

| 라벨명 | 성격 및 대상 | Star (⭐) | INBOX 보존 | 설명 |
| :--- | :--- | :---: | :---: | :--- |
| **`Follow Up`** | 내가 직접 회신, 승인, 업무 처리를 해야 하는 메일 | **긴급/오늘 마감 건만 ON** | **유지** | 오늘 처리할 일은 ⭐가 켜지고, 일반 대기열은 ⭐ 없이 인박스에 남음 |
| **`Pending`** | 상대방에게 공을 넘겨서 회신이나 결과를 기다리는 메일 | OFF | **아카이브** | 주 1~2회 `label:Pending` 검색을 통해 리마인드/독촉 관리 |
| **`Receipts`** | 결제 확인서, Stripe 영수증, 송장, 세금계산서, 티켓 | OFF | **즉시 아카이브** | 인박스에서 즉시 치우고 세무/정산 시 검색용으로 라벨 보관 |
| **`Newsletter`** | 구독 뉴스레터, 테크 블로그, 제품 릴리즈 소식 | OFF | **즉시 아카이브** | 인박스를 채우지 않고 여유 시간에 `Newsletter` 라벨에서 읽음 |
| **`Notifications`** | GitHub, Jira, 슬랙 핑, 시스템 모니터링 로그, 보안 알림 | OFF | **즉시 아카이브** | 읽지 않고 넘겨도 무방한 시스템 기계 생성 메일 |
| *(안전망)* **`Review`** | 모델 신뢰도(`confidence`)가 낮아 AI 판정이 애매한 메일 | OFF | **유지** | 오분류를 방지하기 위해 사용자 수동 검토용으로 인박스 보존 |

---

## 2. Jev 모델 판정 스펙 (System One Primitives)

단 1번의 API 호출(약 100ms)로 메일의 상태(`state`)에 대해 병렬 질의(`Parallel Speculative Fan-out`)를 수행합니다.

### State (입력)
```json
{
  "sender": "sender@domain.com",
  "subject": "Email Subject",
  "snippet": "Email body preview text...",
  "has_attachment": false
}
```

### Questions (질문)
```json
{
  "requires_action": {
    "type": "noul",
    "instructions": "Does this email require the recipient to directly reply, make a decision, approve a request, or take manual action?"
  },
  "is_urgent": {
    "type": "noul",
    "instructions": "If action is required, is this urgent or expected to be handled within today (24 hours)?"
  },
  "bucket": {
    "type": "choice",
    "instructions": "Classify the non-action category of this email.",
    "criteria": {
      "pending": "Emails where the recipient is waiting for someone else's reply, status update, package delivery, or external resolution",
      "receipts": "Billing receipts, payment invoices, subscription renewals, tax invoices, ticket/hotel confirmations",
      "newsletter": "Scheduled newsletters, product announcement digests, tech blogs, marketing promotions",
      "notifications": "Automated system alerts, security codes, GitHub/Jira notifications, platform notices"
    }
  }
}
```

---

## 3. 컴퓨터 전원과 무관한 24/7 상시 구동 방안

내 PC/노트북이 꺼져 있어도 항상 Gmail에 붙어서 자동 분류가 동작하게 하는 방법입니다.

### 방법 1. Google Apps Script (GAS) 트리거 ⭐ (강력 추천 / 비용 0원)
* **원리**: 구글 클라우드에서 제공하는 무료 스크립트 엔진([script.google.com](https://script.google.com))에 코드를 올려두고 시간 기반 트리거(매 1분~5분)로 자동 실행.
* **장점**:
  - 내 컴퓨터가 꺼져 있어도 365일 24시간 완전 무중단 자동 실행.
  - 서버 비용 0원, 인프라 관리 불필요.
  - 구글 네이티브 권한(`GmailApp`)을 쓰므로 OAuth 만료나 리프레시 토큰 이슈가 없음.
* **배포 파일**: [`gas/Code.gs`](./gas/Code.gs)

### 방법 2. 초소형 클라우드 서버리스 (Cloudflare Workers / Vercel Cron)
* Vercel Cron 또는 Cloudflare Cron Worker를 통해 주기적으로 Gmail API와 TypeSafe API를 호출.

---

## 4. 디렉터리 구성

```text
jev-mail/
├── README.md             # 시스템 아키텍처 및 운영 문서
├── gas/
│   └── Code.gs           # 24/7 구글 클라우드 실행용 Apps Script 원본 코드
├── src/
│   ├── types.ts          # 데이터 모델 및 타입 정의
│   ├── config.ts         # 라벨 및 판정 임계치 설정
│   └── triage.ts         # Jev 판정 및 액션 매핑 엔진
├── package.json
└── tsconfig.json
```
