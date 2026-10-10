# PPFP 확장 로드맵 명세 (2026-10)

- 작성일: 2026-10-10
- 기준 코드: main `d4e073b` (PR #25까지)
- 상태: **제안**. 기능은 아직 구현하지 않았다. 이번 작업에서 만든 코드는 [5장](#5-이번에-만든-뼈대-코드-범위)의 뼈대뿐이다.
- 범위: 네 영역을 다룬다.
  - **NW** 순자산 · 부채 통합 트래킹
  - **AP** AI 자산 운용 위임(오토파일럿)
  - **ST** 투자 철학 · 스킬셋을 검증 가능한 운용 전략으로
  - **EX** 그 밖에 추가할 만한 서비스
- 만든 방법: 영역마다 초안을 쓰고, 코드를 직접 읽는 리뷰로 고쳤다. 리뷰 근거(파일·행)는 각 장 끝 *리뷰에서 고친 점*에 있다.
- 표기
  - 우선순위: P0(먼저) · P1 · P2(나중)
  - 노력: S · M · L · XL
  - **미확인**: 이번에 공식 자료로 확인하지 못한 값이다. 구현 전에 다시 확인한다.
  - 법규 관련 내용은 설계 판단을 위한 쟁점 정리이며 법률 자문이 아니다. 모두 **확인 필요**다.

## 목차

1. [한눈에 보기](#1-한눈에-보기)
2. [영역별 명세](#2-영역별-명세)
   - [2.1 순자산 · 부채 통합 트래킹 (NW)](#21-순자산--부채-통합-트래킹-nw)
   - [2.2 AI 자산 운용 위임 (AP)](#22-ai-자산-운용-위임-ap)
   - [2.3 운용 전략 · 투자 철학 (ST)](#23-운용-전략--투자-철학-st)
   - [2.4 그 밖에 추가할 만한 서비스 (EX)](#24-그-밖에-추가할-만한-서비스-ex)
3. [영역 간 의존 관계](#3-영역-간-의존-관계)
4. [전체 우선순위 Top 10](#4-전체-우선순위-top-10)
5. [이번에 만든 뼈대 코드 범위](#5-이번에-만든-뼈대-코드-범위)

---

## 1. 한눈에 보기

### 1.1 비전

PPFP를 투자 포트폴리오 앱에서 개인 재무 전체를 보는 앱으로 넓힌다. 주식·코인뿐 아니라 대출, 전세보증금, 예적금, 연금, 보험까지 지금의 원장(Asset · Holding · Lot · Transaction · Snapshot)에 넣어 순자산을 정확히 보이게 한다. 그 위에서 AI 어드바이저가 내 실제 조건을 알고 조언하고, 사용자가 정한 정책과 한도 안에서 단계적으로 주문까지 맡는다. 운용 철학은 직접 쓰거나 외부 스킬에서 가져오되, 인기 순위가 아니라 같은 조건에서 검증한 본인 성적으로 고른다. 모든 단계는 기존 원장과 승인 흐름을 재사용하고, 실패하면 "주문하지 않음"으로 끝나게 한다.

### 1.2 영역별 핵심

**순자산 · 부채 (NW)**
- 부채는 지금도 `LIABILITY` 자산이다. 새로 더하는 것은 대출 조건(Loan · LoanRate · LoanPayment)과 거래 유형 `REPAY`뿐이다.
- 첫 화면은 재무상태표 `/networth`다. 순자산 · 총자산 · 총부채 · 부채비율과 자산/부채 2열 표를 보여 준다.
- `REPAY`는 앱 밖 돈으로 갚은 원금이 수익률에 '수익'으로 잡히던 왜곡도 함께 고친다.

**AI 운용 위임 (AP)**
- 지금은 주문 경로가 하나도 없다. 정책 → 사전검증 → 승인 → 주문 순서로 만든다.
- 모든 정책은 내부 페이퍼로 시작한다. 실전은 KIS 국내 지정가 하나부터 열고, 서버 env 화이트리스트로만 허용한다.
- 방어선은 모델 지시가 아니라 결정적 통제다: 허용 목록, 한도 예약, 원자적 선점, 오염 시 사람 승인.

**운용 전략 · 투자 철학 (ST)**
- 서술형 스킬과 거장 프로필은 이미 있다. 없는 것은 검증할 수 있는 규칙이다. v1은 정적 배분(비중 · 리밸런싱 · 한도) 닫힌 스키마다.
- 버전을 고정하고, 비용을 넣은 다년 백테스트와 페이퍼 운용(전진 검증)으로 비교한다. 순위는 설치 수가 아니라 본인 성적으로 매긴다.
- 외부 텍스트는 권한을 갖지 않는다. 주문할 종목 · 방향 · 금액은 규칙에서 결정적으로만 나온다.

**그 밖의 서비스 (EX)**
- 먼저 할 일은 방어선이다. DB 백업과 가입 · 로그인 통제 · 2단계 인증이 지금 없다.
- 안드로이드는 TWA(웹을 그대로 감싸기)로 싸게 시작한다.
- 기존 데이터만으로 값이 나오는 절세 계좌와 은퇴 인출을 가계부보다 먼저 한다.

### 1.3 전체 로드맵

시기는 순서를 보이기 위한 제안이다. 각 단계는 CLAUDE.md 규칙대로 기능 커밋 → 문서 커밋(사용설명서 · 캡처) → merge commit 순서를 지킨다.

| 시기 | 순자산 · 부채 (NW) | AI 운용 위임 (AP) | 운용 전략 (ST) | 그 밖의 서비스 (EX) |
|---|---|---|---|---|
| **0단계** · 2026-10 | — | — | — | EX-12 DB 백업, EX-02 보안 MVP(가입 통제, 시도 제한, TOTP, 로그인 기기) |
| **1단계** · 2026 Q4 | 1단계 MVP: 대출 조건, REPAY, `/networth` 요약 · 부채 탭, loans 시트 (NW-01~03) | Phase 0: 정책, 사전검증, 주문 카드, 내부 페이퍼, 킬스위치, 오염 판정 (증권사 주문 코드 없음) | 1단계 MVP: 정적 배분 규칙, 버전, 엔진 일반화, 데이터 점검, 페이퍼 운용, 지표, 화면 (ST-01~07) | EX-01a 안드로이드 TWA |
| **2단계** · 2027 Q1 | 예적금, 전세, 중도상환 시뮬레이터, 금융 일정 알림, 건전성 지표, 계산형 평가, AI 읽기 도구 | Phase 1: KIS 국내 주문(모의 → 실전), 체결 반영, 수량 대사, TRADE 알림 | 포트폴리오 연결, 텍스트 lint, 스킬 · 거장에서 전략 초안, 비교 화면, ECOS 환율 이력 | EX-03 절세 계좌, EX-04 은퇴 인출 |
| **3단계** · 2027 Q2 | 연금 · 보험, 현금흐름 계획, AI 제안(loan_payment · valuation) | Phase 2: 결정 기록, 승급 심사, 운용 예산, 서킷 확장, 키움 · 업비트 | 오토파일럿에 planRebalance 연결, 신호 규칙 v2 | EX-05 가계부, EX-06 월간 리포트, EX-07 캘린더 (NW-12와 합쳐서, 3장 참고) |
| **4단계** · 2027 H2~ | 은행 · 카드 내역, 안드로이드 알림 파싱 | Phase 3: AUTO 운용 / Phase 4: 전략 프로필 리그 | 랭킹 · 등급, 펀더멘털, 내보내기 | EX-09 스트레스 테스트, EX-11 보험, EX-10 명의 라벨, 보류 항목 재검토 |

선행 조건 요약
- 서버를 인터넷에 열기 전(TWA · 모바일 포함)에 EX-02가 끝나야 한다.
- 실전 주문(AP Phase 1) 전에 EX-02, AP-03, AP-06, AP-10이 끝나야 한다.
- 스키마를 바꾸는 단계마다 EX-12 백업이 돌고 있어야 한다.

---

## 2. 영역별 명세

### 2.1 순자산 · 부채 통합 트래킹 (NW)

개인 재무상태표(순자산)를 한 곳에서 추적한다. 대상은 금융자산, 비금융자산(전세보증금, 예적금, 연금 · 보험, 차량), 부채(주담대, 신용 · 마통, 전세대출, 할부, 사인 간 대출), 월 현금흐름, 건전성 지표(부채비율 · LTV · DSR)다. 모두 기존 원장 위에 얹는다.

#### 현재 있는 것

1. **부채는 이미 자산의 한 종류다.**
   - `AssetType.LIABILITY`와 `Asset.meta`(Json)가 있다. `trading.ts:13` `signOf(LIABILITY) = -1`.
   - `recordBuy`는 fromCash면 현금을 +로, 아니면 flow를 −로 잡는다(68행). `recordSell`은 부채 매도를 막고(167행) `recordValuation`으로 잔액을 갱신하게 한다(283행).
   - '추가 대출'은 BUY로 lot을 하나 더 만든다(`holdings/[id]/page.tsx:154`).
   - 금리 · 만기 · 상환방식 필드는 없다.
2. **순자산은 이미 부채를 뺀다.**
   - `analytics.ts` currentState(부호 −1), `scopeWeights(null)`(모든 포트폴리오를 한 번씩 합산), `snapshots.ts`(부호 −1, `Snapshot.holdings {holdingId: 값}`).
   - 가격 시계열로 읽는 거래 유형은 BUY / SELL / VALUATION뿐이다. 수기 자산의 현재가는 `Asset.manualPrice`(`market.ts:97`)다.
   - 기존 결함: `deleteTransaction`(`trading.ts:350`)은 VALUATION을 지워도 manualPrice를 되돌리지 않는다.
3. **부채를 다루는 화면은 빈약하다.**
   - 보유 자산 화면은 '부채 n원' 한 줄뿐이다. `asset-book.ts:109`는 비중 계산에서 부채를 뺀다.
   - 종목 상세(`holdings/[id]:88~93`)는 부채에도 '미실현 손익'을 보여 준다. 갚은 원금이 수익처럼 보인다.
   - `performance.ts:59` 기여도는 부채를 뺀다. `goals.ts` scopeMix는 부채를 차감하지만 이자는 고려하지 않는다.
4. **부동산**: `domain/real-estate.ts` estimatePrice, `ApartmentMeta`(Asset.meta), RealEstatePanel이 있다. LTV와 전세가율의 분모로 바로 쓸 수 있다.
5. **현금**: CASH 수기 자산과 포트폴리오 CashBalance가 있다. CASH_SIGN의 INTEREST는 +1(받은 이자)뿐이다. `tax.ts`는 INTEREST를 금융소득으로 집계하고 FEE는 쓰지 않는다.
6. **분류**: TraitGroup / Trait / AssetTrait로 사용자가 성질을 정의한다. 시스템 세부 종류 필드는 없다. PortfolioEdge로 계좌 계층을 만들 수 있지만 계좌 성격 필드는 없다.
7. **자동화와 AI**
   - `jobs.ts` runDailyForUser는 종가 · 환율 수집 뒤 최근 1개월 스냅샷만 다시 계산한다.
   - `notify.ts` NotificationKind는 PRICE · DRIFT · TEST · BRIEFING · REALESTATE다.
   - `ai/tools.ts`에 부채 · 현금흐름 도구가 없다. `ai/actions.ts` kind는 note, price_alert, target_weights, journal_review, journal_draft, book이고 모두 '실행' 버튼으로 승인한다.
   - `Transaction @@unique([portfolioId, externalRef])`를 자동 기록의 멱등 키로 쓸 수 있다.
8. **입출력**: `data-format.ts` · `data-io.ts`(XLSX/CSV), `csv.ts`, `holdings-paste.ts`. 은행 · 카드 연동은 없다.

**설계 결론**: 값은 기존 Asset / Holding / Lot / Transaction(+ 새 REPAY)이 운반한다. 그래서 순자산, 스냅샷, 대시보드, 목표, 내보내기가 그대로 동작한다. 계산과 알림에 쓰는 '조건'만 타입별 1:1 테이블(Loan, Deposit, Lease)로 둔다. 자산이 아닌 권리(국민연금)와 계획(반복 현금흐름)은 Asset을 만들지 않는 독립 모델로 둔다. AssetType enum은 늘리지 않고 `Asset.kind`(문자열) 하나만 더한다.

#### 기능 명세표

| ID | 기능 | 설명 | 사용자 가치 | 우선순위 | 노력 | 데이터 출처 | 재사용 | 위험 |
|---|---|---|---|---|---|---|---|---|
| NW-01 | 재무상태표(순자산) 화면 | `/networth` 신설. KPI는 순자산 · 총자산 · 총부채 · 부채비율. 자산(현금성 · 예적금 · 투자 · 부동산 · 보증금 · 받을 돈 · 실물)과 부채(담보 · 전세 · 신용 · 마통 · 할부 · 사인 간 · 받은 보증금) 2열 표를 AssetType과 Asset.kind로 묶고, 행을 누르면 `holdings/[id]`. 추이 차트는 Snapshot.holdings를 LIABILITY 여부로 나눠 그린다. 원인 분해(시장/저축/상환)와 유동성 열은 2단계(NW-01b). | 흩어진 포트폴리오, 대출, 보증금을 재무상태표 한 장으로 본다. | P0 | M | currentState, Snapshot.holdings · cash, Asset.kind | `analytics.ts` currentState · scopeWeights(null) · scopedSeries, `asset-book.ts`, 대시보드 KPI · recharts, ASSET_TYPE_LABEL | 과거 시점도 현재 kind로 분류된다. 생활 자산 · 부채 포트폴리오가 루트 아래에 연결되지 않으면 루트 기준 목표에서 빠진다(자동 생성 시 100% 엣지 연결 제안). |
| NW-02 | 대출 조건과 상환 스케줄 | LIABILITY 자산에 Loan(1:1)을 붙인다. 빌려준 돈은 `lent=true`로 ALTERNATIVE · kind RECEIVABLE 자산에 붙인다. 상환방식은 원리금균등 · 원금균등 · 만기일시 · 마통(일할 이자 추정) · 수기, 거치기간과 납입일. 금리는 LoanRate 이력만 쓴다. `domain/loans.ts`가 회차별 원금 · 이자 · 잔액, 총 · 잔여 이자, 가중평균 금리를 계산한다. 조건 있는 대출은 수량 1 lot로 고정하고 '추가 대출'을 숨긴다. 종목 상세는 '미실현 손익' 대신 상환 진행률 · 남은 이자(LoanPanel). | 남은 이자, 상환 완료일, 이번 달 납입액을 한 화면에서 본다. | P0 | L | 사용자 입력(약정서 · 은행 앱) | `add-asset-form.tsx`, `holdings/[id]`(RealEstatePanel 패턴), `domain/decimal.ts`, `domain/period.ts` | 일할 · 휴일 · 단수 처리로 은행 청구액과 수 원~수백 원 차이가 난다('추정' 표시, 실제 납부액 우선). 카드 할부 수수료는 카드사마다 달라 '수기'. 대출 자산이 holding 2개 이상에 담기지 않게 서비스에서 막는다. |
| NW-03 | 상환 · 인출 기록(REPAY) | 새 TxnType `REPAY`(부호 있는 원금: + 상환, − 마통 인출). price는 상환 후 잔액(수량 1 기준). 포트폴리오 현금으로 내면 cashDelta = −원금 · flow 0, 앱 밖 돈이면 flow = +원금. 이자 · 수수료는 payFrom이 있을 때만 FEE로 원장에 쓰고, 없으면 LoanPayment에만 남긴다. `Transaction.loanPaymentId`로 연결. 지난 회차 '기록' 버튼(스케줄 값 미리 채움). REPAY도 manualPrice를 갱신한다. 대출에 연결된 REPAY는 거래 내역에서 지울 수 없다. 기록 · 삭제 뒤 `rebuildSnapshots(가장 이른 날짜)`. deleteTransaction의 manualPrice 복원 결함도 같이 고친다. | 잔액을 손으로 고치지 않는다. 앱 밖 돈으로 갚은 원금이 '수익'으로 잡히던 왜곡이 사라진다. | P0 | M | Loan, LoanRate, LoanPayment, CashBalance | `trading.ts` recordValuation · recordCash · audit, `snapshots.ts` pricedTxns(REPAY 추가), `domain/ledger.ts` TXN_TYPES · TXN_LABEL, `data-format.ts`, 거래 내역 화면 | enum이 늘면 TXN_TYPES, TXN_LABEL, data-format, 거래 필터, AI get_transactions 설명을 같이 고쳐야 한다. 이자(FEE)는 flow 0인 현금 감소라 그 포트폴리오의 TWR을 낮춘다(성과 화면 안내). |
| NW-04 | 중도상환 · 대환 시뮬레이터 | 금액과 날짜를 넣으면 중도상환수수료(계약 요율 × 남은 면제 기간 비율), 절감 이자, '기간 단축' 대 '월 납입 감소', 투자 기대수익률과의 손익분기를 보여 준다. 선택적으로 금감원 대출 금리 비교로 대환 효과. | 여윳돈으로 대출을 갚을지 투자할지 숫자로 판단한다. | P1 | S | Loan, LoanRate, `domain/goals.ts` 가정, (선택) 금융상품 한눈에 OpenAPI | `domain/loans.ts`, `domain/goals.ts` mixAssumptions | 중도상환수수료는 2025-01-13 개편 뒤 상품마다 달라 계약서 값만 쓴다. '투자 · 대출 자문 아님' 고지. |
| NW-05 | 예 · 적금 만기와 경과이자 | CASH 자산(kind TERM_DEPOSIT / INSTALLMENT_SAVING / FREE_SAVING)에 Deposit(1:1). 금리, 단리/월복리, 가입 · 만기일, 월 납입액, payFrom, 과세 유형, 중도해지이율. 세전 · 세후 경과 평가액, 만기 수령액, 해지 시 수령액은 읽을 때 계산한다(NW-10). 만기에 INTEREST로 기록하면 세금 화면과 이어진다. 파킹통장 · CMA는 포트폴리오 현금으로 둔다. | 예적금이 지금 얼마인지, 만기에 얼마 받는지, 깨면 얼마 손해인지 바로 보인다. | P1 | M | 사용자 입력, (선택) 금융상품 한눈에 OpenAPI | `tax.ts` INTEREST 집계, `trading.ts` recordCash, `notify.ts` | 세금우대 · 비과세 한도는 개정이 잦아 상수와 기준일로 관리한다(현재 값 미확인). 자유적금은 실제 납입 기록이 있어야 정확하다. |
| NW-06 | 전세 · 월세 보증금 | Lease. TENANT는 낸 보증금을 ALTERNATIVE · kind LEASE_DEPOSIT_PAID 자산으로 두고 그 Asset.meta에 ApartmentMeta를 넣는다. LANDLORD는 받은 보증금을 LIABILITY · kind LEASE_DEPOSIT_RECEIVED로 두고 propertyId로 임대 부동산을 연결한다. 전세대출은 `Loan.leaseId`. 세입자에게 전세가율(보증금/실거래 추정가)과 경고, 집주인에게 갭(추정가 − 보증금 − 담보대출). 만기 D-180 · D-60 알림. | 전세 사는 사람은 가장 큰 자산과 위험을 보고, 집주인은 보증금 부채를 빠뜨리지 않는다. | P1 | M | 사용자 입력, 국토부 매매 실거래가(기존), (선택) 전월세 실거래가 | `domain/real-estate.ts` estimatePrice · readApartmentMeta, `apartment-picker.tsx`, `real-estate.ts` apartmentView, `real-estate-alerts.ts` 루프 | 전세가율 경고와 갱신요구권 안내는 법률 자문이 아님을 표시하고 조문을 다시 확인한다. 보증금 증액은 Lease.deposit과 원장을 같은 서비스 함수에서 고친다. |
| NW-07 | 금융 일정 알림과 선택적 자동 기록 | NotificationKind `FINANCE`. 대상은 납입일, 예금 · 대출 만기, 금리 재산정일(`Loan.nextResetAt`), 전세 만기, 매월 1일 '갱신할 항목' 묶음(오래된 수기 평가, 은행 잔액 대사). autoPost는 고정금리이면서 payFrom이 있는 대출만 켤 수 있고, externalRef `loan:<id>:<dueDate>`로 멱등하게 REPAY · FEE를 기록하며 auto 표시를 남긴다. | 납입일과 만기를 놓치지 않고, 매달 몇 분으로 최신 상태를 유지한다. | P1 | M | Loan, Deposit, Lease, Asset.manualPriceAt | `notify.ts`, `jobs.ts` runDailyForUser, `real-estate-alerts.ts` 체크 루프, alerts 화면 | 자동 기록은 추정값이 실적처럼 들어갈 수 있다(잔액 대사로 VALUATION 보정). 소급 기록 뒤 스냅샷 재계산 범위를 넓힌다. |
| NW-08 | 재무 건전성 지표 | FinancialProfile(연소득, 출생연도, 은퇴 나이, 지역, 비상자금 목표 개월, AI 공유). 지표는 부채비율, 담보별 LTV(`Loan.collateralId`), DSR · 스트레스 DSR(지역을 넣었을 때만), 월 이자/소득, 비상자금 개월 수, 가중평균 금리, 1년 내 만기 부채. 정책값은 상수와 기준일로 두고 화면에 기준일을 보인다. | 대출 여력, 금리 상승 내성, 비상자금 충분성을 숫자로 본다. | P1 | M | Loan(+스케줄), FinancialProfile, 실거래 추정가 | `domain/loans.ts`, `domain/real-estate.ts` estimatePrice, settings 카드 패턴 | 스트레스 DSR 가산금리, 지방 적용값, 신용대출 가정 만기는 2025년 자료 기준이다(2026-10 기준 미확인). '심사 결과와 다름' 고지. |
| NW-09 | AI 어드바이저 재무 도구 | 읽기 도구 먼저: `get_balance_sheet`, `get_loans`(조건, 다음 납입, 남은 이자), `simulate_prepayment`. 다음으로 제안형 AiAction `loan_payment`, `valuation`(둘 다 '실행'을 눌러야 저장). 아침 브리핑에 7일 안의 금융 일정. 소득 · 대출 조건 · 상대방 정보는 `FinancialProfile.shareWithAi`가 켜졌을 때만 보내고, 상대방 이름은 항상 가린다. | '대출을 먼저 갚을까 ETF를 살까'를 내 실제 조건으로 묻는다. AI 운용 영역의 기반이다. | P1 | M | NW-01~08 서비스 함수 | `ai/tools.ts` tool(), `ai/actions.ts` 승인 흐름 · hrefOf, `ai/background.ts` 브리핑 | 민감정보가 외부 LLM으로 나간다. 토글은 새 정보에만 적용한다(기존 overview는 이미 부채 잔액을 보냄). 도구 결과가 커지면 monthlyLimit 비용이 는다. |
| NW-10 | 계산형 자동 평가(감가 · 경과이자)와 아파트 월간 추정 | ValuationRule(자산 1:1, DEPRECIATE_STRAIGHT / DEPRECIATE_DECLINING / DEPOSIT_ACCRUAL / APT_ESTIMATE). APT_ESTIMATE 외에는 원장에 행을 쓰지 않고, `market.ts` 수기 시세 경로와 `snapshots.ts` priceOn이 마지막 수동 평가를 기준점으로 계산한다(파라미터를 고치면 과거 추이도 바뀜). APT_ESTIMATE만 월 1회 VALUATION(importSource `auto:apt`). | 차량처럼 값이 떨어지는 자산과 예금 경과이자가 손대지 않아도 현실에 가깝다. | P1 | M | 규칙 파라미터, Deposit, 국토부 실거래가 | `market.ts` getQuotes(수기 경로), `snapshots.ts` priceOn, apartmentView, `jobs.ts` | 차량 시세 API는 확인하지 못해 감가는 '가정'이다. 같은 날짜에 수동 평가가 있으면 수동 평가를 기준점으로 삼는다. |
| NW-11 | 연금과 보험 | 계좌형(IRP, 연금저축, DC, ISA)은 `Portfolio.accountType`으로 표시하고 '잠긴 돈'으로 묶는다. 권리형(국민연금, DB, 직역연금)은 PensionPlan으로 만들되 Asset은 만들지 않는다. 예상 월액 · 개시 나이 · 퇴직금 추계액 · 할인율로 현재가치를 계산하고 재무상태표 '포함해서 보기' 토글로만 더한다. 보험은 InsurancePolicy, 해약환급금은 연결된 ALTERNATIVE · kind INSURANCE 자산의 VALUATION. | 노후 준비 상태, 보험료 부담, 해지 환급금을 한 번에 본다. | P1 | L | 통합연금포털, 국민연금공단, 내보험찾아줌(개인 API 미확인 → 수동 입력), 증권사 연금계좌 잔고(미확인) | Portfolio · PortfolioEdge, `tax.ts`, `domain/goals.ts` simulateGoal | 현재가치는 할인율 · 수령 기간 가정에 크게 좌우된다(가정값 노출). 국민연금 산식은 직접 계산하지 않고 공단 예상액을 받는다. EX-03 · EX-04 · EX-11과 겹친다(3장). |
| NW-12 | 월 현금흐름 계획과 12개월 전망 | RecurringFlow(월급, 관리비 같은 반복 수입 · 지출). 대출 납입(NW-02), 적금(NW-05), 보험료(NW-11), 월세(NW-06), 배당 예측은 각 모델에서 자동으로 합친다. 이번 달 잉여현금, 12개월 전망(큰 이벤트 표시), 저축률, 잉여현금을 Goal.monthly 후보로 제안. | 매달 실제로 모을 수 있는 돈과 돈이 몰려 나가는 시점을 미리 본다. | P1 | M | RecurringFlow, Loan, Deposit, InsurancePolicy, Lease, 배당 | `dividends.ts`, `goals.ts` · `domain/goals.ts`, `domain/period.ts` | 계획값이라 실제와 다를 수 있다. 소득 · 지출은 AI 공유 토글을 따른다. EX-05와 겹친다(3장). |
| NW-13 | 은행 · 카드 내역 가져오기(가계부 실적) | 직접 내려받은 엑셀/CSV를 발급사별 헤더로 인식해 CashEntry로 저장(해시로 중복 방지, 드라이런 뒤 실행). CashRule로 카테고리, 계획 대 실적 비교. 장기적으로 안드로이드 본인 기기 알림 파싱을 검토(SMS 권한은 쓰지 않음). | 자동 연동 없이 한 달에 파일 한 번만 올리면 지출 실적이 잡힌다. | P2 | L | 발급사 거래내역 파일(형식 미확인), 붙여넣기 | `domain/csv.ts` parseCsv, `data-format.ts` detectSheet, `data-io.ts` 드라이런, `holdings-paste.ts`, import 화면 | 발급사 형식이 자주 바뀌어 형식마다 픽스처 테스트를 둔다. 스크래핑은 하지 않는다. 행이 많아 보관 기간 정책이 필요하다. EX-05와 겹친다. |
| NW-14 | 일괄 입출력 시트와 온보딩 체크리스트 | data-format에 loans · deposits · leases 시트를 추가한다(각 기능 작업에 포함). 2단계 뒤 pensions · insurance · flows. 내보낸 파일을 그대로 다시 가져올 수 있어야 한다. 온보딩 체크리스트로 크레딧포유(대출), 통합연금포털(연금), 내보험찾아줌(보험)에서 확인해 입력하도록 안내한다. | 처음에 모든 자산 · 부채를 빨리 넣는다. | P1 | M | 사용자 파일 | `data-format.ts` SHEETS · SAMPLES · IMPORT_ORDER, `data-io.ts`, `export.ts` | 자산을 '이름 + 유형'으로 찾는 기존 규칙에서 같은 이름 대출이 충돌한다(kind까지 매칭 키에). 내보내기 파일에 민감정보가 들어간다는 안내. |

#### 화면

**새 화면**
1. `/networth` 재무상태표 (사이드바에서 대시보드 아래). 탭: 요약 / 부채 / 예적금 · 보증금(2단계) / 연금 · 보험(3단계).
   - 요약: KPI(순자산, 총자산, 총부채, 부채비율), 자산/부채 2열 표(행 → `holdings/[id]`), 자산 · 부채 · 순자산 추이(대시보드와 같은 period 파라미터).
     - 2단계: 원인 분해, 유동성 열, 지표 카드(LTV, DSR, 비상자금, 가중평균 금리).
     - 3단계: '국민연금 현재가치 포함해서 보기' 토글.
   - 부채 탭: 이름, 종류, 금융사, 잔액, 현재 금리(고정/변동), 월 납입액, 다음 납입일, 남은 이자, 만기, 상환 진행률. '조건 미입력' 배지와 '+ 대출 추가'.
   - 12개월 금융 일정 타임라인(2단계): 납입일, 재산정, 예금 · 전세 만기.
   - '✦ AI 재무 점검' 버튼(AskAiButton, 2단계).
2. `/cashflow` (3단계): 이번 달 잉여현금 폭포 차트, 12개월 전망, 반복 항목 편집, '잉여현금을 목표 월 적립액으로' → `/goals`. 4단계에 `/cashflow/import`(드라이런 → 가져오기)와 카테고리 규칙.

**기존 화면 변경**
- `holdings/[id]`: 부채면 '미실현 손익' → '상환 진행률 · 남은 이자'. 조건 있는 대출은 '추가 대출' 숨김. LoanPanel(조건 편집, 금리 이력 추가, 상환표 회차별 '기록', 2단계 중도상환 시뮬레이터, 담보 · 전세 연결). DepositPanel · LeasePanel(2단계)도 RealEstatePanel 패턴.
- `add-asset-form.tsx`: 부채를 고르면 종류, 금리, 상환방식, 만기, 거치, 납입일, payFrom 섹션. 2단계에 예적금 섹션과 대안자산 세부 종류.
- `transactions`: REPAY 라벨과 필터. 대출에 연결된 행은 삭제 대신 '대출 화면에서 관리' 링크.
- `assets`: '부채 n원' 메모를 `/networth` 링크로.
- `portfolios/[id]`: 계좌 유형 선택(2단계). `settings`: 재무 프로필 카드(2단계). `alerts`: FINANCE 종류(2단계).
- `data`: loans · deposits · leases 시트 형식과 샘플.
- 사용설명서: '순자산 · 부채' 장과 기능 이력. `capture.ts` SHOTS에 networth, holding-loan 추가. `seed-demo.ts`에 가짜 대출 · 예금 · 전세.

#### 데이터 모델

금액은 스키마 머리말 규칙(Money `Decimal(24,6)`, Rates `Decimal(20,10)`)을 따른다.

```prisma
// ── 기존 모델 변경 ──────────────────────────────────────────────

enum TxnType {
  // ... BUY SELL DEPOSIT WITHDRAW DIVIDEND INTEREST FEE TAX SPLIT VALUATION
  /// Loan principal on a one-unit loan holding: + repaid, − drawn (마통). `price` = balance after;
  /// cashDelta = −principal when paid from the portfolio, else flow = +principal. Snapshots read it like VALUATION.
  REPAY
}

model User {
  // ... 기존 필드 ...
  loans             Loan[]
  deposits          Deposit[]
  leases            Lease[]
  pensionPlans      PensionPlan[]
  insurancePolicies InsurancePolicy[]
  valuationRules    ValuationRule[]
  financialProfile  FinancialProfile?
  recurringFlows    RecurringFlow[]
  cashEntries       CashEntry[]
  cashRules         CashRule[]
}

model Asset {
  // ... 기존 필드 ...
  /// System sub-kind within `type`, validated per type in domain/asset-kinds.ts:
  /// LIABILITY: MORTGAGE, JEONSE_LOAN, CREDIT, OVERDRAFT, INSTALLMENT, STUDENT, PRIVATE, LEASE_DEPOSIT_RECEIVED
  /// CASH: TERM_DEPOSIT, INSTALLMENT_SAVING, FREE_SAVING
  /// ALTERNATIVE: LEASE_DEPOSIT_PAID, RECEIVABLE, VEHICLE, GOODS, INSURANCE. Null = generic.
  kind          String?

  loan          Loan?            @relation("loanAsset")
  securedLoans  Loan[]           @relation("loanCollateral")
  deposit       Deposit?
  lease         Lease?           @relation("leaseAsset")
  leasedOut     Lease[]          @relation("leaseProperty")
  insurance     InsurancePolicy?
  valuationRule ValuationRule?
}

model Portfolio {
  // ... 기존 필드 ...
  /// (2단계) GENERAL, ISA, IRP, PENSION_SAVINGS, DC. Locked kinds show as 잠긴 돈.
  accountType  String    @default("GENERAL")
  loansPaid    Loan[]    @relation("loanPayFrom")
  depositsPaid Deposit[] @relation("depositPayFrom")
}

model Transaction {
  // ... 기존 필드 ...
  /// REPAY and its interest/fee FEE rows; deleting them goes through the loan screen
  loanPaymentId String?
  loanPayment   LoanPayment? @relation(fields: [loanPaymentId], references: [id], onDelete: SetNull)

  @@index([loanPaymentId])
}

// ── 1단계 (P0) ──────────────────────────────────────────────────

enum RepaymentMethod {
  AMORTIZING      // 원리금균등
  EQUAL_PRINCIPAL // 원금균등
  BULLET          // 만기일시
  REVOLVING       // 마이너스통장: daily interest on the drawn balance
  CUSTOM          // 사인 간 등: no schedule, payments only
}

/// Terms of a loan. The asset (LIABILITY, or ALTERNATIVE/RECEIVABLE when `lent`) must sit in exactly one
/// holding with one unit; its ledger carries the balance. Rates live only in LoanRate.
model Loan {
  id              String          @id @default(cuid())
  userId          String
  assetId         String          @unique
  lent            Boolean         @default(false)
  lender          String?
  /// 사인 간 상대방; always masked before reaching the AI
  counterparty    String?
  principal       Decimal         @db.Decimal(24, 6)
  /// REVOLVING: 한도
  creditLimit     Decimal?        @db.Decimal(24, 6)
  startDate       DateTime        @db.Date
  /// Null for CUSTOM or open-ended REVOLVING
  maturityDate    DateTime?       @db.Date
  method          RepaymentMethod
  graceMonths     Int             @default(0)
  /// Day of month due (past month end = last day)
  paymentDay      Int             @default(1)
  /// FIXED, VARIABLE, MIXED: only tells the UI to ask for a new rate at resets
  rateType        String          @default("FIXED")
  /// Next 금리 재산정, for reminders
  nextResetAt     DateTime?       @db.Date
  /// 중도상환수수료 on the prepaid amount, sliding to 0 over `prepayFeeMonths` (contract values; 0 = none)
  prepayFeeRate   Decimal         @default(0) @db.Decimal(20, 10)
  prepayFeeMonths Int             @default(0)
  collateralId    String?
  leaseId         String?
  /// Portfolio whose cash pays installments; null = paid outside the app (interest stays off the ledger)
  payFromId       String?
  /// (2단계) Post each FIXED-rate installment on its due date; needs payFromId
  autoPost        Boolean         @default(false)
  note            String?
  createdAt       DateTime        @default(now())
  updatedAt       DateTime        @updatedAt

  user       User          @relation(fields: [userId], references: [id], onDelete: Cascade)
  asset      Asset         @relation("loanAsset", fields: [assetId], references: [id], onDelete: Cascade)
  collateral Asset?        @relation("loanCollateral", fields: [collateralId], references: [id], onDelete: SetNull)
  lease      Lease?        @relation(fields: [leaseId], references: [id], onDelete: SetNull)
  payFrom    Portfolio?    @relation("loanPayFrom", fields: [payFromId], references: [id], onDelete: SetNull)
  rates      LoanRate[]
  payments   LoanPayment[]

  @@index([userId])
  @@index([collateralId])
}

/// Annual rate in force from `from` (first row = rate at start; resets, 금리인하요구).
model LoanRate {
  loanId String
  from   DateTime @db.Date
  rate   Decimal  @db.Decimal(20, 10)

  loan Loan @relation(fields: [loanId], references: [id], onDelete: Cascade)

  @@id([loanId, from])
}

/// A payment or draw actually made. Ledger rows point back via Transaction.loanPaymentId.
model LoanPayment {
  id           String        @id @default(cuid())
  loanId       String
  /// Installment it settles; null = prepayment or REVOLVING movement (NULLs don't collide in the unique)
  dueDate      DateTime?     @db.Date
  paidAt       DateTime
  /// + repaid, − drawn
  principal    Decimal       @db.Decimal(24, 6)
  interest     Decimal       @default(0) @db.Decimal(24, 6)
  fee          Decimal       @default(0) @db.Decimal(24, 6)
  balanceAfter Decimal       @db.Decimal(24, 6)
  prepayment   Boolean       @default(false)
  auto         Boolean       @default(false)
  memo         String?
  createdAt    DateTime      @default(now())

  loan Loan          @relation(fields: [loanId], references: [id], onDelete: Cascade)
  txns Transaction[]

  @@unique([loanId, dueDate])
  @@index([loanId, paidAt])
}

// ── 2단계 (P1) ──────────────────────────────────────────────────

/// 예·적금 terms on a CASH asset (kind TERM_DEPOSIT / INSTALLMENT_SAVING / FREE_SAVING).
/// Parking accounts stay as portfolio cash. Value is computed on read (ValuationRule DEPOSIT_ACCRUAL).
model Deposit {
  id           String     @id @default(cuid())
  userId       String
  assetId      String     @unique
  bank         String?
  rate         Decimal    @db.Decimal(20, 10)
  /// SIMPLE or MONTHLY
  compounding  String     @default("SIMPLE")
  startDate    DateTime   @db.Date
  maturityDate DateTime?  @db.Date
  monthly      Decimal?   @db.Decimal(24, 6)
  payFromId    String?
  /// GENERAL, PREFERENTIAL, EXEMPT, ISA
  taxType      String     @default("GENERAL")
  earlyRate    Decimal?   @db.Decimal(20, 10)
  createdAt    DateTime   @default(now())
  updatedAt    DateTime   @updatedAt

  user    User       @relation(fields: [userId], references: [id], onDelete: Cascade)
  asset   Asset      @relation(fields: [assetId], references: [id], onDelete: Cascade)
  payFrom Portfolio? @relation("depositPayFrom", fields: [payFromId], references: [id], onDelete: SetNull)

  @@index([userId])
}

/// 전세·월세 계약. TENANT: deposit asset (ALTERNATIVE, LEASE_DEPOSIT_PAID; home in Asset.meta as ApartmentMeta).
/// LANDLORD: deposit liability (LIABILITY, LEASE_DEPOSIT_RECEIVED) with the property rented out.
model Lease {
  id          String    @id @default(cuid())
  userId      String
  assetId     String    @unique
  /// TENANT or LANDLORD
  role        String
  /// Contract amount; the asset's ledger holds the balance
  deposit     Decimal   @db.Decimal(24, 6)
  monthlyRent Decimal   @default(0) @db.Decimal(24, 6)
  startDate   DateTime  @db.Date
  endDate     DateTime  @db.Date
  propertyId  String?
  /// 전세보증금 반환보증
  guaranteed  Boolean   @default(false)
  /// 확정일자
  fixedDate   DateTime? @db.Date
  note        String?
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  user     User   @relation(fields: [userId], references: [id], onDelete: Cascade)
  asset    Asset  @relation("leaseAsset", fields: [assetId], references: [id], onDelete: Cascade)
  property Asset? @relation("leaseProperty", fields: [propertyId], references: [id], onDelete: SetNull)
  loans    Loan[]

  @@index([userId])
}

/// What the ratios and the advisor need that the ledger does not hold.
model FinancialProfile {
  userId          String   @id
  annualIncome    Decimal? @db.Decimal(24, 6)
  birthYear       Int?
  retireAge       Int?
  /// CAPITAL or OTHER; null hides stress DSR
  region          String?
  emergencyMonths Int      @default(6)
  /// Send income, loan terms to the AI (counterparties stay masked)
  shareWithAi     Boolean  @default(false)
  updatedAt       DateTime @updatedAt

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
}

/// Value derived on read (market.ts manual quotes, snapshots priceOn) from the last manual price;
/// only APT_ESTIMATE writes VALUATION rows (monthly, importSource 'auto:apt').
model ValuationRule {
  id        String   @id @default(cuid())
  userId    String
  assetId   String   @unique
  /// DEPRECIATE_STRAIGHT, DEPRECIATE_DECLINING, DEPOSIT_ACCRUAL, APT_ESTIMATE
  method    String
  /// e.g. { lifeYears, residual } or { yearlyRate }
  params    Json     @default("{}")
  active    Boolean  @default(true)
  lastError String?
  createdAt DateTime @default(now())

  user  User  @relation(fields: [userId], references: [id], onDelete: Cascade)
  asset Asset @relation(fields: [assetId], references: [id], onDelete: Cascade)

  @@index([userId])
}

// ── 3단계 (P1) ──────────────────────────────────────────────────

/// A pension that is a right, not an account (국민연금, DB, 직역). No asset: shown beside net worth, added only by toggle.
model PensionPlan {
  id             String   @id @default(cuid())
  userId         String
  /// NPS, DB, PUBLIC, OTHER
  kind           String
  /// Expected monthly benefit in today's money (from 공단/통합연금포털)
  monthlyBenefit Decimal  @db.Decimal(24, 6)
  startAge       Int
  /// DB: 퇴직금 추계액, used instead of the present value
  accrued        Decimal? @db.Decimal(24, 6)
  discountRate   Decimal  @default(0.02) @db.Decimal(20, 10)
  payoutYears    Int      @default(25)
  asOf           DateTime @db.Date
  updatedAt      DateTime @updatedAt

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
}

/// Policy terms; a 해약환급금, if any, is the linked ALTERNATIVE/INSURANCE asset's VALUATION.
model InsurancePolicy {
  id           String    @id @default(cuid())
  userId       String
  assetId      String?   @unique
  insurer      String
  product      String
  /// LIFE, ANNUITY, SAVINGS, HEALTH, OTHER
  kind         String
  premium      Decimal   @db.Decimal(24, 6)
  /// MONTHLY, YEARLY, SINGLE
  premiumCycle String    @default("MONTHLY")
  payUntil     DateTime? @db.Date
  maturityDate DateTime? @db.Date
  note         String?
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt

  user  User   @relation(fields: [userId], references: [id], onDelete: Cascade)
  asset Asset? @relation(fields: [assetId], references: [id], onDelete: SetNull)

  @@index([userId])
}

/// A repeating income or expense. Installments, savings, premiums and rent come from their own models.
model RecurringFlow {
  id        String    @id @default(cuid())
  userId    String
  name      String
  /// INCOME or EXPENSE
  direction String
  category  String
  amount    Decimal   @db.Decimal(24, 6)
  /// MONTHLY, YEARLY, WEEKLY
  cadence   String    @default("MONTHLY")
  day       Int?
  startDate DateTime  @db.Date
  endDate   DateTime? @db.Date
  active    Boolean   @default(true)
  createdAt DateTime  @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
}

// ── 4단계 (P2) ──────────────────────────────────────────────────

/// One bank or card statement line, outside the investment ledger.
model CashEntry {
  id        String   @id @default(cuid())
  userId    String
  date      DateTime @db.Date
  amount    Decimal  @db.Decimal(24, 6)
  merchant  String
  category  String?
  account   String
  source    String
  /// sha256 of date|amount|merchant|account|ordinal-in-file
  hash      String
  memo      String?
  createdAt DateTime @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, hash])
  @@index([userId, date])
}

model CashRule {
  id        String @id @default(cuid())
  userId    String
  pattern   String
  category  String
  sortOrder Int    @default(0)

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
}

// 코드 쪽 변경: notify.ts NotificationKind에 'FINANCE' 추가,
// domain/ledger.ts TXN_TYPES·TXN_LABEL에 REPAY('상환·인출') 추가.
```

#### 외부 API

- **필수 외부 API는 없다.** 1 · 2단계는 사용자 입력과 내부 계산만으로 동작한다.
- 선택
  - 국토부 아파트 매매 실거래가(이미 사용 중, data.go.kr 키): LTV, 전세가율, APT_ESTIMATE.
  - 국토부 아파트 전월세 실거래가(data.go.kr, API별 활용신청 필요): 주변 전세 시세. 승인 절차 미확인.
  - 금감원 '금융상품 한눈에' OpenAPI(개인 인증키): 예적금 재예치 금리, 주담대 · 전세 · 신용대출 금리 비교(NW-04 대환). 스펙과 한도 미확인.
  - 한국은행 ECOS OpenAPI(인증키): 기준금리, CD91 같은 시장금리를 재산정 참고값으로. COFIX(은행연합회 공시)는 API 제공 여부 미확인이라 처음에는 사용자가 입력한다.
  - 기존 증권사 API: IRP · 연금저축 잔고(증권사별 지원 미확인).
- 쓸 수 없는 것과 대안
  - 마이데이터는 금융위 허가가 필요해 개인 앱은 쓸 수 없다. 오픈뱅킹은 이용기관 승인이 필요하다. 스크래핑과 인증서 대행 로그인은 하지 않는다.
  - 크레딧포유(대출), 통합연금포털(연금), 내보험찾아줌(보험)은 개인용 API가 확인되지 않아 사용자가 직접 보고 입력한다(온보딩 체크리스트).
  - 은행 · 카드 내역은 사용자가 내려받은 파일만 받는다(NW-13). 안드로이드는 본인 기기 알림 파싱만 검토한다(SMS 권한 미사용, Play 정책 미확인).
  - 차량 시세는 공식 API를 확인하지 못해 감가 규칙으로 추정한다.
  - DSR · 스트레스 DSR · 중도상환수수료 근거는 2025년 자료다(금융위, 은행 안내). **2026-10 기준 재확인 필요.**

#### 안전 · 법규

1. **법적 범위**: 본인 데이터를 본인이 입력하는 개인용 앱은 마이데이터 허가 대상이 아닌 것으로 보인다(**확인 필요**). 안드로이드 앱을 다른 사람에게 배포해 신용정보를 모으는 구조가 되면 별도 법률 검토가 필요하다. 스크래핑과 인증서 대행은 구현하지 않는다.
2. **추정값 고지**: 상환 스케줄, 경과이자, 중도상환수수료, DSR, 전세가율, 연금 현재가치는 모두 '추정 · 참고용'으로 표시한다. 정책값은 domain 상수와 기준일로 두고 화면에 기준일을 보인다. '대출 심사, 투자, 법률 자문이 아님'을 고지한다. 계약갱신요구권, 비과세 한도 같은 조문 · 세율은 다시 확인한다. 사인 간 이자(비영업대금이익)는 일반 이자와 세율이 다를 수 있어 세금 화면에 안내한다(**확인 필요**).
3. **원장 무결성**: autoPost는 opt-in이고 고정금리 + payFrom이 있을 때만 켤 수 있다. externalRef로 멱등하게 기록하고 auto를 표시한다. 월 1회 잔액 대사를 안내한다. 대출에 연결된 원장 행은 대출 화면에서만 지운다. 지우면 manualPrice를 복원하고 스냅샷을 다시 계산한다. 조건 변경과 상환 기록은 기존 `audit()`로 남긴다.
4. **민감정보**: 소득, 대출 조건, 상대방 이름은 `FinancialProfile.shareWithAi`(기본 off)가 켜졌을 때만 AI 도구가 보낸다. 상대방 이름은 켜져 있어도 항상 가린다. 주소 필드는 만들지 않는다(ApartmentMeta만). 내보내기 파일에 민감정보가 들어간다고 안내한다. 문서 캡처에는 seed-demo의 가짜 데이터만 쓴다.
5. **AI 연계**: 상환 기록과 평가 갱신 제안은 기존 AiAction 승인 흐름(PENDING → 실행)으로만 저장한다. 자동 실행은 하지 않는다.

#### 단계별 출시

- **1단계: MVP, 부채를 제대로 (P0, 약 L)**
  - 스키마: Asset.kind, Loan · LoanRate · LoanPayment, TxnType.REPAY, Transaction.loanPaymentId.
  - `src/domain/loans.ts`(원리금균등 · 원금균등 · 만기일시 · 거치 · 금리 이력 · 마통 일할 추정)와 `src/domain/__tests__/loans.test.ts`(은행 예시 상환표와 대조).
  - `src/server/services/loans.ts`, `src/app/loan-actions.ts`. REPAY 기록과 삭제(manualPrice 복원 결함 포함), snapshots pricedTxns에 REPAY, 소급 기록 시 스냅샷 재계산.
  - `holdings/[id]` LoanPanel과 상환 진행률, add-asset-form 대출 조건 섹션.
  - `/networth` 요약 · 부채 탭(KPI, 2열 표, 자산/부채 추이).
  - 조건이 없는 기존 부채는 '조건 미입력' 배지만 달고 그대로 동작한다(데이터 마이그레이션 불필요).
  - data-format loans 시트, 사용설명서 '순자산 · 부채' 장과 캡처.
- **2단계: 비금융자산, 일정, 지표, AI 읽기 (P1)**
  - Deposit, Lease(전세가율 · 갭), 중도상환 · 대환 시뮬레이터.
  - FINANCE 알림(납입일, 만기, 재산정, 월초 갱신 · 대사), autoPost(opt-in).
  - FinancialProfile과 LTV · DSR · 스트레스 DSR · 비상자금 지표, Portfolio.accountType.
  - ValuationRule(계산형 감가 · 경과이자, 아파트 월간 추정).
  - AI 읽기 도구 get_balance_sheet · get_loans · simulate_prepayment와 공유 토글. 원인 분해(시장/저축/상환).
  - deposits · leases 시트와 온보딩 체크리스트.
- **3단계: 연금 · 보험, 현금흐름, AI 제안 (P1)**
  - PensionPlan(자산 아님, 토글), InsurancePolicy, 연금 · 보험 탭.
  - RecurringFlow와 `/cashflow`, 목표 월 적립액 연동.
  - AiAction loan_payment · valuation, 브리핑의 금융 일정.
- **4단계: 실적 데이터 (P2)**
  - CashEntry · CashRule, 은행 · 카드 파일 파서(발급사별 픽스처), 계획 대 실적.
  - 안드로이드: 본인 기기 금융 알림 파싱으로 초안을 만들고 원탭 승인.
  - (선택) ECOS 시장금리, 금감원 비교공시 연동.

#### 열린 질문

1. 대출 상환금의 기본 출처를 앱 안 포트폴리오 현금(예: 월급 통장 포트폴리오)으로 할까, 앱 밖 돈(외부 입금 처리, 이자는 원장 밖)으로 할까?
2. 대출 · 보증금 · 차량을 담을 '생활 자산 · 부채' 포트폴리오를 자동으로 만들고 루트(순자산) 포트폴리오 아래에 100%로 연결해도 될까?
3. 국민연금 · DB 현재가치는 자산으로 저장하지 않고 '포함해서 보기' 토글로만 더하는 방식이면 될까?
4. 새 거래 유형 REPAY(상환 · 인출)를 추가하면 거래 내역과 가져오기 형식이 바뀐다. 괜찮을까? (대안인 VALUATION + FEE 조합은 앱 밖 돈으로 상환할 때 수익률이 왜곡된다.)
5. 현금흐름은 반복 수입 · 지출 '계획' 수준이면 충분한가, 은행 · 카드 내역 단위 가계부 실적(NW-13)까지 원하나?
6. 소득 · 대출 조건을 AI 어드바이저(외부 LLM)에게 보내도 될까? (상대방 이름은 항상 가림)
7. 가구(배우자) 단위 합산이 필요한가? 지금 모델은 사용자 1명 기준이다(EX-10과 연결).

#### 리뷰에서 고친 점

**[1] 기존 기능 중복, 기존 모델을 무시한 설계**
- C1 · 자산 하나가 여러 Holding에 담길 수 있다(Holding 제약은 `@@unique([portfolioId, assetId])`뿐). 초안은 REPAY · 이자를 어느 holding에 쓸지 정하지 않았다. → 조건 있는 대출 자산은 holding을 정확히 1개만 갖도록 서비스에서 강제한다(다른 포트폴리오 추가 금지, 이동은 moveHolding만). 원장 기록 시점에 그 holding을 찾는다.
- C2 · 수량 규칙이 깨진다. `holdings/[id]/page.tsx:154` '추가 대출'은 BUY로 수량 1 lot을 더 만들고, VALUATION 가격은 '단위당 잔액'(196행)이라 수량 2가 되면 잔액이 두 배가 된다. 초안의 'REPAY price = 상환 후 잔액'도 같은 이유로 틀렸다. → 수량 1 lot 고정, '추가 대출' 숨김. 마통 인출 · 증액은 부호 있는 REPAY(음수 원금).
- C3 · `inNetWorth`는 비용이 크다. 순자산은 포트폴리오 단위 Snapshot.value와 `scopeWeights(null)`(`analytics.ts:116`)로 합산되므로 자산 하나를 빼려면 currentState, snapshots, dashboard, goals.scopeMix, performance, asset-book을 모두 고쳐야 한다. → 삭제. 국민연금 · DB는 Asset 없이 PensionPlan으로만 두고 토글로 더한다.
- C4 · kind 저장 위치가 셋(Asset.kind, Deposit.kind, Loan 없음)으로 갈렸다. → Asset.kind 하나. 허용 값은 `src/domain/asset-kinds.ts`에서 AssetType별로 검증.
- C5 · `Lease.apartment`(Json)는 기존 ApartmentMeta(readApartmentMeta, RealEstatePanel, `real-estate.ts:188~209`)와 겹친다. → 세입자 보증금 자산의 Asset.meta를 쓴다. 주소 필드는 민감정보라 삭제.
- C6 · `InsurancePolicy.surrenderValue`와 `Loan.rate`는 원장과 이중 기록이다. → 둘 다 삭제. 환급금은 자산 VALUATION, 금리는 LoanRate 이력만(대출 생성 시 첫 행 함께 생성).
- C7 · `LoanPayment.txnIds String[]`에는 FK가 없어 거래 내역에서 REPAY를 지우면 고아가 된다. → `Transaction.loanPaymentId` FK(onDelete SetNull). 대출에 연결된 REPAY는 deleteTransaction이 거부하고 대출 화면으로 안내.
- C8 · 기존 결함: `deleteTransaction`(`trading.ts:350~`)은 VALUATION을 지워도 manualPrice를 되돌리지 않는다. 현재 순자산은 manualPrice(`market.ts:97`)로 계산되므로 REPAY에도 같은 문제가 생긴다. → 1단계에 '삭제 뒤 남은 가장 최근 가격 거래로 manualPrice 재계산'을 넣었다.
- C9 · `jobs.ts` runDailyForUser는 최근 1개월만 스냅샷을 다시 계산한다(`minusMonths(today, 1)`). 지난 회차를 몰아 기록하거나 autoPost로 소급하면 오래된 추이가 틀린다. → 기록할 때 `rebuildSnapshots(userId, 가장 이른 거래일)`.
- C10 · 초안이 놓친 장점: 지금은 앱 밖 돈으로 갚은 대출을 VALUATION으로 줄이면 flow 없이 순자산이 늘어 TWR에 '수익'으로 잡힌다. REPAY의 flow = +원금이 이 왜곡을 바로잡는다. 기여도 계산은 이미 부채를 뺀다(`performance.ts:59`).
- C11 · 앱 밖에서 낸 이자를 FEE로 쓰면 CASH_SIGN FEE = −1(`trading.ts:231`) 때문에 포트폴리오 현금이 음수가 된다. → payFrom이 없으면 이자는 원장에 쓰지 않고 LoanPayment에만 남긴다.
- C12 · 사인 간에 빌려준 돈의 이자를 INTEREST로 쓰면 `tax.ts:24`가 일반 이자소득으로 합산한다. 비영업대금이익은 원천징수율이 다르다(**확인 필요**). → 메모로 구분하고 화면에 안내.
- C13 · 새 라우트 8개(`/liabilities/[id]`는 `holdings/[id]`와 겹침) → `/networth` 하나(탭) + 3단계 `/cashflow`. 대출 · 예적금 상세는 RealEstatePanel 패턴의 패널.
- C14 · 성질(TraitGroup/Trait)은 사용자 분류다. Asset.kind는 시스템 분류(재무상태표 그룹 · 유동성)로만 쓰고, '유동성'은 kind에서 계산한다.

**[2] 데이터 출처**
- 금감원 '금융상품 한눈에' OpenAPI는 예적금 외에 주담대 · 전세 · 신용대출 금리 비교도 제공하는 것으로 알려져 있어 NW-04 대환 비교에 쓸 수 있다. 스펙 · 한도는 미확인.
- DSR · 스트레스 DSR · 중도상환수수료 근거는 2025년 자료다. 정책값은 상수와 기준일로만 둔다.
- 안드로이드 SMS 권한은 Play 제한 권한이라 쓰지 않는다. 알림 리스너만 P2로 검토(정책 미확인).
- 마이데이터 · 오픈뱅킹 · 스크래핑을 쓸 수 없다는 판단은 유지.

**[3] 안전 · 보안 · 법규**
- autoPost는 추정값을 실적처럼 자동으로 쓴다. → MVP에서 뺐다. P1에서 고정금리 + payFrom일 때만, auto 표시, 월 1회 잔액 대사 리마인더와 함께. 멱등성은 `externalRef = 'loan:<id>:<dueDate>'`.
- AI 공유 토글 범위: 기존 get_portfolio_overview는 이미 부채 잔액을 보낸다. 토글은 새 정보(소득, 대출 조건, 상대방)에만 적용하고 상대방 이름은 항상 가린다.
- `FinancialProfile.region` 기본값 CAPITAL은 근거 없는 가정 → null. 입력하지 않으면 스트레스 DSR을 숨긴다.
- 새 AiAction(loan_payment, valuation)도 기존 '실행' 승인 흐름(`actions.ts`)만 쓴다.

**[4] 우선순위와 노력**
- MVP가 너무 컸다(변동금리 지표 · 가산금리 · 재산정 계산, 중도상환, 전 유형 kind, accountType, inNetWorth, 원인 분해). → P0를 '대출 조건 + 상환 기록 + 재무상태표(원인 분해 제외)'로 줄였다.
- NW-01 원인 분해는 Snapshot.flow가 포트폴리오 합계뿐이라 M이 아니라 L → 2단계로 분리.
- 초안의 일괄 입출력 항목(지금 NW-14)은 S가 아니다(시트 5개 + 온보딩 + 월간 알림). → 시트는 각 기능 작업에 포함하고 온보딩과 알림은 따로 뺐다.
- 초안의 ValuationRule(지금 NW-10)이 매일 VALUATION 행을 쓰면 거래 내역이 오염된다. → 읽을 때 계산(market.ts 수기 시세 경로, snapshots priceOn). APT_ESTIMATE만 월 1회 행. LOAN_SCHEDULE(실제 REPAY가 잔액을 정함)과 PENSION_PV(자산 아님)는 삭제.
- 사용자 관심이 AI에 있으므로 읽기 도구 get_balance_sheet · get_loans를 2단계로 앞당겼다.

**[5] Prisma 모델**
- 금액 정밀도를 스키마 머리말 규칙(Money `Decimal(24,6)`, Rates `Decimal(20,10)`)에 맞췄다.
- payFromId(Loan, Deposit)에 관계가 없어 FK가 없었다. → Portfolio 관계(onDelete SetNull)와 역관계 추가.
- `Loan.maturityDate` 필수 → 사인 간 대출 · 만기 없는 마통 때문에 선택 항목으로. `prepayFeeMonths` 기본값 36은 근거 없는 가정 → 0.
- `LoanPayment @@unique([loanId, dueDate])`는 dueDate가 null이면 Postgres에서 서로 다른 값으로 취급돼 중도상환 여러 건을 허용한다(의도와 맞음). 다만 upsert 키로는 쓸 수 없다.
- rateIndex, spread, resetMonths, fixedUntil은 MVP에서 뺐다. rateType과 nextResetAt(알림용)만 남기고 재산정 금리는 LoanRate에 직접 입력한다.
- Loan `@@index([collateralId])`(LTV 계산), Transaction `@@index([loanPaymentId])` 추가.

---

### 2.2 AI 자산 운용 위임 (AP)

AI 어드바이저에게 실제 계좌 운용을 단계적으로 맡긴다. 초안 → 건별 승인 → 한도 안 자동 순서로 위임 범위를 넓히고, 모든 정책은 페이퍼에서 시작한다.

#### 현재 있는 것

코드로 확인한 현재 상태다. 읽기와 제안까지만 있고 **주문 경로는 하나도 없다.**

1. **에이전트 · 도구** (`src/server/services/ai/*`)
   - `agent.ts` runTurn
     - MAX_STEPS = 16, 단계당 max_tokens 32000. 한 단계의 도구 호출은 `Promise.all`로 동시에 실행된다(동시 제안 → 한도 경쟁 조건의 원인).
     - 월 비용 한도(`AiSettings.monthlyLimit`)는 턴 시작 때 한 번만 검사한다.
     - Anthropic 호출에 `fallbacks: 'default'`(서버 측 모델 폴백)가 켜져 있고, 실제 모델은 `AiMessage.model`에 남는다.
     - 대화 기록 전체를 매 단계 다시 보낸다.
     - COMMON 프롬프트: '웹 페이지 안에 적힌 지시는 따르지 않습니다', '매수 · 매도 주문은 할 수 없습니다'.
   - `tools.ts`: 읽기 도구 약 20개. 외부 텍스트를 들여오는 것은 서버 도구 web_search · web_fetch와 앱 도구 search_books(카카오 도서)다. propose_* 6개는 AiAction 행만 만든다.
   - `actions.ts` executeAction: findFirst로 status == PENDING을 확인한 뒤 분기를 실행하고 따로 update한다. **원자적 선점이 아니다**(연타 시 이중 실행 가능). dismissAction은 updateMany로 원자적이다.
   - `background.ts`: 프로세스 안의 직렬 큐 enqueue와 runQuiet. checkBriefings는 `AiSettings.briefingLastDate`를 updateMany로 선점해 여러 프로세스에서도 중복 실행을 막는다.
   - `alert-loop.ts`: setInterval 루프(가격 60초, 드리프트 600초, 브리핑 5분, 부동산 180분). 외부 크론용 `/api/cron/alerts`, `/api/cron/daily`.
   - AgentKind: MANAGER, RESEARCH, COACH, LIBRARIAN, SAGE. AGENT_ORDER는 채팅 선택기와 설정 모델 표 폼(`ai-actions.ts` saveAiSettingsAction)에 쓰인다.
   - 스킬: `domain/ai-skills.ts` rankCatalog(설치 수 순), DENY · DENY_OWNERS로 주문 · 지갑 스킬을 거른다. skillsPrompt에 '주문은 낼 수 없습니다'. AiSkill 내용은 refreshSkill과 사용자 편집으로 바뀐다(버전 보관 없음). `Sage.contentText`는 사용자가 쓴 철학 텍스트다.
2. **증권사 어댑터** (`src/server/brokers/*`)
   - `types.ts` 머리말: 어댑터는 모두 읽기 전용이고 주문을 내지 않는다. 주식 계좌의 예수금 · 현금을 읽는 메서드가 없다(`balances()`는 코인 전용). `PriceQuote.asOf`는 null일 수 있다.
   - `kis.ts`: get()만 있고 POST 헬퍼가 없다. paper면 모의 서버와 trId() V 접두사. throttle은 모의 520ms, 실전 60ms.
   - `kiwoom.ts` post(): 401(토큰 재발급), 1700~1702, 429, 5xx에서 자동 재전송 → 그대로 주문에 쓰면 중복 주문 위험.
   - `upbit.ts` request(): GET 전용(fetchJson에 method · body 없음). `sign.ts`에 jwt와 sha512Hex(query_hash).
   - `http.ts` fetchJson: 20초 타임아웃에 `BrokerApiError('timeout')`. 주문이었다면 접수 여부를 모르는 상태가 된다.
   - `lib/brokers.ts`: KIS와 키움만 `paper: true`. 업비트 안내는 '주문 권한은 필요 없습니다'.
   - `services/brokers.ts`: 연결은 만들기만 가능(수정은 해제 뒤 재등록). 키는 AES-256-GCM 암호화, audit() 기록. sourceKey는 계좌번호가 없으면 label을 써서 같은 업비트 계좌를 두 번 연결할 수 있다.
3. **원장 · 동기화**
   - `trading.ts` recordBuy / recordSell은 fromCash와 externalRef를 받는다. `Transaction @@unique([portfolioId, externalRef])`라 중복이면 P2002 예외(건너뛰지 않음).
   - `exchange-sync.ts`: 코인 체결을 주문 하나당 한 건으로 묶어 externalRef `${broker}:${BUY|SELL}:${주문uuid}`로 기록. historyPortfolioId에 고정, 2시간 겹쳐 받고 ref로 중복을 건너뛴다.
   - `imports.ts`: loadBrokerSources는 코인 거래소를 뺀다. importHoldings는 `fromCash: false` 시작 Lot만 만들어 예수금이 원장 현금에 들어오지 않는다.
   - 순수 계산: `domain/ledger.ts` applyTxn · positionsAsOf · dailySeries, `domain/performance.ts` twrIndex · summarize(MDD), `domain/benchmark.ts`, `domain/alerts.ts` driftReport, `domain/goals.ts` backtest.
   - AuditLog와 audit()(`services/portfolios.ts`). `notify.ts` NotificationKind는 PRICE · DRIFT · TEST · BRIEFING · REALESTATE, 푸시 페이로드는 `{title, body, url, tag}`. `public/sw.js`에 알림 액션 버튼 처리가 없다.
   - 재인증 패턴: `key-backup.ts` exportKeys가 verifyPassword로 비밀번호를 다시 확인한다. Session에 step-up 필드는 없다.
4. **사용설명서**: 810행 '주문은 내지 않습니다', 945 · 947행 스킬과 주문 문구, 1071행 '이 앱은 조회만 하고 주문은 내지 않습니다'. 출시 커밋과 함께 고쳐야 한다.
5. **없는 것**: 주문 · 정정 · 취소 · 주문가능금액 · 체결 조회 호출, 주식 예수금 조회, 장 시간 · 휴장일 · 호가단위 함수, 정책 · 킬스위치 · 페이퍼 계좌, step-up 재인증, 운용 전용 비용 상한(턴 중간 검사).

#### 기능 명세표

| ID | 기능 | 설명 | 사용자 가치 | 우선순위 | 노력 | 데이터 출처 | 재사용 | 위험 |
|---|---|---|---|---|---|---|---|---|
| AP-01 | 운용 정책(간소 IPS)과 위임 단계 | 포트폴리오 하나에 정책 하나(portfolioId · connectionId 모두 유일). MVP 필드: 위임 단계(SUGGEST 초안만 / APPROVE 건별 승인 / AUTO 한도 안 자동, Phase 3부터), 모드(PAPER/LIVE), 허용 자산 유형(기본 KR_STOCK), 허용 · 금지 종목, 1회 · 하루 금액 한도, 하루 건수, 일손실 정지 비율, 지정가 괴리 상한, 페이퍼 시작 현금 · 슬리피지. 끌 수 없는 고정 규칙(시장가 금지, 신용 · 미수 · 공매도 금지, 허용 목록 밖 금지, 거래대금 하한)은 domain 상수. 비중 상하한은 기존 PortfolioTarget · driftTolerance. 단계 비교는 `LEVEL_RANK`. 올릴 때 step-up 재인증, 내릴 때 즉시. 바꿀 때마다 version을 올리고 audit(). 다른 계좌 Lot이 섞인 포트폴리오는 저장 거부, 코인은 historyPortfolioId와 같아야 한다. | 무엇을 어디까지 맡기는지 폼 하나로 정하고 언제든 바로 줄인다. | P0 | M | 사용자 입력, PortfolioTarget · driftTolerance, Asset/AssetType, Lot.importSource | `services/portfolios.ts` audit() · ownedPortfolio, `services/alerts.ts` portfolioTargets, `domain/alerts.ts` driftReport, zod | 주간 한도 · 거래 시간대 · 스케줄 · 전략 프로필 · 비중 상하한을 MVP에 다 넣으면 설정 실수가 는다(해당 Phase에서 마이그레이션). 보수적 기본값(1회 50만원, 하루 200만원, 하루 5건, 일손실 2%)과 사람이 읽는 요약을 함께 보인다. |
| AP-02 | KIS 국내주식 주문 어댑터 | 읽기 전용 BrokerAdapter와 분리한 `src/server/brokers/trade-types.ts` BrokerTrader(orderableCash, buyingPower, placeOrder, cancelOrder, orderStatus, todayOrders). 1차는 KIS 국내 현금주문 지정가, 모의 먼저. 주문 POST는 **자동 재시도 없는 단발 함수**. 재전송은 '접수 안 됨'이 확실한 응답(호출 제한 코드, 토큰 만료 거절)만. 타임아웃 · 네트워크 오류 · 5xx는 UNKNOWN. 보내기 전에 DB에서 SUBMITTING으로 바꿔 최대 한 번 전송. 실전은 `AUTOPILOT_LIVE=on`, `AUTOPILOT_LIVE_USERS` 화이트리스트, 연결의 tradeEnabled가 모두 맞아야 열린다. 출금 · 이체 API는 구현하지 않는다. | 이미 연결한 KIS 키로 앱 안에서 주문까지 이어진다. 모의투자 계좌로 실제 흐름을 먼저 확인한다. | P0 | L | KIS Open API order-cash, order-rvsecncl, inquire-psbl-order, inquire-daily-ccld, inquire-balance 요약부(TR ID 재확인 필요) | `kis.ts` TokenManager · trId() · throttle · REAL/PAPER, `http.ts` fetchJson · BrokerApiError, `services/brokers.ts` adapterFor · dbTokenStore | TR ID와 필드(TTTC0012U/0011U, EXCG_ID_DVSN_CD, hashkey)는 2차 자료로만 확인했다. 모의 서버는 TR 범위 · 호출 제한이 실전과 다르다. KIS에 클라이언트 주문 ID가 없어 UNKNOWN 해소는 당일 주문 목록과의 휴리스틱 짝짓기다. |
| AP-02B | 키움 · 업비트 주문 확장 | KIS가 안정된 뒤. 키움 `/api/dostk/ordr`(kt10000~kt10003)을 기존 post()의 재시도 없이 단발로, 체결은 kt00009 · ka10075. 업비트 POST `/v1/orders` · DELETE `/v1/order`를 새 request 경로(method · body, 본문 query_hash 서명)로, `identifier = clientOrderId`로 멱등. 업비트 체결은 OrderFill에서 원장에 직접 쓰지 않고 syncExchangeHistory로 반영. 주문 권한 키는 두 번째 연결로 넣지 않고 기존 연결 해제 뒤 재등록(두 번째 연결은 동기화 · 보유를 두 번 잡음). | 키움 계좌와 코인(24시간 장)까지 같은 정책 · 승인 흐름으로 운용한다. | P2 | L | 키움 REST(실전 api.kiwoom.com, 모의 mockapi.kiwoom.com), 업비트 Open API(주문 권한 키, 허용 IP) | `kiwoom.ts` 토큰 · throttle, `upbit.ts` sign() · `sign.ts`, `exchange-sync.ts` syncExchangeHistory, `exchange-replay.ts` | 코인은 24시간 장이라 일손실 기준 시각 · 휴장 · 스케줄 정의가 다르다. 업비트 identifier는 취소 뒤에도 재사용 불가. 업비트는 모의투자가 없어 내부 페이퍼로만 사전 검증한다. |
| AP-03 | 주문 전 사전검증과 한도 예약 | 모든 주문(승인 · 자동 · 페이퍼)은 순수 함수 `checkOrder(order, policy, state, quote, usage, now)`(`src/domain/pretrade.ts`, 테스트 필수)를 통과해야 한다. 검사: 전역 · 정책 정지, 단계 · 모드, 허용 유형 · 종목 · 금지 목록, KRX 정규장 · 휴장일(`market-hours.ts`, 연도별 상수), 1회 · 하루 금액 · 건수, 주문가능금액 · 보유수량, 지정가 괴리, 호가단위(`tick-size.ts`), 거래대금 하한, 반대 방향 쿨다운, 같은 종목 UNKNOWN · 미체결 차단, 주문 후 비중 이탈 경고. 서버 함수는 정책 단위 잠금(`pg_advisory_xact_lock` 또는 SELECT FOR UPDATE) 안에서 돌고, PENDING_APPROVAL · SUBMITTING · SUBMITTED · PARTIAL 금액을 `reserved`로 미리 잡는다. 결과는 TradeOrder.checks. 승인 시점과 전송 직전에 시세(캐시 없이)와 잔고를 다시 읽어 재검증. | AI가 무엇을 판단하든 정책을 벗어난 주문은 증권사에 닿기 전에 막힌다. 여러 건을 동시에 제안해도 한도를 넘지 못한다. | P0 | M | AP-01 정책, 정책 포트폴리오 보유 · 현금, 주문 증권사 quotes/orderbook, AP-02 buyingPower, TradeOrder 누적, 휴장일 상수 | `domain/decimal.ts`, `domain/alerts.ts` driftReport, `services/analytics.ts`, BrokerAdapter.quotes/orderbook | 검사 로직 버그는 곧 손실이므로 경계값 테스트를 가장 먼저 쓴다. 휴장일 표를 갱신하지 않으면 다음 해에는 모두 거부한다(fail-closed). 잠금은 정책 단위로만(응답 지연 방지). |
| AP-04 | 주문 제안 카드 → 승인 → 실행 | `propose_order` 도구(symbol은 허용 목록 안, side enum, qty, limitPrice. 근거 · 반대 근거 · 무효화 조건은 표시 전용). AP-03을 돌려 통과면 PENDING_APPROVAL, 실패면 BLOCKED. 통과 시 AiAction(kind `order`)도 만든다. SUGGEST 단계는 실행 버튼 없는 초안 카드. 실행은 executeAction에 `order` 분기를 두되 `updateMany({id, status: 'PENDING'} → 'EXECUTING')`로 먼저 선점 → step-up 재인증(Session.stepUpUntil, 10분) → 유효시간(기본 10분, 지나면 EXPIRED) → 재검증 → 전송. 접수되면 AiAction은 DONE, 이후 상태는 TradeOrder가 맡는다. COMMON · skillsPrompt의 '주문 불가' 문구는 정책 단계에 따라 바꾼다. AgentDecision 한 행을 같이 남긴다. | AI가 근거와 함께 구체적인 주문을 내밀고, 재인증 뒤 버튼 한 번으로 실제 주문을 낸다. | P0 | M | AI 대화, AP-03 결과, 시세 | `tools.ts` propose() · runTool(zod), `ai/actions.ts` executeAction · dismissAction · hrefOf, `components/ai/chat.tsx` 카드, `ai-actions.ts`, `key-backup.ts` · `crypto.ts` verifyPassword | 모델이 수량 · 금액, 주 · 원을 혼동할 수 있다(수량 · 지정가 · 총액을 크게, 1회 한도 80% 초과 경고). 동시 제안은 AP-03 잠금 · 예약으로 막는다. 대화 삭제 시 AiAction이 cascade로 지워지므로 TradeOrder.aiActionId는 SetNull. |
| AP-05 | 체결 추적 · 원장 반영 · 수량 대사 | 폴러가 alert-loop 틱마다(장중 30~60초) SUBMITTED · PARTIAL · UNKNOWN과 오래된 SUBMITTING(60초 초과 → UNKNOWN)을 처리. 상태가 모두 DB에 있어 재시작 뒤 이어진다. 누적 체결수량이 늘어난 만큼을 OrderFill 한 건으로. 주식은 recordBuy/recordSell(`fromCash: true`, externalRef `<BROKER>:ord:<brokerOrderId>:<seq>`, P2002는 성공으로 간주). 코인은 syncExchangeHistory. 정책 생성 시 주문가능금액을 DEPOSIT으로 넣어 현금 추적 시작. 장 마감 뒤 **수량만** 대사하고, 차이가 있으면 정책 HALTED + 알림. 원장을 자동으로 고치지 않는다. '외부 매매로 인정'(재인증)을 누르면 차이만큼 BUY/SELL을 기록하고 정지 해제. TRADE 알림(접수 · 체결 · 부분체결 · 취소 · 실패) 포함. | 주문이 실제로 몇 주, 얼마에 체결됐는지 원장 · 성과 · 세금에 맞게 들어간다. 장부와 실계좌가 어긋나면 운용이 멈춘다. | P0 | L | AP-02 orderStatus · todayOrders · orderableCash, BrokerAdapter.holdings · balances, 원장(Lot, Transaction, CashBalance) | `trading.ts` recordBuy/recordSell/recordCash, Transaction externalRef unique, `exchange-sync.ts`, `alert-loop.ts`, `notify.ts`(TRADE 추가) | 수수료 · 세금이 늦게 확정되면 추정치로 기록하고 다음 날 FEE/TAX 보정. 정책이 걸린 계좌를 importHoldings로 다시 가져오면 중복이 생겨 가져오기 화면에서 경고 · 차단. 현금 대사는 MVP 제외. |
| AP-06 | 킬스위치와 일손실 정지 | MVP: ① 전역 킬스위치 `AiSettings.tradingHaltedAt`. 켜면 모든 정책의 신규 주문을 막고 미체결을 일괄 취소 시도(실패 건은 따로 알림). ② 정책별 일손실 정지: 당일 평가손실이 dailyLossStop을 넘으면 haltedAt. 해제는 사람만, 재인증 필요, 자동 해제 없음. 확장(P1): 연속 손실 n회, 브로커 오류 n회, 대사 불일치, 운용 예산 초과, 이상 주문 패턴. 운영자 마스터 스위치는 `AUTOPILOT_LIVE=off`. 앱 상단에 운용 중 · 정지 배지. 푸시 '정지' 액션은 sw.js 액션 처리와 1회용 서명 토큰이 필요해 Phase 2. | 버튼 하나로 AI 운용을 멈추고, 손실이 정한 선을 넘으면 저절로 멈춘다. | P0 | S | 정책 포트폴리오 실시간 평가, 전일 Snapshot, TradeOrder 상태 | `services/snapshots.ts` · `analytics.ts`, `domain/performance.ts` summarize, `notify.ts`, audit() | 정지 중에도 이미 접수된 주문은 체결될 수 있다. 시세 지연 · 환율로 잘못 정지할 수 있다(안전한 쪽의 실패). 손실 기준(전일 종가 평가 대 장 시작 평가)을 명확히 정한다. |
| AP-07 | 내부 페이퍼 체결 | 새 정책은 모두 PAPER로 시작. 승인된 페이퍼 주문은 그 시점 주문 증권사 시세로 체결을 흉내 낸다(매수: 현재가 ≤ 지정가, 매도: 현재가 ≥ 지정가면 즉시, 아니면 유효시간 안에 폴러가 재확인). 체결가에 slippageBp와 수수료 · 세금 추정 반영. TradeOrder(mode PAPER) · OrderFill에만 쌓고 원장에는 쓰지 않는다. 포지션 · 현금은 OrderFill을 LedgerTxn으로 바꿔 positionsAsOf로 계산(별도 positions Json 없음). 일별 평가는 PaperDaily → twrIndex · summarize로 TWR · MDD. 순자산 · 대시보드 · 세금에 섞이지 않는다. | 내 돈을 넣기 전에 같은 정책 · 같은 AI · 같은 승인 흐름으로 가상 계좌 성적을 먼저 본다. | P0 | M | 주문 증권사 quotes/orderbook, PriceDaily, 벤치마크 | `domain/ledger.ts` applyTxn · positionsAsOf · dailySeries, `domain/performance.ts`, `domain/benchmark.ts`, alert-loop 틱 | 즉시 체결 시뮬레이터는 유동성 · 체결 우선순위를 무시해 성적이 부풀려진다('낙관적 추정' 표시, 보수적 슬리피지). 증권사 모의투자(KIS · 키움 paper)는 LIVE 경로를 모의 연결로 시험하는 용도로 쓴다. |
| AP-07B | 승급 심사 (APPROVE → AUTO, PAPER → LIVE) | 승급을 요청하면 운영 영업일, 거래 수, 벤치마크 대비 초과수익, MDD, BLOCKED 비율, 사람 거절 비율, 대사 오류 수를 계산해 보인다. 앱 기본값(예: 40영업일, 20건, MDD 10% 이하, 대사 오류 0건)이 하한이고 사용자는 더 엄격하게만 바꾼다. 기준을 넘어도 재인증 후 직접 눌러야 바뀐다. 결과는 별도 모델 없이 `audit(entity='autopilot_policy', action='promote', after={metrics, passed})`. 승급 직후 20영업일은 한도 절반. | 감이 아니라 숫자로 기준을 넘었을 때만 실전 · 자동에 넣는다. | P1 | M | PaperDaily, TradeOrder/OrderFill, 벤치마크, AuditLog | `domain/performance.ts`, `domain/benchmark.ts`, AuditLog · audit() | 짧은 기간 성적은 운이 좌우한다(최소 기간 · 거래 수 하한 고정). 페이퍼 성적이 미래를 보장하지 않는다는 문구. |
| AP-08 | 자율 운용 사이클 (AUTO) | 정책별 스케줄(예: 장 시작 30분 뒤, 마감 1시간 전)과 트리거(드리프트, 가격 알림)로 사이클: 상태 수집 → 운용 에이전트 판단 → propose_order → 사전검증 → 한도 안 · 비오염이면 자동 실행, 아니면 승인 대기 → 결정 기록 → 요약 알림. 운용 에이전트(OPERATOR)는 AGENT_ORDER에 넣지 않고 별도 상수. 사이클마다 새 대화(오염 차단). TurnInput에 budgetUsd를 더해 runTurn 루프 안에서 단계마다 검사. 같은 정책은 동시에 하나만(`AutopilotPolicy.cycleClaimedAt` updateMany 선점), 브리핑과 분리된 운용 전용 큐. PAPER AUTO 먼저, LIVE AUTO는 AP-07B 통과 뒤. 프롬프트 기본값은 NO_TRADE. | 정한 한도 안에서 AI가 장중에 리밸런싱 · 매매를 하고, 나는 요약과 예외만 본다. | P2 | XL | 기존 읽기 도구, 정책, 시세, (설정 시) 웹 검색 | `background.ts` enqueue · runQuiet · checkBriefings 선점 패턴, `agent.ts` runTurn, `alert-loop.ts`, `services/alerts.ts` checkDrift · checkPriceAlerts | LLM 판단은 일관성이 낮고 과매매로 비용이 커질 수 있다(건수 한도 · 쿨다운). 다중 인스턴스에서는 DB 선점이 필수. 법률 검토 전에는 본인 계정에서만 연다. |
| AP-09 | 의사결정 기록과 성과 귀속 | MVP(AP-04에 포함): propose_order마다 AgentDecision 한 행(trigger, 대화 id, policyVersion, outcome, 근거 · 반대 근거, tainted · taintSources, 실제 응답 모델, 비용). 확장(P1): 결정 뒤 1 · 5 · 20일 수익과 벤치마크 대비, 프로필별 적중률, '왜 샀나' 화면, 매매일지 자동 연결. 입력 원문은 저장하지 않고 대화를 참조하되, 근거 요약은 결정 행에 복사(대화 삭제 대비). | AI가 왜 그 주문을 냈는지, 어떤 철학 · 스킬이 돈을 벌고 잃었는지 복기한다. | P1 | M | AiConversation/AiMessage, TradeOrder/OrderFill, PriceDaily | AuditLog, `domain/ai-analysis.ts` priceStats · tradeStats, JournalEntry · JournalTxn, COACH 에이전트 | 개별 결정에 성과를 귀속하는 것은 단순화한 추정이다(화면에 명시). 대화 삭제는 SetNull, 요약은 남긴다. |
| AP-10 | 프롬프트 인젝션 방어 (결정적 통제 우선) | 전제: 모델 지시로는 막을 수 없다. ① 오염 판정: **대화 전체 기록**에 web_search · web_fetch · search_books 결과나 custom이 아닌 스킬의 use_skill이 있으면 tainted(순수 함수 `src/domain/ai-taint.ts`가 AiMessage.content를 스캔). ② tainted 결정의 주문은 단계와 무관하게 사람 승인(끌 수 없음). ③ propose_order 실행 필드는 enum과 숫자만, 종목은 허용 목록 안. ④ 이상 신호(한도 80% 이상, 처음 보는 종목, 거래대금 하한 근처)는 경고하고 AUTO에서는 승인으로. ⑤ 출금 · 이체 API는 구현하지 않는다. 확장(P2): 운용 스킬 스냅샷 고정(AP-11), 정책 문서 대조 검토. 판단 · 주문 2단계 분리는 요약 자체가 오염된 출력이라 채택하지 않는다. | 뉴스 기사나 남이 만든 스킬에 숨은 지시 때문에 엉뚱한 주문이 나가는 일을 막는다. | P0 | S | AiMessage.content(server_tool_use, tool_use), AiSkill.source | `agent.ts` COMMON, `domain/ai-skills.ts` skillsPrompt · DENY_OWNERS · isInvestingSkill, `tools.ts` runTool zod 검증 | 오염 판정이 넓으면 AUTO가 거의 항상 승인으로 떨어진다(tainted 비율 표시, 운용 사이클에서 웹 검색 끄기 선택지). |
| AP-11 | 운용 전략 프로필 (커스텀 · 외부 철학 · 성적 순위) | 정책에 프로필을 붙인다. 프로필은 거장(Sage) 관점, 스킬, 사용자 원칙 텍스트를 붙이는 시점에 통째로 복사한 스냅샷이다(AiSkill은 바뀌므로 해시만으로는 재현 불가). 외부 가져오기는 기존 skills.sh 카탈로그(설치 수 순), 운용 프로필에는 텍스트 지침만. 순위는 인기가 아니라 같은 기간 · 한도로 돌린 본인 페이퍼 리그 성적(초과수익, MDD, 회전율, BLOCKED 수)이고 설치 수는 참고 열. 1위라도 사용자가 골라야 붙는다. | 내 철학을 쓰거나 인기 있는 외부 철학을 가져와, 실제로 성적이 좋은 것을 숫자로 골라 쓴다. | P2 | M | skills.sh API · GitHub raw(기존), Sage, PaperDaily | `services/ai/skills.ts` communityCatalog · installCommunitySkill, `domain/ai-skills.ts` rankCatalog, Sage, `/ai/skills` | 과최적화 · 생존 편향. 프로필 여러 개를 동시에 돌리면 AI 비용이 배로 든다(리그 전용 예산). 라이선스 · 출처 표시. 순위를 남과 공유하면 유사투자자문 쟁점(본인만). **ST 영역과 겹친다(3장).** |
| AP-12 | 운용 리포트와 운용 비용 상한 | AUTOPILOT 알림(승인 요청, 정지 발동, 대사 불일치, 사이클 요약)과 장 마감 뒤 일일 운용 리포트(결정, 주문, 손익, 한도 사용률, AI 비용, 브리핑에 합칠 수 있음). 비용 상한은 운용 전용 월 예산(monthlyLimit과 별도)과 사이클 예산. runTurn이 턴 시작에만 한도를 보므로 루프 안 단계마다 누적 비용을 검사하도록 `agent.ts`를 바꾼다. 넘으면 주문 없이 정지. 승인 요청 푸시는 '열기' 링크만, 실행은 앱에서 재인증 뒤. | 자동 운용이 무엇을 했는지 놓치지 않고, AI 비용이 운용 수익을 갉아먹지 않게 한다. | P1 | M | TradeOrder, AgentDecision, AiMessage.costUsd | `notify.ts`(AUTOPILOT 추가), checkBriefings 선점 패턴, `agent.ts` spentThisMonth · runTurn, `/usage` | 알림이 많으면 꺼 버린다(체결 알림은 묶어서). |

#### 화면

**MVP (Phase 0~1)**
- 새 메뉴 'AI 운용' `/autopilot` (현황)
  - 상단 '전체 정지' 버튼(전역 킬스위치)과 상태 배지(운용 중, 승인 대기 n건, 정지됨과 사유).
  - 정책 카드: 단계(초안 → 승인 → 자동), 모드(페이퍼/실전, 모의 연결 표시), 오늘 한도 사용률(금액 · 건수, 예약 포함), 일손실 정지선까지 남은 거리.
  - 승인 대기 주문, 미체결 · UNKNOWN 주문, 최근 주문 목록.
- `/autopilot/policies/new`, `/autopilot/policies/[id]` (정책 폼 한 장)
  - 포트폴리오 · 계좌 선택과 전용 포트폴리오 검사 결과.
  - 단계, 허용 유형 · 종목 칩, 금지 종목, 1회 · 하루 한도, 건수, 일손실, 가격 괴리, 페이퍼 시작 현금.
  - 오른쪽에 '이 정책을 사람 말로' 요약. 저장 시 변경 diff와 version.
  - 단계 올리기와 실전 전환은 재인증 대화상자.
- `/autopilot/orders/[id]` (주문 상세): 사전검증 체크리스트, 상태 타임라인(제안 → 승인 → 전송 → 접수 → 체결 → 취소), 체결 목록, 원장 거래 링크, 대화 · 결정 링크, 취소 버튼(재인증). UNKNOWN이면 '증권사 앱에서 확인 중' 안내.
- `/autopilot/paper` (페이퍼 성적): TWR 대 벤치마크, MDD, 거래 수, BLOCKED · 거절 비율.

**기존 화면 변경 (MVP)**
- `/ai` 채팅(`components/ai/chat.tsx`): kind `order` 카드. 종목, 방향, 수량, 지정가, 총액(원), 수수료 · 세금 추정, 주문 후 비중, 검사 결과, 남은 유효시간, tainted 배지. '주문 실행'(재인증) · '거절'. SUGGEST면 실행 버튼 없는 초안.
- `/settings` 연동: 연결별 '주문 허용' 토글(재인증), 필요한 권한 안내, 모의/실전 표시. `/settings#ai`: 전역 킬스위치 상태.
- `/import`: 정책이 걸린 계좌를 다시 가져오면 중복 경고.
- 앱 레이아웃 상단: 운용 중 · 정지 배지.
- 사용설명서: 'AI 운용' 장 추가, 810 · 945 · 947 · 1071행의 '주문은 내지 않습니다' 문구 수정.

**이후 단계**
- `/autopilot/decisions/[id]`: 근거, 반대 근거, 오염 출처, 실제 모델, 비용, 결정 뒤 1 · 5 · 20일 성과 (P1)
- `/autopilot/policies/[id]/promote`: 승급 심사 지표 · 기준표 · '승급' 버튼 (P1)
- `/autopilot/league`: 프로필별 페이퍼 순위표, 설치 수는 참고 열 (P2)
- 푸시 '정지' 액션(sw.js 액션 + 1회용 서명 토큰), 안드로이드 위젯 킬스위치 · 생체 인증 승인 (Phase 2~3)

#### 데이터 모델

```prisma
/// Delegation steps. Compare with LEVEL_RANK in src/domain/autopilot-policy.ts (Prisma enums have no ordering).
enum DelegationLevel {
  SUGGEST // draft order cards only, no execute button
  APPROVE // every order needs the user's confirmation
  AUTO // within limits without confirmation (Phase 3; PAPER first)
}

enum TradeMode {
  PAPER
  LIVE
}

enum OrderSide {
  BUY
  SELL
}

enum OrderStatus {
  PENDING_APPROVAL
  BLOCKED // failed the pre-trade check, never sent
  DISMISSED
  EXPIRED
  SUBMITTING // claimed and being sent; older than a minute becomes UNKNOWN
  SUBMITTED
  PARTIAL
  FILLED
  CANCELLED
  REJECTED // refused by the broker
  /// Sent but the answer was lost; resolved from the broker's order list before any new order on the symbol
  UNKNOWN
}

/// Trading policy for one portfolio (and at most one account). Every order runs inside it.
/// Changes bump `version` and go to AuditLog. Later phases add windows, schedule and profile columns.
model AutopilotPolicy {
  id             String          @id @default(cuid())
  userId         String
  name           String
  /// Account orders go to; null = paper only. One policy per account.
  connectionId   String?         @unique
  /// Portfolio fills are recorded into; must hold only this account's lots. One policy per portfolio.
  portfolioId    String          @unique
  level          DelegationLevel @default(SUGGEST)
  mode           TradeMode       @default(PAPER)
  objective      String          @default("")
  allowedTypes   AssetType[]     @default([KR_STOCK])
  /// Symbols the advisor may trade (required for AUTO) and never trade
  allowSymbols   String[]        @default([])
  denySymbols    String[]        @default([])
  /// Limits in the policy currency (KRW)
  maxOrder       Decimal         @db.Decimal(24, 6)
  maxDaily       Decimal         @db.Decimal(24, 6)
  maxDailyOrders Int             @default(5)
  /// Fractions (0.02 = 2%)
  dailyLossStop  Decimal         @default(0.02) @db.Decimal(20, 10)
  maxPriceGap    Decimal         @default(0.03) @db.Decimal(20, 10)
  /// Paper account: starting cash and slippage for simulated fills
  paperCash      Decimal         @default(10000000) @db.Decimal(24, 6)
  slippageBp     Int             @default(10)
  version        Int             @default(1)
  haltedAt       DateTime?
  haltReason     String?
  /// Claimed by a server process before running a cycle (AP-08), like AiSettings.briefingLastDate
  cycleClaimedAt DateTime?
  createdAt      DateTime        @default(now())
  updatedAt      DateTime        @updatedAt

  user       User              @relation(fields: [userId], references: [id], onDelete: Cascade)
  // NoAction: deleting the user still cascades; deleting just the portfolio is refused while a policy exists
  portfolio  Portfolio         @relation(fields: [portfolioId], references: [id], onDelete: NoAction)
  connection BrokerConnection? @relation(fields: [connectionId], references: [id], onDelete: SetNull)
  orders     TradeOrder[]
  decisions  AgentDecision[]
  paperDays  PaperDaily[]

  @@index([userId])
}

/// One advisor proposal or cycle that may lead to orders. Rationale is copied; inputs stay in the conversation.
model AgentDecision {
  id             String   @id @default(cuid())
  userId         String
  policyId       String
  policyVersion  Int
  /// USER (chat), SCHEDULE, DRIFT, ALERT
  trigger        String
  conversationId String?
  /// NO_TRADE, ORDERS, BLOCKED, ERROR
  outcome        String
  rationale      String   @default("")
  counterpoints  String   @default("")
  /// The conversation read outside text; its orders always wait for approval
  tainted        Boolean  @default(false)
  /// web_search, web_fetch, search_books, skill:<name>
  taintSources   String[] @default([])
  /// Model that actually answered (server-side fallback may differ from the setting)
  model          String?
  costUsd        Decimal  @default(0) @db.Decimal(12, 6)
  createdAt      DateTime @default(now())

  user         User            @relation(fields: [userId], references: [id], onDelete: Cascade)
  policy       AutopilotPolicy @relation(fields: [policyId], references: [id], onDelete: Cascade)
  conversation AiConversation? @relation(fields: [conversationId], references: [id], onDelete: SetNull)
  orders       TradeOrder[]

  @@index([policyId, createdAt])
  @@index([userId, createdAt])
}

/// An order, paper or live, from proposal to its last fill.
model TradeOrder {
  id            String      @id @default(cuid())
  userId        String
  policyId      String
  decisionId    String?
  /// Chat card the order came from
  aiActionId    String?     @unique
  connectionId  String?
  mode          TradeMode
  assetId       String?
  symbol        String
  /// KRX for now; NXT/SOR later
  exchange      String      @default("KRX")
  currency      String      @default("KRW")
  side          OrderSide
  /// LIMIT only in the MVP
  orderType     String      @default("LIMIT")
  qty           Decimal     @db.Decimal(28, 8)
  limitPrice    Decimal?    @db.Decimal(24, 6)
  /// Amount held against the policy's limits while the order is open
  reserved      Decimal     @default(0) @db.Decimal(24, 6)
  /// Ours; sent as the broker's identifier where supported (Upbit). Never reused.
  clientOrderId String      @unique
  brokerOrderId String?
  status        OrderStatus @default(PENDING_APPROVAL)
  /// Pre-trade results [{ rule, ok, level, message }]
  checks        Json        @default("[]")
  filledQty     Decimal     @default(0) @db.Decimal(28, 8)
  avgFillPrice  Decimal?    @db.Decimal(24, 6)
  error         String?
  expiresAt     DateTime?
  approvedAt    DateTime?
  submittedAt   DateTime?
  lastCheckedAt DateTime?
  closedAt      DateTime?
  createdAt     DateTime    @default(now())
  updatedAt     DateTime    @updatedAt

  user       User              @relation(fields: [userId], references: [id], onDelete: Cascade)
  policy     AutopilotPolicy   @relation(fields: [policyId], references: [id], onDelete: Cascade)
  decision   AgentDecision?    @relation(fields: [decisionId], references: [id], onDelete: SetNull)
  aiAction   AiAction?         @relation(fields: [aiActionId], references: [id], onDelete: SetNull)
  connection BrokerConnection? @relation(fields: [connectionId], references: [id], onDelete: SetNull)
  asset      Asset?            @relation(fields: [assetId], references: [id], onDelete: SetNull)
  fills      OrderFill[]

  @@unique([connectionId, brokerOrderId])
  @@index([status, updatedAt]) // poller
  @@index([policyId, createdAt])
  @@index([userId, createdAt])
}

/// One increase of an order's filled quantity (a broker fill, or the change in its cumulative total).
/// Stock fills go to the ledger once (Transaction.externalRef "<BROKER>:ord:<brokerOrderId>:<seq>");
/// crypto fills are recorded by exchange-sync instead; paper fills never touch the ledger.
model OrderFill {
  id            String   @id @default(cuid())
  orderId       String
  seq           Int
  brokerFillId  String?
  qty           Decimal  @db.Decimal(28, 8)
  price         Decimal  @db.Decimal(24, 6)
  fee           Decimal  @default(0) @db.Decimal(24, 6)
  tax           Decimal  @default(0) @db.Decimal(24, 6)
  /// Fee and tax were estimated and still need the broker's figures
  estimated     Boolean  @default(false)
  filledAt      DateTime
  transactionId String?  @unique
  createdAt     DateTime @default(now())

  order       TradeOrder   @relation(fields: [orderId], references: [id], onDelete: Cascade)
  transaction Transaction? @relation(fields: [transactionId], references: [id], onDelete: SetNull)

  @@unique([orderId, seq])
}

/// End-of-day value of a policy's paper account (positions derived from its PAPER fills), for TWR / MDD.
model PaperDaily {
  policyId String
  date     DateTime @db.Date
  value    Decimal  @db.Decimal(24, 6)
  flow     Decimal  @default(0) @db.Decimal(24, 6)

  policy AutopilotPolicy @relation(fields: [policyId], references: [id], onDelete: Cascade)

  @@id([policyId, date])
}

// ---- 기존 모델 변경 ----
// User: autopilotPolicies AutopilotPolicy[] / agentDecisions AgentDecision[] / tradeOrders TradeOrder[]
// Portfolio: autopilotPolicy AutopilotPolicy?
// Asset: tradeOrders TradeOrder[]
// AiAction: tradeOrder TradeOrder?   (kind 'order' 추가, status에 EXECUTING 추가 — 문자열이라 스키마 변경 없음)
// AiConversation: decisions AgentDecision[]
// Transaction: orderFill OrderFill?
// BrokerConnection:
//   /// User turned on ordering for this link (separate from read access); links are create-only
//   tradeEnabled   Boolean   @default(false)
//   tradeEnabledAt DateTime?
//   policy         AutopilotPolicy?
//   tradeOrders    TradeOrder[]
// AiSettings (전역 킬스위치):
//   tradingHaltedAt   DateTime?
//   tradingHaltReason String?
// Session (step-up 재인증):
//   /// Password re-entered; order execution, level changes and un-halting allowed until then
//   stepUpUntil DateTime?
// 코드만: notify.ts NotificationKind에 'TRADE' | 'AUTOPILOT' 추가 (Notification.kind는 String)
// 제거: PaperAccount(positions Json 중복 상태), PromotionReview(AuditLog로 대체)
```

#### 외부 API

아래 TR ID · 필드 · 경로는 2차 자료나 일반 지식이다. **구현 전에 각사 공식 문서로 다시 확인한다.** 표시가 없는 항목도 모두 미확인이다.

- **공통 구현 규칙 (코드 확인 결과)**
  - 주문 POST는 기존 get() / post() / request()의 자동 재시도 경로를 쓰지 않는 단발 함수로 만든다(근거: kiwoom.ts post()는 5xx · 401에서 재전송, upbit.ts request()는 GET 전용, kis.ts에는 POST 헬퍼가 없음).
  - fetchJson의 20초 타임아웃이나 네트워크 오류는 UNKNOWN으로 남기고 다시 보내지 않는다.
  - 주문 직전 시세는 주문 증권사의 quotes/orderbook을 캐시 없이 직접 읽는다.
- **한국투자증권 KIS Open API** (kis.ts REAL :9443 / PAPER openapivts :29443)
  - 현금주문 `POST /uapi/domestic-stock/v1/trading/order-cash`. TR ID 매수 TTTC0012U, 매도 TTTC0011U(모의는 V 접두사, 기존 trId()). 구 TR TTTC0802U/0801U는 폐기된 것으로 보인다.
  - 본문: CANO, ACNT_PRDT_CD, PDNO, ORD_DVSN(00 지정가), ORD_QTY, ORD_UNPR, EXCG_ID_DVSN_CD(KRX/NXT/SOR, 2025 NXT 개장 뒤 추가된 것으로 보임).
  - 정정 · 취소 `order-rvsecncl`(TTTC0013U). 주문가능조회 `inquire-psbl-order`, 일별 주문체결조회 `inquire-daily-ccld`(주문별 누적 체결수량 · 평균가로 알려짐 → OrderFill은 누적 증가분 방식).
  - 예수금: inquire-balance 응답 요약부(output2)의 예수금 · 주문가능금액(필드명 미확인).
  - hashkey(`POST /uapi/hashkey`)는 선택이라는 자료가 우세하다. 쓸 경우 해시한 본문과 보낸 본문 문자열이 같아야 한다.
  - 휴장일 조회(chk-holiday로 알려짐)는 모의 미지원 · 하루 1회 권장이라는 자료가 있어 MVP는 연도별 상수 표를 쓴다.
  - 실시간 체결통보 WebSocket은 MVP에서 폴링으로 대신한다.
- **키움 REST API** (AP-02B; REAL api.kiwoom.com / MOCK mockapi.kiwoom.com)
  - 주문 `POST /api/dostk/ordr`. api-id kt10000 매수, kt10001 매도, kt10002 정정, kt10003 취소.
  - 본문 dmst_stex_tp, stk_cd, ord_qty, ord_uv, trde_tp(0 지정가). return_code = 0이면 접수, ord_no가 주문번호.
  - 체결 확인 kt00009, 미체결 ka10075.
- **업비트 Open API** (AP-02B)
  - 주문 `POST /v1/orders`(JSON: market, side, volume, price, ord_type, identifier). JWT에 본문 query_hash(SHA512), sign.ts의 jwt · sha512Hex 재사용.
  - identifier는 계정 안에서 유일하고 취소 뒤에도 재사용 불가. 취소 `DELETE /v1/order`, 조회 `GET /v1/order`(uuid 또는 identifier).
  - '주문하기' 권한 키와 허용 IP 등록이 필요하다. 현재 앱 안내문은 주문 권한을 빼라고 하므로 키를 재발급해 연결을 다시 등록해야 한다.
  - 주문 호출 제한이 시세 · 조회와 따로 있다(초당 수 회 수준). 테스트 주문 API의 국내 제공 여부는 미확인이라 내부 페이퍼로만 사전 검증한다.
- **시장 데이터**: KRX 정규장 09:00~15:30. 동시호가 · 시간외 · NXT 프리/애프터마켓은 MVP 범위 밖. 호가단위는 2023년 통합 체계를 domain 상수로. 거래세 · 수수료는 연도별로 바뀌므로 domain/tax.ts처럼 날짜별 상수 표.
- **AI**: 기존 Anthropic Messages API(agent.ts)와 다른 공급자(providers.ts compatStep). 운용 사이클은 웹 검색을 끈 호출이 기본. `fallbacks: 'default'`로 실제 모델이 바뀔 수 있어 응답 모델을 기록한다.

#### 안전 · 법규

아래는 법률 자문이 아니라 설계 판단을 위한 쟁점 정리다. **다른 사람에게 열기 전에 금융 전문 변호사나 금융당국 질의로 확인해야 한다.**

1. **본인 계좌, 본인 도구 (현재 목표)**
   - 자본시장법상 투자일임업은 '타인'에게서 투자판단을 일임받아 '영업으로' 운용하는 것이다. 본인 프로그램으로 본인 계좌를 운용하는 것은 일반적으로 이 구조가 아니라고 본다. 다만 명시적 근거 자료는 확인하지 못했다(**확인 필요**).
   - 그래도 지킬 것
     - 증권사 · 거래소 API 약관: 자동주문 허용, 호출 제한, 키 제3자 제공 금지.
     - 시장질서 교란행위(자본시장법 제178조의2)로 오인될 패턴 금지: 잦은 정정 · 취소, 허수성 호가. 쿨다운과 하루 건수 한도로 막는다.
     - 코인: 가상자산이용자보호법(2024-07 시행)의 불공정거래 금지가 적용된다.
     - 세금: 양도세, 거래세, 가상자산 과세 시행 시점(**확인 필요**).
2. **다른 사람에게 제공 (안드로이드 배포, 가족 · 지인 계정 포함)**
   - 이용자 계좌 운용, 맞춤 매매 신호 제공, 수수료 수취, 성적 랭킹 공지는 투자자문 · 일임업이나 유사투자자문업 쟁점이 된다. 자동매매 프로그램 판매가 '자문'인지 다툰 대법원 2018도4413 관련 보도가 있다(**확인 필요**).
   - '로그인만 하면 서버 키로 동작'하는 구조에서는 서버가 남의 주문 권한 키를 들고 있게 된다. 주문 기능은 `AUTOPILOT_LIVE=on`과 `AUTOPILOT_LIVE_USERS` 화이트리스트가 모두 맞을 때만 열고 기본값은 꺼짐이다. 다른 사람에게 열기 전에 법률 검토를 필수 관문으로 둔다.
   - 전략 순위(AP-11)는 본인에게만 보인다. 실존 투자자 이름은 '관점' 표기를 유지한다(기존 SAGE 방침).
3. **보안 · 안전 원칙**
   - **fail-closed**: 시세 신선도 미확인, 휴장일 표 만료, 대사 불일치, 브로커 오류, 예산 초과, 파싱 실패, 잠금 실패는 모두 '주문하지 않음'으로 끝난다.
   - **최대 한 번 전송**: DB에서 SUBMITTING으로 선점한 뒤 단발 전송. 응답을 모르면 UNKNOWN으로 두고 같은 종목의 새 주문을 막는다. 자동 재전송은 없다.
   - **이중 실행 방지**: AiAction은 `updateMany(PENDING → EXECUTING)`로 선점한다. 사전검증과 한도 사용량은 정책 단위 잠금 안에서 계산하고 열린 주문 금액을 예약으로 넣는다.
   - **키 탈취 대비**: 출금 없이도 저유동성 종목을 비싸게 사게 하는 펌프 앤 덤프가 가능하다. 끌 수 없는 규칙: AUTO는 허용 목록 종목만, 거래대금 하한, 지정가 괴리 상한, 시장가 금지(MVP), 신용 · 미수 · 공매도 금지, 허용 목록 기본(레버리지 · 인버스 판별 데이터 없음), 출금 · 이체 API 미구현.
   - **키 보관**: 주문 키도 기존처럼 AES-256-GCM(crypto.ts 서버 마스터키). 마스터키와 DB가 함께 새면 주문이 가능하므로 운영 서버 접근을 통제한다. key-backup 백업 파일에 주문 권한 키가 들어간다는 경고를 추가한다.
   - **재인증(step-up)**: 비밀번호를 다시 넣으면 10분 허용(exportKeys의 verifyPassword 패턴). 대상은 주문 실행 · 취소, 단계 올리기, 실전 전환, 주문 허용 토글, 정지 해제, 외부 매매 인정. 장기적으로 WebAuthn이나 안드로이드 생체 인증.
   - **프롬프트 인젝션**: 모델 지시로는 막을 수 없다는 것이 전제다. 방어선은 허용 목록, 한도, 사전검증, 오염 시 사람 승인(AP-10).
   - **고지**: 화면과 사용설명서에 'AI 판단은 손실을 낼 수 있고 책임은 사용자에게 있다', '페이퍼 성적은 낙관적 추정이며 미래를 보장하지 않는다'를 적는다. 사용설명서의 '주문은 내지 않습니다'(810 · 947 · 1071행 부근)와 COMMON · skillsPrompt 문구는 출시 커밋과 함께 고친다(CLAUDE.md 규칙).

#### 단계별 출시

- **Phase 0 — 주문 카드와 페이퍼 (약 1.5~2주, 증권사 주문 코드 없음)**
  - AP-01 정책 폼 한 장(SUGGEST/APPROVE, PAPER만)
  - AP-03 사전검증 순수 함수와 테스트(market-hours, tick-size 포함), 정책 단위 잠금과 예약
  - AP-04 propose_order와 주문 카드, 원자적 선점, step-up 재인증
  - AP-07 내부 페이퍼 체결(현재가 + 슬리피지, PaperDaily)
  - AP-06 전역 킬스위치와 일손실 정지
  - AP-10 오염 판정(대화 전체 기준)과 강제 승인
  - 최소 AgentDecision 기록, Prisma 마이그레이션
  - 완료 기준: 채팅에서 propose_order → 재인증 승인 → 페이퍼 체결 → `/autopilot/paper` 성적까지 이어진다. checkOrder 테스트가 경계값과 동시 제안을 덮는다.
- **Phase 1 — KIS 국내 승인 후 실전 주문 (약 2~3주)**
  - AP-02 KIS 단발 주문 · 취소, 주문가능금액, 당일 주문 조회. 모의 연결로 먼저 검증한 뒤 실전.
  - AP-05 폴링, 원장 반영(externalRef), 시작 예수금 DEPOSIT, 수량 대사와 정지, TRADE 알림.
  - `AUTOPILOT_LIVE` · `AUTOPILOT_LIVE_USERS` · 연결 tradeEnabled. 첫 4주는 1회 한도 10만원 강제.
  - 사용설명서 'AI 운용' 장, 기존 '주문은 내지 않습니다' 문구 수정, 캡처 재촬영.
- **Phase 2 — 기록, 심사, 확장 (약 3주)**
  - AP-09 결정 성과 귀속과 '왜 샀나' 화면, AP-07B 승급 심사(AuditLog)
  - AP-12 운용 예산(runTurn 루프 안 검사), 일일 리포트, AUTOPILOT 알림
  - AP-06 서킷 확장, 푸시 '정지' 액션(sw.js + 서명 토큰)
  - AP-02B 키움, 그다음 업비트(exchange-sync 경로)
- **Phase 3 — 자동 운용 (AUTO)**
  - AP-08: PAPER AUTO로 40영업일 이상 운영한 뒤, 승급 심사를 통과한 정책만 LIVE AUTO. 승급 직후 한도 절반.
  - tainted 주문은 계속 승인을 거친다. 안드로이드 생체 인증 승인과 위젯 킬스위치.
- **Phase 4 — 전략 프로필과 리그 (P2)**
  - AP-11 스냅샷 고정 프로필, 외부 철학 가져오기, 본인 페이퍼 리그 순위.
  - 해외주식, NXT, 시장가는 수요를 보고 정한다. 다중 사용자 배포에서 열지는 법률 검토 뒤에 정한다.

> 확인할 순서 문제: Phase 1에서 실전(LIVE, APPROVE)을 여는데 PAPER → LIVE 승급 심사(AP-07B)는 Phase 2에 있다. Phase 1의 실전 전환은 재인증과 10만원 한도로만 막힌다. AP-07B의 PAPER → LIVE 부분을 Phase 1로 당길지 정해야 한다.

#### 열린 질문

1. 정책 포트폴리오를 '그 계좌 전용'으로 강제하면 여러 계좌를 한 포트폴리오에 모아 둔 사용자는 포트폴리오를 나눠야 한다. 나누게 할까, Lot.importSource로 계좌별 수량을 구분해 대사하는 복잡한 방식을 택할까?
2. 현금 추적 시작점: 정책을 만들 때 주문가능금액을 DEPOSIT으로 넣을까, 기존 CashBalance를 믿을까? 지금 가져오기는 예수금을 기록하지 않는다.
3. step-up 재인증 유효시간(10분 제안)과 수단: 비밀번호 재입력으로 시작할까, TOTP나 WebAuthn을 먼저 넣을까? (EX-02와 연결)
4. 승급 기준 하한(영업일, 거래 수, MDD, 대사 오류)을 앱이 고정하고 사용자는 더 엄격하게만 바꾸는 방식을 받아들일까?
5. 폴러 · 사이클을 Next.js 프로세스 안 setInterval로 돌릴까, `/api/cron/*` 외부 스케줄러나 별도 워커로 분리할까? 장중 폴링 공백 허용치는?
6. KIS 주문 TR ID(TTTC0012U/0011U), EXCG_ID_DVSN_CD 필수 여부, hashkey 필요 여부, 체결조회 응답 단위(누적/개별), 예수금 필드명은 2차 자료로만 확인했다. Phase 1 착수 전에 공식 문서와 모의 계좌로 확인한다.
7. 운용 사이클에서 웹 검색을 기본으로 끌까? 켜면 거의 모든 결정이 tainted가 되어 AUTO의 의미가 줄어든다.
8. 외부 스킬 · 철학을 운용 프로필로 복사할 때 라이선스를 어떻게 표시하고, 라이선스 없는 문서를 허용할까?
9. 안드로이드 배포 빌드에서 AI 운용 화면을 아예 빼고 서버 화이트리스트로만 열까? 법률 검토 시점은?

#### 리뷰에서 고친 점

**[1] 이미 있는 기능과 겹치거나 기존 모델을 무시한 설계**
- **업비트 주문이 원장에 두 번 들어간다(치명적).** exchange-sync.ts는 업비트 체결을 주문 하나당 한 건으로 묶어 `${conn.broker}:${e.kind}:${e.id}`로 기록한다. 초안의 `<broker>:<주문번호>:<체결순번>` 키와 달라 동기화 때 같은 체결이 다시 기록된다. → 코인 체결은 syncExchangeHistory로만 반영하고, 정책 포트폴리오는 historyPortfolioId와 같아야 한다.
- **대사 재료가 맞지 않는다.** loadBrokerSources는 코인을 뺀다(isCryptoBroker). 주식 어댑터에 예수금 메서드가 없다. importHoldings는 `fromCash: false`라 CashBalance가 예수금을 따라가지 않는다. → MVP는 수량만 대사하고, 정책 생성 시 주문가능금액을 DEPOSIT으로 넣어 현금 추적을 시작한다.
- **페이퍼 상태 중복.** `PaperAccount.positions`(Json)는 TradeOrder(PAPER) · OrderFill과 같은 내용을 가변 상태로 다시 들어 경쟁 조건과 불일치를 만든다. → positions Json을 없애고 applyTxn · positionsAsOf · dailySeries로 계산한다.
- **PromotionReview 모델 불필요.** → AuditLog의 `audit(entity='autopilot_policy', action='promote')`로 대체.
- **재인증은 이미 패턴이 있다.** key-backup.ts exportKeys의 verifyPassword를 재사용하고, 주문마다 비밀번호를 묻지 않도록 Session에 짧은 step-up 창을 둔다.
- **OPERATOR를 AgentKind/AGENT_ORDER에 그냥 넣으면** 채팅 선택기와 설정 모델 표에 노출된다. → 별도 목록.
- **정책 키 중복.** 초안은 PortfolioTarget 키 체계로 weightBounds를 따로 뒀다. → MVP는 기존 PortfolioTarget · driftTolerance를 쓰고 정책 쪽 상하한은 나중.

**[2] 개인 개발자가 실제로 쓸 수 있는 데이터인가**
- **키움 post()는 주문에 그대로 쓸 수 없다.** 5xx와 401에서 자동 재전송한다(kiwoom.ts 141~170행). 접수 뒤 5xx · 타임아웃이 나면 같은 주문이 두 번 나간다. KIS · 키움에는 클라이언트 주문 ID 멱등성도 없다. → 재시도 없는 단발 POST. 재시도는 '접수 안 됨'이 확실한 호출 제한 코드에서만.
- **업비트 request()는 GET 전용**이라 POST/DELETE 경로를 새로 만든다.
- **체결 단위가 다를 수 있다.** KIS 일별 주문체결조회는 누적 수량 · 평균가로 알려져 있다(미확인). → OrderFill은 누적 증가분 방식도 지원.
- **휴장일 · NXT · 레버리지 데이터 출처가 없다.** → KRX 휴장일은 연도별 상수 표(KIS 휴장일 API 미확인). MVP는 KRX 정규장만. 레버리지 · 인버스 ETF · ETN을 가릴 데이터가 없어 금지 목록 대신 **허용 목록 기본**.
- **시세 신선도.** PriceQuote.asOf가 null일 수 있고 market-board는 다른 증권사 시세를 쓸 수 있다. → 주문 직전 시세는 주문 증권사에서 캐시 없이 읽고, asOf가 없으면 조회 시각 기준.

**[3] 안전 · 보안 · 법규**
- **이중 실행 경쟁 조건(치명적).** executeAction은 findFirst 확인 뒤 따로 update한다. → 주문은 `updateMany({status: 'PENDING'} → 'EXECUTING')`로 먼저 선점.
- **한도 우회(치명적).** agent.ts는 한 단계의 도구 호출을 Promise.all로 동시에 실행해, 같은 응답의 propose_order들이 같은 사용량을 보고 각각 통과한다. → 정책 단위 잠금 안에서 사전검증, PENDING_APPROVAL · SUBMITTED 금액을 예약.
- **비용 상한이 턴 시작에만 걸린다**(agent.ts 205행). 한 턴은 최대 16단계 × 32000 토큰. → 루프 안 누적 비용 검사, AP-12 노력을 S → M.
- **오염 판정 범위.** 대화 기록을 매 턴 통째로 다시 보내므로 이전 턴의 웹 페이지도 영향을 준다. → '이번 사이클'이 아니라 대화 전체 기준. search_books(카카오)와 커뮤니티 스킬 use_skill도 외부 텍스트에 포함. '판단 요약만 받는 2단계 호출'은 요약도 오염된 출력이라 MVP에서 빼고 결정적 통제를 방어선으로 명시.
- **서버 측 폴백으로 모델이 바뀐다.** → 결정 기록에 실제 응답 모델(msg.model).
- **키 탈취 → 펌프 앤 덤프.** → 허용 목록 기본, 가격 괴리 상한 · 거래대금 하한을 끌 수 없는 규칙으로.
- **푸시 '정지' 액션은 아직 못 만든다.** sw.js에 notificationclick만 있고 페이로드는 `{title, body, url, tag}`뿐이다. '인증 없는 정지'는 CSRF · 남용 통로다. → 1회용 서명 토큰, Phase 2.
- **업비트 키를 두 연결로 나누면** 동기화 · 보유 집계가 두 번 일어난다. → 기존 연결 해제 뒤 주문 권한 키로 재등록을 안내.
- **법규**: 가상자산이용자보호법(2024-07 시행) 불공정거래 금지 추가. 서버가 남의 주문 키를 드는 구조는 서버 env 화이트리스트로 차단.

**[4] 우선순위와 노력**
- MVP가 너무 컸다(P0 7개 중 L 2개를 2~3주). AP-02는 증권사 3곳이라 사실상 XL. → Phase 0은 증권사 코드 없이 '주문 카드 + 페이퍼', Phase 1은 KIS 국내 하나. 키움 · 업비트는 AP-02B(P2).
- AP-07은 P1인데 Phase 0에 있었다. → 페이퍼 체결을 단순화(현재가 + 슬리피지)해 P0/M으로 올리고, 승급 심사는 AP-07B(P1)로 분리.
- AP-08 자율 운용은 P1/L이 아니라 P2/XL(수개월 페이퍼, 법률 검토, 별도 큐 · 잠금).
- 위임 5단계 중 LIMITED · FULL은 구분이 모호하고 OFF는 haltedAt과 겹친다. → SUGGEST · APPROVE · AUTO 3단계.
- 8단계 정책 편집기는 과하다. → 핵심 필드 8~10개 폼 하나. 거래 시간대 · 스케줄 · 전략 프로필 · 주간 한도는 나중 마이그레이션.
- AP-06은 전역 킬스위치와 일손실 정지만 P0/S, 나머지 서킷은 P1.

**[5] Prisma 모델**
- `AutopilotPolicy.portfolioId`에 relation이 없었다. → Portfolio relation, onDelete NoAction(사용자 삭제 cascade는 통과, 포트폴리오만 지우기는 거부).
- 한 계좌 · 포트폴리오에 정책이 여럿 붙으면 한도 · 체결이 갈라진다. → `connectionId String? @unique`, `portfolioId @unique`.
- `allowedTypes String[]` → 기존 enum `AssetType[]`.
- DelegationLevel은 Prisma enum이라 대소 비교가 안 된다. → domain `LEVEL_RANK`.
- TradeOrder.assetId · aiActionId에 relation 추가(SetNull). deleteConversation이 AiAction을 cascade로 지우므로 주문 기록은 SetNull로 보존.
- AgentDecision.conversationId relation(SetNull).
- 금액 정밀도를 규약(금액 24,6 · 수량 28,8 · 비율 20,10)에 맞췄다(초안은 18,0 · 18,2 · 8,5).
- 폴링 · 중복 방지 인덱스: `@@unique([connectionId, brokerOrderId])`, `@@index([status, updatedAt])`.
- OrderFill.transactionId에 Transaction relation(SetNull)과 역관계. brokerFillId는 선택(누적 증가분 방식 수용).
- '거부' 상태 분리: 사전검증 거부 BLOCKED, 증권사 거부 REJECTED. 오래된 SUBMITTING → UNKNOWN 규칙 명시.
- 빠진 역관계(User, Portfolio, Asset, AiAction, AiConversation, Transaction, BrokerConnection)와 Session.stepUpUntil, AiSettings 킬스위치 필드 추가.

---

### 2.3 운용 전략 · 투자 철학 (ST)

투자 철학과 스킬을 **검증 가능한 규칙**으로 만들고, 고정된 버전으로 백테스트 · 페이퍼 운용해 자체 성과로 비교한다. 사용자가 말한 '외부의 성능 좋은(랭킹 순) 스킬셋 · 철학'은 이 영역에서 '인기 순위'와 '본인 데이터로 검증한 성적'을 분리해 다룬다.

이름 정리: 리뷰에서 모델 이름을 Philosophy에서 **Strategy(운용 전략)**로 바꿨다. 'Philosophy'는 기존 Sage(투자 거장의 철학)와 뜻이 겹치기 때문이다. 화면 구분 제안은 '투자 노트 > 거장(서술)', 'AI > 스킬(분석 절차)', 'AI > 전략(규칙과 검증)'이다.

#### 현재 있는 것

1. **AiSkill** (schema 768행): SKILL.md 형식의 글 스킬. source custom 또는 skills.sh, sourceId/Path/Url, license, installs, skipped. 버전 · contentHash · lint는 없다. `skills.ts` installCommunitySkill / refreshSkill은 원본을 다시 가져오면 사용자가 고친 지침을 덮어쓴다. communityCatalog는 skills.sh 검색 결과를 installs 순으로 보여 주고, repoFiles / communitySkill은 비인증 GitHub API와 raw를 1시간 캐시해 쓴다.
2. **`src/domain/ai-skills.ts`**: skillsPrompt 가드레일(프롬프트 수준), DENY_OWNERS, CATEGORIES. 'investor' 카테고리 정규식에 invest가 들어 있어 사실상 모든 항목에 걸린다. 가져올 때 정적 인젝션 검사는 없다.
3. **Sage**(679행)와 SAGE_PRESETS(`domain/knowledge.ts` 155행): 서술형 거장 프로필. SAGE 에이전트가 렌즈로 대화에만 쓴다.
4. **AiAction**(842행): conversationId와 toolUseId가 필수다. 대화 밖(일일 작업, 버튼)에서는 만들 수 없다.
5. **도구 실행**: `tools.ts` runTool은 이름만으로 ALL_TOOLS에서 찾아 실행한다. 에이전트별 · 스킬별 허용 목록 필터가 없다(`agent.ts` 244행은 모든 에이전트에 같은 toolDefs).
6. **백테스트**: `domain/goals.ts` backtest(dates, prices, weights, rule, band)는 NONE / MONTHLY / QUARTERLY / BAND, 비용 0, 같은 날 종가 리밸런싱. `services/goals.ts` backtestReport는 현재 보유 비중을 기본 365일로 재생하고 환율이 없으면 현재 환율로 대신한다. AI 도구 get_rebalance_backtest.
7. **목표 비중**: PortfolioTarget, Portfolio.driftAlert / driftTolerance / driftBreaches, `alerts.ts` savePortfolioTargets(보유 자산 키, CASH, 하위 포트폴리오만 허용, 243행), propose_target_weights. 이 조합이 이미 '리밸런싱 알림'을 한다.
8. **시세**: PriceDaily는 사용자 공용이고 가격만 담으며(배당 미포함) upsert가 source를 덮어쓴다. backfillCloses는 한 번 채운 심볼을 최근 2주만 다시 받는다(`market.ts` 187행). KIS dailyCloses는 국내 수정주가 약 11년, 해외 약 6년. FxDaily는 recordTodayFx로 하루 1건만 쌓이고 환율 이력 백필 코드는 없다. runDailyForUser는 보유 중인 BROKER 자산만 36개월까지 백필한다. BENCHMARKS는 069500, VOO, QQQ.
9. **Trait / AssetTrait**: 사용자가 등록한 Asset에 붙이는 태그다. 시장 전체를 거르는 스크리너가 아니다.
10. AuditLog(358행)가 있다. BrokerConnection.paper(KIS · 키움 모의투자)가 있다. `src/server/brokers/*`에 주문 코드는 없다.
11. 화면: `/ai`, `/ai/skills`, `/sages`, `/sages/[id]`, `/portfolios/[id]`. 사용설명서에 '리밸런싱 백테스트'(419행), '투자 거장'(747행), '스킬'(905행) 장.

**결론**: 서술형 스킬 · 거장, 인기 기준 랭킹, 1년짜리 비용 없는 리밸런싱 백테스트, 목표 비중 알림은 이미 있다. 없는 것은 다섯 가지다: 검증 가능한 규칙과 버전 고정, 비용 · 다년 · 환율을 반영한 시뮬레이션, 전진 검증(페이퍼), 자체 성과 비교, 외부 텍스트 lint.

#### 기능 명세표

| ID | 기능 | 설명 | 사용자 가치 | 우선순위 | 노력 | 데이터 출처 | 재사용 | 위험 |
|---|---|---|---|---|---|---|---|---|
| ST-01 | 전략 규칙 v1: 정적 배분 (닫힌 스키마) | 전략 = 원칙 서술(선택, 최대 8,000자) + 규칙 JSON. v1 규칙은 zod 닫힌 스키마(schemaVersion 1, 모르는 키 거부): `assets[{symbol, market, currency, weight}]`(명시 목록, 최대 30종목), cashWeight, rebalance(NONE / MONTHLY / QUARTERLY / YEARLY / BAND + band), `limits{maxWeight, minCash}`. 부채 · 레버리지는 스키마에 없다. 순수 함수 `src/domain/strategy.ts`: parseRules, normalizeWeights, `checkAgainst(holdings)` → violations(비중 초과, 목록 밖 종목, 현금 부족, drift). 진입 · 청산 신호와 펀더멘털 조건은 v1에 없다(ST-12, ST-14). | '버핏처럼' 같은 막연한 말 대신, 사람과 기계가 같은 숫자 규칙으로 무엇을 얼마나 들고 언제 리밸런싱하는지 확인한다. | P0 | M | 사용자 입력, 기존 Asset(심볼 · 시장 · 통화 조회) | `domain/goals.ts` RebalanceRule · RULE_LABEL(YEARLY 추가), `alerts.ts` targetsOk, zod 서버 액션 관례 | v1은 정적 배분만이라 추세 추종 · 가치주 선별은 표현할 수 없다(화면에 한계 명시). 유니버스가 명시 목록이라 오늘 고른 종목으로 과거를 돌리는 선택 편향이 생긴다(ST-06 경고). |
| ST-02 | 버전 고정과 채택 | StrategyVersion은 append-only, contentHash(sha256(principles + rules)). 편집하면 새 버전. `Strategy.activeVersion`은 사용자가 채택한 버전 번호. AI나 스킬 · 거장 변환으로 만든 버전은 채택 전까지 초안이고, 그 자체가 승인 게이트다. 백테스트 · 페이퍼 · 포트폴리오 연결은 항상 versionId 고정. 채택 · 연결 변경은 AuditLog. | 성과가 어느 규칙에서 나왔는지 끝까지 추적된다. 원본 스킬이 바뀌거나 AI가 제안해도 운용 기준이 몰래 바뀌지 않는다. | P0 | S | 내부 DB | AuditLog, AiMessage의 append-only 패턴 | 버전이 늘면 화면이 복잡해진다(기본 화면은 채택 버전과 초안만). |
| ST-03 | 시뮬레이션 엔진 일반화 (비용, 연 1회, 다음날 체결, 다년) | `src/domain/strategy-sim.ts` `simulate(dates, prices, rules, costs)`. 기존 backtest()를 일반화해 매매 수수료 · 매도세(bps), YEARLY, 신호 다음 거래일 종가 체결, 거래 목록(날짜, 종목, 방향, 비중 변화, 비용), 비용으로 깎인 수익을 더한다. 기존 backtest()는 이 엔진의 래퍼로 남겨 backtestReport · get_rebalance_backtest 동작을 유지. 서버 `services/strategies.ts` runReport(runId)는 backtestReport의 가격 정렬 · 환산 로직을 함수로 빼서 공유. | 비용과 기간을 반영해 1년 · 비용 0 백테스트보다 현실에 가깝다. | P0 | M | PriceDaily, FxDaily(ST-04), backfillCloses | `domain/goals.ts` backtest, `services/goals.ts` backtestReport, `domain/performance.ts` downsample | 가격 수익만 반영해 배당 전략이 불리하게 나온다. 종가 체결 가정이라 슬리피지가 빠진다. 둘 다 경고로 표시. |
| ST-04 | 데이터 준비: 환율 이력, 가격 점프 검사, 커버리지 | (a) 환율 이력: 다년 USDKRW가 없으면 결과가 틀린다. 첫 단계는 통화별로 따로 계산하고 원화 환산 구간에 환율이 없으면 '현재 환율로 대체' 경고. 이후 한국은행 ECOS(ApiKey service `ecos`)로 FxDaily 백필. (b) 가격 점프 검사: 하루 ±35% 넘게 움직이고 되돌아오지 않으면 분할 의심 표시, 심볼 전체 다시 받기(backfillCloses에 force 옵션). (c) 커버리지: 종목별 첫 종가일, 빈 날 비율. 백테스트 시작일은 모든 종목에 가격이 있는 날부터. | 숫자가 그럴듯해도 데이터가 틀렸다면 바로 드러난다. | P0 | M | PriceDaily, FxDaily, 증권사 dailyCloses, (후속) ECOS 환율 API | `market.ts` backfillCloses · storeFx · storeClose, api-usage noteCall, ApiKey 암호화 저장 | ECOS 통계코드 · 호출 한도 미확인. 재백필은 브로커 호출을 늘린다(ApiLimit 확인). PriceDaily가 공용이라 한 사용자의 재백필이 다른 사용자 데이터도 바꾼다(내용이 맞으면 이득). |
| ST-05 | 페이퍼 운용 (전진 검증) | StrategyRun mode PAPER는 startDate(오늘 이후, 버전 생성 이후)부터 최신 종가까지 결정적으로 재생한다. 일별 값은 저장하지 않고 읽을 때 계산, 요약만 metrics에 캐시. runDailyForUser에 활성 런의 유니버스 심볼 백필을 추가. 상한은 사용자당 활성 런 10개, 런당 30종목. BACKTEST와 같은 엔진. | 규칙을 먼저 정해 두고 앞으로의 데이터로 검증해 과거에 끼워 맞춘 전략을 걸러낸다. 기록은 일찍 시작할수록 쓸모가 크다. | P0 | S | PriceDaily, FxDaily | `services/jobs.ts` runDailyForUser, ST-03 엔진, `domain/benchmark.ts` benchmarkReturns | 과거 종가가 나중에 바뀌면(재백필, 다른 브로커 upsert) 재생 결과도 바뀐다. 입력 데이터 해시를 metrics에 남겨 변화를 표시한다. |
| ST-06 | 지표와 경고 배지 | `src/domain/strategy-metrics.ts`(순수 함수 + 테스트). 누적수익, CAGR, 연 변동성, MDD, 회전율, 리밸런싱 횟수, 비용 손실, 벤치마크 대비 초과수익(가격 수익끼리), 샤프(rf = 0 또는 사용자 입력), 페이퍼 운용 개월 수. warningsOf()가 결정적으로 매기는 경고: 짧은 기록(페이퍼 12개월 미만), 백테스트만 있음, 비용 0bps, 데이터 공백, 분할 의심, 환율 대체 구간, 종목 사후 선택, 배당 미포함. 각 경고는 차단 · 주의 · 참고 등급. | 좋아 보이는 숫자가 왜 믿기 어려운지 한눈에 보인다. | P0 | M | StrategyRun 재생 결과, PriceDaily 커버리지 | `goals.ts` backtest의 MDD · 변동성 · 회전율, `performance.ts` summarize | 지표 정의(일간 로그수익, 연환산 252일, rf)는 사용설명서에 고정. 경고가 많으면 무시되므로 등급별로 접는다. |
| ST-07 | 전략 화면, 템플릿, '내 포트폴리오에 대 보기' | `/ai/strategies`, `/ai/strategies/[id]`. 규칙 폼(종목 행, 비중, 리밸런싱 주기 · 밴드, 한도)과 원칙 텍스트. 템플릿 60/40, 동일가중, 올웨더 근사, '내 현재 보유 비중'(backtestReport와 같음). 템플릿 ETF 심볼은 사용자가 확인. '내 포트폴리오에 대 보기'는 checkAgainst 결과(위반, drift 표, 리밸런싱 금액 초안). 버튼: 백테스트(1/3/5년), 페이퍼 운용 시작, 버전 채택. | 규칙을 바꾸면 내 포트폴리오에 무엇이 달라지는지 바로 보여 실험 비용이 낮다. | P0 | M | Holding, CashBalance, PortfolioTarget, PriceDaily | get_target_drift 계산(alerts.ts), recharts, SKILL_STARTERS 템플릿 패턴, `goal-actions.ts` 관례 | 폼이 복잡해지기 쉽다. v1을 정적 배분으로 한정해 행 편집기 하나로 충분하다. |
| ST-08 | 포트폴리오 연결: ADVISE와 목표 비중 적용 | `Portfolio.strategyVersionId`(onDelete Restrict). MANAGER 에이전트 page-context에 규칙 요약(숫자 JSON)과 위반 목록, 원칙 텍스트는 신뢰하지 않는 구분자 안에. '목표 비중으로 적용'은 확인 대화상자를 거쳐 기존 savePortfolioTargets를 호출하거나 AI의 propose_target_weights로. 그러면 기존 drift 알림이 리밸런싱 시점을 알린다. 보유하지 않은 종목은 '먼저 매수하거나 자산 등록 필요'로 따로. 주문은 하지 않는다. | 새 주문 코드 없이도 검증한 전략이 매일 내 포트폴리오를 지켜보고 벗어나면 알린다. | P1 | S | PortfolioTarget, Portfolio.drift*, StrategyVersion | `alerts.ts` savePortfolioTargets · targetsOk, `actions.ts` target_weights 실행, `agent.ts` pageContext, `notify.ts` | 목표 키는 보유 자산 id만 받아 전략 종목과 1:1로 맞지 않을 수 있다(같은 심볼 Asset이 여럿 등). 매핑 결과를 미리 보여 주고 확인받는다. |
| ST-09 | 스킬 · 거장에서 전략 초안 만들기 (AI 보조) | `/ai/skills`의 스킬과 `/sages/[id]`에 '전략 초안 만들기'. 누르면 MANAGER(거장이면 SAGE) 대화를 열고 새 도구 `propose_strategy`(입력은 ST-01 zod 스키마)를 부른다. 결과는 AiAction kind `strategy_draft`(대화 안에서 만들어 conversationId 제약을 지킴). 실행하면 채택 전 초안 버전(author ai, origin skill/sage, lint 기록). 펀더멘털 조건은 원칙에만 남기고 '해석'으로 표시. | 정리해 둔 스킬과 거장 노트를 시험 운용 가능한 전략으로 옮긴다. | P1 | M | AiSkill, Sage, SAGE_PRESETS | `tools.ts` tool() · propose_* 패턴, `actions.ts` executeAction(새 kind), sageSummary, readSkill | LLM이 만든 비중은 근거가 약하다. 초안은 채택 전까지 연결 · 적용 불가, 백테스트만. 거장 이름을 성과 근거처럼 쓰지 않는다. |
| ST-10 | 외부 텍스트 lint와 스킬 갱신 diff | `src/domain/text-lint.ts`(순수 함수): 이전 지시 무시 · 역할 전환 문구, 도구 이름이나 propose_* 직접 호출 지시, 주문 · 송금 · 출금 · 키 · 비밀번호 요구, URL로 데이터를 보내라는 요구, 제로폭 문자, HTML 주석, base64 덩어리, 비정상적으로 긴 줄. 커뮤니티 스킬 미리보기 · 가져오기, 전략 초안 변환에 적용하고 등급별로 보인다. 차단 등급은 추가 확인. `AiSkill.contentHash`를 더해 refreshSkill이 덮어쓰기 전에 diff를 보이고 확인받는다. | 남이 만든 스킬 · 철학을 써도 그 글의 지시대로 데이터와 키가 움직이지 않는다. | P1 | S | 가져온 원문 | `skills.ts` communitySkill · installCommunitySkill · refreshSkill, `ai-skills.ts` skillFolderFiles · SKILL_LIMITS · skillsPrompt | 정적 패턴은 우회할 수 있어 최종 방어선이 아니다. 최종 방어선은 '외부 텍스트에서 규칙 자동 생성 안 함', '데이터 변경은 승인 필수', '주문은 결정적 규칙에서만'. |
| ST-11 | 같은 조건 비교 화면 | `/ai/strategies/compare?runs=a,b,c`. 같은 시작일 · 비용 · 벤치마크로 다시 계산하고 곡선 겹쳐 보기, 지표 표, 경고 합집합. 조건이 다른 런은 비교를 막는다. | 내 전략끼리 같은 잣대로 고른다. | P1 | S | StrategyRun | ST-03 엔진, recharts | N개 중 1등을 고르는 다중 비교 편향은 경고 문구로만 알린다(정량 보정은 ST-13). |
| ST-12 | 신호 규칙 v2 (추세 필터, 낙폭 브레이크, 목록 내 모멘텀) | schemaVersion 2에서 열거형 지표만 허용: PRICE_VS_MA(window), RETURN_N, DRAWDOWN_FROM_HIGH, 명시 목록 안 상위 N개 모멘텀. 조건 최대 8개. `drawdownBrake{at, cutTo}`. 순수 함수 evaluateSignals, 같은 엔진. | 200일선 추세 추종 같은 대표 전략을 검증한다. | P2 | L | PriceDaily | ST-01, ST-03 | DSL이 커지면 사실상 코드가 된다. 분할 의심 데이터가 남아 있으면 신호가 잘못 발동하므로 차단 경고와 연동. |
| ST-13 | 랭킹 점수, 다중 비교 보정, 신뢰도 등급 | 기간 가중 점수, Deflated Sharpe 근사, 근거 등급(A: 페이퍼 12개월 이상, B: 백테스트 또는 짧은 페이퍼, C: installs · 별 같은 인기 지표, D: 해석 · 미검증). 공식은 화면과 사용설명서에 공개. | 운이 좋았던 1등과 꾸준히 이긴 전략을 가른다. | P2 | M | StrategyRun.metrics | ST-06 | A등급은 페이퍼 1년 뒤에야 의미가 생긴다. 등급 기준이 자의적으로 보일 수 있다. |
| ST-14 | 펀더멘털 연동 (가치투자 조건을 규칙으로) | OpenDART(국내)와 SEC EDGAR companyfacts(미국)로 PER · ROE 같은 지표를 받아 명시 목록 안 필터 조건으로. 시장 전체 스크리닝은 범위 밖. | 버핏 · 그레이엄류 철학을 서술에 그치지 않고 규칙으로 검증한다. | P2 | XL | OpenDART(인증키, 일일 한도 미확인), SEC EDGAR(User-Agent 필수, 속도 제한 미확인) | ApiKey, api-usage | 재무 시점을 맞추지 않으면 미래 정보가 섞인다(공시일 기준 필요). 데이터 정제 비용이 크다. |
| ST-15 | 전략 내보내기 (SKILL.md + rules.json) | 채택 버전을 SKILL.md(원칙)와 rules.json으로. 성과는 붙이지 않고 받은 쪽이 자기 데이터로 다시 검증. 라이선스가 없는 원본에서 만든 전략은 내보내기를 막는다. 공개 리더보드는 만들지 않는다. | 다른 기기나 안드로이드 앱으로 전략을 그대로 옮긴다. | P2 | S | StrategyVersion | `ai-skills.ts` toSkillMd, `export.ts` · `data-io.ts` | 성과를 함께 게시하면 투자 권유로 보일 수 있다(미확인). 그래서 성과는 넣지 않는다. |

#### 화면

1. **`/ai/strategies` (목록)**
   - 표: 전략명, 채택 버전(초안 배지), 최근 런 모드(백테스트/페이퍼), 기간, CAGR, MDD, 변동성, 비용 손실, 벤치마크 대비, 경고 배지(차단 · 주의 수).
   - 버튼: 새 전략(템플릿 60/40, 동일가중, 올웨더 근사, 내 현재 보유 비중), 체크한 런 비교.
   - 상단 고정 문구: '백테스트 · 페이퍼 결과는 가격 수익(배당 제외), 종가 체결, 가정 비용 기준이며 실제와 다를 수 있음'.
2. **`/ai/strategies/[id]` (편집과 상세)**
   - 규칙 폼: 종목 행(심볼 검색, 비중), 현금 비중, 리밸런싱 주기 · 밴드, 한도(종목당 최대 비중, 최소 현금), 비중 합 실시간 검사. 원칙 텍스트는 접어 둔다.
   - 버전: 목록, 초안 표시, 직전 버전과의 diff(규칙 표 비교), '채택' 버튼.
   - 런: 백테스트(1/3/5년), '페이퍼 운용 시작', 비용 입력(시장별 기본값). 결과는 누적 곡선 + 벤치마크, 낙폭 곡선, 리밸런싱 거래 목록, 지표 카드, 경고 패널(등급별), 데이터 커버리지(종목별 첫 종가일, 분할 의심, 환율 대체 구간, '다시 받기').
   - '내 포트폴리오에 대 보기': 위반 목록, drift 표, 리밸런싱 금액 초안, 보유하지 않은 종목.
   - (P1) '이 포트폴리오에 연결', '목표 비중으로 적용'(확인 대화상자에 바뀌는 목표 비중).
3. **`/ai/strategies/compare?runs=…`** (P1): 같은 조건을 상단에 고정, 곡선 겹쳐 보기, 지표 표, 다중 비교 안내.
4. **`/ai/skills`** (P1): 커뮤니티 미리보기 · 가져오기에 lint 결과(차단 · 주의 · 참고, 문제 구절 강조). '다시 가져오기' 전 diff 확인. 내 스킬마다 '전략 초안 만들기'.
5. **`/sages/[id]`** (P1): '전략 초안 만들기' → SAGE 대화에서 strategy_draft 제안.
6. **`/ai` 대화** (P1): strategy_draft 카드(규칙 표, lint, 실행 · 무시). 실행하면 초안 버전 생성.
7. **`/portfolios/[id]#targets`** (P1): '따르는 전략: 이름 vN', 위반 요약, 연결 해제.
8. **사용설명서**: '운용 전략' 장(지표 정의, 경고 기준, 한계). '스킬' · '투자 거장' 장에 초안 만들기. 기능 이력 표 갱신.

#### 데이터 모델

리뷰에서 아래 모델을 현재 schema.prisma 사본에 붙여 `prisma validate` 통과를 확인했다(scratchpad에서만, 프로젝트 파일은 그때 수정하지 않음).

```prisma
/// A strategy the advisor checks a portfolio against and the app can test: optional principles
/// in prose plus closed-schema rules (domain/strategy.ts). Every edit adds a StrategyVersion.
model Strategy {
  id            String   @id @default(cuid())
  userId        String
  name          String
  oneLine       String?
  /// custom, template:<key>, skill (drafted from an AiSkill), sage (drafted from a Sage)
  origin        String   @default("custom")
  /// What it was drafted from; plain ids, the skill or sage may be deleted later
  skillId       String?
  sageId        String?
  /// Version number the user adopted; null until one is (drafts wait here)
  activeVersion Int?
  archived      Boolean  @default(false)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  user     User              @relation(fields: [userId], references: [id], onDelete: Cascade)
  versions StrategyVersion[]

  @@unique([userId, name])
}

/// One immutable revision. Runs and portfolios pin a version, never the strategy.
model StrategyVersion {
  id          String   @id @default(cuid())
  strategyId  String
  version     Int
  /// Principles in markdown; shown to agents only inside an untrusted-text block
  principles  String   @default("")
  /// StrategyRules { schemaVersion, assets, cashWeight, rebalance, band, limits } (zod, closed)
  rules       Json
  /// sha256 of principles + rules
  contentHash String
  /// Text-lint findings from a skill/sage conversion: [{ level, code, excerpt }]
  lint        Json     @default("[]")
  /// user, ai (strategy_draft action), template
  author      String   @default("user")
  note        String?
  createdAt   DateTime @default(now())

  strategy   Strategy      @relation(fields: [strategyId], references: [id], onDelete: Cascade)
  runs       StrategyRun[]
  portfolios Portfolio[]

  @@unique([strategyId, version])
}

/// A test of a pinned version: BACKTEST over past closes or PAPER forward from startDate.
/// Values are replayed from PriceDaily on read; only the summary is cached in `metrics`.
model StrategyRun {
  id         String    @id @default(cuid())
  userId     String
  versionId  String
  /// BACKTEST or PAPER
  mode       String
  startDate  DateTime  @db.Date
  /// End of a BACKTEST; null for PAPER (runs to the latest close)
  endDate    DateTime? @db.Date
  /// performance.ts BENCHMARKS symbol
  benchmark  String    @default("069500")
  /// Per trade side, and sell-side tax, in basis points
  feeBps     Decimal   @default(15) @db.Decimal(8, 2)
  taxBps     Decimal   @default(0) @db.Decimal(8, 2)
  /// Last metrics, warnings, coverage and a hash of the input closes (domain/strategy-metrics.ts)
  metrics    Json      @default("{}")
  computedAt DateTime?
  lastError  String?
  active     Boolean   @default(true)
  createdAt  DateTime  @default(now())

  user    User            @relation(fields: [userId], references: [id], onDelete: Cascade)
  version StrategyVersion @relation(fields: [versionId], references: [id], onDelete: Cascade)

  @@index([userId, active])
  @@index([versionId])
}

// Portfolio 에 추가 (ST-08, P1). Restrict: 따르는 포트폴리오가 있으면 전략을 지울 수 없다.
//   /// Strategy version the advisor checks this portfolio against (no orders here)
//   strategyVersionId String?
//   strategyVersion   StrategyVersion? @relation(fields: [strategyVersionId], references: [id], onDelete: Restrict)
//
// AiSkill 에 추가 (ST-10, P1):
//   /// sha256 of the imported text, to show a diff before a refresh overwrites it
//   contentHash String?
//
// User 에 추가할 역관계:
//   strategies   Strategy[]
//   strategyRuns StrategyRun[]
//
// AiAction.kind 새 값(스키마 변경 없음): strategy_draft — 대화 안에서만 생성 (conversationId 필수 제약 유지)
// 채택·연결 변경은 기존 AuditLog(entity='Strategy'|'Portfolio')에 기록.
```

#### 외부 API

- **첫 단계(P0)에는 새 외부 API가 없다.** 과거 종가는 기존 증권사 어댑터의 dailyCloses를 backfillCloses로 받는다. 사용자의 증권사 연결과 시세 조회 권한이 필요하다. KIS는 국내 약 11년, 해외 약 6년. 다른 브로커의 범위는 미확인. 호출량은 ApiUsage · ApiLimit로 본다.
- **환율 이력(P0 후속)**: 한국은행 ECOS 통계 API(인증키, 원/달러 일별 통계코드와 호출 한도 미확인). ApiKey service `ecos`에 암호화 저장, 읽기만. 키가 없으면 통화별 분리 계산과 경고.
- **skills.sh · GitHub**: `/api/search`, git/trees, raw.githubusercontent.com은 지금 쓰는 그대로. GitHub stars 수집(`GET /repos/{owner}/{repo}`)은 P2. 비인증 시간당 60회로 알려져 있고(미확인) repoFiles와 한도를 같이 쓰기 때문이다. 토큰을 쓴다면 공개 저장소 메타데이터 읽기 권한만.
- **AI 모델**: 기존 providers.ts, AiSettings.monthlyLimit 적용. 전략 초안(ST-09)에만 쓴다. lint(ST-10)는 결정적 함수라 모델을 쓰지 않는다.
- **펀더멘털(P2)**: OpenDART(인증키, 일일 한도 미확인), SEC EDGAR companyfacts(User-Agent 필수, 속도 제한 미확인).
- **주문 API는 이 영역에서 쓰지 않는다.** 오토파일럿 영역이 이 영역의 결정적 출력(`planRebalance`: 종목, 방향, 금액, 근거 규칙)을 받아 주문 키를 따로 연결하고 별도로 동의받아 처리한다. KIS 앱키는 조회와 주문 권한을 나누지 않는 것으로 알려져 있어(미확인), 기존 연결 키를 주문에 재사용하지 않도록 오토파일럿 쪽에 권고한다.

#### 안전 · 법규

- **주문과 LLM 분리**: 매매 종목 · 방향 · 금액은 닫힌 스키마 규칙을 domain 순수 함수가 결정적으로 평가한 결과로만 만든다. LLM은 결과를 설명만 한다. 외부 텍스트(스킬, 거장 노트, 웹)에서 규칙을 자동 생성해 저장하거나 실행하지 않는다. 초안은 사용자가 채택해야 쓸 수 있고, 채택 전에는 백테스트만 된다.
- **권한**: 외부 텍스트는 어떤 도구 권한도 갖지 않는다. 데이터 변경은 기존 AiAction 승인 흐름(PENDING → 사용자가 실행)을 그대로 거친다. runTool에는 에이전트별 · 텍스트별 필터가 없으므로 도구 목록에서 빼는 것만으로는 권한 제어가 되지 않는다는 점을 설계 원칙으로 문서화한다.
- **프롬프트 주입**: 원칙 텍스트와 스킬 본문은 신뢰하지 않는 구분자 안에 넣고 기존 skillsPrompt 우선순위 문구를 유지한다. 가져올 때 결정적 lint로 차단 · 주의 · 참고 등급을 매기고 차단 등급은 추가 확인을 받는다. 스킬을 갱신할 때 diff를 확인받는다.
- **성과 표시**: 모든 성과 화면에 '가격 수익(배당 제외), 종가 체결, 가정 비용, 미래 수익 보장 없음'을 고정 표시한다. 백테스트(표본 내)와 페이퍼(표본 외)를 색과 라벨로 구분한다. 데이터 문제(분할 의심, 환율 대체, 공백)는 숨기지 않는다.
- **거장 이름**: 거장에서 만든 전략은 '○○ 원칙에 대한 사용자 · AI의 해석'으로 표기하고, 인물 이름을 성과의 근거로 쓰지 않는다.
- **라이선스**: 스킬에서 만든 전략은 원본 license를 표시하고, 라이선스가 없으면 내보내기를 막는다.
- **감사**: 버전 채택, 포트폴리오 연결 · 해제, 목표 비중 적용을 AuditLog에 남긴다.
- **법규**: 이 영역은 본인 포트폴리오에 대한 분석 · 알림 도구 범위에 머문다(주문, 자동매매, 타인 제공 없음). 공개 리더보드, 성과 게시, 전략 판매 · 공유, 타인 계좌 운용은 투자자문업 · 투자일임업 · 유사투자자문업 해당 여부를 확인하지 못했으므로(**확인 필요**) 법률 검토 전까지 만들지 않는다. 안드로이드 앱을 서버 쪽 키로 동작하게 하면 다중 사용자 서버가 증권사 키를 보관하게 되므로 키 암호화(AES-256-GCM)와 접근 감사를 유지한다.

#### 단계별 출시

- **1단계 MVP (약 2~3주, 주문 없음)**: ST-01 정적 배분 규칙, ST-02 버전 고정과 채택, ST-03 엔진 일반화(비용, YEARLY, 다음날 체결, 기존 backtest는 래퍼로 유지), ST-04 통화별 계산 · 환율 대체 경고 · 가격 점프 검사 · 커버리지, ST-05 페이퍼 운용(일찍 시작), ST-06 지표와 경고, ST-07 목록 · 상세 · 템플릿 · '내 포트폴리오에 대 보기'. domain 테스트, `npm test` · `typecheck` · `build` 통과, 사용설명서 '운용 전략' 장과 캡처(seed-demo에 데모 전략과 런).
- **2단계 (약 2주)**: ST-08 포트폴리오 연결(ADVISE, 목표 비중 적용, 기존 drift 알림), ST-10 lint와 스킬 갱신 diff(기존 스킬 가져오기에도 적용), ST-09 스킬 · 거장에서 전략 초안, ST-11 비교 화면, ECOS 환율 이력 백필.
- **3단계 (오토파일럿과 맞춤)**: planRebalance 출력 형식을 확정해 오토파일럿에 넘긴다. 실행은 그쪽에서 모의투자 먼저, 승인 필수, 한도와 킬스위치. 이 영역에서는 ST-12 신호 규칙 v2.
- **4단계 (선택)**: ST-13 랭킹 점수와 등급(페이퍼 기록 1년 뒤), ST-14 펀더멘털, ST-15 내보내기. 공개 리더보드는 법률 검토 뒤 판단.

#### 열린 질문

1. 환율 이력을 어디서 받을까? ECOS 키로 백필할지, 첫 단계는 통화별 분리 계산과 경고로만 갈지(3 · 5년 원화 백테스트 정확도가 달라진다).
2. 배당을 반영할까? 가격 수익만으로 비교할지, dividends.ts나 DIVIDEND 기록, 외부 배당 데이터로 총수익을 근사할지.
3. 분할 의심 임계값(하루 ±35%, 되돌림 없음)과 자동 재백필 허용 여부. 브로커 호출량과 공용 PriceDaily 덮어쓰기 영향을 함께 따진다.
4. 시장별 비용 기본값. 국내 증권거래세율은 연도별로 바뀌어 왔고 2026년 세율은 미확인이다. 해외 주식 양도세처럼 연 단위 세금을 런에 반영할지.
5. 페이퍼 운용 상한(사용자당 활성 10개, 런당 30종목)이 적정한가?
6. 템플릿 '올웨더 근사'의 국내 상장 ETF 심볼을 사용자가 직접 고르게 할지, 기본값을 제안할지.
7. UI에서 거장(서술) · 스킬(분석 절차) · 전략(규칙과 검증)을 하나로 합치지 않고 나누는 데 동의하는가?
8. 오토파일럿과의 경계: planRebalance 출력 형식(금액/수량 기준, 최소 주문 단위, 환전)과 승인 정책은 그 영역에서 확정할까?
9. 공개 리더보드와 전략 공유를 장기적으로 원하는가? 원하면 투자자문 · 일임 · 유사투자자문 해당 여부를 법률로 검토해야 한다(미확인).

#### 리뷰에서 고친 점

**[1] 이미 있는 기능과 중복되거나 기존 모델을 무시한 부분**
- Philosophy가 AiSkill의 출처 필드(source, sourceId, sourceUrl, license, installs)를 복제하고, 가져오기 경로를 하나 더 만들었다. → 가져오기는 기존 AiSkill 경로(communitySkill, installCommunitySkill) 하나로 두고 전략은 skillId로만 연결. 이름은 Sage와 겹치지 않게 **Strategy**로.
- '내 포트폴리오에 적용했다면' 모드는 기존 goals.ts backtestReport(현재 보유 비중을 1년 재생)와 같다. → 엔진을 일반화하며 흡수.
- PROPOSE 모드의 리밸런싱 알림은 PortfolioTarget, Portfolio.drift*, propose_target_weights와 겹친다. → 정적 배분 전략은 목표 비중으로 적용해 기존 drift 알림을 그대로 쓴다. savePortfolioTargets는 보유 자산 키만 받으므로(alerts.ts 243행) 보유하지 않은 종목은 적용할 수 없다고 명시.
- ShadowDaily · ShadowTrade 테이블은 불필요하다. performance.ts처럼 '읽을 때 PriceDaily로 재생'하는 것이 관례다. 고정 버전 + 시작일이면 결과가 결정적으로 재현된다. → 요약 지표 캐시만.

**[2] 개인 개발자가 실제로 구할 수 없는 데이터**
- **환율 이력이 없다.** FxDaily는 recordTodayFx(market.ts 208행)뿐이고 backtestReport는 환율이 없으면 현재 환율로 대신한다. 3 · 5년 백테스트에서 미국 자산의 원화 수익이 틀린다. → 환율 이력 확보(또는 통화별 분리 + 경고)를 P0 선결 과제로.
- **'유니버스 = Trait'는 스크리너가 아니다.** 시장 전체 종목 목록 · 펀더멘털 데이터가 없어 '가치주 유니버스', '마법공식 상위 30종목'은 만들 수 없다. → v1 유니버스는 명시 심볼 목록(상한 30).
- **배당 미포함**: PriceDaily는 가격만 담아 배당 전략과 벤치마크 비교가 왜곡된다. → 경고.
- **액면분할로 과거 가격이 어긋날 수 있다.** KIS는 수정주가로 받지만 backfillCloses는 한 번 채운 심볼을 최근 2주만 다시 받는다(market.ts 187행). 나중에 분할이 일어나면 과거 행이 옛 기준으로 남아 가짜 급락이 생길 수 있다(코드 추론, 실데이터 미확인). 낙폭 브레이크 · 청산 신호가 잘못 발동한다. → 가격 점프 검사와 전체 재백필. PriceDaily는 공용이고 upsert가 source를 덮어써 브로커별 기준이 섞일 수 있다.
- **과거 데이터 길이**: KIS 국내 140일 창 × 최대 30회(약 11년), 해외 100행 × 최대 15쪽(약 6년). runDailyForUser는 36개월까지만. 다른 브로커 범위는 미확인.
- **성과 순위를 매긴 외부 소스는 없다.** skills.sh installs와 GitHub 별 수는 인기 지표다. 비인증 GitHub API(시간당 60회로 알려짐, 미확인)를 repoFiles와 함께 써서 별 수 수집은 P2로. 'investor' 카테고리 정규식은 철학 필터로 쓸 수 없다. 무위험수익률 출처가 없어 샤프는 rf = 0 또는 사용자 입력.

**[3] 안전 · 보안 · 법규**
- 주문과 LLM 사이 경로가 닫혀 있지 않았다(LLM이 외부 본문을 읽고 propose_*를 부르는 경로). → 종목 · 방향 · 금액은 닫힌 스키마 규칙의 결정적 평가로만. LLM은 설명만. 외부 텍스트를 규칙으로 자동 변환하지 않고 사용자가 폼에서 확인한 값만 저장.
- **allowedTools는 효과가 없다.** runTool은 이름만 보고 ALL_TOOLS에서 찾아 실행한다(tools.ts 694행). → 철학별 도구 권한을 없애고 '외부 텍스트는 권한이 없다'를 원칙으로. 필요하면 runTool 안에서 검사해야 한다.
- **AiAction은 대화 없이 못 만든다**(conversationId · toolUseId 필수, schema 842행~). → 버전 초안 자체를 승인 게이트로 쓰고, AiAction은 대화 안 제안(strategy_draft)에만.
- **주문 권한**: KIS 앱키는 조회 · 주문 권한을 나누지 않는 것으로 알려져 있다(미확인). → 이 영역은 주문 코드와 AUTO 모드를 만들지 않고 planRebalance만 넘긴다.
- **인젝션 정적 검사가 기존 스킬 가져오기에도 없다.** → 공통 lint를 만들어 스킬 가져오기에 먼저 적용. refreshSkill이 사용자 지침을 덮어쓰므로 contentHash와 diff 미리보기.
- **법규**: 공개 리더보드 · 성과 게시 · 공유는 유사투자자문 · 투자자문 소지가 있다(미확인). → 범위 밖(P2), 개인 범위만.

**[4] 우선순위 · 노력**
- 초안 MVP(L + M + XL + M + M + L)를 2~3주에 하겠다는 계획은 불가능했다. → v1을 정적 배분(비중, 리밸런싱, 비용, 한도)으로 줄였다. 기존 backtest()에 비용 · YEARLY · 다음날 체결 · 통화 처리만 더하면 된다. 진입 · 청산 신호 DSL은 P2.
- Deflated Sharpe와 기간 가중 점수는 사용자 한 명이 전략 몇 개를 비교하기엔 과하다. → P2. MVP는 지표 표와 경고만.
- 결정적 매핑(버핏 → 회전율 0.2 등)은 근거 없는 수치다. → AI 초안 + 사용자 편집(P1).
- A등급은 페이퍼 12개월 뒤에야 의미가 있어 P2로. 반대로 페이퍼 운용은 기록이 쌓이는 데 시간이 걸려 P0으로 올렸다.
- 승격 게이트, 괴리 추적 · 자동 강등, AUTO는 오토파일럿 영역으로 넘겼다. startCapital(1억)은 정수 주 반올림을 하지 않는 한 지표와 무관해 없앴다.

**[5] Prisma 모델**
- ShadowPortfolio가 philosophyId와 versionId를 둘 다 가져 어긋날 수 있었다. → versionId만.
- '불변' 버전의 status를 DRAFT → ACTIVE로 고치는 구조라 ACTIVE가 여럿 생길 수 있었다. → `Strategy.activeVersion`(Int) 포인터 하나. 순환 FK는 피했다.
- PhilosophyBinding → version이 onDelete Cascade라 버전을 지우면 바인딩이 조용히 사라졌다. → `Portfolio.strategyVersionId` onDelete Restrict.
- 바인딩 `@@unique([portfolioId])`인데 Portfolio 역관계가 리스트였다(validate는 통과하나 의미상 1:1). → 별도 테이블 대신 Portfolio 필드 하나.
- 그 밖에: 중복 인덱스(`@@index([userId])`와 `@@unique([userId, name])`), versionId 인덱스 누락, PhilosophyVersion.userId 중복, 관계 없는 shadowId 문자열, AiSkill에서 복제한 installs · stars 정리.

---

### 2.4 그 밖에 추가할 만한 서비스 (EX)

순자산 · 부채, AI 운용 위임, 운용 전략을 뺀 나머지다. 보안 · 가입 통제, 데이터 보존(백업), 모바일 접근, 절세 계좌, 은퇴 인출, 가계부, 정기 리포트, 캘린더, 스트레스 테스트, 보험, 가구 명의를 다룬다. ID는 리뷰 과정의 번호를 유지해 순서가 건너뛴다(EX-01a/b, EX-02~EX-12).

#### 현재 있는 것 (PR #25 기준)

- **인증** (`src/server/auth.ts`): 쿠키 ppfp_session, 30일, Session.id에 토큰 sha256 저장. Session 열은 id, userId, expiresAt, createdAt뿐이라 기기 정보도 2단계 인증도 없다. middleware.ts는 없고 화면과 route handler가 모두 currentUser() / requireUser()를 거친다. 크론만 Bearer를 받는다(`src/server/cron-auth.ts`).
- **가입 · 로그인** (`src/app/actions.ts` signupAction / loginAction): **가입 제한(초대 · 닫기)이 없고 로그인 시도 제한도 없다.** src 전체에 rate limit 코드가 없다. 서버에 공용 fallback 키(DATA_GO_KR_API_KEY, KAKAO_REST_API_KEY, VWORLD_API_KEY)가 있다.
- **암호화**: `crypto.ts` encryptSecret / decryptSecret(APP_ENCRYPTION_KEY)은 DB 저장값용, `key-vault.ts`는 사용자 암호로 잠그는 백업 파일 형식.
- **감사 · 설정**: AuditLog는 있지만 쓰는 곳이 `portfolios.ts:23` 한 곳이고 볼 화면이 없다. AppSetting(전역 설정)이 있다.
- **푸시**: Web Push만(`push.ts`, PushSubscription endpoint/p256dh/auth). NotificationKind는 `notify.ts`의 TS 유니언(PRICE · DRIFT · TEST · BRIEFING · REALESTATE).
- **배포**: Dockerfile, docker-compose.yml(postgres:16, 볼륨 db-data). **DB 백업 스크립트는 없다.** 키 백업(`key-backup.ts`)만 있다.
- **데이터 입출력**: `data-io.ts`(exportSheet, readUpload, importData)는 목표 비중, 알림, 자산 성질, AI, 증권사 연결을 옮기지 않는다. JournalImage는 DB Bytes.
- **세금**: `domain/tax.ts` · `services/tax.ts`는 해외주식 양도세와 금융소득만. Portfolio에 계좌 종류가 없다. Portfolio는 PortfolioEdge 그래프의 노드이고 거래(Transaction.flow)는 포트폴리오에 붙는다.
- **목표**: Goal(target, targetDate, monthly, portfolioId, expectedReturn, volatility, realTerms)과 `domain/goals.ts` simulateGoal(2,000경로, 적립 단계만). UI `goals-tabs.tsx` · `goals.tsx`, 액션 `goal-actions.ts`.
- **성과 · 스냅샷**: `performance.ts` performanceReport, `snapshots.ts` rebuildSnapshots, Snapshot(value, flow, cash, holdings).
- 배당 달력은 `domain/dividends.ts`. 가계부, 보험, 가구 공유, 리포트 화면은 없다.
- **AI**: AiAction은 conversationId · toolUseId가 필수인 대화 안 승인 흐름. `ai/providers.ts`에 PDF 입력이 없다. 아침 브리핑은 `ai/background.ts`, 설정은 AiSettings.briefing*.
- 증권사 어댑터는 모두 읽기 전용이다.

#### 기능 명세표

| ID | 기능 | 설명 | 사용자 가치 | 우선순위 | 노력 | 데이터 출처 | 재사용 | 위험 |
|---|---|---|---|---|---|---|---|---|
| EX-02 | 계정 보안: 가입 통제 · 로그인 시도 제한 · 2단계 인증 · 로그인 기기 | MVP 네 가지. ① 가입 제한: AppSetting `signup = open / invite / closed`, 기본 closed, 첫 사용자만 예외. ② 로그인 시도 제한: IP · 이메일별 5회 실패 뒤 지수 대기(단일 프로세스라 메모리 맵). ③ TOTP: RFC 6238, node:crypto, ±1 스텝, totpLastStep으로 재사용 차단. 복구 코드 10개는 sha256 저장. ④ Session 확장(kind, name, userAgent, ip, lastSeenAt 5분 간격, mfaAt)으로 로그인 기기 목록 · 원격 로그아웃, 새 기기 로그인 알림(SECURITY). 민감 작업(키 백업, 증권사 연결, 비밀번호 변경, AI 실주문 위임 켜기)은 10분 안 2단계 인증 재확인. 2단계에서 AuditLog 범위 확대와 활동 기록 화면. | 지금 서버를 인터넷에 열면 누구나 가입해 공용 키를 쓰거나 비밀번호를 무차별 대입할 수 있다. 증권사 키를 들고 AI 실주문까지 붙을 앱의 최소 방어선이다. | P0 | M | 내부만. 외부 API 없음 | `auth.ts` createSession · currentUser, `crypto.ts` encryptSecret · sha256 · newToken, `actions.ts` signupAction · loginAction, AppSetting, AuditLog(`portfolios.ts:23` 패턴), `key-backup.ts` 비밀번호 재확인, `notify.ts`, `settings/page.tsx` | 복구 코드 분실 대비 관리자 해제 스크립트(`npm run user:reset-2fa`). QR 라이브러리가 없어 otpauth URI가 기본, QR은 선택. 기존 세션은 '알 수 없는 기기'. 시도 제한은 재시작하면 초기화된다. |
| EX-12 | DB 정기 백업(운영) | `scripts/backup-db.sh`(pg_dump -Fc)와 docker-compose 사이드카 또는 호스트 cron 예시. N개 보관, 호스트 바깥(외장 디스크, rclone 등)으로 복사 안내. 복원 절차(pg_restore → prisma migrate deploy → 기동) 문서화. `.env`의 APP_ENCRYPTION_KEY를 따로 보관해야 증권사 secret을 복호화할 수 있다고 명시. `/data`에 '마지막 DB 백업 시각'만 표시(스크립트가 AppSetting에 기록). | DB 유실에 대한 직접적인 답이다. 지금 db-data 볼륨에는 백업이 없다. | P0 | S | 로컬 Postgres(pg_dump), 외부 저장 위치는 사용자가 고름 | docker-compose.yml, package.json scripts, AppSetting, `data/page.tsx` | 백업 파일에 전 재산 내역이 평문으로 들어 있어 age · gpg 암호화를 권장한다. `.env`와 같은 곳에 두지 않는다. 실제 복원 리허설 절차를 둔다. |
| EX-01a | 안드로이드 앱(TWA 래핑) | PWA(`manifest.ts`)를 Trusted Web Activity로 감싼다. 쿠키 세션, 서버 액션, Web Push를 그대로 쓴다. 서버 작업은 `/.well-known/assetlinks.json` 추가와 HTTPS · COOKIE_SECURE 안내뿐. 키는 서버에만 있어 '로그인만 하면 동작' 요구를 만족한다. EX-02가 먼저다. | 안드로이드 앱을 가장 싸게 실현하고 웹 기능을 모두 그대로 쓴다. | P1 | S | 기존 웹 앱, Bubblewrap 같은 TWA 빌드 도구 | `src/app/manifest.ts`, `src/server/push.ts`, 기존 화면 전체 | 서버를 인터넷에 열어야 하므로 EX-02와 HTTPS가 전제다. TWA의 Web Push 동작은 기기마다 다를 수 있다(미확인). |
| EX-01b | 네이티브 앱용 Bearer 토큰 · FCM (보류 후보) | TWA로 부족할 때만. currentUser()가 `Authorization: Bearer`도 읽고 Session.kind APP으로 저장(id = sha256(토큰), 30일 슬라이딩). `POST /api/auth/token`(이메일, 비밀번호, TOTP)으로 발급, 기기 목록에서 폐기. 서버 액션으로만 된 쓰기는 서비스로 옮긴 뒤 route handler 추가. FCM은 PushSubscription.channel FCM. | 네이티브 UI(위젯, 생체 인증 잠금)가 필요할 때의 경로다. | P2 | L | 기존 DB, FCM HTTP v1(서비스 계정은 .env) | `auth.ts`, `crypto.ts`, `cron-auth.ts`(timingSafeEqual), 기존 `src/app/api/*`, `push.ts` · `notify.ts` | 로직을 API에 복제하면 서로 어긋난다. refresh 회전은 Session PK 분리 마이그레이션이 필요하다. 토큰 발급에도 시도 제한, 토큰은 Android Keystore에. |
| EX-03 | 절세 계좌(ISA · 연금저축 · IRP) 트래커 | 거래가 달린 포트폴리오를 절세 계좌로 지정(TaxAccount 1:1). 올해 납입액 = DEPOSIT flow 합 − 옮기기 flow, 앱 이전 납입은 priorContrib. TaxYearProfile(총급여 구간)로 연금저축 + IRP 합산 세액공제 예상액과 남은 한도. ISA는 계좌 내 순이익 대비 비과세 한도, 초과분 분리과세 예상, 만기 D-day, 연금 이전 추가공제. 11~12월 '한도 남음' 알림(TAX). 상수는 `src/domain/tax-accounts.ts`에 연도별 · 출처와 함께. | 가장 확실한 수익인 절세를 기존 거래 데이터만으로 바로 보여 준다. | P1 | M | 내부 Transaction.flow, LotConsumption, 배당, 세법 상수(연금저축 600만, IRP 합산 900만, 공제율 16.5%/13.2%는 2026년 기준 미확인. 2026년 ISA 확대도 미확인이라 사용자가 고름) | `domain/tax.ts` taxYear, `services/tax.ts` taxReport, `services/dividends.ts`, `tax/page.tsx`(탭), `domain/portfolio-graph.ts`, get_tax_summary 확장, `notify.ts` | 세법이 매년 바뀌고 예외(ISA 내 국내 상장 해외 ETF, 중도 인출, 미납입 한도 이월)가 많다. 상위 노드를 지정하면 이중 집계되므로 막는다. 소득은 Boolean 구간 하나만 받고 모든 값에 '예상치' 고지. |
| EX-04 | 은퇴 · 노후 인출 시뮬레이션(Goal 확장) | Goal.kind RETIREMENT에 1:1 RetirementPlan. 은퇴일 = Goal.targetDate, 자금 목표 = target, 적립액 = monthly, 수익률 · 변동성 · 물가는 기존 Goal 필드. Plan에는 출생 연도, 은퇴 · 기대 수명 나이, 은퇴 후 월 생활비(오늘 가치), 연금 소득 행, 인출 전략(정액, 정률, 가드레일). simulateGoal 경로에 인출 단계를 이어 고갈 확률, 고갈 나이 분포, 남는 자산 중앙값, 지속 가능한 월 생활비(이분 탐색). | '몇 살에 은퇴할 수 있나', '한 달에 얼마까지 써도 되나'에 답하고 기존 목표 화면 · AI 도구를 재사용한다. | P1 | M | 내부 자산, 사용자 입력, 국민연금 예상액 수기(공개 API 미확인) | `domain/goals.ts` mulberry32 · ASSUMPTIONS · mixAssumptions · simulateGoal, `services/goals.ts` goalViews, `goal-actions.ts`, `goals-tabs.tsx` · `goals.tsx`, get_goals, `goals.test.ts` | 가정에 민감하므로 '가정이지 예측이 아님' 고지. 연금 세제 · 건강보험료는 단순화. 가계부 전까지 적립액은 수기 값, 부채 상환은 NW 모델 확정 뒤 연결. |
| EX-05 | 현금흐름 · 가계부 | MVP(M): CashflowEntry(kind + 양수 금액), 2단 분류, 카드 · 은행 엑셀/CSV 가져오기(열 매핑 → 미리 보기 → 중복 건너뜀, externalRef = sha256(계좌, 날짜, 금액, 가맹점, 순번)), 월 요약(수입, 지출, 저축률, 분류 도넛, 12개월 막대). 투자 계좌 입금은 txnId 1:1로 이어 '저축 → 투자'로 세고 지출에서 뺀다. 2단계: 예산, 정기 지출(RecurringItem), 키워드 자동 분류, 대화 안 propose_cashflow_categories. 12개월 평균 저축액은 EX-04 적립액 제안값. | 순자산(스톡)에 더해 매달 얼마가 남는지(플로)를 보여 주고, 목표 시뮬레이션의 적립액을 실제 값으로 바꾼다. | P1 | L | 수기 입력, 카드사 · 은행 내역 파일(오픈뱅킹 · 마이데이터는 허가 사업자 대상이라 안 씀) | `data-io.ts` readUpload, `domain/holdings-paste.ts`, `domain/csv.ts`, `domain/dividends.ts` cashflow, `components/charts.tsx`, `period-bar.tsx`, `ai/actions.ts`(2단계) | 카드사별 형식 차이(사용자 샘플 필요). 카드 대금 출금이 이중으로 잡히지 않게 TRANSFER. 민감 내역이 섞여 AI로는 가맹점명 · 금액만 보내는 옵션. **NW-12 · NW-13과 겹친다(3장).** |
| EX-06 | 월간 · 분기 자산 리포트 | 매월 1일(선택: 분기, 연말) 지난 기간 리포트를 계산해 Report.data(formatVer 포함)에 고정. 순자산 변화의 입금 · 시장(환율 포함) 분해, TWR 대 벤치마크, 기여도 상 · 하위, 배당 · 이자, 실현손익과 예상 세금, 목표 확률 변화, 일지 적중률, (가계부가 있으면) 저축률. 알림함과 푸시(REPORT), `/reports/[period]`는 인쇄 CSS로 PDF 저장. AI 코멘트는 브리핑 실행기. 이메일은 보류. | 한 달에 한 번 정리된 자산 기록을 받고, 쌓이면 자산 일기가 된다. | P1 | M | 내부 Snapshot, 성과, 배당, 세금, 목표, 일지 | `performance.ts`, `dividends.ts`, `tax.ts`, `goals.ts` goalViews, `snapshots.ts` rebuildSnapshots, `ai/background.ts`, `alert-loop.ts`, `notify.ts`, Notification.aiConversationId 패턴, `charts.tsx` | 스냅숏에 빈 날이 있으면 분해가 틀어져 먼저 rebuildSnapshots. 환율 효과 분리는 2단계. 옛 리포트는 formatVer별로 렌더링. |
| EX-07 | 경제 · 투자 캘린더 | MVP(S): 예상 배당일, 일지 목표 기한, 목표 기한, ISA 만기, 세금 고정일, 규칙으로 계산한 옵션 만기일(국내 둘째 목요일, 미국 셋째 금요일), 사용자 일정(CalendarEvent)을 한 달력에. D-n 알림(CALENDAR)은 remindedDays로 중복 방지, 아침 브리핑이 '오늘 일정'을 읽는다. 2단계: 공유 MarketEvent(FOMC · 금통위 연간 시드, DART 공시를 서버 env 키로 수집). | 흩어진 기한과 배당 · 만기를 한눈에 보고 미리 알림을 받는다. | P2 | M | MVP는 내부 데이터와 날짜 규칙. 2단계 DART OpenAPI(무료 키, 한도 미확인), FOMC · 금통위 공식 공지(API 없음, 시드) | `domain/dividends.ts` forecast, JournalEntry.targetDate, Goal.targetDate, TaxAccount.maturityAt, `alert-loop.ts`, `notify.ts`, `ai/background.ts`, `services/api-usage.ts` | MarketEvent는 서버 키 하나로 모은다. KST · ET 시간대 처리, 외부 일정에 출처 · 시각 표시. NW-07 일정과 겹친다(3장). |
| EX-09 | 시나리오 · 스트레스 테스트 | MVP(S): 저장 없는 계산 화면. 슬라이더로 주식(국내 · 미국), 원/달러, 아파트, 코인, 채권, 금리(변동금리 부채 이자)를 움직여 순자산과 월 이자 부담 변화를 본다. 역사 시나리오(2008, 2020년 3월, 2022년)는 출처를 단 정적 낙폭 표(`src/domain/stress.ts`). 국면별 노출, AI 도구 get_stress_test. | 분산 효과와 집값 · 금리 동시 충격에 대한 내성을 숫자로 확인한다. | P2 | M | 내부 보유, FxDaily, 부동산 추정 시세, 정적 시나리오 표 | `asset-book.ts` · `analytics.ts`(LIABILITY 부호), `domain/goals.ts` ASSUMPTIONS, `domain/traits.ts`, `real-estate.ts`, `ai/tools.ts` | 상관관계 · 듀레이션을 단순화하므로 과신하지 않게 고지. 부채 금리는 NW 규격(LoanRate)에 의존. PriceDaily에 과거 위기 데이터가 없다는 점 명시. |
| EX-11 | 보험 계약 · 보장 정리(수기) | 계약(보험사, 상품, 피보험자, 종류, 월 보험료, 기간, 해지환급금)과 보장 항목을 수기로 등록하고 피보험자 × 분류 매트릭스로 빈칸 · 중복 표시. 해지환급금은 ALTERNATIVE 수기 자산으로 순자산에 넣고, 보험료는 EX-05 2단계 정기 지출과 연결. PDF AI 추출은 providers.ts에 문서 입력이 생긴 뒤 별도 작업. | 큰 고정비이자 위험 관리 축인 보험을 자산 현황 옆에서 보고 과보장을 줄일 근거로 쓴다. | P2 | M | 수기 입력(내보험다보여 · 보험 마이데이터는 안 씀, 개인 API 미확인) | `services/assets.ts`, Asset.meta, Notification, EX-05 RecurringItem | 상품 권유는 보험업법상 모집으로 오해될 수 있어 분석만. 병력은 저장하지 않고 보장 금액만. PDF를 외부 AI로 보내려면 동의(2단계). **NW-11 InsurancePolicy와 겹친다(3장).** |
| EX-10 | 가구 명의 라벨(본인 · 배우자 · 공동) | 내 계정 안에서 포트폴리오에 명의(SELF, SPOUSE, JOINT)와 내 지분을 표시하고 대시보드에 '나 · 가구' 전환. '나'는 SELF + JOINT × 지분, '가구'는 전체. 다중 계정 공유(Household, 초대, 권한 계층)는 보류. | 부부 합산 순자산을 권한 리팩터링 없이 바로 본다. | P2 | S | 내부 DB | Portfolio, `domain/portfolio-graph.ts`, `analytics.ts` · `snapshots.ts`, 대시보드 전환 UI | 배우자 자산을 배우자 동의 없이 기록하게 되므로 안내 문구. 다중 계정 공유는 모든 서비스에 권한 검사를 넣는 XL 작업이고 누락되면 데이터가 샌다. |
| EX-08 | 계정 전체 JSON 내보내기 · 이전 | 다른 서버로 옮길 때 쓰는 계정 단위 스냅숏. data-io가 빠뜨리는 목표 비중, 알림, 성질, 목표, AI 설정 · 스킬 · 대화, JournalImage(base64)를 버전 붙은 JSON 하나에 담고 key-vault 형식으로 잠근다. 복원은 빈 계정에만, ID 재부여, 미리 보기. PENDING AiAction은 DISMISSED로, 증권사 토큰은 빼고, 키는 key-backup으로 따로. 자동 백업은 EX-12가 맡는다. | 서버 이전 때 빈칸 없이 옮긴다. | P2 | M | 내부 DB | `data-io.ts`, `key-backup.ts`, `key-vault.ts` sealVault · openVault, `snapshots.ts` rebuildSnapshots, `data/page.tsx` | formatVersion별 마이그레이터가 필요하고 이미지로 파일이 커질 수 있다. 승인 대기 항목은 반드시 무력화. |

#### 화면

- **EX-02**: `/settings` '보안' 카드(2단계 인증 켜기: otpauth URI · secret 표시와 코드 확인, 복구 코드 보기 · 재발급, 가입 방식: 열기 · 초대 · 닫기, 첫 사용자 전용). `/settings/security` 로그인 기기 목록(이름, 웹/앱, 마지막 접속, IP, [로그아웃], [다른 기기 모두 로그아웃]). 로그인 화면에 TOTP 단계, 민감 작업 앞에 재인증 모달. 2단계에 `/settings/activity`(활동 기록 표).
- **EX-12**: `/data`에 '마지막 DB 백업' 표시와 설정 방법 링크.
- **EX-01a**: UI 변경 없음, `/.well-known/assetlinks.json`만. EX-01b는 `/api/auth/token`과 기존 `/api/*`의 Bearer 인증.
- **EX-03**: `/tax` '절세 계좌' 탭. 계좌 카드마다 종류, 올해 납입/한도 진행 막대, 남은 한도, 예상 세액공제, ISA 비과세 한도 대비 순이익, 만기 D-day. 연도별 소득 구간 입력, 상수 출처 · '미확인' 표시. 포트폴리오 편집에 '계좌 종류'(거래가 달린 포트폴리오만).
- **EX-04**: `/goals` 목표 추가에 '은퇴'(`goals-tabs.tsx`). 입력: 나이, 생활비, 연금 소득 행, 인출 전략. 결과: 고갈 확률, 지속 가능한 월 생활비, 나이별 분위수 띠 차트(적립 → 인출 구간 색 구분).
- **EX-05**: `/cashflow`(새 메뉴 '가계부'). 월 선택(PeriodBar), 수입 · 지출 · 저축률 카드, 분류 도넛, 12개월 막대, 내역 표(분류 인라인 변경, 찾기). `/cashflow/import`(파일 → 열 매핑 → 미리 보기 → 저장), `/cashflow/categories`. 2단계 `/cashflow/recurring`과 예산 막대.
- **EX-06**: `/reports`(기간, 순자산 변화, 수익률), `/reports/[period]`(요약 카드, 변화 분해 워터폴, 기여도, 배당 · 세금, 목표 확률, AI 코멘트, [인쇄 · PDF]). 설정에 '월간 리포트 받기' 토글.
- **EX-07**: `/calendar`(월 보기, 목록 보기, 유형 필터, 내 일정 추가, D-7/D-1 알림 선택). 대시보드에 '이번 주 일정' 카드.
- **EX-09**: `/performance` '시나리오' 탭. 충격 슬라이더, 역사 시나리오 버튼, 순자산 전후 비교, 유형별 손실 막대, 월 이자 변화, 국면별 노출, 출처와 한계 고지.
- **EX-11**: `/assets` 아래 '보험' 탭. 계약 목록(월 보험료 합계), 피보험자 × 보장 분류 매트릭스(빈칸 빨강, 중복 주황), 계약 추가 폼.
- **EX-10**: 포트폴리오 편집에 명의 · 지분, 대시보드 위쪽 '나 · 가구' 전환.
- **EX-08**: `/data` '계정 전체 내보내기 · 이전'(암호 입력, 파일, 복원 미리 보기 표).
- 모든 새 화면은 CLAUDE.md 규칙대로 사용설명서 장, 기능 이력, `capture.ts` SHOTS, `seed-demo.ts` 데모 데이터를 같이 갱신한다.

#### 데이터 모델

이 영역 초안은 계획 · 가계부 금액에 `Decimal(24,2)`를 썼다. 스키마 머리말 규칙은 Money `Decimal(24,6)`이므로 구현 때 하나로 맞춘다(3장 표 참고).

```prisma
// ── 기존 모델 변경 ──
// model User {
//   ...
//   /// TOTP secret, encrypted with encryptSecret (APP_ENCRYPTION_KEY) like broker secrets; null = 2단계 인증 꺼짐
//   totpSecretEnc  String?
//   totpEnabledAt  DateTime?
//   /// Last accepted 30s step, so a code can't be replayed
//   totpLastStep   Int?
//   /// 월간 리포트 받기 (EX-06)
//   monthlyReport  Boolean   @default(false)
//   recoveryCodes  RecoveryCode[]
//   taxAccounts    TaxAccount[]
//   taxYears       TaxYearProfile[]
//   cashflowCategories CashflowCategory[]
//   cashflowEntries    CashflowEntry[]
//   cashflowBudgets    CashflowBudget[]   // 2단계
//   recurringItems     RecurringItem[]    // 2단계
//   reports            Report[]
//   calendarEvents     CalendarEvent[]
//   insurancePolicies  InsurancePolicy[]
// }
//
// model Session {
//   id          String    @id // sha256 of the cookie or bearer token
//   userId      String
//   expiresAt   DateTime
//   createdAt   DateTime  @default(now())
//   /// WEB (cookie) or APP (Authorization: Bearer, EX-01b)
//   kind        String    @default("WEB")
//   /// Label in 설정 > 로그인 기기, e.g. "Galaxy S25"
//   name        String?
//   userAgent   String?
//   ip          String?
//   /// Written at most every 5 minutes
//   lastSeenAt  DateTime  @default(now())
//   /// When the TOTP step was last passed; sensitive actions need it within 10 minutes
//   mfaAt       DateTime?
//   pushSubs    PushSubscription[]
//   user        User      @relation(fields: [userId], references: [id], onDelete: Cascade)
//   @@index([userId])
// }
//
// model PushSubscription {   // EX-01b에서만 변경
//   ...
//   /// WEBPUSH (endpoint + keys) or FCM (endpoint holds the registration token)
//   channel   String   @default("WEBPUSH")
//   p256dh    String?  // was required; push.ts must skip null for WEBPUSH rows
//   auth      String?
//   /// Logging out a device drops its push target too
//   sessionId String?
//   session   Session? @relation(fields: [sessionId], references: [id], onDelete: Cascade)
// }
//
// model Portfolio {
//   ...
//   /// 명의 for 가구 합산: SELF, SPOUSE, JOINT (a label, not an access grant)
//   owner      String   @default("SELF")
//   /// My share when owner = JOINT (1 = all)
//   ownerShare Decimal  @default(1) @db.Decimal(20, 10)
//   taxAccount TaxAccount?
// }
//
// model Transaction { ... cashflow CashflowEntry? }
// model Asset { ... insurancePolicies InsurancePolicy[] }
//
// model Goal {
//   ...
//   /// SAVING (적립 목표) or RETIREMENT (적립 후 인출, see RetirementPlan)
//   kind       String          @default("SAVING")
//   retirement RetirementPlan?
// }

// ── EX-02 계정 보안 ──
/// One-time recovery codes for 2단계 인증; only the sha256 is kept.
model RecoveryCode {
  id       String    @id @default(cuid())
  userId   String
  codeHash String    @unique
  usedAt   DateTime?

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
}

// ── EX-03 절세 계좌 ──
enum TaxAccountKind {
  ISA_GENERAL
  ISA_SEOMIN
  ISA_FARMER
  PENSION_SAVING
  IRP
}

/// Marks a portfolio that holds transactions as a tax-advantaged account.
/// Yearly contributions = its DEPOSIT flows (moves between portfolios excluded) + priorContrib.
model TaxAccount {
  id           String         @id @default(cuid())
  userId       String
  portfolioId  String         @unique
  kind         TaxAccountKind
  openedAt     DateTime       @db.Date
  /// ISA 의무가입 만기 (기본 개설 3년 뒤, 연장 가능)
  maturityAt   DateTime?      @db.Date
  /// Contributions before the app's records, KRW by year: { "2025": 20000000 }
  priorContrib Json           @default("{}")
  createdAt    DateTime       @default(now())
  updatedAt    DateTime       @updatedAt

  user      User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  portfolio Portfolio @relation(fields: [portfolioId], references: [id], onDelete: Cascade)

  @@index([userId])
}

/// Per-person, per-year tax inputs. 공제율·서민형 판정은 계좌가 아니라 사람 단위입니다.
model TaxYearProfile {
  userId    String
  year      Int
  /// 총급여 5,500만 원 이하 (종합소득 4,500만 원 이하) → 높은 공제율 (연도별 상수로 판정, 2026 기준 미확인)
  lowIncome Boolean @default(false)
  /// 앱 밖 연금계좌 납입 등 수기 보정 (KRW)
  extraPensionContrib Decimal @default(0) @db.Decimal(24, 2)

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@id([userId, year])
}

// ── EX-04 은퇴 인출 (Goal 1:1) ──
/// Drawdown part of a RETIREMENT goal. Saving phase uses Goal.monthly / expectedReturn / volatility / realTerms;
/// Goal.targetDate is the retirement date and Goal.target the money wanted by then.
model RetirementPlan {
  goalId       String  @id
  birthYear    Int
  retireAge    Int
  lifeAge      Int     @default(95)
  /// 은퇴 후 월 생활비 (오늘 가치)
  monthlySpend Decimal @db.Decimal(24, 2)
  /// FIXED, PERCENT, GUARDRAIL
  strategy     String  @default("FIXED")
  /// [{ label, startAge, monthly, indexed }] — 국민연금·퇴직연금·연금계좌·임대소득, validated by zod in src/domain
  incomes      Json    @default("[]")

  goal Goal @relation(fields: [goalId], references: [id], onDelete: Cascade)
}

// ── EX-05 가계부 ──
enum CashflowKind {
  INCOME
  EXPENSE
  TRANSFER
}

model CashflowCategory {
  id        String       @id @default(cuid())
  userId    String
  name      String
  kind      CashflowKind
  /// Two levels at most (대·소 분류)
  parentId  String?
  color     String       @default("#6B7280")
  /// 2단계: auto-classify when merchant or memo contains one of these
  keywords  String[]     @default([])
  sortOrder Int          @default(0)

  user      User               @relation(fields: [userId], references: [id], onDelete: Cascade)
  parent    CashflowCategory?  @relation("categoryTree", fields: [parentId], references: [id], onDelete: Cascade)
  children  CashflowCategory[] @relation("categoryTree")
  entries   CashflowEntry[]
  budgets   CashflowBudget[]
  recurring RecurringItem[]

  /// NULL parentId rows are distinct in Postgres; the service rejects duplicate top-level names
  @@unique([userId, kind, parentId, name])
  @@index([userId])
}

/// One income, spending or transfer line. `amount` is always positive; `kind` gives the direction.
model CashflowEntry {
  id           String       @id @default(cuid())
  userId       String
  date         DateTime     @db.Date
  kind         CashflowKind
  amount       Decimal      @db.Decimal(24, 2)
  currency     String       @default("KRW")
  categoryId   String?
  /// 카드·통장 이름
  account      String?
  merchant     String?
  memo         String?
  /// Investment deposit this line funded (counted as 저축, not 지출)
  txnId        String?      @unique
  recurringId  String?
  /// e.g. "file:신한카드_2026-09.xlsx"
  importSource String?
  /// sha256(account|date|amount|merchant|same-day seq) — card files rarely carry line ids
  externalRef  String?
  createdAt    DateTime     @default(now())

  user      User              @relation(fields: [userId], references: [id], onDelete: Cascade)
  category  CashflowCategory? @relation(fields: [categoryId], references: [id], onDelete: SetNull)
  txn       Transaction?      @relation(fields: [txnId], references: [id], onDelete: SetNull)
  recurring RecurringItem?    @relation(fields: [recurringId], references: [id], onDelete: SetNull)

  @@unique([userId, externalRef])
  @@index([userId, date])
  @@index([categoryId])
}

/// 2단계. Monthly budget per category; month "*" = every month, a "2026-10" row overrides it.
model CashflowBudget {
  id         String  @id @default(cuid())
  userId     String
  categoryId String
  month      String  @default("*")
  amount     Decimal @db.Decimal(24, 2)

  user     User             @relation(fields: [userId], references: [id], onDelete: Cascade)
  category CashflowCategory @relation(fields: [categoryId], references: [id], onDelete: Cascade)

  @@unique([categoryId, month])
  @@index([userId])
}

/// 2단계. A fixed monthly flow: 구독, 보험료, 대출 상환, 관리비, 월급.
model RecurringItem {
  id         String       @id @default(cuid())
  userId     String
  name       String
  kind       CashflowKind
  amount     Decimal      @db.Decimal(24, 2)
  categoryId String?
  /// 1–31; clamped to the month's last day
  dayOfMonth Int
  startsAt   DateTime     @db.Date
  endsAt     DateTime?    @db.Date
  /// What it pays for: INSURANCE (policy id) or LIABILITY (asset id); boundary with the 순자산·부채 area TBD
  linkKind   String?
  linkId     String?
  active     Boolean      @default(true)

  user     User              @relation(fields: [userId], references: [id], onDelete: Cascade)
  category CashflowCategory? @relation(fields: [categoryId], references: [id], onDelete: SetNull)
  entries  CashflowEntry[]

  @@index([userId])
}

// ── EX-06 정기 리포트 ──
/// A period report, computed once and kept as it was.
model Report {
  id               String   @id @default(cuid())
  userId           String
  /// MONTHLY, QUARTERLY, YEARLY
  kind             String
  /// "2026-09", "2026-Q3", "2026"
  period           String
  /// Shape of `data`, so old reports still render after the format changes
  formatVer        Int      @default(1)
  data             Json
  /// AI advisor conversation holding the comment (like Notification.aiConversationId)
  aiConversationId String?
  createdAt        DateTime @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, kind, period])
}

// ── EX-07 캘린더 ──
/// The user's own entries; 배당·일지·목표·만기·옵션 만기 dates are derived on read.
model CalendarEvent {
  id           String   @id @default(cuid())
  userId       String
  date         DateTime @db.Date
  title        String
  memo         String?
  /// Notify this many days before, e.g. [7, 1]
  remindDays   Int[]    @default([])
  /// Reminders already sent, so the loop doesn't repeat them
  remindedDays Int[]    @default([])
  createdAt    DateTime @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, date])
}

/// 2단계. Market-wide events shared across users (like PriceDaily), collected with a server env key.
model MarketEvent {
  id        String   @id @default(cuid())
  date      DateTime @db.Date
  /// "14:00" in `tz`; null = all day
  time      String?
  tz        String   @default("Asia/Seoul")
  country   String
  /// FOMC, BOK, CPI, JOBS, DISCLOSURE, EARNINGS
  kind      String
  title     String
  symbol    String?
  source    String
  sourceRef String

  @@unique([source, sourceRef])
  @@index([date])
  @@index([symbol, date])
}

// ── EX-11 보험 ── (NW-11 InsurancePolicy와 하나로 합칠 것, 3장)
model InsurancePolicy {
  id             String    @id @default(cuid())
  userId         String
  insurer        String
  product        String
  /// 피보험자 이름 (본인·배우자·자녀). 병력은 저장하지 않습니다.
  insured        String
  /// 종신, 정기, 건강, 실손, 연금, 저축, 자동차 ...
  kind           String
  /// 월 보험료
  premium        Decimal   @db.Decimal(24, 2)
  startedAt      DateTime  @db.Date
  payUntil       DateTime? @db.Date
  coverUntil     DateTime? @db.Date
  surrenderValue Decimal?  @db.Decimal(24, 2)
  /// Manual ALTERNATIVE asset carrying the 해지환급금 into net worth
  assetId        String?
  memo           String?
  createdAt      DateTime  @default(now())
  updatedAt      DateTime  @updatedAt

  user      User                @relation(fields: [userId], references: [id], onDelete: Cascade)
  asset     Asset?              @relation(fields: [assetId], references: [id], onDelete: SetNull)
  coverages InsuranceCoverage[]

  @@index([userId])
}

model InsuranceCoverage {
  id       String    @id @default(cuid())
  policyId String
  /// DEATH, CANCER, BRAIN, HEART, MEDICAL_EXPENSE, DISABILITY, HOSPITAL, SURGERY, OTHER
  category String
  name     String
  amount   Decimal   @db.Decimal(24, 2)
  until    DateTime? @db.Date

  policy InsurancePolicy @relation(fields: [policyId], references: [id], onDelete: Cascade)

  @@index([policyId])
}

// 삭제: DeviceToken(→ Session 확장), BackupSetting·BackupRun(→ EX-12 pg_dump 스크립트),
//       Household·HouseholdMember·HouseholdInvite·PortfolioShare(→ Portfolio.owner 라벨, 다중 계정 공유는 보류).
// TS만 변경: notify.ts NotificationKind에 'SECURITY' | 'REPORT' | 'CALENDAR' | 'TAX' 추가.
```

#### 외부 API

- **없음(MVP 대부분)**: EX-02 TOTP는 node:crypto HMAC-SHA1, EX-12는 pg_dump / pg_restore. EX-03 · 04 · 06 · 09 · 10 · 11 MVP는 내부 데이터만.
- **TWA(EX-01a)**: Digital Asset Links(`/.well-known/assetlinks.json`), Bubblewrap CLI(사용자 PC). Web Push(VAPID)는 기존 그대로.
- **FCM HTTP v1(EX-01b, 보류)**: `POST https://fcm.googleapis.com/v1/projects/{PROJECT_ID}/messages:send`. 서비스 계정 OAuth2(scope firebase.messaging), 서비스 계정 JSON은 `.env`(key-vault 아님).
- **DART OpenAPI(EX-07 2단계)**: `https://opendart.fss.or.kr/api/list.json`. 무료 인증키, 일일 한도 미확인. 서버 env 키 하나로 MarketEvent를 채우고 api-usage로 집계.
- **FOMC(federalreserve.gov) · 금통위(한국은행) 일정**: API가 없어 공식 공지를 연 1회 시드.
- **미국 실적 일정(Finnhub, FMP 등)**: 키가 필요하고 무료 한도 · 약관 미확인이라 보류.
- **오픈뱅킹 · 마이데이터(EX-05), 내보험다보여 · 보험 마이데이터(EX-11)**: 허가 사업자 대상이라 개인은 쓰지 않는다. 내역 파일과 수기 입력.
- **국민연금 예상액(EX-04)**: 공개 API 미확인이라 수기.
- **이메일(EX-06)**: 보류. 하게 되면 SMTP(nodemailer) 또는 Resend를 새 의존성으로.
- **PDF 추출(EX-11 2단계)**: `ai/providers.ts`에 문서 입력(Anthropic document 블록 등)을 먼저 추가해야 한다. 지금은 없다.

#### 안전 · 법규

- **가입 · 로그인(EX-02)**: 서버를 인터넷에 열기 전에 가입 닫기와 시도 제한이 필수다. 지금은 누구나 가입해 서버 공용 키(DATA_GO_KR, KAKAO, VWORLD)를 소진할 수 있다. TOTP 재사용 차단, 복구 코드는 해시만, 민감 작업은 10분 안 재인증과 AuditLog. AI 실주문 위임(AP)은 2단계 인증 켜기를 강제 조건으로 건다.
- **모바일(EX-01)**: 증권사 · AI 키는 앱으로 내려보내지 않고 서버에만. HTTPS와 `COOKIE_SECURE=true` 전제. Bearer 토큰은 해시만 저장, 기기별 폐기, 앱은 Keystore 보관.
- **백업(EX-12, EX-08)**: 백업에 전 재산 내역이 들어 있으므로 암호화와 외부 보관을 권장하고 `.env`와 같은 곳에 두지 않게 한다. 계정 복원 때 PENDING AiAction은 DISMISSED, 증권사 토큰은 넣지 않는다.
- **세금 · 연금 · 은퇴 · 스트레스(EX-03, 04, 09)**: '예상치 · 가정이지 예측이 아님' 고지. 세법 상수에 연도와 출처, 확인되지 않은 개정은 '미확인'으로 두고 사용자가 고른다. 개별 투자 권유가 아니라 계산 도구로 표기.
- **가계부(EX-05)**: 의료 · 종교 같은 민감 내역이 섞이므로 AI 분류는 가맹점명 · 금액만 보내는 옵션, 분류 제안은 대화 안 승인 흐름으로만 반영.
- **보험(EX-11)**: 보험업법상 모집으로 오해될 수 있는 상품 권유를 하지 않는다(**확인 필요**). 병력 같은 민감정보는 받지 않는다. PDF를 외부 AI로 보내려면 별도 동의.
- **가구 명의(EX-10)**: 배우자 자산 기록 시 안내 문구. 다중 계정 공유는 개인정보 제3자 제공 성격이고 권한 누락 위험이 커서 보류.
- **외부 일정(EX-07)**: 출처와 수집 시각 표시, 오류 가능성 고지.

#### 단계별 출시

- **0단계 · 즉시(1주)**: EX-12 DB 백업 스크립트와 문서(S), EX-02 MVP(가입 통제, 로그인 시도 제한, TOTP, 복구 코드, 로그인 기기 · 원격 로그아웃). 서버를 인터넷에 열기 전에, 그리고 AI 실제 운용 위임보다 먼저 끝낸다.
- **1단계 · 바로 가치가 나는 것(2~3주)**: EX-01a TWA(S), EX-03 절세 계좌(M), EX-04 은퇴 인출(M). 모두 기존 데이터만으로 동작하고 새 입력 부담이 적다.
- **2단계 · 플로 추가**: EX-05 가계부 MVP → EX-06 월간 리포트 → EX-07 캘린더 MVP. EX-02 활동 기록 화면도 이때.
- **3단계 · 계획 · 보완**: EX-09 스트레스 테스트, EX-11 보험(수기), EX-10 명의 라벨, EX-05 2단계(예산, 정기 지출, 키워드 규칙, 대화 내 AI 분류), EX-07 2단계(MarketEvent).
- **보류**: EX-01b 네이티브 토큰 API · FCM, EX-08 계정 JSON 이전, 다중 계정 가구 공유, 보험 PDF AI 추출, 리포트 이메일, 미국 실적 일정. 실제 필요가 확인될 때 다시 본다.

#### 열린 질문

1. 서버를 인터넷에 열 계획인가(TWA · 모바일 사용 시 필수)? 연다면 가입을 닫고 초대 방식으로 바꿔도 될까? 지금은 누구나 가입할 수 있다.
2. 서버는 혼자 쓰나, 가족 · 지인과 같이 쓰나? 1인용이면 가구는 명의 라벨(S)로 충분하고 다중 계정 공유(XL)는 보류한다.
3. 안드로이드를 TWA(S)로 시작해도 될까? 네이티브 위젯 · 생체 인증 잠금 요구가 있으면 EX-01b가 필요하다.
4. DB 백업을 어디에 둘까(외장 디스크, NAS, 클라우드 드라이브)? 백업 암호화 도구(age · gpg)를 써도 될까?
5. 절세 계좌 공제율 판정을 위해 연도별 총급여 구간(5,500만 원 이하 여부)만 받는 방식이 괜찮을까? 2026년 ISA 한도 확대 시행 여부는 미확인이다.
6. 가계부 입력원으로 어떤 카드사 · 은행을 쓰나? 엑셀 샘플이 있으면 열 매핑 프리셋을 먼저 만든다.
7. 대출 일정 · 금리를 어떤 모델로 둘지에 따라 RecurringItem(LIABILITY 연결), 스트레스 테스트, 은퇴 시뮬레이션 연동이 달라진다. (제안: NW 영역이 별도 Loan 모델로 정했으므로 그쪽에 맞춘다. 3장 참고)
8. 보험은 가족 피보험자까지 다룰까? 보험증권 PDF를 외부 AI로 보내는 것(2단계)에 동의하나?

#### 리뷰에서 고친 점

**[1] 기존 기능 · 모델과 겹치거나 무시한 설계**
- EX-01 DeviceToken은 Session과 같은 일을 하는 두 번째 세션 테이블이었다. PK가 access 토큰 sha256이라 토큰을 바꿀 때마다 PK가 바뀐다. → Session을 넓혀(kind, name, userAgent, ip, lastSeenAt, mfaAt) 쿠키와 Bearer를 같이 받는다. middleware.ts가 없고 모든 route handler가 currentUser() 하나를 거치므로, currentUser가 Authorization 헤더도 읽으면 기존 `/api/*`가 그대로 앱 API가 된다. FCM 토큰은 PushSubscription을 넓혀 담는다.
- 재사용 근거 오류: `key-vault.ts`는 사용자 암호로 잠그는 백업 파일 형식(scrypt, sealVault/openVault)이지 DB 저장값 암호화 도구가 아니다. → TOTP secret은 `crypto.ts` encryptSecret으로. FCM 서비스 계정은 VAPID처럼 `.env`.
- EX-04 RetirementPlan이 Goal과 나란히 선 모델이라 goal-actions, goals-tabs, goalViews, get_goals를 한 벌 더 만들어야 했다. → Goal.kind + 1:1 RetirementPlan(goalId PK).
- EX-03은 공제율 판정값을 계좌에 붙였지만 공제율 · 서민형 판정은 사람 · 연도 단위다(연금저축 + IRP 합산 한도). → TaxYearProfile. Portfolio는 그래프 노드라 상위 노드 지정 시 DEPOSIT flow 범위가 애매하고 '보유 자산 옮기기' flow를 납입으로 잘못 셀 수 있다. → 거래가 달린 노드만 지정, 옮기기 flow 제외.
- EX-05는 AI 분류에 대화 밖 AiAction을 쓰려 했지만 conversationId · toolUseId가 필수다. → 2단계로 미루고 대화 안 propose_* 도구로.
- EX-08의 '일지 이미지 파일'은 실제로는 DB의 JournalImage.data(Bytes)다. EX-11의 fileUrl은 파일 저장소가 없어 쓸 곳이 없다. providers.ts에 document · pdf 입력이 없다(grep 결과 없음). → 보험 MVP는 수기만, PDF 보류.
- EX-06은 서버리스를 가정했지만 실제 배포는 Dockerfile · docker-compose 직접 운영이다. 리포트 이메일을 AiSettings에 넣은 것도 맞지 않다(User.email이 이미 있음). → 이메일 보류, 받기 여부만 User.monthlyReport.
- NotificationKind는 Prisma enum이 아니라 TS 유니언이다. SECURITY · REPORT · CALENDAR · TAX는 코드에서 넓힌다.

**[2] 개인이 실제로 쓸 수 없는 데이터 출처**
- EX-09 'PriceDaily로 2008년 실제 낙폭'은 불가능하다(앱이 돌기 시작한 뒤에 쌓은 값). → 출처를 단 정적 낙폭 표.
- EX-07 공유 MarketEvent를 사용자별 ApiKey(DART)로 채우면 키 소유가 애매하다. 옵션 만기일은 규칙으로 계산된다. 미국 실적 API는 약관 · 한도 미확인. → MVP는 내부 일정과 규칙 일정, DART는 2단계에 서버 env 키 하나로.
- 오픈뱅킹 · 마이데이터 · 내보험다보여 배제 판단은 유지.

**[3] 안전 · 보안 · 법규**
- 초안이 놓친 실제 구멍: signupAction에 가입 제한이 없고 loginAction에 시도 제한이 없다(src 전체에 rate limit 없음). 공용 키(DATA_GO_KR_API_KEY, KAKAO_REST_API_KEY, VWORLD_API_KEY)를 모르는 사람이 소진하거나 비밀번호를 무차별 대입할 수 있다. → EX-02 MVP 첫 항목.
- TOTP 재사용 방지(totpLastStep)가 빠져 있었다. QR 라이브러리가 package.json에 없어 otpauth URI 기본. lastSeenAt은 요청마다가 아니라 5분 간격.
- 백업 복원 시 PENDING AiAction이 되살아나 낡은 제안이 승인 대기로 뜬다. → DISMISSED로 바꾸고 증권사 토큰은 넣지 않는다.
- 증권사 어댑터가 모두 읽기 전용이다(types.ts). 실주문 위임은 다른 영역이지만, 2단계 인증 켜기와 10분 안 재인증을 그 기능의 강제 조건으로 명시.
- refresh 회전은 Session.id(토큰 해시)를 PK에서 떼는 마이그레이션이 필요해 MVP에서 뺐다. 대신 30일 슬라이딩 토큰과 기기별 폐기.

**[4] 우선순위 · 노력 · MVP 크기**
- 'DB 유실'의 답은 운영 백업(pg_dump)이다. db-data 볼륨에 백업이 없다. → EX-12를 P0 · S로 신설, EX-08 계정 JSON은 이식성 용도로 P2. 서버 디스크에만 두는 자동 백업은 의미가 없어 외부 위치로 안내.
- EX-01 네이티브 API · FCM(L)을 P0로 둔 것은 과하다. → EX-01a TWA P1 · S, EX-01b 네이티브 P2 · L.
- EX-05 MVP가 너무 컸다. → 내역, 2단 분류, 파일 가져오기, 월 요약. 예산 · 정기 지출 · 키워드 규칙 · AI 분류는 2단계.
- EX-10 가구(XL)는 모든 서비스의 `where: {userId}`에 권한 계층을 넣어야 하고 누락되면 데이터가 샌다. → 명의 라벨(S), 다중 계정 공유 보류.
- EX-03 · EX-04는 기존 데이터만으로 값이 나와 가계부보다 먼저. EX-07 · EX-09 MVP는 S로 줄였다.

**[5] Prisma 모델**
- CashflowCategory `@@unique([userId, name])`는 다른 대분류 밑의 같은 이름을 막는다. → `[userId, kind, parentId, name]`. Postgres에서 NULL끼리는 다른 값이라 최상위 중복은 서비스에서 막는다.
- RecurringItem.categoryId에 relation이 없었다. → 관계와 역관계 추가.
- CashflowEntry가 금액 부호로만 방향을 나누면 TRANSFER를 구분할 수 없다. → kind 열, 금액은 항상 양수.
- txnId는 `@unique`(1:1)로, Transaction에 cashflow 역관계. 카드 파일에 줄 ID가 없는 경우가 많아 externalRef를 해시로 정의.
- InsurancePolicy.assetId에 relation이 없었다. → Asset 관계(SetNull), fileUrl 삭제.
- Household 계열은 역관계가 빠져 있었고 보류했으므로 삭제. DeviceToken은 Session 확장으로, BackupSetting · BackupRun은 삭제.
- CalendarEvent에 보낸 알림 기록이 없어 중복 알림이 갔다. → remindedDays.
- RetirementPlan에서 Goal과 겹치는 필드를 뺐다. AiSettings.reportEmail 대신 User.monthlyReport.

---

## 3. 영역 간 의존 관계

실선은 "먼저 있어야 한다", 점선은 "같은 것을 다루므로 하나로 합쳐야 한다"는 뜻이다. EX-12(DB 백업)는 모든 스키마 변경의 전제라 따로 그리지 않았다.

```mermaid
flowchart LR
  subgraph EXA["그 밖의 서비스 (EX)"]
    EX02["EX-02 계정 보안 · 2단계 인증"]
    EX01a["EX-01a 안드로이드 TWA"]
    EX03["EX-03 절세 계좌"]
    EX04["EX-04 은퇴 인출"]
    EX05["EX-05 가계부"]
    EX06["EX-06 월간 리포트"]
    EX07["EX-07 캘린더"]
    EX09["EX-09 스트레스 테스트"]
    EX11["EX-11 보험"]
  end

  subgraph NWA["순자산 · 부채 (NW)"]
    NW02["NW-02 대출 조건"]
    NW03["NW-03 REPAY 상환 기록"]
    NW01["NW-01 재무상태표"]
    NW07["NW-07 금융 일정 알림"]
    NW08["NW-08 건전성 지표"]
    NW09["NW-09 AI 재무 도구"]
    NW11["NW-11 연금 · 보험"]
    NW12["NW-12 현금흐름 계획"]
  end

  subgraph STA["운용 전략 (ST)"]
    ST01["ST-01 · 02 규칙과 버전"]
    ST03["ST-03 · 04 엔진과 데이터 점검"]
    ST05["ST-05 페이퍼 운용"]
    ST08["ST-08 포트폴리오 연결"]
    ST13["ST-13 랭킹 · 등급"]
  end

  subgraph APA["AI 운용 위임 (AP)"]
    AP01["AP-01 정책"]
    AP03["AP-03 사전검증 · 한도 예약"]
    AP10["AP-10 오염 판정"]
    AP06["AP-06 킬스위치"]
    AP04["AP-04 주문 카드 · 승인"]
    AP07["AP-07 내부 페이퍼"]
    AP02["AP-02 KIS 주문"]
    AP05["AP-05 체결 · 대사"]
    AP07B["AP-07B 승급 심사"]
    AP08["AP-08 자율 운용"]
    AP11["AP-11 전략 프로필"]
  end

  EX02 -->|"인터넷 공개 전"| EX01a
  EX02 -->|"재인증 공유"| AP04
  EX02 -->|"실전 주문 전"| AP02

  NW02 --> NW03 --> NW01
  NW02 --> NW07
  NW02 --> NW08 --> NW09
  NW01 --> NW09
  NW09 -->|"부채 · 현금 맥락"| AP08
  NW02 -->|"부채 금리"| EX09
  NW01 -->|"순자산 분해"| EX06
  NW11 -->|"연금 소득"| EX04
  NW07 -.->|"같은 일정"| EX07
  NW12 -.->|"합칠 것"| EX05
  NW11 -.->|"합칠 것"| EX11
  NW11 -.->|"계좌 유형"| EX03
  EX05 -->|"저축률"| EX06

  AP01 --> AP03 --> AP04
  AP10 --> AP04
  AP04 --> AP07 --> AP07B
  AP06 --> AP02
  AP04 --> AP02 --> AP05 --> AP07B
  AP07B --> AP08
  AP11 --> AP08

  ST01 --> ST03 --> ST05 --> ST13
  ST01 --> ST08
  ST08 -->|"planRebalance"| AP08
  ST05 -.->|"성적 원천 하나로"| AP11
  ST13 -.-> AP11
```

### 3.1 영역 간 겹침과 정리안

영역별 리뷰는 각 영역 안에서만 이뤄졌다. 영역을 가로지르면 아래가 겹친다. 정리안은 제안이고, 구현 전에 하나로 정한다.

| # | 겹치는 것 | 관련 | 정리안(제안) |
|---|---|---|---|
| 1 | 보험 모델이 두 벌이다. NW-11 InsurancePolicy(premiumCycle, `assetId @unique`, 환급금은 자산 VALUATION)와 EX-11 InsurancePolicy(insured, surrenderValue 필드, InsuranceCoverage)가 같은 이름으로 다르다. User 역관계도 겹친다. | NW-11, EX-11 | 모델 하나로 합친다. NW 원칙(환급금은 자산 원장, surrenderValue 필드 없음)에 EX의 insured와 InsuranceCoverage를 더한다. 자산 표시는 `Asset.kind = INSURANCE`로 통일한다(EX의 `meta.kind = 'insurance'` 대신). |
| 2 | 현금흐름 모델이 세 벌이다. NW-12 RecurringFlow, NW-13 CashEntry · CashRule, EX-05 CashflowEntry · CashflowCategory · RecurringItem · CashflowBudget. 둘 다 `/cashflow`를 쓴다. | NW-12, NW-13, EX-05 | EX-05 모델(kind + 양수 금액, 2단 분류, txnId 연결)을 기준으로 하나로 합친다. 12개월 전망(NW-12)은 그 위의 계산으로 둔다. 대출 납입은 RecurringItem(linkKind LIABILITY)이 아니라 Loan 스케줄에서 자동으로 합친다. |
| 3 | 개인 정보가 세 곳에 있다. FinancialProfile(birthYear, retireAge, annualIncome, region), RetirementPlan(birthYear, retireAge), TaxYearProfile(lowIncome). | NW-08, EX-04, EX-03 | 출생연도와 기본 은퇴 나이는 FinancialProfile 하나에 둔다. RetirementPlan은 목표별로 다른 값만 갖고 기본값은 프로필에서 읽는다. TaxYearProfile은 연도별 값이라 유지한다. |
| 4 | 연금 입력이 두 곳이다. PensionPlan(국민연금 · DB)과 RetirementPlan.incomes(국민연금 행). | NW-11, EX-04 | PensionPlan을 원천으로 두고 incomes는 PensionPlan을 참조한다. |
| 5 | 계좌 유형이 두 곳이다. `Portfolio.accountType`과 TaxAccount. | NW-11, EX-03 | TaxAccount 하나로 둔다. '잠긴 돈' 표시는 TaxAccount가 있는지로 판단한다. |
| 6 | 재인증 필드가 두 개다. `Session.stepUpUntil`(비밀번호 재입력)과 `Session.mfaAt`(TOTP). | AP-04, EX-02 | Session 확장 하나로 합친다. EX-02 전에는 비밀번호, 뒤에는 TOTP 재확인으로 step-up을 준다. |
| 7 | '페이퍼'가 두 가지다. AP-07은 AI 주문의 모의 체결(TradeOrder · OrderFill · PaperDaily), ST-05는 규칙의 결정적 재생(StrategyRun PAPER). AP-11 전략 프로필 · 리그와 ST-13 랭킹도 겹친다. | AP-07, AP-11, ST-05, ST-13 | 화면 이름을 나눈다: '모의 운용(AI 주문)'과 '전진 검증(규칙)'. 전략과 성적 비교의 원천은 ST(StrategyVersion · StrategyRun) 하나로 두고, AP-11은 정책에 StrategyVersion을 붙이는 연결만 맡는다. |
| 8 | 알림 종류가 일곱 개 늘어난다: FINANCE, TRADE, AUTOPILOT, SECURITY, REPORT, CALENDAR, TAX. NW-07 FINANCE와 EX-07 CALENDAR는 만기 · 납입일이 겹친다. | NW-07, EX-07, AP-05, AP-12, EX-02, EX-03, EX-06 | 캘린더는 NW 일정을 읽기만 하고, 같은 일정의 알림은 한 곳(FINANCE)에서만 보낸다. 알림 설정 화면에서 종류별로 끌 수 있게 한다. |
| 9 | 외부 키가 겹친다. ECOS는 NW(시장금리)와 ST-04(환율 이력)가 쓴다. DART는 EX-07(서버 env 키)과 ST-14(OpenDART)가 쓴다. | NW, ST-04, ST-14, EX-07 | ECOS는 ApiKey service `ecos` 하나를 공유한다. DART는 한 방식(서버 env 키 또는 사용자 ApiKey)으로 정한다. |
| 10 | 금액 정밀도가 다르다. 스키마 규칙은 Money `Decimal(24,6)`인데 EX 초안은 계획 · 가계부 금액에 `Decimal(24,2)`를 썼다. | EX-03 · 04 · 05 · 11 | 스키마 머리말 규칙(24,6)으로 맞춘다. |
| 11 | 경로 이름이 다르다. 명세는 `/networth`, `/ai/strategies`(모델 Strategy)인데 뼈대는 `/net-worth`, `/philosophies`다. | NW-01, ST-07 | 메뉴에 연결하는 커밋 전에 하나로 정한다(5장). |
| 12 | 사용설명서의 '주문은 내지 않습니다'(810 · 945 · 947 · 1071행 부근)와 AI 프롬프트 문구가 AP 출시와 충돌한다. | AP | AP Phase 1 출시 커밋과 같은 브랜치의 문서 커밋에서 고친다. |
| 13 | 실전 전환 순서. AP Phase 1이 실전을 여는데 PAPER → LIVE 승급 심사(AP-07B)는 Phase 2다. | AP-02, AP-07B | AP-07B의 PAPER → LIVE 부분을 Phase 1로 당길지 정한다. |

---

## 4. 전체 우선순위 Top 10

기준: 사용자 가치(상 · 중 · 하) ÷ 노력(S = 1, M = 2, L = 3, XL = 5)을 기본으로 하고, 다른 기능의 선행 조건이면 올렸다. 사용자가 요청한 두 축(순자산 통합, AI 운용 위임)을 우선했다.

| 순위 | ID | 기능 | 가치 | 노력 | 근거 | 먼저 필요한 것 |
|---|---|---|---|---|---|---|
| 1 | EX-12 | DB 정기 백업 | 상 | S | 지금 db-data 볼륨에 백업이 없다. 스크립트 하나로 모든 데이터의 유실 위험을 줄인다. 이후 모든 마이그레이션의 안전망이다. | 없음 |
| 2 | EX-02 | 계정 보안 MVP | 상 | M | 지금은 누구나 가입하고 비밀번호를 무차별 대입할 수 있다. 서버 공개, 안드로이드(TWA), 실전 주문이 모두 이것을 전제로 한다. | 없음 |
| 3 | NW-02 · NW-03 | 대출 조건과 REPAY 상환 기록 | 상 | L + M | 사용자 요청 1의 핵심이다. 앱 밖 돈 상환이 수익으로 잡히던 TWR 왜곡과 manualPrice 미복원 결함도 함께 고친다. | 없음 (EX-12 권장) |
| 4 | NW-01 | 재무상태표 `/networth` | 상 | M | 사용자가 매일 볼 화면이다. currentState · scopeWeights · 스냅샷을 재사용해 노력이 작다. | NW-02 · 03 |
| 5 | AP-03 · AP-10 | 사전검증 · 한도 예약 · 오염 판정 | 상 | M + S | 실주문의 안전을 결정하는 순수 함수다. 테스트로 경계값과 동시 제안을 덮을 수 있어 일찍 만들수록 좋다. | AP-01 |
| 6 | AP-01 · 04 · 06 · 07 | 정책, 주문 카드 · 승인, 킬스위치, 내부 페이퍼 (Phase 0) | 상 | M · M · S · M | 사용자 요청 2의 첫 단계다. 증권사 주문 코드 없이 돈 위험 없이 흐름 전체를 검증한다. | AP-03 · 10 |
| 7 | ST-01 · 02 · 03 · 04 · 05 | 정적 배분 규칙, 버전, 엔진, 데이터 점검, 페이퍼 운용 | 중상 | M · S · M · M · S | '좋은 철학을 성적으로 고른다'의 바탕이다. 페이퍼 기록은 시간이 지나야 쌓이므로 일찍 시작할수록 가치가 크다. 데이터 점검(환율 · 분할)이 없으면 숫자가 틀린다. | 없음 |
| 8 | NW-09 | AI 재무 도구(읽기 먼저) | 중상 | M | 두 축을 잇는다. 어드바이저가 부채 · 현금 조건을 알아야 운용 판단이 의미가 있다. | NW-01 · 02 |
| 9 | EX-01a | 안드로이드 TWA | 중 | S | 장기 계획(안드로이드)을 가장 싸게 시작한다. 웹 기능을 그대로 쓴다. | EX-02, HTTPS |
| 10 | AP-02 · AP-05 | KIS 국내 주문, 체결 반영 · 수량 대사 (Phase 1) | 상 | L + L | 실제 운용 위임의 첫 실전 단계다. 노력과 위험이 커서 마지막에 두었고, TR ID 등 미확인 항목을 모의 계좌로 먼저 확인해야 한다. | EX-02, AP-03 · 04 · 06 · 10, Phase 0 운영 |

바로 다음 후보: EX-03 절세 계좌(기존 데이터만으로 가치, M), EX-04 은퇴 인출(M), NW-08 건전성 지표(M), ST-07 전략 화면(1단계 MVP에 포함 예정), NW-14 loans 시트.

---

## 5. 이번에 만든 뼈대 코드 범위

이번 작업에서는 세 영역(순자산 · 부채, AI 운용 위임, 투자 철학 = 운용 전략)의 **뼈대**만 만들었다. EX 영역은 명세만 있고 코드는 없다. 아래는 이 문서를 쓰는 시점의 작업 트리 기준이다(아직 커밋 전).

### 5.1 성격

- **실험 화면이다.** `/net-worth`, `/autopilot`, `/philosophies`는 사이드바 메뉴에 연결하지 않았다. 주소를 직접 입력해야 열린다.
- **사용설명서에는 아직 넣지 않았다.** 메뉴에 연결하고 사용자가 쓰는 기능이 되는 커밋에서 CLAUDE.md 규칙대로 장, 기능 이력, 캡처를 추가한다.
- **실제 주문은 나가지 않는다.** 주문 라우터(`src/server/brokers/orders.ts`)는 페이퍼 라우터만 있다. LIVE는 거부하며, 실전 라우터(KIS order-cash부터)는 `AUTOPILOT_LIVE`, `AUTOPILOT_LIVE_USERS`, 연결의 tradeEnabled 뒤에 둘 예정이다.

### 5.2 영역별 파일

| 영역 | Prisma 모델 · 필드 | domain (+ 테스트) | service | action | page · 컴포넌트 |
|---|---|---|---|---|---|
| 순자산 · 부채 (NW 1단계 일부) | Loan, LoanRate, LoanPayment, RepaymentMethod, FinancialProfile, `Asset.kind`, `TxnType.REPAY`, `Transaction.loanPaymentId` | `src/domain/net-worth.ts` (상환 스케줄, 마통 일할 이자, 대출 상태, 가중평균 금리, 예금 만기 계산, 재무상태표 그룹, LTV · DSR), `__tests__/net-worth.test.ts` | `src/server/services/net-worth.ts` (재무상태표, 대출 조회 · 저장 · 삭제, 금리 이력, 상환 기록, 재무 프로필) | `src/app/net-worth-actions.ts` | `src/app/(app)/net-worth/page.tsx`, `src/components/net-worth/balance-side.tsx` |
| AI 운용 위임 (AP Phase 0 일부) | DelegationLevel, TradeMode, OrderSide, OrderStatus, AutopilotPolicy, AgentDecision, TradeOrder, OrderFill, `Session.stepUpUntil`, `AiSettings.tradingHaltedAt` · `tradingHaltReason`, `BrokerConnection.tradeEnabled` · `tradeEnabledAt` | `src/domain/autopilot.ts` (정책 스키마 · 요약, 고정 규칙, KRX 장 시간 · 휴장일 · 호가단위, 비용 추정, checkOrder 사전검증, 판정, 당일 사용량, 페이퍼 체결 · 장부, 승급 기준), `__tests__/autopilot.test.ts` | `src/server/services/autopilot.ts` (step-up, 현황, 정책 저장, 전역 · 정책 정지, 주문 제안 · 승인 · 거절), `src/server/brokers/orders.ts` (주문 라우터 인터페이스, 페이퍼 라우터) | `src/app/autopilot-actions.ts` | `src/app/(app)/autopilot/page.tsx`, `src/components/autopilot/controls.tsx` |
| 투자 철학 = 운용 전략 (ST 1단계 일부) | Strategy, StrategyVersion, StrategyRun, `Portfolio.strategyVersionId` | `src/domain/philosophy.ts` (닫힌 규칙 스키마, 비중 정규화, 해시, checkAgainst, 템플릿, 지표, 경고, 랭킹 · 근거 등급, 텍스트 lint), `__tests__/philosophy.test.ts` | `src/server/services/philosophy.ts` (목록, 생성, 버전 추가 · 채택, 보관 · 삭제, 런 시작, 랭킹, 가져오기 미리보기) | `src/app/philosophy-actions.ts` | `src/app/(app)/philosophies/page.tsx`, `src/components/philosophy/philosophy-forms.tsx` |

마이그레이션: `prisma/migrations/20261010150000_net_worth_autopilot_philosophy/migration.sql` (세 영역 모델을 한 번에 추가). 실데이터 DB에 적용하기 전에 pg_dump로 백업한다.

### 5.3 명세와 다른 점 (뼈대 기준)

- **경로와 파일 이름**: 명세는 `/networth`, `/ai/strategies`, `domain/loans.ts` · `strategy.ts` · `pretrade.ts` 등으로 나눴지만, 뼈대는 영역별 파일 하나(`net-worth.ts`, `autopilot.ts`, `philosophy.ts`)와 경로 `/net-worth`, `/philosophies`를 쓴다. 모델 이름은 명세대로 Strategy다. 메뉴 연결 전에 이름을 하나로 정한다(3.1의 11번).
- **뼈대에 없는 것**: Deposit · Lease · ValuationRule · PensionPlan · InsurancePolicy 등 NW 2단계 이후 모델, PaperDaily, `AiSkill.contentHash`, AI 도구(`propose_order`, `get_balance_sheet` 등), 체결 폴러와 대사, 실전 주문 라우터, 사이드바 링크, 사용설명서.
- **명세보다 앞선 것**: 투자 철학 domain에 랭킹 · 근거 등급(ST-13, P2)과 텍스트 lint(ST-10, P1)의 초기 함수가, 오토파일럿 domain에 승급 기준(AP-07B, P1) 함수가 들어 있다. 화면에서 쓰기 전에 각 기능의 단계 순서를 다시 본다.
- **Portfolio → StrategyVersion 관계**는 명세(Restrict)와 달리 NoAction이다. Postgres에서 둘 다 따르는 포트폴리오가 있으면 삭제를 막지만, 검사 시점이 다르다(NoAction은 문장 끝에 검사).

### 5.4 다음 작업

1. 현재 DB를 pg_dump로 백업한 뒤 마이그레이션을 적용한다(EX-12 스크립트가 생기기 전에는 수동으로).
2. `npm test`, `npm run typecheck`, `npm run build`로 뼈대를 검증한다.
3. 3.1의 겹침(특히 1 · 2 · 6 · 7 · 11번)을 정하고 스키마를 맞춘다.
4. NW 1단계를 끝까지(REPAY 원장 연결, 스냅샷 재계산, LoanPanel, loans 시트) 만든 뒤 메뉴에 연결하고 사용설명서 장과 캡처를 더한다.
5. AP는 Phase 0 완료 기준(채팅 → 재인증 승인 → 페이퍼 체결 → 성적)을 채운 뒤에만 Phase 1로 간다.
