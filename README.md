# History Cleaner (Manifest V3)

브라우저 시작 시점(`chrome.runtime.onStartup`)에 사용자가 선택한 브라우징 데이터를 자동으로 삭제하는 크롬 확장 프로그램입니다.

## 1. 프로젝트 구조

```text
History-Cleaner/
├── manifest.json
├── src/
│   ├── background.js
│   ├── popup.html
│   ├── popup.css
│   └── popup.js
└── README.md
```

## 2. 파일 역할

- `manifest.json`: 확장 프로그램 메타 정보, 권한, 백그라운드 서비스 워커, 팝업 등록
- `src/background.js`: 시작 시 자동 삭제 실행 로직
- `src/popup.html`: 체크박스 기반 설정 UI
- `src/popup.css`: 팝업 스타일
- `src/popup.js`: 설정 불러오기/저장/의존성(방문 기록-typed URLs) 제어

## 3. 삭제 대상 항목

- 방문 기록 (`history`)
- 폼 데이터 (`formData`)
- 주소창 입력 기록 (`typed URLs`, `history` API 기반 별도 처리)
- 캐시 (`cache`)
- 쿠키 (`cookies`)

## 4. 동작 방식 핵심

1. 사용자가 팝업에서 체크박스를 선택/해제합니다.
2. 선택값은 `chrome.storage.local`의 `cleanupSettings`에 저장됩니다.
3. Chrome 시작 시 `src/background.js`가 저장값을 읽습니다.
4. `chrome.browsingData.remove({ since: 0 }, dataTypes)`로 전체 기간 데이터를 삭제합니다.
5. 단, `방문 기록 OFF + typed URLs ON`인 경우에는 `chrome.history` API로 주소창 전이(`typed`, `generated`, `keyword*`) 기반 URL을 추가 삭제합니다.
6. 시작 직후 동기화로 기록이 다시 보일 수 있어, 1분 뒤 `chrome.alarms`로 한 번 더 정리합니다.

## 5. 설치 방법 (개발자 모드)

1. Chrome 주소창에 `chrome://extensions` 입력 후 접속합니다.
2. 오른쪽 위 `개발자 모드`를 켭니다.
3. `압축해제된 확장 프로그램을 로드`를 클릭합니다.
4. `History-Cleaner` 폴더를 선택합니다.
5. 확장 목록에 `History Cleaner`가 나타나는지 확인합니다.

## 6. 테스트 방법

1. 확장 아이콘을 눌러 팝업을 열고 체크박스를 원하는 값으로 설정합니다.
2. 팝업을 닫고 다시 열어 설정이 유지되는지 확인합니다.
3. 브라우저를 완전히 종료한 뒤 다시 실행합니다.
4. 방문 기록/쿠키/캐시/주소창 제안 결과가 설정대로 정리되었는지 확인합니다.
5. 필요하면 `chrome://extensions` -> 해당 확장 `서비스 워커`에서 콘솔 로그를 확인합니다.

## 7. 중요한 제약 사항

- 본 구현은 안정성을 위해 **시작 시점(onStartup) 자동 삭제**를 우선 구현합니다.
- 종료 시점 자동 삭제는 MV3 서비스 워커 특성상 신뢰성이 낮아 포함하지 않았습니다.
- 방문 기록 삭제를 켜면 typed URLs는 방문 기록에 포함되어 함께 삭제됩니다.
  - 그래서 UI에서 방문 기록 ON 상태일 때 typed URLs는 자동 ON + 비활성 처리됩니다.
- 주소창 제안은 방문 기록 외에도 북마크, 동기화된 기록, 검색엔진 실시간 제안이 섞일 수 있습니다.
  - 따라서 `typed URLs`만 켠 상태는 best-effort 정리이며, 주소창 제안을 강하게 줄이려면 `방문 기록`도 함께 켜는 것이 안전합니다.
