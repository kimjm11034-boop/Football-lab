# Football-lab Agent Guide

## Role Definition
- 스포츠 데이터 과학자 관점에서 전술 데이터를 해석한다.
- 시니어 풀스택 개발자 관점에서 확장 가능한 구조를 설계한다.
- 비전공자를 위한 멘토 관점에서 설명은 쉽게, 구현은 엄격하게 유지한다.

## Project Goal
- 사용자가 직접 그린 전술을 입력으로 받아 수비 반응을 시뮬레이션한다.
- 공간 점유율, 패스 성공률 같은 핵심 분석 지표를 출력한다.
- 연구용 프로토타입에서 시작해 3D 시각화와 비디오 분석까지 단계적으로 확장한다.

## Roadmap
1. 11vs11 시뮬레이션: 점/선 기반 시각화, 기본 물리, 수비 AI
2. 분석 기법 고도화: Voronoi, xG, EPV, GNN 패스 네트워크
3. 3D 시각화: Three.js/WebGL
4. 비디오 분석: 객체 탐지 및 트래킹
5. 실경기 데이터 연동 및 최적화

## Working Rules
1. 작업 시작 전 최소 3가지 구현 방안을 비교하고 최적안을 선택한다.
2. 새 기능은 항상 기존 코드와의 호환성 및 변경 영향을 먼저 검토한다.
3. 코드 설명에는 파일 경로, import 역할, 함수 목적, 전술적 의미를 포함한다.
4. 답변은 한국어로 작성한다.
5. 실행 가이드는 변경될 때마다 함께 갱신한다.
6. 코드를 수정한 뒤에는 반드시 타입 검사, 빌드, 또는 컴파일 검토를 수행하고 오류가 있으면 바로 수정한다.

## Source Policy
- 기술 문서는 공식 문서를 우선한다.
- 스포츠 데이터 분석은 StatsBomb, Opta, 논문 등 1차 자료를 우선한다.
- 최신성이나 정확성이 중요한 정보는 검증 후 반영한다.

## Initial Stack
- Frontend: React, TypeScript, Vite, Konva.js, D3.js
- Backend: FastAPI, NumPy, SciPy
- Data: JSON 기반 전술 이벤트 및 포지셔닝 데이터

## Guide Docs
이 섹션은 "어느 파일이 무엇을 하는지", "주요 const/function이 무엇을 뜻하는지", "최근 어떤 구조 변경이 있었는지"를 기록한다.
앞으로 새 기능을 만들거나 기존 코드를 수정할 때마다 이 섹션도 함께 갱신한다.

### frontend/src/main.tsx
- 역할: 프런트엔드 진입점. `BrowserRouter`로 라우팅 컨텍스트를 감싼 뒤 `App`을 브라우저 DOM의 `#root`에 마운트한다.
- 핵심 import:
  - `react-dom/client`: React 앱을 실제 브라우저 DOM에 렌더링한다.
  - `react-router-dom`의 `BrowserRouter`: 홈/시뮬레이션/분석 URL 라우팅 컨텍스트를 제공한다.
  - `./App`: 메인 UI와 시뮬레이션 로직이 들어 있는 핵심 컴포넌트다.
  - `./styles.css`: 전체 화면 레이아웃과 컴포넌트 스타일을 담당한다.

### frontend/src/App.tsx
- 역할: 현재 프로젝트의 핵심 화면/상태/시뮬레이션/분석 로직을 담당하는 메인 컴포넌트다.
- 전술적 의미:
  - 사용자가 직접 패스와 이동을 그려 빌드업 시퀀스를 만든다.
  - 각 이벤트마다 수비 반응을 자동 생성한다.
  - 시퀀스별로 전진성, 압박, 폭 활용, 공간 점유를 시각화한다.

#### 주요 const
- `PITCH_WIDTH`, `PITCH_HEIGHT`, `PITCH_PADDING`
  - 경기장 캔버스 크기와 안쪽 여백이다.
- `PLAYER_RADIUS`
  - 선수 토큰 원 반지름이다.
- `BALL_ANIMATION_DURATION_MS`, `MOVE_ANIMATION_DURATION_MS`
  - 패스/이동 애니메이션 재생 시간이다.
- `PITCH_LENGTH_METERS`, `PITCH_WIDTH_METERS`
  - 캔버스 좌표를 실제 축구장 미터 단위로 환산할 때 기준이 된다.
- `PLAYBACK_SPEED_OPTIONS`
  - 플레이백 속도 선택지다.
- `API_BASE_URL`
  - FastAPI 백엔드 분석 엔드포인트 기본 주소다.

#### 주요 type
- `PlayerNode`
  - 선수 1명의 현재 위치, 팀, 색상, 라벨을 담는다.
- `PassLink`
  - 선수 간 패스 이벤트 1개를 뜻한다.
- `MovementPath`
  - 선수 이동 이벤트 1개를 뜻한다.
- `ShotEvent`
  - 슈팅 이벤트 1개를 뜻한다. 슈팅 시작 좌표, 목표 좌표, xG 값, 결과(`득점/유효슈팅/빗나감/차단`)를 함께 가진다.
- `TacticSequence`
  - 패스/이동 이벤트를 묶어 하나의 전술 시퀀스로 관리하는 구조다.
- `SequenceAnalysisResult`
  - 백엔드 분석 결과와 수비 시프트 응답을 담는 구조다.

#### 주요 function
- `buildTimelineEvents`
  - 패스와 이동을 하나의 시간축 이벤트 목록으로 정렬한다.
- `getBoardSnapshotAtElapsed`
  - 특정 시점의 선수 위치, 공 상태, 활성 이벤트를 계산한다.
- `getSequenceScopedEvents`
  - 선택한 시퀀스에 포함된 패스/이동만 따로 뽑는다.
  - 중요 이유: 시퀀스 1 작업 흔적이 시퀀스 2 작업 화면에 겹쳐 보이지 않게 만든다.
- `buildAutomaticDefensiveShift`
  - 패스나 이동이 생길 때마다 상대 수비 반응 단계를 자동 생성한다.
  - 중요 이유: 사용자가 공격과 수비를 따로 모두 입력하지 않아도 된다.
- `getPlaybackDefensiveShiftState`
  - 플레이백 중 현재 이벤트 단계에 맞는 수비 시프트 진행률을 계산한다.
- `focusSequence`
  - 특정 시퀀스를 작업 보드에 불러와 그 시퀀스만 집중해서 보게 한다.
- `resetWorkingBoard`
  - 저장된 시퀀스와 분석 기록은 유지한 채 현재 작업 보드만 초기화한다.
- `clearAllProjectData`
  - 모든 시퀀스/경로/분석 기록을 완전히 삭제한다.
- `buildVoronoiCells`
  - 선수 영향 구역을 Voronoi 다이어그램으로 만든다.
- `buildPassNetworkEdges`
  - 패스 빈도를 가중치로 갖는 패스 네트워크 선을 만든다.
- `buildThreatPoints`
  - 패스/이동/슈팅 이벤트를 xG 위협 포인트로 변환한다.
- `buildEpvHeatCells`
  - 공간의 예상 점유 가치를 EPV 프록시 히트맵으로 만든다.
- `navigateToScreen`
  - 홈/시뮬레이션/분석 화면을 URL 기반으로 전환한다.
- `recordShot`
  - 현재 공 소유 선수가 클릭한 목표 지점으로 슈팅 이벤트를 기록하고 결과를 자동 분류한다.
- `toggleShotMode`
  - 슈팅 모드를 켜거나 꺼서 경기장 클릭 입력을 슈팅 이벤트로 바꾼다.
- `resolveShotOutcome`
  - 슈팅 각도, 차단 각, 슈터 압박, 골키퍼 개입 거리를 함께 보고 슈팅 결과를 분류한다.
- `getShotOutcomeLabel`
  - 슈팅 결과 코드를 한국어 라벨로 바꾼다.
- `getShotAngleDegrees`
  - 슈팅 위치에서 골문이 얼마나 열려 있는지 각도 기준으로 계산한다.

### frontend/src/components/AdvancedAnalysisPanel.tsx
- 역할: 분석 화면의 무거운 시각화 카드 묶음을 별도 청크로 분리해 지연 로딩하는 컴포넌트다.
- 전술적 의미:
  - Voronoi로 공간 점유를 보고,
  - 패스 네트워크로 연결 구조를 보고,
  - xG/EPV 프록시와 슈팅 결과 분포로 마무리 위협을 읽는다.
  - 카드 확대 모드로 특정 분석을 크게 읽고 세부 패턴만 집중해서 볼 수 있다.
- 주요 function:
  - `buildVoronoiCells`
    - 선수 영향 구역 다각형을 계산한다.
  - `buildPassNetworkEdges`
    - 패스 빈도 기반 네트워크 선 가중치를 만든다.
  - `buildThreatPoints`
    - 패스/이동/슈팅을 위협 지점 카드 데이터로 바꾼다. 백엔드 값이 있으면 백엔드 결과를 우선 사용한다.
  - `buildEpvHeatCells`
    - EPV 프록시 히트맵 셀을 만든다. 백엔드 응답이 없을 때 프런트 fallback으로 사용한다.
  - `buildShotOutcomeData`
    - 득점/유효슈팅/빗나감/차단 분포를 막대 카드용 데이터로 만든다.
  - `expandedCardId`
    - 어떤 분석 카드를 확대 모달로 열었는지 추적하는 상태다.

### frontend/src/styles.css
- 역할: 홈 화면, 시뮬레이션 화면, 분석 화면, 시퀀스 패널, 차트 카드, 보드 버튼의 시각 스타일을 담당한다.
- 최근 중요 클래스:
  - `.screen-nav`: 화면 전환 버튼 줄
  - `.home-panel`, `.home-card-grid`: 홈 화면 가이드 레이아웃
  - `.analysis-visual-grid`: 분석 카드 그리드
  - `.analysis-mini-pitch`: Voronoi/패스 네트워크/xG/EPV 미니 피치 SVG
  - `.analysis-modal-backdrop`, `.analysis-modal`: 분석 카드 확대 보기 오버레이
  - `.analysis-card-expand`: 카드 확대 버튼

### frontend/vite.config.ts
- 역할: Vite 개발 서버와 프런트 빌드 청크 분할 정책을 설정한다.
- 주요 설정:
  - `manualChunks`
    - `konva` 계열과 분석(`d3-delaunay`) 계열을 분리해 메인 번들 크기 경고를 줄인다.

### backend/app/main.py
- 역할: FastAPI 분석 API 구현 파일
- 주요 function:
  - `get_xg_proxy_value`
    - 거리, 골대 개방 각도, 중앙성을 바탕으로 xG 프록시를 계산한다.
  - `get_epv_value`
    - 전진성, 중앙성, 슈팅 접근성을 합쳐 EPV 프록시를 계산한다.
  - `build_threat_points`
    - 선택 시퀀스의 패스/이동/슈팅을 백엔드 위협 포인트로 정리한다.
  - `build_epv_heatmap`
    - 분석 화면에 필요한 EPV 히트맵 셀을 생성한다.
  - `build_shot_outcomes`
    - 슈팅 결과 분포를 요약한다.
  - `build_shift_stage_note`
    - 이벤트별 수비 반응을 마킹 우선순위와 라인 간격 유지 관점에서 설명한다.
  - `build_defensive_shift`
    - 선택 시퀀스를 바탕으로 수비 시프트 요약과 단계별 반응을 계산한다.
    - 가까운 수비수 우선 마킹, 뒤 라인의 과도한 전진 억제, 수평 간격 유지 규칙이 포함된다.
  - `build_shift_points`
    - 수비수별 목표 이동 좌표를 계산한다.
    - 우선순위가 높은 수비수는 더 공격적으로 반응하고, 나머지는 라인 폭을 유지하며 슬라이드한다.
  - `summarize_shift_line`
    - 평균 시프트 거리, 라인 높이, 라인 폭을 계산한다.
  - `build_coaching_note`
    - 전진성, 압박, 폭 활용, 슈팅 마무리 여부를 종합해 코칭 메모를 만든다.

### backend/app/models.py
- 역할: FastAPI 요청/응답의 Pydantic 모델 정의 파일
- 주요 모델:
  - `SequenceAnalysisRequest`
  - `SequenceAnalysisResponse`
  - `DefensiveShiftSummary`
  - `DefensiveShiftStage`
  - `ShotRecord`
    - 슈팅 이벤트와 결과를 API 요청에서 검증하는 모델이다.
  - `ThreatPoint`
    - 백엔드 xG 위협 포인트 응답 모델이다.
  - `EpvHeatCell`
    - 백엔드 EPV 히트맵 셀 응답 모델이다.
  - `ShotOutcomeSummary`
    - 득점/유효슈팅/빗나감/차단 분포 응답 모델이다.

### README.md
- 역할: 실행 방법, 현재 기능, 개발 진입 가이드를 설명하는 사용자 문서다.
- 규칙: `npm run dev`, 백엔드 실행법, 새 화면 흐름, 주요 기능이 바뀌면 항상 업데이트한다.

## Change Log
### 2026-03-01
- 홈 / 시뮬레이션 / 분석 화면을 URL 기반으로 분리했다.
- 시퀀스 선택 시 해당 시퀀스의 패스/이동만 보이게 바꿨다.
- 작업 보드 초기화와 전체 기록 삭제를 분리했다.
- 분석 화면에 Voronoi, 패스 네트워크, xG 프록시, EPV 프록시 시각화를 추가했다.
- 자동 수비 반응이 이벤트별로 계속 보이도록 유지했다.
- `react-router-dom` 기반 브라우저 라우팅 컨텍스트를 도입했다.
- 슈팅 모드와 `ShotEvent`를 추가해 xG/EPV가 실제 슈팅 입력도 반영하게 바꿨다.
- 슈팅 결과를 `득점 / 유효슈팅 / 빗나감 / 차단`으로 자동 분류하고 플레이백 메시지와 분석 카드에 반영했다.
- 분석 화면의 무거운 SVG 카드 묶음을 `AdvancedAnalysisPanel`로 분리하고 lazy loading + manualChunks로 번들 경고를 줄였다.
- 백엔드 분석 API가 `shot` 이벤트와 슈팅 결과를 공식적으로 처리하도록 모델과 로직을 확장했다.
- 홈/시뮬레이션/분석 화면을 이미지 예시 방향에 맞춰 `히어로 홈`, `오른쪽 컨트롤 센터`, `하단 분석 대시보드` 구조로 재배치했다.
- xG/EPV 프록시 계산과 슈팅 결과 분포를 FastAPI 응답으로 내려서 분석 화면이 백엔드 결과를 우선 사용하게 바꿨다.
- 분석 카드에 `확대 보기` 모드를 추가해 Voronoi, 패스 네트워크, xG, EPV 등을 크게 볼 수 있게 했다.
- 수비 시프트가 단순 전원 이동이 아니라 우선 마킹, 라인 폭 유지, 깊은 수비수 보수적 전진 규칙을 따르도록 보강했다.

## Documentation Rule
- 앞으로 새 const, type, function, 파일이 추가되면 이 문서의 `Guide Docs`에 반드시 요약을 추가한다.
- 구조를 바꾸는 수정이면 `Change Log`에 날짜와 핵심 변경점을 남긴다.
