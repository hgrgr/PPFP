# 클라우드 VM에서 개발하기 (Claude 앱에서 SSH로)

맥북이나 집의 Windows 노트북에 설치한 **Claude 앱**에서 Claude Code 세션을 열되, 실제 작업은 클라우드 VM에서 하는 방법입니다. 앱은 화면만 맡고, 저장소·데이터·명령 실행은 모두 VM의 작업 폴더(`~/dev/PPFP`)에서 이뤄집니다. 앱을 닫거나 노트북을 꺼도 VM에서 돌던 작업은 계속됩니다.

## VM에 준비된 것

[`deploy/remote-dev/setup-vm.sh`](../deploy/remote-dev/setup-vm.sh)가 만든 환경입니다. 다시 실행해도 안전합니다.

| 무엇 | 어디 |
| --- | --- |
| 저장소 | `~/dev/PPFP` (운영 앱이 도는 `~/ppfp`와 별개) |
| Node 22, Claude Code, GitHub CLI | `~/.local/bin` |
| 개발용 DB | Docker 컨테이너 `ppfp-dev-db`, `127.0.0.1:5433` (DB `ppfp_dev`, `ppfp_demo`). 운영 DB와 컨테이너·볼륨이 따로라 건드리지 않습니다 |
| 개발용 `.env` | `~/dev/PPFP/.env` (개발 DB를 가리키고, 키는 새로 만든 값) |
| Claude 대화 기록과 메모리 | `~/.claude/projects/-home-ubuntu-dev-PPFP/` (맥에서 옮겨 온 것) |

앱의 SSH 연결이 요구하는 조건(SFTP, 연결 하나에 여러 세션, 홈 폴더 여유 공간 1GB 이상)은 2026-10-14에 확인했습니다.

## 기기 준비 (기기마다 한 번)

1. **Tailscale** — <https://tailscale.com/download>에서 설치하고 VM과 **같은 계정**으로 로그인합니다. 그래야 VM 주소 `100.121.56.5`에 닿습니다. 맥북에는 이미 있습니다.
2. **Claude 앱** — <https://claude.ai/download>에서 설치하고 로그인합니다.
3. **접속 한 번 확인** — 터미널(Windows는 *Windows Terminal*이나 *PowerShell*)에서

   ```
   ssh ubuntu@100.121.56.5
   ```

   로 들어가지는지 봅니다. Tailscale SSH라 비밀번호나 키 파일이 필요 없습니다. `To authenticate, visit: https://login.tailscale.com/...`가 나오면 브라우저로 열어 승인합니다. 들어가지면 `exit`로 나옵니다.

## 앱에 VM 연결하기 (기기마다 한 번)

1. Claude 앱의 **Code** 탭에서 새 세션을 엽니다.
2. 실행 위치 드롭다운(Local · Cloud · SSH)에서 **SSH**의 연결 추가를 고릅니다.
3. 이렇게 넣습니다.
   - **호스트**: `ubuntu@100.121.56.5` (맥북에서는 `~/.ssh/config`에 등록한 별칭 `ppfp-vm`도 됩니다)
   - **키**: 비워 둡니다. Tailscale SSH가 인증합니다.
   - **작업 폴더**: `/home/ubuntu/dev/PPFP`
4. 저장하면 드롭다운의 SSH 아래에 연결이 생깁니다. 처음 연결할 때 앱이 VM에 자기 Claude Code를 설치합니다(`~/.claude/remote/`).
5. Claude 로그인 주소가 나오면 지금 쓰는 기기의 브라우저로 열어 승인합니다.

그다음부터는 새 세션을 열 때 실행 위치로 이 SSH 연결만 고르면 됩니다.

## GitHub 로그인 (VM에서 한 번)

PR을 만들고 push하려면 VM의 GitHub CLI에 한 번 로그인합니다. 앱 세션에서 Claude에게 부탁하거나, 터미널로 VM에 들어가

```
gh auth login
```

을 실행하고 *GitHub.com → HTTPS → Login with a web browser*를 고릅니다.

## 알아 둘 점

- **맥락은 메모리로 이어짐** — 앱에서 여는 세션은 새 대화로 시작하지만, 같은 VM 폴더에서 돌아 메모리(지금까지의 작업 기록)와 `CLAUDE.md`를 읽습니다. 맥에서 옮겨 온 예전 대화 자체를 이어야 하면 터미널로 VM에 들어가 `ppfp-claude 6e6247ca-9437-43b1-917d-9d2866eb480b`를 실행합니다(tmux 안에서 열리고, 빠져나오기는 **Ctrl+B** 뒤 **D**).
- **Tailscale 승인** — VM 접속이 가끔 브라우저 승인을 요구합니다. 그때 앱 연결이 실패하면 터미널에서 `ssh ubuntu@100.121.56.5`를 한 번 실행해 나온 주소를 승인하면 풀립니다. 매번 번거로우면 Tailscale 관리 화면의 SSH 규칙을 `check`에서 `accept`로 바꾸면 승인이 없어집니다(보안 설정이라 직접 정합니다).
- **로그인 만료** — VM에서 돌던 작업은 Claude 로그인이 만료되면 멈출 수 있습니다.
- **한 곳에서만 이어 가기** — 맥의 앱 세션(실행 위치 Local)과 VM 세션은 서로의 대화를 모릅니다. VM으로 옮긴 뒤로는 SSH 연결로만 작업하고, 코드는 GitHub에 push해 둡니다.
- **화면 확인** — VM의 개발 서버는 VM 안(`localhost`)에서만 열려 있습니다. VM에서 개발 서버를 3200번 포트로 띄우고(`PORT=3200 npm run dev`, 운영 앱이 3000번을 씀), 기기의 터미널에서

  ```
  ssh -L 3200:localhost:3200 ubuntu@100.121.56.5
  ```

  를 연 채 `http://localhost:3200`을 엽니다.
- **배포** — VM 안에서 `bash ~/ppfp/deploy/cloud/update.sh`를 바로 실행합니다(먼저 백업을 받음).
- **백업** — VM의 대화 기록과 개발 폴더의 비밀값은 VM이 매일 03:30 KST에 따로 묶어 Drive에 올립니다([recovery.md의 VM 백업](recovery.md#vm에서-하는-대화도-백업하기), 한 번 설정 필요). 코드는 GitHub에 push해 두세요.
- **스킬** — SSH 세션은 VM의 `~/.claude/skills/`에서 스킬을 읽습니다.

## 앱 없이 터미널로만 쓰기

앱이 없는 기기에서는 `ssh ubuntu@100.121.56.5`로 들어가 `ppfp-claude`를 실행합니다. tmux 안에서 Claude Code가 켜지거나, 켜 둔 세션에 다시 붙습니다. 처음 한 번은 `claude`로 로그인합니다.
