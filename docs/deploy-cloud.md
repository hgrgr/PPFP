# 클라우드에 올리기: Oracle Cloud 무료 VM + Tailscale

집 PC를 켜 두지 않고 PPFP를 24시간 돌리는 방법입니다. Oracle Cloud의 상시 무료(Always Free) VM에 지금과 같은 `docker compose`를 올리고, 접속은 Tailscale로 내 기기와 허락한 가족·지인 기기에만 엽니다. 도메인을 사거나 포트를 인터넷에 열지 않고, 휴대폰에서는 웹 앱을 설치해 앱처럼 씁니다.

```
휴대폰 · PC (Tailscale 앱)
   │  Tailscale 네트워크 (허락한 기기만)
   ▼
Oracle VM ── tailscale serve (HTTPS, https://ppfp.<tailnet>.ts.net)
   └─ docker compose
        ├─ app      127.0.0.1:3000 (VM 밖에서는 직접 닿지 않음)
        ├─ db       PostgreSQL
        ├─ backup   하루 한 번 backups/에 암호화 백업
        └─ offsite  (선택) 암호화 백업을 Google Drive로 복사
```

- **비용**: Oracle 상시 무료 한도와 Tailscale 무료 플랜 안에서는 0원입니다. 두 회사 모두 무료 범위를 바꾼 적이 있으니 아래 *주의할 점*을 먼저 읽으세요.
- **누가 들어올 수 있나**: 두 겹으로 막습니다. Tailscale에서 허락한 기기만 서버에 닿고, 그다음 PPFP 계정(초대 코드 가입, 2단계 인증)이 필요합니다.

## 1. Oracle Cloud 가입

1. [Oracle Cloud Free Tier](https://www.oracle.com/cloud/free/)에서 가입합니다. 본인 확인용으로 카드 정보를 넣지만 무료 계정은 결제되지 않습니다.
2. **홈 리전은 나중에 바꿀 수 없습니다.** 상시 무료 VM은 홈 리전에만 만들 수 있으므로 **South Korea Central (Seoul)** 을 고르세요. South Korea North (Chuncheon)는 무료 Arm VM을 만들 수 없습니다.

## 2. VM 만들기

콘솔에서 *Compute → Instances → Create instance*.

| 항목 | 값 |
| --- | --- |
| Image | Canonical **Ubuntu 24.04** (Arm용 이미지가 자동으로 골라집니다) |
| Shape | **VM.Standard.A1.Flex**, OCPU **2**, 메모리 **12GB** |
| Networking | 기본 VCN, *Assign a public IPv4 address* 켬 |
| SSH keys | *Generate a key pair* → 개인 키를 내려받아 보관 |
| Boot volume | 기본값(약 50GB) |

- 상시 무료 Arm 한도는 2026년 6월부터 **2 OCPU · 12GB**로 줄었습니다. 이보다 크게 만들면 무료가 아니게 될 수 있습니다.
- *Out of host capacity*가 나오면 다른 가용 도메인(AD)을 고르거나 시간을 두고 다시 시도합니다.
- 보안 목록(방화벽)은 **기본값(22번 SSH만 열림)** 그대로 둡니다. 3000번은 열지 마세요.
- **업비트를 쓴다면** 만든 VM의 공인 IP를 업비트 Open API 키의 허용 IP로 등록합니다. VM을 지웠다가 다시 만들면 IP가 바뀌므로, 고정하려면 *Reserved public IP*를 쓰세요(요금은 콘솔에서 확인).

## 3. 설치 스크립트 실행

내려받은 키로 접속합니다(IP는 인스턴스 화면의 *Public IP address*).

```bash
chmod 600 ~/Downloads/ssh-key-*.key
ssh -i ~/Downloads/ssh-key-*.key ubuntu@<VM 공인 IP>
```

VM 안에서:

```bash
sudo apt-get install -y git && git clone https://github.com/hgrgr/PPFP.git ~/ppfp
bash ~/ppfp/deploy/cloud/setup.sh
```

[setup.sh](../deploy/cloud/setup.sh)가 차례로 합니다. 다시 실행해도 이미 된 단계는 건너뜁니다.

1. 스왑 4GB, 자동 보안 업데이트, Docker
2. Tailscale 설치. **출력되는 링크를 브라우저로 열어 로그인**합니다(구글 계정 가능). 이 VM이 `ppfp`라는 이름으로 내 Tailscale 네트워크에 들어갑니다.
3. `~/ppfp/.env`를 새로 만들고 비밀값을 채웁니다. 화면에 한 번 나오는 **`APP_ENCRYPTION_KEY`와 `BACKUP_GPG_PASSPHRASE`를 비밀번호 관리자에 바로 저장하세요.** 앞의 것이 없으면 백업을 되살려도 증권사 키를 풀 수 없고, 뒤의 것이 없으면 암호화한 백업을 열 수 없습니다.
4. 앱·DB·백업 컨테이너를 빌드해 띄웁니다. 처음 빌드는 5~10분 걸립니다.
5. `tailscale serve`로 `https://ppfp.<tailnet>.ts.net` 주소에 HTTPS를 붙입니다.

## 4. Tailscale 관리 콘솔에서 세 가지

[관리 콘솔](https://login.tailscale.com/admin)에서:

- **DNS → MagicDNS 켜기, HTTPS Certificates 켜기**: `https://ppfp.….ts.net` 주소와 인증서가 생깁니다. 나중에 켰다면 VM에서 `sudo tailscale serve --bg http://127.0.0.1:3000`을 한 번 더 실행합니다.
- **Machines → ppfp → ⋯ → Disable key expiry**: 기본값이면 서버의 로그인이 180일 뒤 만료돼 아무도 접속하지 못하게 됩니다.
- (선택) VM 접속을 Tailscale SSH(`ssh ubuntu@ppfp`)로만 한다면 Oracle 보안 목록에서 22번도 닫을 수 있습니다.

## 5. 휴대폰에 설치

1. Play 스토어에서 **Tailscale** 앱을 설치하고 같은 계정으로 로그인합니다.
2. Chrome에서 `https://ppfp.<tailnet>.ts.net`을 엽니다. 주소는 관리 콘솔의 Machines에서 확인합니다.
3. 첫 계정을 가입합니다. 서버의 첫 계정은 초대 코드 없이 만들어집니다.
4. Chrome 메뉴 → **앱 설치**(또는 *홈 화면에 추가*)를 누르면 홈 화면에 PPFP 아이콘이 생기고 주소창 없이 열립니다. 푸시 알림도 이 앱으로 받습니다.
5. *연동 · 설정 › 계정 보안*에서 **2단계 인증**을 켜세요.

PC도 Tailscale을 설치하고 같은 주소로 엽니다.

## 6. 가족 · 지인 허락하기

두 단계입니다.

1. **서버에 닿게 하기**: Tailscale 관리 콘솔 → Machines → `ppfp` → **Share**로 공유 링크를 보냅니다. 받은 사람은 자기 Tailscale 계정으로 수락하면 **이 서버 하나만** 볼 수 있습니다. 내 다른 기기는 보이지 않습니다. 나와 같은 네트워크에 사용자로 초대하는 방법(*Users → Invite*)도 있지만, 무료 플랜의 사용자 수 제한에 들어갑니다. 2026년 4월부터 6명으로 늘었다는 보도가 있으니 [공식 요금표](https://tailscale.com/pricing)에서 확인하세요.
2. **PPFP 계정 만들게 하기**: *연동 · 설정 › 계정 보안 › 가입 초대*에서 초대 코드를 만들어 가입 링크를 보냅니다. 7일 안에 한 번 쓸 수 있습니다.

허락을 거둘 때는 Tailscale에서 공유를 취소하고, 필요하면 PPFP 계정의 *로그인한 기기*에서 로그아웃시킵니다.

## 7. 지금 쓰던 데이터 옮기기 (선택)

Mac의 Docker에서 쓰던 데이터를 그대로 옮깁니다.

1. Mac에서 백업을 하나 뜹니다: `npm run db:backup` → `backups/ppfp-….dump`
2. Mac의 `.env`에 있는 `APP_ENCRYPTION_KEY`를 VM의 `~/ppfp/.env`에 **덮어씁니다.** 증권사 시크릿과 API 키가 이 키로 잠겨 있어서, 키가 다르면 옮긴 뒤 키를 풀 수 없습니다.
3. 파일을 VM으로 보내고 되살립니다.

```bash
# Mac에서 (Tailscale에 로그인된 상태)
scp backups/ppfp-20261010-030000.dump ubuntu@ppfp:~/ppfp/backups/
# VM에서
cd ~/ppfp && sudo docker compose -f docker-compose.yml -f docker-compose.cloud.yml up -d   # 바꾼 키로 다시 시작
sudo bash scripts/backup/restore.sh backups/ppfp-20261010-030000.dump
```

키를 바꾸고 싶지 않다면 데이터만 되살린 뒤, *API 키 백업 · 복원* 파일로 키만 다시 넣어도 됩니다.

## 8. Google Drive로 백업 복사 (권장)

VM의 `backups/`는 VM 디스크에 있어서 VM이 없어지면 같이 사라집니다. `offsite` 서비스가 **암호화된 백업(`.dump.gpg`)만** Google Drive로 6시간마다 복사하고, Drive에서는 30일 지난 사본을 지웁니다. VM을 새로 만들어 `backups/`가 비어도 Drive 사본은 지워지지 않습니다.

1. **내 PC**에 [rclone](https://rclone.org/install/)을 설치하고 Google 로그인 토큰을 받습니다. 브라우저가 열리면 로그인하고 허용합니다.

   ```bash
   rclone authorize "drive"
   ```

   마지막에 나오는 `{"access_token":…}` 한 줄을 복사해 둡니다.
2. **VM**에서 rclone 설정을 만듭니다. 이름은 `gdrive`, 종류는 `drive`, scope는 `drive.file`(이 앱이 만든 파일만)을 고르고, *Use web browser to automatically authenticate?*에 `n`을 답한 뒤 1의 토큰을 붙여 넣습니다.

   ```bash
   cd ~/ppfp && sudo docker run --rm -it -v ~/ppfp/rclone:/config/rclone rclone/rclone:1.71.1 config
   ```
3. 업데이트 스크립트를 한 번 돌리면 `offsite`가 같이 뜹니다.

   ```bash
   bash ~/ppfp/deploy/cloud/update.sh
   sudo docker compose -f docker-compose.yml -f docker-compose.cloud.yml logs offsite   # "copied to gdrive:ppfp-backups"
   ```

복사할 곳과 주기는 `.env`의 `OFFSITE_REMOTE`(기본 `gdrive:ppfp-backups`), `OFFSITE_INTERVAL_HOURS`(6), `OFFSITE_KEEP_DAYS`(30)로 바꿉니다. 되살릴 때는 Drive에서 받은 `.dump.gpg`를 `backups/`에 넣고, `BACKUP_GPG_PASSPHRASE`를 셸에 준 채로 `restore.sh`를 실행합니다.

## 9. 업데이트

main에 새 기능이 들어오면 VM에서:

```bash
bash ~/ppfp/deploy/cloud/update.sh
```

[update.sh](../deploy/cloud/update.sh)는 백업을 먼저 하나 뜬 뒤 최신 코드로 다시 빌드합니다. 새 마이그레이션은 앱이 시작하면서 적용됩니다.

## 주의할 점

- **놀고 있는 무료 VM은 회수될 수 있습니다.** Oracle은 7일 동안 CPU(95퍼센타일)·네트워크·메모리(Arm만) 사용률이 모두 20% 미만인 상시 무료 인스턴스를 회수할 수 있다고 [밝힙니다](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm). PPFP는 가벼워서 여기에 걸릴 수 있습니다.
  - **대응 1**: 계정을 **종량제(Pay As You Go)로 업그레이드**합니다. 상시 무료 자원은 계속 무료이고, 한도를 넘는 사용만 과금됩니다. 회수 규칙이 종량제에도 적용되는지는 공식 문서에 적혀 있지 않습니다. 업그레이드했다면 *Billing → Budgets*에 1달러 예산 알림을 걸어 두세요.
  - **대응 2**: 8번의 Drive 백업을 켜 둡니다. 회수 안내 메일을 받으면 콘솔에서 다시 시작하고, VM이 아예 없어졌으면 새로 만들어 백업에서 되살립니다.
- **무료 범위는 바뀔 수 있습니다.** Oracle은 2026년 6월에 무료 Arm 한도를 4 OCPU · 24GB에서 2 OCPU · 12GB로 줄였습니다. 한도보다 큰 VM은 무료가 아니게 됩니다.
- **비밀값 두 개를 잃지 마세요.** `APP_ENCRYPTION_KEY`와 `BACKUP_GPG_PASSPHRASE`는 VM과 Drive가 아닌 곳(비밀번호 관리자)에 둡니다.
- **SSH 키**: Oracle에서 받은 개인 키를 잃으면 VM에 들어갈 수 없습니다. Tailscale SSH(`ssh ubuntu@ppfp`)를 켜 두었으니 키를 잃어도 Tailscale 로그인으로 들어갈 수 있습니다.
