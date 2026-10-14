# 처음부터 되살리기: VM과 Mac을 모두 잃었을 때

VM과 개발하던 Mac이 한꺼번에 사라져도 **GitHub**, **Google Drive**, **복구 암호 하나**만 있으면 서비스와 데이터, 개발 환경, Claude Code 대화까지 되살리는 방법입니다.

| 어디에 | 무엇이 | 누가 올리나 |
| --- | --- | --- |
| GitHub `hgrgr/PPFP` | 코드, 문서, 이 절차서와 스크립트 | 커밋·푸시 |
| Drive `ppfp-backups/` | DB 덤프 `ppfp-….dump.gpg` (`BACKUP_GPG_PASSPHRASE`로 잠금) | VM의 `offsite` 서비스, 6시간마다 ([deploy-cloud.md 8](deploy-cloud.md#8-google-drive로-백업-복사-권장)) |
| Drive `ppfp-recovery/` | 복구 묶음 `ppfp-recovery-….tar.gz.enc` (복구 암호로 잠금) | Mac에서 `deploy/recovery/backup.sh` |
| Drive `ppfp-recovery/` | VM 개발 환경 묶음 `ppfp-vm-….tar.gz.enc` (VM 복구 암호) | VM의 cron이 매일 03:30 KST에 `deploy/recovery/backup-vm.sh` ([아래](#vm에서-하는-대화도-백업하기)) |
| 비밀번호 관리자나 종이 | **복구 암호** | 사람 |

복구 묶음에 들어가는 것:

- **VM의 비밀값**: `~/ppfp/.env`(`APP_ENCRYPTION_KEY` — 증권사 시크릿·API 키를 여는 키, `BACKUP_GPG_PASSPHRASE` — DB 덤프를 여는 암호 등)와 `rclone.conf`(Drive 연결)
- **Claude Code**: `~/.claude` 전체(대화 기록, 메모리, 설정, 스킬)와 데스크톱 앱의 세션 목록(`~/Library/Application Support/Claude/claude-code-sessions`)
- **열쇠들**: VM SSH 키 `~/.ssh/oci_ppfp`, 안드로이드 서명 키 `~/.local/ppfp-signing/`과 `mobile/android/keystore.properties`(없으면 같은 앱으로 업데이트를 못 냅니다), Mac의 rclone 설정
- **저장소의 커밋되지 않는 것**: `.env`, `.claude/`(데모 스크립트, 서명 암호, 로컬 DB 백업). 작업 폴더(worktrees)와 APK는 빼고, 대신 **모든 브랜치**를 `repo.bundle`로 넣어 GitHub에 안 올린 커밋도 남깁니다.

복구 암호를 잃으면 묶음을 열 수 없고, 묶음이 없으면 DB 덤프도 열 수 없습니다. 복구 암호는 꼭 **두 기계 밖에** 적어 두세요.

## 한 번만: 준비

Mac에서 합니다.

1. 복구 암호를 정해 비밀번호 관리자에 저장하고, 이 Mac의 키체인에도 넣습니다(물으면 입력).
   ```bash
   security add-generic-password -s ppfp-recovery -a "$USER" -w
   ```
2. rclone(`~/.local/bin/rclone`)에 Drive를 연결합니다. 브라우저가 열리면 백업용 구글 계정으로 허용합니다.
   ```bash
   rclone config create gdrive drive scope=drive.file
   ```
3. 첫 묶음을 만들어 올립니다. Tailscale SSH가 브라우저 확인을 요구하면 먼저 승인합니다(VM 비밀값을 가져오기 때문).
   ```bash
   bash deploy/recovery/backup.sh
   ```

그다음부터는 큰 작업을 마칠 때마다(배포, 키 추가, 긴 Claude 세션 뒤) 3만 다시 돌립니다. Drive에는 60일치가 남습니다(`PPFP_RECOVERY_KEEP_DAYS`). 묶음을 Drive 대신 파일로만 받으려면 `--local`을 붙입니다.

## 되살리기

### A. 새 Mac

1. Xcode 명령줄 도구(`xcode-select --install`, git이 들어 있음)와 rclone을 설치하고, 준비 2처럼 `rclone config create gdrive drive scope=drive.file`로 Drive를 연결합니다. rclone 대신 Drive 웹에서 `ppfp-recovery/`의 가장 새 파일을 내려받아도 됩니다.
2. 이 스크립트를 GitHub에서 받아 돌립니다. 복구 암호를 묻습니다.
   ```bash
   curl -fsSLO https://raw.githubusercontent.com/hgrgr/PPFP/main/deploy/recovery/restore.sh
   bash restore.sh                                  # Drive의 가장 새 묶음
   bash restore.sh ~/Downloads/ppfp-recovery-….enc   # 받아 둔 파일
   ```
   `~/.claude`, 세션 목록, 열쇠들, `~/claude/PPFP`의 `.env`·`.claude/`를 제자리에 놓고, 저장소를 GitHub에서 받은 뒤 GitHub에 없던 브랜치를 붙이고, 세션들이 쓰던 작업 폴더(worktree)를 그 브랜치로 다시 만듭니다. 이미 있는 파일은 건드리지 않습니다(`--force`면 덮어씀).
3. 개발 도구를 다시 깝니다: Node·PostgreSQL·JDK·Android SDK·gh. 어디에 어떻게 깔았는지는 2에서 돌아온 Claude 메모리 `~/.claude/projects/-Users-hbw-claude-PPFP/memory/local-dev-env.md`에 적혀 있으니, 새 세션에서 Claude에게 "이대로 다시 깔아줘"라고 하면 됩니다. 그다음 저장소와 각 작업 폴더에서 `npm install`.
4. Claude 데스크톱 앱을 설치하고 같은 계정으로 로그인합니다. 사이드바에 예전 세션이 보이면 열어서 이어 갑니다. 안 보이면 터미널에서 세션의 폴더로 가서 `claude --resume`으로 고릅니다. 대화 기록은 마지막 묶음을 만든 때까지 남아 있습니다.
5. 다 끝나면 `~/ppfp-restore-…` 폴더를 지웁니다(비밀값이 풀린 채로 들어 있음).

### B. 새 VM

[deploy-cloud.md](deploy-cloud.md)의 1–2(가입, VM 만들기)를 한 뒤, 3의 설치 스크립트를 돌리기 **전에** 비밀값부터 놓습니다. A의 2에서 풀린 `~/ppfp-restore-…/vm/`에 있습니다.

```bash
# VM에서
sudo apt-get install -y git && git clone https://github.com/hgrgr/PPFP.git ~/ppfp
mkdir -p ~/ppfp/rclone
# Mac에서 (VM 공인 IP나 Tailscale 이름으로)
scp ~/ppfp-restore-…/vm/env ubuntu@<VM>:~/ppfp/.env
scp ~/ppfp-restore-…/vm/rclone.conf ubuntu@<VM>:~/ppfp/rclone/rclone.conf
# VM에서
chmod 600 ~/ppfp/.env ~/ppfp/rclone/rclone.conf
bash ~/ppfp/deploy/cloud/setup.sh              # .env가 있으면 새 비밀값을 만들지 않음, offsite도 켬
bash ~/ppfp/deploy/recovery/restore-vm.sh      # Drive의 가장 새 DB 덤프로 되살림
```

`setup.sh`가 Tailscale 로그인 링크를 보여 주면 엽니다. 옛 기기 이름 `ppfp`가 Tailscale 관리 콘솔에 남아 있으면 지운 뒤 새 VM을 `ppfp`로 바꿔야 주소(`https://ppfp.<tailnet>.ts.net`)가 그대로 유지됩니다. 새 VM의 Tailscale IP가 바뀌면 `deploy/recovery/backup.sh`의 `PPFP_VM`(기본 `ubuntu@100.121.56.5`)도 새 주소로 줍니다. 앱 로그인, 증권사 연결, API 키는 DB와 `APP_ENCRYPTION_KEY`가 돌아오면 그대로 됩니다.

### C. 둘 다

A를 먼저 하고(복구 묶음이 VM 비밀값을 갖고 있음) B를 합니다. 휴대폰 앱과 가족 기기는 같은 Tailscale 주소를 쓰면 다시 설정할 것이 없습니다.

## VM에서 하는 대화도 백업하기

VM을 개발 기계로 쓰면([remote-dev.md](remote-dev.md)) 거기서 한 Claude Code 대화는 VM의 `~/.claude`에만 남습니다. `deploy/recovery/backup-vm.sh`가 이것을 Mac 묶음과 같은 모양으로 묶어 같은 Drive 폴더에 `ppfp-vm-<시각>.tar.gz.enc`로 올립니다.

- **들어가는 것**: `~/.claude`(대화, 메모리, 설정. 앱이 깐 Claude Code 사본 `remote/`는 뺌), `~/.claude.json`, `~/.local/bin/ppfp-claude`, `~/dev/PPFP`의 `.env`·`.claude/`, `~/dev/PPFP`의 모든 브랜치(`repo.bundle`), 운영 폴더의 `~/ppfp/.env`와 `rclone.conf`
- **암호**: `~/.config/ppfp-recovery/passphrase`(권한 600)에 든 VM 복구 암호. 2026-10-14에 새로 만들어 Mac 암호와 다릅니다(Mac 묶음 `ppfp-recovery-…`은 계속 Mac 암호로 엽니다). 이 암호도 VM 밖, 비밀번호 관리자에 적어 둡니다.
- **올리는 길**: 따로 rclone을 깔지 않고 `offsite` 서비스가 쓰는 rclone 이미지와 `~/ppfp/rclone/rclone.conf`를 그대로 씁니다.
- Drive에는 60일치가 남고(`PPFP_RECOVERY_KEEP_DAYS`), 기록은 `~/.local/state/ppfp-recovery.log`에 쌓입니다.

처음 설정할 때는 VM 터미널에서(지금 VM에는 되어 있음):

```bash
mkdir -p ~/.config/ppfp-recovery && (umask 077; read -rsp 'passphrase: ' p && printf %s "$p" > ~/.config/ppfp-recovery/passphrase); echo
bash ~/dev/PPFP/deploy/recovery/backup-vm.sh            # 첫 묶음을 바로 올려 봄
bash ~/dev/PPFP/deploy/recovery/backup-vm.sh --install  # 매일 03:30 KST cron 등록
```

되살릴 때는 묶음을 풀어 `home/files.tar`를 새 VM의 홈에 풀고, 저장소는 GitHub에서 받은 뒤 `repo.bundle`에서 안 올린 브랜치를 가져옵니다.

```bash
mkdir -m 700 ~/vm-restore && cd ~/vm-restore
read -rsp 'passphrase: ' PASS; export PASS; echo
openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -md sha256 -pass env:PASS -in ~/ppfp-vm-….tar.gz.enc | tar -xzf -
tar -xpkf home/files.tar -C ~                          # 이미 있는 파일은 그대로 둠
git clone https://github.com/hgrgr/PPFP.git ~/dev/PPFP 2>/dev/null || true
git -C ~/dev/PPFP fetch ~/vm-restore/repo.bundle 'refs/heads/*:refs/remotes/vm-bundle/*'
```

개발 DB와 도구는 `deploy/remote-dev/setup-vm.sh`로 다시 만들고, 끝나면 `~/vm-restore`를 지웁니다(비밀값이 풀린 채로 들어 있음). 운영 VM까지 새로 만드는 경우 `vm/env`·`vm/rclone.conf`는 B에서 Mac 묶음 대신 써도 됩니다.

## 묶음에 없는 것

- **계정**: GitHub, Google, Oracle Cloud, Tailscale, Anthropic 로그인. 각 서비스의 2단계 인증 복구 코드를 따로 챙기세요.
- **증권사·공공데이터포털 등 외부 키의 원본**: DB 안에 잠겨 돌아오지만, 키를 새로 받아야 하면 각 사이트에서 다시 발급합니다.
- **무거운 것**: `node_modules`, 빌드 결과, APK, Docker 이미지 — 다시 만듭니다.
