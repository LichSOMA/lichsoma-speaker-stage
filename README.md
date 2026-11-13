> **AI 제작 안내: 이 프로젝트는 생성형 AI의 도움을 받아 제작되었습니다.**

# LichSOMA's Speaker Stage

## 배포 버전·설치 안내

- **현재 버전**: 3.0.0
- **Foundry VTT**: 13 / 14 (manifest의 verified: 14)
- **최신 릴리즈**: [LichSOMA's Speaker Stage Releases](https://github.com/LichSOMA/lichsoma-speaker-stage/releases/latest)
- **설치용 manifest**: [module.json](https://github.com/LichSOMA/lichsoma-speaker-stage/releases/latest/download/module.json)
- **수동 설치 ZIP**: [lichsoma-speaker-stage.zip](https://github.com/LichSOMA/lichsoma-speaker-stage/releases/download/3.0.0/lichsoma-speaker-stage.zip)

릴리즈 첨부 파일의 `lichsoma-speaker-stage.zip`을 사용하세요. GitHub의 자동 생성 `Source code` 압축 파일과는 구성이 다릅니다. ZIP에는 실행 파일·자원, README와 라이선스를 포함하며, 테스트·개발용 문서와 이전 압축 파일은 포함하지 않습니다. 개발·API 문서는 GitHub 저장소에서 확인할 수 있습니다.

업데이트 전 월드를 백업하고, 교체 후 월드와 브라우저를 다시 불러오세요. 함께 사용하는 LichSOMA 모듈도 이번 릴리즈 버전으로 업데이트하는 것을 권장합니다.

## 소개

[LichSOMA's Speaker Selector](https://github.com/LichSOMA/lichsoma-speaker-selector)를 확장하는 모듈입니다. 채팅과 연동된 **스테이지**(스탠딩·대화창), **백스테이지**, 선택적으로 **스테이지 배경**(16:9)·시간대 연동 등을 제공합니다. Speaker Selector와 함께 활성화해야 합니다.

## 호환성·의존성

- **Foundry VTT**: v13 / v14 (`module.json` 기준, 확인 대상은 v14)
- **필수 모듈**: Speaker Selector 4.0.0 이상. 시간대 연동은 Daily Calendar 1.1.0을 권장하며 1.0.0 이상을 지원합니다.

## 설치

1. 모듈 폴더를 Foundry 사용자 데이터의 `Data/modules/lichsoma-speaker-stage`에 배치합니다.
2. 해당 폴더 바로 안에 `module.json`이 있는지 확인합니다.
3. FVTT를 시작하고 월드의 **게임 설정 → 모듈 관리**에서 **LichSOMA's Speaker Stage** 항목을 활성화합니다. 필수 모듈도 함께 활성화합니다.

Manifest URL이 제공된 배포본은 모듈 설치 화면의 **Manifest URL** 입력란을 사용할 수도 있습니다.

```text
https://github.com/LichSOMA/lichsoma-speaker-stage/releases/latest/download/module.json
```

## 주요 기능·사용법

### 캐릭터와 대화창

- GM이 올린 캐릭터는 왼쪽, 플레이어가 올린 캐릭터는 오른쪽에 배치합니다. 진영은 액터 종류나 소유권이 아니라 올린 사용자로 구분합니다.
- 각 진영은 대화창 하나를 공유합니다. PL A 다음 PL B가 말하면 PL 대화창의 이름·대사는 B로 바뀌고 GM 대화창은 유지됩니다.
- **스탠딩 사용**을 켜면 감정별 스탠딩 → 기본 스탠딩 → 포트레잇 순서로 이미지를 선택합니다. 끄면 감정 포트레잇 또는 액터 이미지를 사용하며 배치와 공유 대화 방식은 같습니다.
- 루비(`[[본문|읽기]]`), 굵게·기울임·취소선과 타이핑 연출을 지원합니다. 채팅 입력창에서 직접 작성한 캐릭터 대사를 사용하며 주사위·귓속말·시스템 카드와 `/desc` 묘사는 제외합니다.

### 백스테이지와 퇴거

GM의 백스테이지는 스피커 셀렉터에 등록한 액터를 표시합니다. 포트레잇을 좌클릭하면 무대에 올리거나 스피커를 선택하고, 우클릭하면 무대 등장 여부를 전환합니다. 전구 버튼은 무대 표시를 전환합니다. 플레이어는 할당 캐릭터의 올리기·내리기 버튼을 사용합니다.

실제 스테이지 이미지 위에 마우스를 올리면 퇴거 가능한 캐릭터에 붉은 하이라이트가 표시되고, 우클릭하면 퇴거합니다. GM은 모든 캐릭터를, 플레이어는 자신이 올린 캐릭터를 내릴 수 있습니다. GM 등록 목록에서 뺀 액터는 무대에서도 제거되지만 **플레이어가 직접 올린 캐릭터는 그 목록과 무관하게 유지**합니다.

### 배경과 시간대

스테이지 전용 16:9 배경과 최대 99개 슬롯을 사용할 수 있습니다. 배경 설정에서 오전·오후·심야 이미지를 등록하고 Daily Calendar의 시간대와 연동합니다. 해당 시간대 이미지가 비어 있으면 오전 이미지를 사용하며, 배경을 표시하려면 사용할 이미지가 등록되어 있어야 합니다.

미니 모드는 개인 화면의 배경을 작은 프레임으로 표시합니다. 내러티브 모드는 배경 영역의 캔버스 조작을 제한합니다. 미니 모드는 클라이언트별, 배경·시간대 연동·내러티브 모드는 월드 설정입니다.

### 동기화

첫 번째 활성 GM이 상태 동기화를 담당하며, 담당자가 바뀌면 다른 활성 GM에서 상태 복구를 시도합니다. 초기 접속·재접속 시 현재 상태를 요청합니다. 모든 클라이언트를 종료한 뒤 무대와 이전 대화를 영구 복원하는 기능은 아닙니다. 업데이트 후에는 GM과 PL 모두 새로고침하세요.

## 설정

게임 설정 → 모듈 설정에서 조정합니다.

- **스테이지 중앙 제어**: GM의 무대 표시 여부를 플레이어에게도 적용하고 플레이어의 표시 전환 버튼을 숨깁니다.
- **플레이어 스테이지 미사용**: 플레이어의 등장·퇴거 버튼을 숨기고 기존 PL 등장을 퇴거시킵니다. 플레이어는 GM 무대를 관람하며 일반 채팅은 계속 사용할 수 있습니다. 해제해도 이전 PL 등장을 자동 복원하지는 않습니다.
- **스탠딩 사용·배경·타이핑**: 이미지 방식, 배경 슬롯, 타이핑 속도·사운드·대사 삭제 지연 등을 설정합니다.
- **테마·웹폰트**: 테마는 각 사용자의 셀렉터에서 자동 상속합니다. 캐릭터 이름·대사 웹폰트와 글자 크기는 GM의 월드 설정입니다.

### 웹폰트 CSS 예시

```css
@font-face {
  font-family: "MyStageFont";
  src: url("https://example.com/MyStageFont.woff2") format("woff2");
  font-weight: 700;
  font-style: italic;
  font-display: swap;
}
```

가변 폰트처럼 `@font-face`가 `font-weight: 200 900` 범위를 선언하는 경우 실제 적용 굵기는 다음 설정 블록에서 지정할 수 있습니다.

```css
.lichsoma-webfont-settings {
  font-family: "MyStageVariableFont";
  font-weight: 700;
  font-style: normal;
  font-variation-settings: "wght" 700;
}
```

## 개발 문서

파일 구성·동기화 처리·자동 검사 방법은 [개발 참고](https://github.com/LichSOMA/lichsoma-speaker-stage/blob/main/docs/DEVELOPMENT.md)에 정리했습니다. 자동 검사는 실제 FVTT 다중 클라이언트 검증을 대신하지 않습니다.

## 라이선스·크레딧

MIT License

제작: LichSoma

## 업데이트 내역

### 3.0.0

- 배경 시간대 연동을 Daily Calendar로 통일하고 시간대별 이미지 선택을 보완했습니다.
- 액터별 기본·감정별 스탠딩을 추가했습니다. 별도 스탠딩 이미지 사용 여부와 관계없이 GM/PL 진영별 배치·공유 대화창·발언자 강조를 같은 방식으로 처리합니다.
- 다중 GM의 담당자 처리와 GM/PL 실시간 동기화를 보강했습니다. 재접속·지연·중복 갱신 시 상태 복구와 대사 순서를 개선했습니다.
- 스테이지 이미지의 호버 강조·우클릭 퇴거와 GM의 플레이어 스테이지 제한 설정을 추가했습니다.
- 스피커 셀렉터의 네 테마(심플 다크·라이트, 터미널 그린·레드)를 상속하고, 루비·Markdown 서식을 유지하는 대사 타이핑과 웹폰트 설정을 개선했습니다.
- 배경 표시와 전환을 보완하고 기능별 파일을 분리했습니다. 배치·입력·타이머 관련 오류를 정리했습니다.

### 2.1.0

- 스피커 셀렉터와 연결된 스테이지·백스테이지, 중앙 제어와 배경·시간대 연동을 제공합니다.
