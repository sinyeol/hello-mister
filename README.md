# Hello Mister

**MiSTer FPGA 관리 + NFC 카드 스티커 제작 Windows 데스크톱 앱**

MiSTer FPGA의 게임 라이브러리를 불러와 NFC(NTAG215) 카드로 게임을 실행하고, 카드에 붙일 스티커를 A4 라벨지(2×5)로 출력하는 로컬 데스크톱 도구입니다.

## 주요 기능

- **미스터 게임 라이브러리** — SSH/SFTP로 게임 폴더를 스캔해 플랫폼별 게임 리스트 구성 (여러 대의 MiSTer 지원, SD 카드 단위 식별)
- **NFC 게임 실행** — Zaparoo(구 TapTo) 호환. Zaparoo Core API로 게임 실행·NTAG215 태그 쓰기
- **카드 스티커 제작** — 카드 앞/뒷면 편집기, 템플릿, LaunchBox 로컬 이미지 매칭, A4 2×5 PDF/PNG 출력
- **SD 카드 설치 마법사** — 새 microSD에 Mr. Fusion을 내려받아 굽고, Wi‑Fi·스크립트·영상 출력(MiSTer.ini)까지 단계별 설정 (DE10-Nano·클론 공통)
- **MiSTer 관리** — MiSTer.ini 프리셋(HDMI·CRT 15kHz·방송용 모니터 등), 스크립트 관리, 컨트롤러 매핑(.map) 편집

## 설치 / 실행

- **포터블(무설치)**: [Releases](../../releases)에서 `Hello-Mister-*-portable.exe`를 받아 더블클릭.
  - 처음 실행 시 Windows SmartScreen 경고가 뜨면 "추가 정보 → 실행"을 누르세요(코드서명 없음, 정상).
- **개발 실행**:
  ```bash
  npm install
  npm run desktop:dev
  ```
- 포터블 빌드: `npm run package:portable` → `release/Hello-Mister-*-portable.exe`

## 요구 사항

- Windows 10/11
- MiSTer FPGA (DE10-Nano 또는 호환 클론), 네트워크 연결(SSH)
- NFC 실행 기능: MiSTer에 [Zaparoo Core](https://github.com/ZaparooProject/zaparoo-core) 설치 (앱의 SD 마법사/스크립트 메뉴에서 공식 설치 파일을 받아드립니다)

## 안전 원칙

- ROM 복사·업로드·삭제는 잠겨 있습니다(dry-run만). 원격 파일 편집(INI·스크립트·컨트롤러)은 백업 후 사용자 확인을 거쳐야 적용됩니다.
- SD 카드 굽기는 대상 검증 + 드라이브 문자 직접 입력 + 관리자 권한(UAC) 동의 후에만 실행됩니다.
- 파괴적 작업은 있는 그대로(AS-IS) 제공되며, 데이터 손실에 대한 보증이 없습니다. 처음에는 여분 카드로 시험하세요.

## 고지 (Disclaimer)

- **Hello Mister는 독립적인 서드파티 도구입니다.** MiSTer 프로젝트(MiSTer-devel), Zaparoo 프로젝트, theypsilon, Unbroken Software(LaunchBox), NXP와 제휴·후원·승인 관계가 없습니다.
- **Zaparoo**는 Wizzo Pty Ltd의 상표입니다. **MISTER FPGA**, **LaunchBox** 등 언급된 명칭은 각 권리자의 상표/명칭이며, 이 저장소에서의 언급은 호환성 설명을 위한 참조적 사용입니다.
- 이 앱은 서드파티 소프트웨어(**Mr. Fusion, Ms. Fusion, update_all, MiSTer 공식 스크립트, Zaparoo Core** — 모두 GPL-3.0)를 **번들하지 않습니다**. 사용자의 요청 시 각 프로젝트의 공식 GitHub 배포 원본을 무수정으로 내려받기만 하며, 해당 소프트웨어는 각자의 라이선스를 따릅니다:
  [mr-fusion](https://github.com/MiSTer-devel/mr-fusion) ·
  [Update_All_MiSTer](https://github.com/theypsilon/Update_All_MiSTer) ·
  [Scripts_MiSTer](https://github.com/MiSTer-devel/Scripts_MiSTer) ·
  [zaparoo-core](https://github.com/ZaparooProject/zaparoo-core)
- 게임 ROM·BIOS·아트워크는 포함하지 않습니다. 스티커 인쇄에 사용하는 게임 이미지는 사용자가 보유한 로컬 파일이며, 저작권 책임은 사용자에게 있습니다(개인적 사용 목적).

## 라이선스

이 저장소의 코드는 [MIT License](LICENSE)로 배포됩니다.

## 문서

내부 개발 기록은 [docs/DEVLOG.md](docs/DEVLOG.md), 기타 설계 문서는 [docs/](docs/)를 참고하세요.
