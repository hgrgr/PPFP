# PPFP 작업 규칙

## 사용설명서 유지 (docs/user-guide.md)

사용자가 보는 기능을 추가·변경·삭제하는 작업에는 항상 [docs/user-guide.md](docs/user-guide.md)를 같이 고친다. 문서 맨 아래 *이 문서 관리하기*에 적힌 방식을 따른다.

- **추가된 기능**: 알맞은 장에 설명을 쓰고, 제목 바로 아래에 `**추가** [`짧은해시`](커밋 URL) · YYYY-MM-DD`를 적는다. *기능 이력* 표에도 한 줄 추가한다.
- **바뀐 기능**: 제목 아래 `**바뀜**`에 커밋과 바뀐 점을 덧붙이고, 본문과 화면 설명을 지금 동작에 맞춘다.
- **삭제된 기능**: 본문에서 빼고 *사라진 기능* 표로 옮긴다. 추가·삭제 커밋과 대신 쓸 방법을 함께 적는다.
- 날짜와 커밋은 그 기능을 넣은 커밋 기준이다. 기능 커밋을 먼저 만든 뒤 같은 브랜치의 문서 커밋에서 그 해시를 적는다. 커밋 URL은 전체 해시로 `https://github.com/hgrgr/PPFP/commit/<hash>` 형식을 쓴다.
- PR은 merge commit으로 합친다(squash·rebase 금지). 그래야 문서에 적힌 커밋 해시가 main에 그대로 남는다.
- 화면이 바뀌었으면 캡처를 다시 찍는다: `npm run build && npm run docs:screenshots`. 일부만 찍을 때는 `DOCS_ONLY=market,settings`를 쓴다. 새 화면을 찍으려면 [scripts/docs/capture.ts](scripts/docs/capture.ts)의 `SHOTS`에 추가한다. 데모 데이터는 [scripts/docs/seed-demo.ts](scripts/docs/seed-demo.ts)에, 가짜 시세 서버는 [scripts/docs/fake-market.cjs](scripts/docs/fake-market.cjs)에 있다.
- 캡처는 임시 DB(`<DB이름>_docs`)와 3100번 포트의 데모 서버로 찍고, 끝나면 둘 다 정리한다. 실제 사용자 데이터나 실제 증권사 키로 캡처하지 않는다.
- 캡처를 다시 찍은 뒤에는 이미지를 직접 열어 확인한다. 차트가 비어 있거나, 표가 잘렸거나, 번호 표시가 엉뚱한 곳에 붙었는지 본다.

## 개발 메모

- 검증: `npm test`, `npm run typecheck`, `npm run build`. PR과 main 푸시마다 [CI](.github/workflows/ci.yml)가 빈 Postgres에 마이그레이션을 적용한 뒤 같은 검증을 돌린다.
- `.env`, `.claude/`는 커밋하지 않는다.
