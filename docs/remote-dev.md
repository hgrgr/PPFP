# 클라우드 VM에서 개발하기 (Windows 노트북에서 접속)

맥이 없어도 집의 Windows 노트북에서 클라우드 VM에 접속해 Claude Code로 작업을 이어 가는 방법입니다. 코드, Claude Code, 대화 기록은 모두 VM에 있고, 노트북은 터미널 창만 엽니다. 노트북을 닫아도 VM의 작업은 계속 돌아갑니다.

## VM에 준비된 것

[`deploy/remote-dev/setup-vm.sh`](../deploy/remote-dev/setup-vm.sh)가 만든 환경입니다. 다시 실행해도 안전합니다.

| 무엇 | 어디 |
| --- | --- |
| 저장소 | `~/dev/PPFP` (운영 앱이 도는 `~/ppfp`와 별개) |
| Node 22, Claude Code, GitHub CLI | `~/.local/bin` |
| 개발용 DB | Docker 컨테이너 `ppfp-dev-db`, `127.0.0.1:5433` (DB `ppfp_dev`, `ppfp_demo`). 운영 DB와 컨테이너·볼륨이 따로라 건드리지 않습니다 |
| 개발용 `.env` | `~/dev/PPFP/.env` (개발 DB를 가리키고, 키는 새로 만든 값) |
| Claude 대화 기록과 메모리 | `~/.claude/projects/-home-ubuntu-dev-PPFP/` (맥에서 옮겨 온 것) |
| 실행기 | `ppfp-claude` — tmux 안에서 Claude Code를 켜거나 다시 붙습니다 |

## Windows 노트북 준비 (한 번만)

1. **Tailscale 설치** — <https://tailscale.com/download/windows>에서 설치하고, VM과 **같은 계정**으로 로그인합니다. 그래야 VM 주소 `100.121.56.5`(이름 `ppfp`)에 닿습니다.
2. **터미널** — Windows 10/11에는 SSH가 들어 있습니다. *Windows Terminal*이나 *PowerShell*을 엽니다.
3. **접속**

   ```
   ssh ubuntu@100.121.56.5
   ```

   Tailscale SSH라서 비밀번호나 키 파일이 필요 없습니다. 가끔 `To authenticate, visit: https://login.tailscale.com/...` 주소가 나오면 브라우저로 열어 승인하면 이어집니다.
4. **VM에서 로그인 (처음 한 번)**

   ```
   claude
   ```

   로그인 주소가 나오면 노트북 브라우저로 열어 승인하고, 나온 코드를 터미널에 붙여 넣습니다. 로그인되면 `/exit`로 나옵니다.

   ```
   gh auth login
   ```

   *GitHub.com → HTTPS → Login with a web browser*를 고르고, 나온 코드를 브라우저에 넣습니다. PR을 만들고 push할 때 씁니다.

## 작업 이어 가기

처음에는 맥에서 하던 대화를 이어서 엽니다.

```
ppfp-claude 6e6247ca-9437-43b1-917d-9d2866eb480b
```

그다음부터는 그냥:

```
ppfp-claude
```

- 이미 켜 둔 세션이 있으면 그 화면으로 다시 붙고, 없으면 가장 최근 대화를 이어서 켭니다.
- 창을 닫거나 노트북을 꺼도 VM의 Claude는 계속 일합니다. 다시 `ssh` → `ppfp-claude`로 붙습니다.
- 잠시 빠져나오려면 **Ctrl+B**를 누르고 손을 뗀 뒤 **D**.
- 다른 대화를 고르려면 Claude 안에서 `/resume`.

## 알아 둘 점

- **한 곳에서만 이어 가기** — 맥과 VM의 대화 기록은 옮긴 시점부터 따로입니다. 같은 대화를 두 곳에서 동시에 이어 가면 서로 모릅니다. 작업한 내용은 GitHub에 push해 두면 어디서든 받습니다(`git pull`).
- **데스크톱 앱 기능은 없음** — 터미널의 Claude Code라서 앱의 브라우저 창, iOS 시뮬레이터, 안드로이드 에뮬레이터는 쓸 수 없습니다. 화면 확인은 아래처럼 포트를 노트북으로 넘겨 브라우저로 봅니다.
- **화면 확인** — VM에서 개발 서버를 3200번 포트로 띄우고(`PORT=3200 npm run dev`, 운영 앱이 3000번을 씀), 노트북에서 새 터미널로

  ```
  ssh -L 3200:localhost:3200 ubuntu@100.121.56.5
  ```

  를 연 채 브라우저에서 `http://localhost:3200`을 엽니다.
- **배포** — 이제 VM 안이므로 `bash ~/ppfp/deploy/cloud/update.sh`를 바로 실행합니다(먼저 백업을 받음).
- **백업** — 매일 만드는 복구 묶음([recovery.md](recovery.md))은 맥에서 돌아서 VM의 대화 기록은 들어가지 않습니다. 코드는 GitHub에 push해 두세요.
- **VS Code를 쓰고 싶으면** — *Remote - SSH* 확장을 설치하고 `ubuntu@100.121.56.5`로 접속해 `~/dev/PPFP` 폴더를 엽니다. 그 안의 터미널에서 `ppfp-claude`를 실행하면 됩니다.
