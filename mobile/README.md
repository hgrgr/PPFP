# PPFP 안드로이드 앱

서버 없이 휴대폰에서 동작하는 PPFP 앱이다. Capacitor(안드로이드) 위에 Vite + React로 만들었고, 계산은 웹 앱의 `src/domain`을 그대로 쓴다. 사용법은 [사용설명서의 안드로이드 앱](../docs/user-guide.md#안드로이드-앱)에 있다.

## 구조

| 경로 | 내용 |
| --- | --- |
| `src/core/` | 데이터(IndexedDB · Dexie), 장부 계산(`book.ts`), 시세(`market.ts`, `prices.ts`), 백업 암호화(`backup.ts`), 시트 변환(`sheets.ts`), 서버 연동(`server.ts`, `sync.ts`, `poll.ts`), AI(`ai.ts`) |
| `src/ui/` | 화면. `screens/`에 탭과 더보기의 화면 |
| `src/core/__tests__/` | `npm test` (node:test + tsx, IndexedDB는 fake-indexeddb) |
| `android/` | Capacitor가 만든 안드로이드 프로젝트. 아이콘·권한·서명 설정만 손댔다 |

서버 쪽 API는 `src/app/api/mobile/*`와 `src/server/services/mobile.ts`(웹 앱 저장소)에 있다.

## 개발

```bash
npm install --prefix mobile
npm run --prefix mobile dev        # http://localhost:5173 (브라우저에서 화면 확인)
npm run --prefix mobile typecheck
npm run --prefix mobile test
```

브라우저에서는 업비트·한국투자증권 같은 외부 API가 CORS로 막힐 수 있다. 휴대폰에서는 Capacitor의 네이티브 HTTP로 나가서 막히지 않는다. 서버 연동은 로컬 서버(`http://localhost:3000`)로 시험할 수 있다(앱 API는 토큰만 쓰므로 모든 출처를 허용한다).

## APK 만들기

JDK 21과 Android SDK(platform 36, build-tools 36)가 있어야 한다. `ANDROID_HOME`과 `JAVA_HOME`을 맞춘 뒤:

```bash
npm run --prefix mobile android:apk       # 디버그: android/app/build/outputs/apk/debug/app-debug.apk
npm run --prefix mobile android:release   # 서명된 릴리스: android/app/build/outputs/apk/release/app-release.apk
```

릴리스 서명은 `android/keystore.properties`(커밋하지 않음)를 읽는다.

```properties
storeFile=/절대/경로/ppfp-release.jks
storePassword=…
keyAlias=ppfp
keyPassword=…
```

키는 `keytool -genkeypair -keystore ppfp-release.jks -storetype PKCS12 -alias ppfp -keyalg RSA -keysize 4096 -validity 10000`으로 만든다. **이 키를 잃으면 설치된 앱을 같은 앱으로 업데이트할 수 없다**(지우고 다시 설치해야 하며 그때 폰의 데이터도 지워진다). 키 파일과 비밀번호를 따로 백업해 둔다.

GitHub Actions의 *Android APK* 워크플로가 PR과 main마다 디버그 APK를 만들어 실행 페이지에 14일 동안 올려 둔다.

## 에뮬레이터와 화면 캡처

```bash
sdkmanager "system-images;android-35;google_apis;x86_64" emulator
avdmanager create avd -n ppfp -k "system-images;android-35;google_apis;x86_64" -d pixel_7
emulator -avd ppfp -no-window -gpu swiftshader_indirect &
adb install -r android/app/build/outputs/apk/release/app-release.apk
adb exec-out screencap -p > shot.png
```

사용설명서의 앱 화면(`docs/images/app-*.webp`)은 첫 화면의 *예시 데이터 넣기*로 채운 뒤 찍고, 상태 표시줄과 제스처 막대를 잘라 폭 540px webp로 저장한다. 에뮬레이터에서 호스트의 서버는 `http://10.0.2.2:3000`이다.
