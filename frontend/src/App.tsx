import { Suspense, lazy, useEffect, useRef, useState, type ChangeEvent } from "react";
import { Stage, Layer, Rect, Circle, Text, Line, Group, Arrow, Image as KonvaImage } from "react-konva";
import { useLocation, useNavigate } from "react-router-dom";
import ballImageUrl from "./assets/ball.svg";

const PITCH_WIDTH = 900;
const PITCH_HEIGHT = 560;
const PITCH_PADDING = 24;
const PLAYER_RADIUS = 18;
const ARROW_HEAD_SIZE = 10;
const BALL_SIZE = 28;
const BALL_ANIMATION_DURATION_MS = 650;
const MOVE_ANIMATION_DURATION_MS = 700;
const PITCH_LENGTH_METERS = 105;
const PITCH_WIDTH_METERS = 68;
const INITIAL_BALL_OWNER_ID = "h7";
const DEFAULT_INTERACTION_MESSAGE = "공을 가진 선수를 먼저 선택한 뒤, 받을 선수를 클릭해 패스를 만드세요.";
const PLAYBACK_SPEED_OPTIONS = [0.75, 1, 1.5] as const;
const MOVE_DISTANCE_THRESHOLD = 4;
const API_BASE_URL = "http://localhost:8000";
const GOAL_MOUTH_HALF_HEIGHT = 44;
const GOAL_TARGET_DEPTH = 54;
const SHOT_BLOCK_DISTANCE_METERS = 3.4;
const SHOT_PRESSURE_DISTANCE_METERS = 4.8;
const SHOT_SAVE_DISTANCE_METERS = 5.8;
const GOAL_VISUAL_WIDTH_METERS = 7.32;
const GOAL_HALF_WIDTH_CANVAS = ((GOAL_VISUAL_WIDTH_METERS / PITCH_WIDTH_METERS) * PITCH_HEIGHT) / 2;

type Team = "home" | "away";
type AppScreen = "home" | "simulation" | "analysis";
type ShotOutcome = "goal" | "saved" | "off_target" | "blocked";

type PlayerNode = {
  id: string;
  label: string;
  x: number;
  y: number;
  fill: string;
  stroke: string;
  team: Team;
};

type PassLink = {
  id: string;
  fromId: string;
  toId: string;
  atMs: number;
  durationMs: number;
};

type MovementPath = {
  id: string;
  playerId: string;
  team: Team;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  atMs: number;
  durationMs: number;
  carriesBall: boolean;
};

type ShotEvent = {
  id: string;
  playerId: string;
  team: Team;
  fromX: number;
  fromY: number;
  targetX: number;
  targetY: number;
  atMs: number;
  durationMs: number;
  xg: number;
  outcome: ShotOutcome;
};

type PassProbability = {
  value: number;
  label: string;
  color: string;
  tier: string;
};

type PassAnalysis = {
  probability: PassProbability;
  distanceMeters: number;
  progressionMeters: number;
  nearestOpponentGapMeters: number;
  pressurePenalty: number;
  directionBonus: number;
};

type MovementAnalysis = {
  distanceMeters: number;
  durationMs: number;
  speedMetersPerSecond: number;
  carriesBall: boolean;
};

type BallState = {
  x: number;
  y: number;
  ownerId: string | null;
  isAnimating: boolean;
};

type BallAnimation = {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  targetPlayerId: string;
  startTime: number;
  durationMs: number;
  source: "manual" | "playback";
  passId: string | null;
};

type ActivePlaybackEvent =
  | { kind: "pass"; id: string }
  | { kind: "move"; id: string }
  | { kind: "shot"; id: string };

type SequenceEventRef = ActivePlaybackEvent;

type TacticSequence = {
  id: string;
  name: string;
  eventRefs: SequenceEventRef[];
  startAtMs: number;
  endAtMs: number;
  createdAt: string;
};

type ExportedPlayer = {
  id: string;
  label: string;
  team: Team;
  x: number;
  y: number;
};

type ExportedPass = {
  id: string;
  fromId: string;
  toId: string;
  atMs: number;
  durationMs: number;
  probability: number | null;
  distanceMeters: number | null;
  progressionMeters: number | null;
  nearestOpponentGapMeters: number | null;
};

type ExportedMovement = {
  id: string;
  playerId: string;
  team: Team;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  atMs: number;
  durationMs: number;
  carriesBall: boolean;
};

type ExportedShot = ShotEvent;

type ExportedSequence = TacticSequence;

type DefensiveShiftPoint = {
  playerId: string;
  label: string;
  team: Team;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  shiftDistanceMeters: number;
};

type DefensiveShiftStage = {
  eventId: string;
  eventKind: "pass" | "move" | "shot";
  atMs: number;
  durationMs: number;
  note: string;
  averageShiftDistanceMeters: number;
  points: DefensiveShiftPoint[];
};

type DefensiveShiftSummary = {
  defending_team: Team;
  average_shift_distance_m: number;
  line_compactness_m: number;
  line_height_m: number;
  note: string;
  points: DefensiveShiftPoint[];
  stages: DefensiveShiftStage[];
};

type DefensiveShiftRenderPoint = {
  playerId: string;
  x: number;
  y: number;
};

type DefensiveShiftPlaybackState = {
  fromPoints: DefensiveShiftRenderPoint[];
  toPoints: DefensiveShiftRenderPoint[];
  progress: number;
  activeStage: DefensiveShiftStage | null;
};

type AnalysisDistributionDatum = {
  label: string;
  value: number;
  color: string;
};

type BackendThreatPoint = {
  id: string;
  x: number;
  y: number;
  team: Team;
  label: string;
  xg: number;
  source: "pass" | "move" | "shot";
};

type BackendEpvHeatCell = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  value: number;
};

type BackendShotOutcomeSummary = {
  outcome: ShotOutcome;
  label: string;
  count: number;
};

type SequenceAnalysisHistoryEntry = {
  analyzed_at: string;
  result: SequenceAnalysisResult;
};

type ExportedAnalysisHistory = Record<string, SequenceAnalysisHistoryEntry[]>;

type ExportedBaseState = {
  players: ExportedPlayer[];
  ball: {
    ownerId: string | null;
    position: {
      x: number;
      y: number;
    };
  };
};

type ExportedBoardPayload = {
  exportedAt: string;
  pitch: {
    canvasWidth: number;
    canvasHeight: number;
    lengthMeters: number;
    widthMeters: number;
  };
  ball: {
    ownerId: string | null;
    isAnimating: boolean;
    position: {
      x: number;
      y: number;
    };
  };
  players: ExportedPlayer[];
  passes: ExportedPass[];
  movements: ExportedMovement[];
  shots: ExportedShot[];
  sequences: ExportedSequence[];
  analysisHistory: ExportedAnalysisHistory;
  base: ExportedBaseState;
};

type SequenceAnalysisRequestPayload = {
  sequence_id: string;
  players: ExportedPlayer[];
  passes: {
    id: string;
    fromId: string;
    toId: string;
    atMs: number;
    durationMs: number;
  }[];
  movements: ExportedMovement[];
  shots: ExportedShot[];
  sequences: ExportedSequence[];
  base: ExportedBaseState;
};

type SequenceAnalysisResult = {
  sequence_id: string;
  sequence_name: string;
  pass_count: number;
  movement_count: number;
  shot_count: number;
  on_target_shot_count: number;
  goal_count: number;
  carry_count: number;
  total_duration_ms: number;
  average_pass_distance_m: number;
  total_progression_m: number;
  total_movement_distance_m: number;
  average_event_gap_ms: number;
  pressure_index: number;
  support_width_m: number;
  team_metrics: {
    home_events: number;
    away_events: number;
    dominant_team: string;
  };
  coaching_note: string;
  threat_points: BackendThreatPoint[];
  epv_heatmap: BackendEpvHeatCell[];
  shot_outcomes: BackendShotOutcomeSummary[];
  defensive_shift: DefensiveShiftSummary;
};

type ImportSuccess = {
  ok: true;
  players: PlayerNode[];
  passes: PassLink[];
  movements: MovementPath[];
  shots: ShotEvent[];
  sequences: TacticSequence[];
  analysisHistory: ExportedAnalysisHistory;
  ballState: BallState;
  basePlayers: PlayerNode[];
  baseBallState: BallState;
};

type ImportFailure = {
  ok: false;
  error: string;
};

type ImportResult = ImportSuccess | ImportFailure;

const initialPlayers: PlayerNode[] = [
  { id: "h1", label: "1", x: 80, y: 280, fill: "#f8fafc", stroke: "#0f172a", team: "home" },
  { id: "h2", label: "2", x: 180, y: 110, fill: "#f8fafc", stroke: "#0f172a", team: "home" },
  { id: "h3", label: "3", x: 180, y: 220, fill: "#f8fafc", stroke: "#0f172a", team: "home" },
  { id: "h4", label: "4", x: 180, y: 340, fill: "#f8fafc", stroke: "#0f172a", team: "home" },
  { id: "h5", label: "5", x: 180, y: 450, fill: "#f8fafc", stroke: "#0f172a", team: "home" },
  { id: "h6", label: "6", x: 360, y: 150, fill: "#f8fafc", stroke: "#0f172a", team: "home" },
  { id: "h7", label: "7", x: 360, y: 280, fill: "#f8fafc", stroke: "#0f172a", team: "home" },
  { id: "h8", label: "8", x: 360, y: 410, fill: "#f8fafc", stroke: "#0f172a", team: "home" },
  { id: "h9", label: "9", x: 560, y: 170, fill: "#f8fafc", stroke: "#0f172a", team: "home" },
  { id: "h10", label: "10", x: 620, y: 280, fill: "#f8fafc", stroke: "#0f172a", team: "home" },
  { id: "h11", label: "11", x: 560, y: 390, fill: "#f8fafc", stroke: "#0f172a", team: "home" },
  { id: "a1", label: "1", x: 820, y: 280, fill: "#dc2626", stroke: "#fee2e2", team: "away" },
  { id: "a2", label: "2", x: 720, y: 110, fill: "#dc2626", stroke: "#fee2e2", team: "away" },
  { id: "a3", label: "3", x: 720, y: 220, fill: "#dc2626", stroke: "#fee2e2", team: "away" },
  { id: "a4", label: "4", x: 720, y: 340, fill: "#dc2626", stroke: "#fee2e2", team: "away" },
  { id: "a5", label: "5", x: 720, y: 450, fill: "#dc2626", stroke: "#fee2e2", team: "away" },
  { id: "a6", label: "6", x: 540, y: 150, fill: "#dc2626", stroke: "#fee2e2", team: "away" },
  { id: "a7", label: "7", x: 540, y: 280, fill: "#dc2626", stroke: "#fee2e2", team: "away" },
  { id: "a8", label: "8", x: 540, y: 410, fill: "#dc2626", stroke: "#fee2e2", team: "away" },
  { id: "a9", label: "9", x: 340, y: 170, fill: "#dc2626", stroke: "#fee2e2", team: "away" },
  { id: "a10", label: "10", x: 280, y: 280, fill: "#dc2626", stroke: "#fee2e2", team: "away" },
  { id: "a11", label: "11", x: 340, y: 390, fill: "#dc2626", stroke: "#fee2e2", team: "away" }
];

const AdvancedAnalysisPanel = lazy(() => import("./components/AdvancedAnalysisPanel"));

/**
 * 좌표를 경기장 내부 범위로 제한합니다.
 *
 * @param value 검사할 좌표 값입니다.
 * @param min 허용 최소값입니다.
 * @param max 허용 최대값입니다.
 * @returns 경기장 경계를 넘지 않도록 보정된 좌표입니다.
 */
function clampPosition(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

/**
 * 선수 ID로 현재 선수 객체를 찾습니다.
 *
 * @param players 전체 선수 목록입니다.
 * @param playerId 찾고 싶은 선수 ID입니다.
 * @returns 일치하는 선수가 있으면 해당 객체를 반환합니다.
 */
function getPlayerById(players: PlayerNode[], playerId: string) {
  return players.find((player) => player.id === playerId);
}

/**
 * 팀에 맞는 기본 시각 스타일을 반환합니다.
 *
 * @param team 선수 소속 팀입니다.
 * @returns 팀 색상에 맞는 토큰 스타일입니다.
 */
function getPlayerAppearance(team: Team) {
  if (team === "home") {
    return { fill: "#f8fafc", stroke: "#0f172a" };
  }

  return { fill: "#dc2626", stroke: "#fee2e2" };
}

/**
 * 캔버스 좌표 차이를 실제 경기장 미터 단위 거리로 근사 변환합니다.
 *
 * @param fromX 시작 x 좌표입니다.
 * @param fromY 시작 y 좌표입니다.
 * @param toX 도착 x 좌표입니다.
 * @param toY 도착 y 좌표입니다.
 * @returns 두 점 사이의 근사 거리(m)입니다.
 */
function getScaledDistance(fromX: number, fromY: number, toX: number, toY: number) {
  const scaledDx = (toX - fromX) * (PITCH_LENGTH_METERS / PITCH_WIDTH);
  const scaledDy = (toY - fromY) * (PITCH_WIDTH_METERS / PITCH_HEIGHT);

  return Math.hypot(scaledDx, scaledDy);
}

/**
 * 확률 값을 시각화 가능한 범위로 제한합니다.
 *
 * @param value 원시 확률 값입니다.
 * @returns 0.1~0.95 범위로 제한된 확률입니다.
 */
function clampProbability(value: number) {
  return Math.min(Math.max(value, 0.1), 0.95);
}

/**
 * 수비수 한 명이 패스 라인에 얼마나 가까운지 계산합니다.
 *
 * @param pointX 수비수 x 좌표입니다.
 * @param pointY 수비수 y 좌표입니다.
 * @param fromX 패스 시작 x 좌표입니다.
 * @param fromY 패스 시작 y 좌표입니다.
 * @param toX 패스 도착 x 좌표입니다.
 * @param toY 패스 도착 y 좌표입니다.
 * @returns 수비수와 패스 라인 사이의 최단 거리(m)입니다.
 */
function getDistanceToSegmentMeters(
  pointX: number,
  pointY: number,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number
) {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const lengthSquared = dx * dx + dy * dy;

  if (lengthSquared === 0) {
    return getScaledDistance(pointX, pointY, fromX, fromY);
  }

  const projection = ((pointX - fromX) * dx + (pointY - fromY) * dy) / lengthSquared;
  const t = Math.min(Math.max(projection, 0), 1);
  const nearestX = fromX + t * dx;
  const nearestY = fromY + t * dy;

  return getScaledDistance(pointX, pointY, nearestX, nearestY);
}

/**
 * 팀 기준으로 공격 골문 중심 X 좌표를 구합니다.
 *
 * @param team 공격 팀입니다.
 * @returns 해당 팀이 노리는 골문 중심 X 좌표입니다.
 */
function getGoalCenterX(team: Team) {
  return team === "home" ? PITCH_WIDTH - PITCH_PADDING : PITCH_PADDING;
}

/**
 * 팀 기준 골대 양쪽 포스트 좌표를 계산합니다.
 *
 * @param team 공격 팀입니다.
 * @returns 왼쪽/오른쪽 포스트 좌표입니다.
 */
function getGoalPostTargets(team: Team) {
  const centerX = getGoalCenterX(team);
  const centerY = PITCH_HEIGHT / 2;
  return {
    leftPost: { x: centerX, y: centerY - GOAL_HALF_WIDTH_CANVAS },
    rightPost: { x: centerX, y: centerY + GOAL_HALF_WIDTH_CANVAS }
  };
}

/**
 * 슈팅 위치에서 보이는 골대 개방 각도를 계산합니다.
 *
 * @param x 슈팅 위치 X 좌표입니다.
 * @param y 슈팅 위치 Y 좌표입니다.
 * @param team 공격 팀입니다.
 * @returns 골대 개방 각도(도)입니다.
 */
function getShotAngleDegrees(x: number, y: number, team: Team) {
  const { leftPost, rightPost } = getGoalPostTargets(team);
  const leftDx = leftPost.x - x;
  const leftDy = leftPost.y - y;
  const rightDx = rightPost.x - x;
  const rightDy = rightPost.y - y;
  const leftLength = Math.hypot(leftDx, leftDy);
  const rightLength = Math.hypot(rightDx, rightDy);

  if (leftLength === 0 || rightLength === 0) {
    return 0;
  }

  const cosine = Math.min(Math.max((leftDx * rightDx + leftDy * rightDy) / (leftLength * rightLength), -1), 1);
  return (Math.acos(cosine) * 180) / Math.PI;
}

/**
 * 위치 한 점의 간단한 xG 프록시 값을 계산합니다.
 *
 * @param x 위치의 X 좌표입니다.
 * @param y 위치의 Y 좌표입니다.
 * @param team 공격 팀입니다.
 * @returns 0~1 사이의 위협도 값입니다.
 */
function getXgProxyValue(x: number, y: number, team: Team) {
  const goalX = getGoalCenterX(team);
  const goalY = PITCH_HEIGHT / 2;
  const distance = getScaledDistance(x, y, goalX, goalY);
  const centrality = 1 - Math.min(Math.abs(y - goalY) / (PITCH_HEIGHT / 2), 1);
  const angleFactor = Math.min(getShotAngleDegrees(x, y, team) / 38, 1);
  const distanceFactor = 1 - Math.min(distance / 40, 1);
  return Number(Math.max(distanceFactor * 0.46 + angleFactor * 0.38 + centrality * 0.16, 0.02).toFixed(2));
}

/**
 * 슈팅이 유효 범위 안으로 향하는지 판정합니다.
 *
 * @param team 공격 팀입니다.
 * @param targetX 슈팅 목표 X 좌표입니다.
 * @param targetY 슈팅 목표 Y 좌표입니다.
 * @returns 골문 안쪽으로 향하면 `true`입니다.
 */
function isShotOnTarget(team: Team, targetX: number, targetY: number) {
  const horizontalGap = Math.abs(targetX - getGoalCenterX(team));
  const verticalGap = Math.abs(targetY - PITCH_HEIGHT / 2);
  return horizontalGap <= GOAL_TARGET_DEPTH && verticalGap <= GOAL_MOUTH_HALF_HEIGHT;
}

/**
 * 슈팅 팀 기준 상대 골키퍼 ID를 반환합니다.
 *
 * @param team 슈팅 팀입니다.
 * @returns 상대 골키퍼 선수 ID입니다.
 */
function getGoalkeeperIdForShot(team: Team) {
  return team === "home" ? "a1" : "h1";
}

/**
 * 슈팅 결과를 사람에게 보여줄 한국어 라벨로 변환합니다.
 *
 * @param outcome 슈팅 결과 코드입니다.
 * @returns 분석/플레이백 UI에 표시할 라벨입니다.
 */
function getShotOutcomeLabel(outcome: ShotOutcome) {
  switch (outcome) {
    case "goal":
      return "득점";
    case "saved":
      return "유효슈팅";
    case "blocked":
      return "차단";
    default:
      return "빗나감";
  }
}

/**
 * 슈팅 결과에 맞는 색상 스타일을 반환합니다.
 *
 * @param outcome 슈팅 결과 코드입니다.
 * @returns 화살표와 배지에 사용할 색상 정보입니다.
 */
function getShotOutcomeStyle(outcome: ShotOutcome) {
  switch (outcome) {
    case "goal":
      return { stroke: "#22c55e", fill: "#14532d", accent: "#bbf7d0" };
    case "saved":
      return { stroke: "#38bdf8", fill: "#082f49", accent: "#bae6fd" };
    case "blocked":
      return { stroke: "#ef4444", fill: "#450a0a", accent: "#fecaca" };
    default:
      return { stroke: "#f59e0b", fill: "#451a03", accent: "#fde68a" };
  }
}

/**
 * 현재 선수 배치를 기준으로 슈팅 결과를 단순 휴리스틱으로 분류합니다.
 *
 * @param players 현재 선수 위치 목록입니다.
 * @param shot 판정할 슈팅 이벤트입니다.
 * @returns 득점/유효슈팅/빗나감/차단 중 하나입니다.
 */
function resolveShotOutcome(players: PlayerNode[], shot: Omit<ShotEvent, "outcome">) {
  const opponents = players.filter((player) => player.team !== shot.team);
  const goalkeeper = getPlayerById(players, getGoalkeeperIdForShot(shot.team));
  const fieldDefenders = opponents.filter((player) => player.id !== getGoalkeeperIdForShot(shot.team));
  const shooterPressureMeters = opponents.reduce((nearestGap, opponent) => {
    return Math.min(nearestGap, getScaledDistance(opponent.x, opponent.y, shot.fromX, shot.fromY));
  }, Number.POSITIVE_INFINITY);
  const laneGapMeters = fieldDefenders.reduce((nearestGap, defender) => {
    return Math.min(
      nearestGap,
      getDistanceToSegmentMeters(
        defender.x,
        defender.y,
        shot.fromX,
        shot.fromY,
        shot.targetX,
        shot.targetY
      )
    );
  }, Number.POSITIVE_INFINITY);
  const goalkeeperGapMeters = goalkeeper
    ? getScaledDistance(goalkeeper.x, goalkeeper.y, shot.targetX, shot.targetY)
    : Number.POSITIVE_INFINITY;
  const goalkeeperInterceptMeters = goalkeeper
    ? getDistanceToSegmentMeters(goalkeeper.x, goalkeeper.y, shot.fromX, shot.fromY, shot.targetX, shot.targetY)
    : Number.POSITIVE_INFINITY;
  const laneBlockerCount = fieldDefenders.filter(
    (defender) =>
      getDistanceToSegmentMeters(defender.x, defender.y, shot.fromX, shot.fromY, shot.targetX, shot.targetY) <=
      SHOT_BLOCK_DISTANCE_METERS
  ).length;
  const angleFactor = Math.min(getShotAngleDegrees(shot.fromX, shot.fromY, shot.team) / 38, 1);
  const targetCentrality = 1 - Math.min(Math.abs(shot.targetY - PITCH_HEIGHT / 2) / (PITCH_HEIGHT / 2), 1);
  const keeperClearance = Math.min(Math.max((goalkeeperInterceptMeters - 2.2) / 5.8, 0), 1);
  const finishingScore = shot.xg * 0.52 + angleFactor * 0.18 + targetCentrality * 0.1 + keeperClearance * 0.2;

  if (
    laneGapMeters <= SHOT_BLOCK_DISTANCE_METERS ||
    laneBlockerCount >= 2 ||
    (shooterPressureMeters <= SHOT_PRESSURE_DISTANCE_METERS && angleFactor < 0.34)
  ) {
    return "blocked";
  }

  if (!isShotOnTarget(shot.team, shot.targetX, shot.targetY)) {
    return "off_target";
  }

  if (
    goalkeeperGapMeters <= SHOT_SAVE_DISTANCE_METERS ||
    goalkeeperInterceptMeters <= 3.4 ||
    finishingScore < 0.58
  ) {
    return "saved";
  }

  return "goal";
}

/**
 * 패스 한 개의 성공 확률과 근거 지표를 계산합니다.
 *
 * @param players 현재 보드의 전체 선수 목록입니다.
 * @param fromPlayer 패스를 보내는 선수입니다.
 * @param toPlayer 패스를 받는 선수입니다.
 * @returns 확률, 거리, 전진성, 압박 정보를 포함한 분석 결과입니다.
 */
function getPassAnalysis(players: PlayerNode[], fromPlayer: PlayerNode, toPlayer: PlayerNode): PassAnalysis {
  const distanceMeters = getScaledDistance(fromPlayer.x, fromPlayer.y, toPlayer.x, toPlayer.y);
  const normalizedDistance = Math.min(distanceMeters / 35, 1);
  const progressionMeters =
    fromPlayer.team === "home"
      ? Math.max((toPlayer.x - fromPlayer.x) * (PITCH_LENGTH_METERS / PITCH_WIDTH), 0)
      : Math.max((fromPlayer.x - toPlayer.x) * (PITCH_LENGTH_METERS / PITCH_WIDTH), 0);
  const directionBonus = Math.min(progressionMeters / 18, 1);

  const nearestOpponentGapMeters = players
    .filter((player) => player.team !== fromPlayer.team)
    .reduce((smallestGap, opponent) => {
      const gap = getDistanceToSegmentMeters(
        opponent.x,
        opponent.y,
        fromPlayer.x,
        fromPlayer.y,
        toPlayer.x,
        toPlayer.y
      );
      return Math.min(smallestGap, gap);
    }, Number.POSITIVE_INFINITY);

  const pressurePenalty = Math.max(0, 1 - Math.min(nearestOpponentGapMeters / 9, 1));
  const rawProbability = 0.88 - normalizedDistance * 0.38 - pressurePenalty * 0.34 + directionBonus * 0.12;
  const probability = clampProbability(rawProbability);

  if (probability >= 0.72) {
    return {
      probability: { value: probability, label: `${Math.round(probability * 100)}%`, color: "#22c55e", tier: "안전" },
      distanceMeters,
      progressionMeters,
      nearestOpponentGapMeters,
      pressurePenalty,
      directionBonus
    };
  }

  if (probability >= 0.5) {
    return {
      probability: { value: probability, label: `${Math.round(probability * 100)}%`, color: "#facc15", tier: "경합" },
      distanceMeters,
      progressionMeters,
      nearestOpponentGapMeters,
      pressurePenalty,
      directionBonus
    };
  }

  return {
    probability: { value: probability, label: `${Math.round(probability * 100)}%`, color: "#ef4444", tier: "위험" },
    distanceMeters,
    progressionMeters,
    nearestOpponentGapMeters,
    pressurePenalty,
    directionBonus
  };
}

/**
 * 이동 경로 한 개의 거리와 속도 정보를 계산합니다.
 *
 * @param movement 선수 이동 경로 데이터입니다.
 * @returns 이동 거리, 이동 시간, 평균 속도, 공 운반 여부입니다.
 */
function getMovementAnalysis(movement: MovementPath): MovementAnalysis {
  const distanceMeters = getScaledDistance(movement.fromX, movement.fromY, movement.toX, movement.toY);
  const durationSeconds = movement.durationMs / 1000;

  return {
    distanceMeters,
    durationMs: movement.durationMs,
    speedMetersPerSecond: durationSeconds > 0 ? distanceMeters / durationSeconds : 0,
    carriesBall: movement.carriesBall
  };
}

/**
 * 패스 화살표가 선수 원형을 침범하지 않도록 시작점과 끝점을 보정합니다.
 *
 * @param fromX 패서 x 좌표입니다.
 * @param fromY 패서 y 좌표입니다.
 * @param toX 리시버 x 좌표입니다.
 * @param toY 리시버 y 좌표입니다.
 * @param endPadding 화살촉 여유 간격입니다.
 * @returns Konva `Arrow`에 전달할 점 배열입니다.
 */
function buildArrowPoints(fromX: number, fromY: number, toX: number, toY: number, endPadding: number) {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const distance = Math.hypot(dx, dy);

  if (distance === 0) {
    return [fromX, fromY, toX, toY];
  }

  const unitX = dx / distance;
  const unitY = dy / distance;

  return [
    fromX + unitX * PLAYER_RADIUS,
    fromY + unitY * PLAYER_RADIUS,
    toX - unitX * endPadding,
    toY - unitY * endPadding
  ];
}

/**
 * 패스 ID가 가리키는 패서와 리시버를 현재 선수 목록에서 찾습니다.
 *
 * @param players 현재 선수 목록입니다.
 * @param pass 찾고 싶은 패스 객체입니다.
 * @returns 패서와 리시버가 모두 있으면 해당 선수 쌍을 반환합니다.
 */
function getPassParticipants(players: PlayerNode[], pass: PassLink) {
  const fromPlayer = getPlayerById(players, pass.fromId);
  const toPlayer = getPlayerById(players, pass.toId);

  if (!fromPlayer || !toPlayer) {
    return null;
  }

  return { fromPlayer, toPlayer };
}

/**
 * 패스와 이동 경로를 시간순 재생 이벤트로 병합합니다.
 *
 * @param passes 현재 패스 목록입니다.
 * @param movements 현재 이동 경로 목록입니다.
 * @returns 시작 시간 기준으로 정렬된 재생 이벤트 목록입니다.
 */
function buildTimelineEvents(passes: PassLink[], movements: MovementPath[], shots: ShotEvent[] = []) {
  return [
    ...passes.map((pass) => ({
      id: pass.id,
      kind: "pass" as const,
      atMs: pass.atMs,
      durationMs: pass.durationMs
    })),
    ...movements.map((movement) => ({
      id: movement.id,
      kind: "move" as const,
      atMs: movement.atMs,
      durationMs: movement.durationMs
    })),
    ...shots.map((shot) => ({
      id: shot.id,
      kind: "shot" as const,
      atMs: shot.atMs,
      durationMs: shot.durationMs
    }))
  ].sort((left, right) => left.atMs - right.atMs);
}

/**
 * 현재 이벤트 목록에서 가장 마지막 종료 시점을 찾습니다.
 *
 * @param passes 현재 패스 목록입니다.
 * @param movements 현재 이동 경로 목록입니다.
 * @returns 이벤트가 없으면 0, 있으면 마지막 종료 시점(ms)입니다.
 */
function getTimelineEndMs(passes: PassLink[], movements: MovementPath[], shots: ShotEvent[] = []) {
  return buildTimelineEvents(passes, movements, shots).reduce(
    (latest, event) => Math.max(latest, event.atMs + event.durationMs),
    0
  );
}

/**
 * 이벤트가 하나 이상 있을 때 기본 시퀀스 한 개를 자동 생성합니다.
 *
 * @param passes 현재 패스 목록입니다.
 * @param movements 현재 이동 경로 목록입니다.
 * @returns 전체 이벤트를 묶은 기본 시퀀스 목록입니다.
 */
function buildFallbackSequences(passes: PassLink[], movements: MovementPath[], shots: ShotEvent[] = []): TacticSequence[] {
  const events = buildTimelineEvents(passes, movements, shots);

  if (events.length === 0) {
    return [];
  }

  const firstEvent = events[0];
  const lastEvent = events.at(-1);

  if (!firstEvent || !lastEvent) {
    return [];
  }

  return [
    {
      id: "sequence-1",
      name: "시퀀스 1",
      eventRefs: events.map((event) => ({ kind: event.kind, id: event.id })),
      startAtMs: firstEvent.atMs,
      endAtMs: lastEvent.atMs + lastEvent.durationMs,
      createdAt: new Date().toISOString()
    }
  ];
}

/**
 * 밀리초 길이를 사람이 읽기 쉬운 재생 시간 문자열로 바꿉니다.
 *
 * @param durationMs 표시할 시간(ms)입니다.
 * @returns 예: `0.65s` 형태의 문자열입니다.
 */
function formatDurationMs(durationMs: number) {
  if (durationMs < 1000) {
    return `${Math.round(durationMs)}ms`;
  }

  return `${(durationMs / 1000).toFixed(durationMs >= 10000 ? 1 : 2)}s`;
}

/**
 * 비교 지표 변화량을 부호가 보이도록 문자열로 포맷합니다.
 *
 * @param value 현재 값과 이전 값의 차이입니다.
 * @param unit 표시 단위입니다.
 * @param digits 소수점 자리수입니다.
 * @returns 예: `+2.4m`, `-8%` 형태의 문자열입니다.
 */
function formatDelta(value: number, unit: string, digits = 1) {
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  const absoluteValue = Math.abs(value);
  return `${sign}${absoluteValue.toFixed(digits)}${unit}`;
}

/**
 * 수비 시프트 단계 포인트를 렌더링용 좌표 목록으로 변환합니다.
 *
 * @param points 백엔드가 반환한 수비 시프트 포인트 목록입니다.
 * @param source 어느 좌표 집합을 사용할지 지정합니다.
 * @returns 선수별 렌더링 좌표입니다.
 */
function toDefensiveShiftRenderPoints(
  points: DefensiveShiftPoint[],
  source: "from" | "to"
): DefensiveShiftRenderPoint[] {
  return points.map((point) => ({
    playerId: point.playerId,
    x: source === "from" ? point.fromX : point.toX,
    y: source === "from" ? point.fromY : point.toY
  }));
}

/**
 * 플레이백 시점이 현재 어느 수비 시프트 단계에 있는지 계산합니다.
 *
 * @param defensiveShift 백엔드가 계산한 수비 시프트 결과입니다.
 * @param playbackWindow 현재 재생 중인 구간 정보입니다.
 * @param playbackElapsedMs 현재 재생 시점(ms)입니다.
 * @returns 단계별 보간에 필요한 이전/다음 목표 좌표와 진행률입니다.
 */
function getPlaybackDefensiveShiftState(
  defensiveShift: DefensiveShiftSummary | null,
  playbackWindow: { startAtMs: number; endAtMs: number } | null,
  playbackElapsedMs: number
): DefensiveShiftPlaybackState | null {
  if (!defensiveShift || !playbackWindow || defensiveShift.stages.length === 0) {
    return null;
  }

  let previousStage: DefensiveShiftStage | null = null;

  for (const stage of defensiveShift.stages) {
    const stageStartAtMs = Math.max(stage.atMs, playbackWindow.startAtMs);
    const stageEndAtMs = stage.atMs + stage.durationMs;

    if (playbackElapsedMs < stageStartAtMs) {
      if (!previousStage) {
        const basePoints = toDefensiveShiftRenderPoints(stage.points, "from");
        return {
          fromPoints: basePoints,
          toPoints: basePoints,
          progress: 1,
          activeStage: null
        };
      }

      const settledPoints = toDefensiveShiftRenderPoints(previousStage.points, "to");
      return {
        fromPoints: settledPoints,
        toPoints: settledPoints,
        progress: 1,
        activeStage: previousStage
      };
    }

    if (playbackElapsedMs <= stageEndAtMs) {
      const fromPoints = previousStage
        ? toDefensiveShiftRenderPoints(previousStage.points, "to")
        : toDefensiveShiftRenderPoints(stage.points, "from");
      const toPoints = toDefensiveShiftRenderPoints(stage.points, "to");
      const durationMs = stage.durationMs <= 0 ? 1 : stage.durationMs;
      const progress = Math.min(Math.max((playbackElapsedMs - stage.atMs) / durationMs, 0), 1);

      return {
        fromPoints,
        toPoints,
        progress,
        activeStage: stage
      };
    }

    previousStage = stage;
  }

  if (!previousStage) {
    return null;
  }

  const finalPoints = toDefensiveShiftRenderPoints(previousStage.points, "to");
  return {
    fromPoints: finalPoints,
    toPoints: finalPoints,
    progress: 1,
    activeStage: previousStage
  };
}

/**
 * 플레이백 중 수비 시프트 결과를 실제 선수 렌더링 좌표에 보간 적용합니다.
 *
 * @param players 현재 렌더링 직전 선수 목록입니다.
 * @param defensiveShift 백엔드가 계산한 수비 시프트 결과입니다.
 * @param progress 현재 재생 단계에서의 시프트 적용 진행률입니다.
 * @returns 시프트가 반영된 렌더링용 선수 목록입니다.
 */
function getShiftAdjustedPlayers(
  players: PlayerNode[],
  defensiveShift: DefensiveShiftSummary | null,
  playbackState: DefensiveShiftPlaybackState | null
) {
  if (!defensiveShift || !playbackState) {
    return players;
  }

  const fromMap = new Map(playbackState.fromPoints.map((point) => [point.playerId, point]));
  const toMap = new Map(playbackState.toPoints.map((point) => [point.playerId, point]));

  return players.map((player) => {
    const toPoint = toMap.get(player.id);

    if (!toPoint) {
      return player;
    }

    const fromPoint = fromMap.get(player.id) ?? toPoint;

    return {
      ...player,
      x: fromPoint.x + (toPoint.x - fromPoint.x) * playbackState.progress,
      y: fromPoint.y + (toPoint.y - fromPoint.y) * playbackState.progress
    };
  });
}

/**
 * 숫자 히스토리를 작은 SVG 선 차트로 그릴 수 있는 path 문자열로 바꿉니다.
 *
 * @param values 시계열 숫자 목록입니다.
 * @param width 차트 너비입니다.
 * @param height 차트 높이입니다.
 * @param padding 테두리 여백입니다.
 * @returns SVG `path`의 `d` 문자열과 점 좌표 목록입니다.
 */
function buildTrendChartGeometry(values: number[], width: number, height: number, padding: number) {
  if (values.length === 0) {
    return { path: "", points: [] as { index: number; x: number; y: number; value: number }[] };
  }

  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const range = maxValue - minValue || 1;

  const points = values.map((value, index) => {
    const x =
      values.length === 1
        ? width / 2
        : padding + (index / (values.length - 1)) * (width - padding * 2);
    const y = height - padding - ((value - minValue) / range) * (height - padding * 2);

    return { index, x, y, value };
  });

  const path = points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`)
    .join(" ");

  return { path, points };
}

/**
 * 선택한 시퀀스에 포함된 패스와 이동만 따로 추출합니다.
 *
 * @param sequenceId 현재 보고 싶은 시퀀스 ID입니다.
 * @param sequences 전체 시퀀스 목록입니다.
 * @param passes 전체 패스 목록입니다.
 * @param movements 전체 이동 목록입니다.
 * @returns 화면에 표시할 패스와 이동 목록입니다.
 */
function getSequenceScopedEvents(
  sequenceId: string | null,
  sequences: TacticSequence[],
  passes: PassLink[],
  movements: MovementPath[],
  shots: ShotEvent[]
) {
  if (!sequenceId) {
    return { passes: [] as PassLink[], movements: [] as MovementPath[], shots: [] as ShotEvent[] };
  }

  const sequence = sequences.find((entry) => entry.id === sequenceId);

  if (!sequence) {
    return { passes: [] as PassLink[], movements: [] as MovementPath[], shots: [] as ShotEvent[] };
  }

  const passIds = new Set(
    sequence.eventRefs.filter((eventRef) => eventRef.kind === "pass").map((eventRef) => eventRef.id)
  );
  const movementIds = new Set(
    sequence.eventRefs.filter((eventRef) => eventRef.kind === "move").map((eventRef) => eventRef.id)
  );
  const shotIds = new Set(
    sequence.eventRefs.filter((eventRef) => eventRef.kind === "shot").map((eventRef) => eventRef.id)
  );

  return {
    passes: passes.filter((pass) => passIds.has(pass.id)),
    movements: movements.filter((movement) => movementIds.has(movement.id)),
    shots: shots.filter((shot) => shotIds.has(shot.id))
  };
}

/**
 * 프론트엔드에서 간단한 휴리스틱으로 이벤트별 자동 수비 반응 단계를 계산합니다.
 *
 * @param basePlayers 플레이백 기준 선수 스냅샷입니다.
 * @param baseBallState 플레이백 기준 공 상태입니다.
 * @param passes 분석 대상 패스 목록입니다.
 * @param movements 분석 대상 이동 목록입니다.
 * @returns 자동 수비 반응 요약과 단계 목록입니다.
 */
function buildAutomaticDefensiveShift(
  basePlayers: PlayerNode[],
  baseBallState: BallState,
  passes: PassLink[],
  movements: MovementPath[],
  shots: ShotEvent[] = []
): DefensiveShiftSummary | null {
  const timelineEvents = buildTimelineEvents(passes, movements, shots);

  if (timelineEvents.length === 0) {
    return null;
  }

  const stages: DefensiveShiftStage[] = [];
  const attackCounts: Record<Team, number> = { home: 0, away: 0 };

  timelineEvents.forEach((event) => {
    const snapshot = getBoardSnapshotAtElapsed(basePlayers, baseBallState, passes, movements, shots, event.atMs);
    let attackingTeam: Team | null = null;
    let focusX = 0;
    let focusY = 0;

    if (event.kind === "pass") {
      const pass = passes.find((entry) => entry.id === event.id);
      const fromPlayer = pass ? getPlayerById(snapshot.players, pass.fromId) : undefined;
      const toPlayer = pass ? getPlayerById(snapshot.players, pass.toId) : undefined;

      if (!pass || !fromPlayer || !toPlayer) {
        return;
      }

      attackingTeam = fromPlayer.team;
      focusX = (fromPlayer.x + toPlayer.x) / 2;
      focusY = (fromPlayer.y + toPlayer.y) / 2;
    } else if (event.kind === "move") {
      const movement = movements.find((entry) => entry.id === event.id);
      const movingPlayer = movement ? getPlayerById(snapshot.players, movement.playerId) : undefined;

      if (!movement || !movingPlayer) {
        return;
      }

      attackingTeam = movement.team;
      focusX = movement.toX;
      focusY = movement.toY;
    } else {
      const shot = shots.find((entry) => entry.id === event.id);

      if (!shot) {
        return;
      }

      attackingTeam = shot.team;
      focusX = shot.fromX;
      focusY = shot.fromY;
    }

    attackCounts[attackingTeam] += 1;
    const defendingTeam: Team = attackingTeam === "home" ? "away" : "home";
    const defendingPlayers = snapshot.players.filter((player) => player.team === defendingTeam);
    const stagePoints = defendingPlayers.map((defender) => {
      const shiftX = clampPosition((focusX - defender.x) * 0.24, -38, 38);
      const shiftY = clampPosition((focusY - defender.y) * 0.3, -30, 30);
      const nextX = clampPosition(defender.x + shiftX, PITCH_PADDING + PLAYER_RADIUS, PITCH_WIDTH - PITCH_PADDING - PLAYER_RADIUS);
      const nextY = clampPosition(defender.y + shiftY, PITCH_PADDING + PLAYER_RADIUS, PITCH_HEIGHT - PITCH_PADDING - PLAYER_RADIUS);

      return {
        playerId: defender.id,
        label: defender.label,
        team: defender.team,
        fromX: defender.x,
        fromY: defender.y,
        toX: nextX,
        toY: nextY,
        shiftDistanceMeters: getScaledDistance(defender.x, defender.y, nextX, nextY)
      };
    });

    const averageShiftDistanceMeters =
      stagePoints.reduce((sum, point) => sum + point.shiftDistanceMeters, 0) / Math.max(stagePoints.length, 1);

    stages.push({
      eventId: event.id,
      eventKind: event.kind,
      atMs: event.atMs,
      durationMs: event.durationMs,
      note: `${event.kind === "pass" ? "패스" : "이동"} 직후 ${defendingTeam.toUpperCase()} 수비가 자동 반응합니다.`,
      averageShiftDistanceMeters,
      points: stagePoints
    });
  });

  if (stages.length === 0) {
    return null;
  }

  const dominantAttackingTeam: Team = attackCounts.home >= attackCounts.away ? "home" : "away";
  const defendingTeam: Team = dominantAttackingTeam === "home" ? "away" : "home";
  const finalPoints = stages.at(-1)?.points ?? [];
  const average_shift_distance_m =
    finalPoints.reduce((sum, point) => sum + point.shiftDistanceMeters, 0) / Math.max(finalPoints.length, 1);
  const shiftedYs = finalPoints.map((point) => point.toY * (PITCH_WIDTH_METERS / PITCH_HEIGHT));
  const line_compactness_m =
    shiftedYs.length > 0 ? Math.max(...shiftedYs) - Math.min(...shiftedYs) : 0;
  const line_height_m =
    finalPoints.length > 0
      ? (finalPoints.reduce((sum, point) => sum + point.toX, 0) / finalPoints.length) * (PITCH_LENGTH_METERS / PITCH_WIDTH)
      : 0;

  return {
    defending_team: defendingTeam,
    average_shift_distance_m,
    line_compactness_m,
    line_height_m,
    note: `${defendingTeam.toUpperCase()} 수비가 각 이벤트마다 자동으로 반응하도록 프론트엔드 휴리스틱을 적용했습니다.`,
    points: finalPoints,
    stages
  };
}

/**
 * 수평 바 차트에 쓸 데이터 중 최대값을 기준으로 너비 비율을 계산합니다.
 *
 * @param value 현재 값입니다.
 * @param maxValue 전체 최대값입니다.
 * @returns 0~100 사이의 백분율입니다.
 */
function getBarWidthPercent(value: number, maxValue: number) {
  if (maxValue <= 0) {
    return 0;
  }

  return Math.max((value / maxValue) * 100, 6);
}

/**
 * 현재 URL 경로를 앱 화면 이름으로 변환합니다.
 *
 * @param pathname 브라우저 주소 경로입니다.
 * @returns 홈/시뮬레이션/분석 화면 중 하나입니다.
 */
function getScreenFromPathname(pathname: string): AppScreen {
  if (pathname === "/simulation") {
    return "simulation";
  }

  if (pathname === "/analysis") {
    return "analysis";
  }

  return "home";
}

/**
 * 앱 화면 이름을 브라우저 주소 경로로 변환합니다.
 *
 * @param screen 이동할 화면 이름입니다.
 * @returns 주소창에 반영할 경로 문자열입니다.
 */
function getPathnameForScreen(screen: AppScreen) {
  if (screen === "simulation") {
    return "/simulation";
  }

  if (screen === "analysis") {
    return "/analysis";
  }

  return "/";
}

/**
 * 현재 이벤트 분포를 기준으로 어느 팀이 시퀀스를 주도하는지 계산합니다.
 *
 * @param passes 현재 화면에 표시 중인 패스 목록입니다.
 * @param movements 현재 화면에 표시 중인 이동 목록입니다.
 * @param players 현재 선수 목록입니다.
 * @returns 우세 팀입니다.
 */
function getDominantTeamFromEvents(
  passes: PassLink[],
  movements: MovementPath[],
  shots: ShotEvent[],
  players: PlayerNode[]
): Team {
  let homeCount = 0;
  let awayCount = 0;

  passes.forEach((pass) => {
    const passer = getPlayerById(players, pass.fromId);
    if (passer?.team === "home") {
      homeCount += 1;
    } else if (passer?.team === "away") {
      awayCount += 1;
    }
  });

  movements.forEach((movement) => {
    if (movement.team === "home") {
      homeCount += 1;
    } else {
      awayCount += 1;
    }
  });

  shots.forEach((shot) => {
    if (shot.team === "home") {
      homeCount += 1;
    } else {
      awayCount += 1;
    }
  });

  return homeCount >= awayCount ? "home" : "away";
}

/**
 * 특정 시점까지의 타임라인을 적용한 보드 스냅샷을 계산합니다.
 *
 * @param basePlayers 플레이백 기준 선수 스냅샷입니다.
 * @param baseBallState 플레이백 기준 공 상태입니다.
 * @param passes 현재 패스 목록입니다.
 * @param movements 현재 이동 경로 목록입니다.
 * @param elapsedMs 계산할 시점(ms)입니다.
 * @returns 해당 시점의 선수 위치, 공 상태, 활성 이벤트입니다.
 */
function getBoardSnapshotAtElapsed(
  basePlayers: PlayerNode[],
  baseBallState: BallState,
  passes: PassLink[],
  movements: MovementPath[],
  shots: ShotEvent[],
  elapsedMs: number
) {
  const nextPlayers = basePlayers.map((player) => ({ ...player }));
  let nextBallState: BallState = { ...baseBallState, isAnimating: false };
  let activeEvent: ActivePlaybackEvent | null = null;

  for (const event of buildTimelineEvents(passes, movements, shots)) {
    if (elapsedMs < event.atMs) {
      break;
    }

    if (event.kind === "move") {
      const movement = movements.find((entry) => entry.id === event.id);

      if (!movement) {
        continue;
      }

      const progress = Math.min(Math.max((elapsedMs - event.atMs) / movement.durationMs, 0), 1);
      const playerIndex = nextPlayers.findIndex((player) => player.id === movement.playerId);

      if (playerIndex >= 0) {
        nextPlayers[playerIndex] = {
          ...nextPlayers[playerIndex],
          x: movement.fromX + (movement.toX - movement.fromX) * progress,
          y: movement.fromY + (movement.toY - movement.fromY) * progress
        };
      }

      if (movement.carriesBall) {
        nextBallState = {
          x: movement.fromX + (movement.toX - movement.fromX) * progress,
          y: movement.fromY + (movement.toY - movement.fromY) * progress,
          ownerId: movement.playerId,
          isAnimating: progress < 1
        };
      }

      if (progress < 1) {
        activeEvent = { kind: "move", id: movement.id };
        break;
      }

      continue;
    }

    if (event.kind === "shot") {
      const shot = shots.find((entry) => entry.id === event.id);

      if (!shot) {
        continue;
      }

      const progress = Math.min(Math.max((elapsedMs - event.atMs) / shot.durationMs, 0), 1);
      nextBallState = {
        x: shot.fromX + (shot.targetX - shot.fromX) * progress,
        y: shot.fromY + (shot.targetY - shot.fromY) * progress,
        ownerId: null,
        isAnimating: progress < 1
      };

      if (progress < 1) {
        activeEvent = { kind: "shot", id: shot.id };
        break;
      }

      continue;
    }

    const pass = passes.find((entry) => entry.id === event.id);

    if (!pass) {
      continue;
    }

    const participants = getPassParticipants(nextPlayers, pass);

    if (!participants) {
      continue;
    }

    const progress = Math.min(Math.max((elapsedMs - event.atMs) / pass.durationMs, 0), 1);
    const ballX = participants.fromPlayer.x + (participants.toPlayer.x - participants.fromPlayer.x) * progress;
    const ballY = participants.fromPlayer.y + (participants.toPlayer.y - participants.fromPlayer.y) * progress;

    nextBallState = {
      x: ballX,
      y: ballY,
      ownerId: progress < 1 ? null : participants.toPlayer.id,
      isAnimating: progress < 1
    };

    if (progress < 1) {
      activeEvent = { kind: "pass", id: pass.id };
      break;
    }
  }

  return { players: nextPlayers, ballState: nextBallState, activeEvent };
}

/**
 * 같은 선수의 이동 경로 시작점을 이전 이동의 끝점에 맞춰 연쇄 보정합니다.
 *
 * @param movements 전체 이동 경로 목록입니다.
 * @param playerId 보정할 선수 ID입니다.
 * @param firstStartOverride 첫 이동 시작점을 강제로 덮어쓸 좌표입니다.
 * @returns 연쇄 보정이 적용된 이동 경로 목록입니다.
 */
function realignPlayerMovements(
  movements: MovementPath[],
  playerId: string,
  firstStartOverride?: { x: number; y: number }
) {
  const nextMovements = movements.map((movement) => ({ ...movement }));
  const indexedMovements = nextMovements
    .map((movement, index) => ({ movement, index }))
    .filter((entry) => entry.movement.playerId === playerId)
    .sort((left, right) => left.movement.atMs - right.movement.atMs);

  indexedMovements.forEach((entry, index) => {
    if (index === 0) {
      if (firstStartOverride) {
        nextMovements[entry.index] = {
          ...nextMovements[entry.index],
          fromX: firstStartOverride.x,
          fromY: firstStartOverride.y
        };
      }
      return;
    }

    const previousMovement = nextMovements[indexedMovements[index - 1].index];

    nextMovements[entry.index] = {
      ...nextMovements[entry.index],
      fromX: previousMovement.toX,
      fromY: previousMovement.toY
    };
  });

  return nextMovements;
}

/**
 * 현재 이벤트 집합에 맞게 시퀀스 목록을 정리하고 시간 범위를 다시 계산합니다.
 *
 * @param sequences 현재 시퀀스 목록입니다.
 * @param passes 현재 패스 목록입니다.
 * @param movements 현재 이동 경로 목록입니다.
 * @returns 존재하는 이벤트만 남기고 재계산한 시퀀스 목록입니다.
 */
function reconcileSequences(
  sequences: TacticSequence[],
  passes: PassLink[],
  movements: MovementPath[],
  shots: ShotEvent[] = []
) {
  const passMap = new Map(passes.map((pass) => [pass.id, pass]));
  const movementMap = new Map(movements.map((movement) => [movement.id, movement]));
  const shotMap = new Map(shots.map((shot) => [shot.id, shot]));

  return sequences
    .map((sequence) => {
      const eventRefs = sequence.eventRefs.filter((eventRef) =>
        eventRef.kind === "pass"
          ? passMap.has(eventRef.id)
          : eventRef.kind === "move"
            ? movementMap.has(eventRef.id)
            : shotMap.has(eventRef.id)
      );

      if (eventRefs.length === 0) {
        return null;
      }

      const eventWindows = eventRefs.map((eventRef) =>
        eventRef.kind === "pass"
          ? passMap.get(eventRef.id)
          : eventRef.kind === "move"
            ? movementMap.get(eventRef.id)
            : shotMap.get(eventRef.id)
      );
      const startAtMs = Math.min(...eventWindows.map((eventWindow) => eventWindow?.atMs ?? 0));
      const endAtMs = Math.max(
        ...eventWindows.map((eventWindow) => (eventWindow?.atMs ?? 0) + (eventWindow?.durationMs ?? 0))
      );

      return {
        ...sequence,
        eventRefs,
        startAtMs,
        endAtMs
      };
    })
    .filter((sequence): sequence is TacticSequence => sequence !== null)
    .sort((left, right) => left.startAtMs - right.startAtMs);
}

/**
 * 플레이백 기준이 되는 초기 선수 스냅샷을 내보내기 형식으로 정규화합니다.
 *
 * @param players 보드 기준 선수 목록입니다.
 * @returns 저장 가능한 선수 스냅샷입니다.
 */
function toExportedPlayers(players: PlayerNode[]): ExportedPlayer[] {
  return players.map((player) => ({
    id: player.id,
    label: player.label,
    team: player.team,
    x: Number(player.x.toFixed(1)),
    y: Number(player.y.toFixed(1))
  }));
}

/**
 * 저장된 선수 스냅샷을 내부 보드 형식으로 바꿉니다.
 *
 * @param players 저장된 선수 스냅샷입니다.
 * @returns 내부 렌더링용 선수 목록입니다.
 */
function toPlayerNodes(players: ExportedPlayer[]): PlayerNode[] {
  return players.map((player) => {
    const appearance = getPlayerAppearance(player.team);

    return {
      id: player.id,
      label: player.label,
      team: player.team,
      x: player.x,
      y: player.y,
      fill: appearance.fill,
      stroke: appearance.stroke
    };
  });
}

/**
 * 플레이백 속도 배율을 버튼 라벨용 문자열로 바꿉니다.
 *
 * @param speed 현재 재생 속도 배율입니다.
 * @returns 예: `1.5x` 형태의 문자열입니다.
 */
function formatPlaybackSpeedLabel(speed: (typeof PLAYBACK_SPEED_OPTIONS)[number]) {
  return `${speed}x`;
}

/**
 * 두 선수가 같은 팀 소속인지 검사합니다.
 *
 * @param fromPlayer 패스를 보내는 선수입니다.
 * @param toPlayer 패스를 받는 선수입니다.
 * @returns 두 선수가 같은 팀이면 `true`입니다.
 */
function isSameTeamPass(fromPlayer: PlayerNode, toPlayer: PlayerNode) {
  return fromPlayer.team === toPlayer.team;
}

/**
 * 현재 보드 상태를 다운로드용 JSON 구조로 변환합니다.
 *
 * @param players 현재 선수 목록입니다.
 * @param passes 현재 패스 목록입니다.
 * @param movements 현재 선수 이동 경로 목록입니다.
 * @param sequences 현재 시퀀스 목록입니다.
 * @param analysisHistory 시퀀스별 분석 히스토리입니다.
 * @param ballState 현재 공 상태입니다.
 * @param basePlayers 플레이백 기준 선수 스냅샷입니다.
 * @param baseBallState 플레이백 기준 공 상태입니다.
 * @returns 전술 보드를 저장하기 위한 직렬화 가능한 객체입니다.
 */
function createExportPayload(
  players: PlayerNode[],
  passes: PassLink[],
  movements: MovementPath[],
  shots: ShotEvent[],
  sequences: TacticSequence[],
  analysisHistory: ExportedAnalysisHistory,
  ballState: BallState,
  basePlayers: PlayerNode[],
  baseBallState: BallState
): ExportedBoardPayload {
  return {
    exportedAt: new Date().toISOString(),
    pitch: {
      canvasWidth: PITCH_WIDTH,
      canvasHeight: PITCH_HEIGHT,
      lengthMeters: PITCH_LENGTH_METERS,
      widthMeters: PITCH_WIDTH_METERS
    },
    ball: {
      ownerId: ballState.ownerId,
      isAnimating: ballState.isAnimating,
      position: {
        x: Number(ballState.x.toFixed(1)),
        y: Number(ballState.y.toFixed(1))
      }
    },
    players: toExportedPlayers(players),
    passes: passes.map((pass) => {
      const fromPlayer = getPlayerById(players, pass.fromId);
      const toPlayer = getPlayerById(players, pass.toId);
      const analysis =
        fromPlayer && toPlayer ? getPassAnalysis(players, fromPlayer, toPlayer) : undefined;

      return {
        id: pass.id,
        fromId: pass.fromId,
        toId: pass.toId,
        atMs: Number(pass.atMs.toFixed(1)),
        durationMs: Number(pass.durationMs.toFixed(1)),
        probability: analysis ? Number(analysis.probability.value.toFixed(3)) : null,
        distanceMeters: analysis ? Number(analysis.distanceMeters.toFixed(2)) : null,
        progressionMeters: analysis ? Number(analysis.progressionMeters.toFixed(2)) : null,
        nearestOpponentGapMeters: analysis ? Number(analysis.nearestOpponentGapMeters.toFixed(2)) : null
      };
    }),
    movements: movements.map((movement) => ({
      id: movement.id,
      playerId: movement.playerId,
      team: movement.team,
      fromX: Number(movement.fromX.toFixed(1)),
      fromY: Number(movement.fromY.toFixed(1)),
      toX: Number(movement.toX.toFixed(1)),
      toY: Number(movement.toY.toFixed(1)),
      atMs: Number(movement.atMs.toFixed(1)),
      durationMs: Number(movement.durationMs.toFixed(1)),
      carriesBall: movement.carriesBall
    })),
    shots: shots.map((shot) => ({
      ...shot,
      fromX: Number(shot.fromX.toFixed(1)),
      fromY: Number(shot.fromY.toFixed(1)),
      targetX: Number(shot.targetX.toFixed(1)),
      targetY: Number(shot.targetY.toFixed(1)),
      atMs: Number(shot.atMs.toFixed(1)),
      durationMs: Number(shot.durationMs.toFixed(1)),
      xg: Number(shot.xg.toFixed(3))
    })),
    sequences: sequences.map((sequence) => ({
      id: sequence.id,
      name: sequence.name,
      eventRefs: sequence.eventRefs.map((eventRef) => ({ kind: eventRef.kind, id: eventRef.id })),
      startAtMs: Number(sequence.startAtMs.toFixed(1)),
      endAtMs: Number(sequence.endAtMs.toFixed(1)),
      createdAt: sequence.createdAt
    })),
    analysisHistory,
    base: {
      players: toExportedPlayers(basePlayers),
      ball: {
        ownerId: baseBallState.ownerId,
        position: {
          x: Number(baseBallState.x.toFixed(1)),
          y: Number(baseBallState.y.toFixed(1))
        }
      }
    }
  };
}

/**
 * 선택한 시퀀스를 백엔드 분석 API에 보낼 요청 본문으로 정리합니다.
 *
 * @param players 현재 선수 목록입니다.
 * @param passes 현재 패스 목록입니다.
 * @param movements 현재 이동 경로 목록입니다.
 * @param sequences 현재 시퀀스 목록입니다.
 * @param basePlayers 플레이백 기준 선수 스냅샷입니다.
 * @param baseBallState 플레이백 기준 공 상태입니다.
 * @param sequenceId 분석할 시퀀스 ID입니다.
 * @returns 백엔드 분석 API와 맞는 요청 객체입니다.
 */
function createSequenceAnalysisPayload(
  players: PlayerNode[],
  passes: PassLink[],
  movements: MovementPath[],
  shots: ShotEvent[],
  sequences: TacticSequence[],
  basePlayers: PlayerNode[],
  baseBallState: BallState,
  sequenceId: string
): SequenceAnalysisRequestPayload {
  return {
    sequence_id: sequenceId,
    players: toExportedPlayers(players),
    passes: passes.map((pass) => ({
      id: pass.id,
      fromId: pass.fromId,
      toId: pass.toId,
      atMs: Number(pass.atMs.toFixed(1)),
      durationMs: Number(pass.durationMs.toFixed(1))
    })),
    movements: movements.map((movement) => ({
      id: movement.id,
      playerId: movement.playerId,
      team: movement.team,
      fromX: Number(movement.fromX.toFixed(1)),
      fromY: Number(movement.fromY.toFixed(1)),
      toX: Number(movement.toX.toFixed(1)),
      toY: Number(movement.toY.toFixed(1)),
      atMs: Number(movement.atMs.toFixed(1)),
      durationMs: Number(movement.durationMs.toFixed(1)),
      carriesBall: movement.carriesBall
    })),
    shots: shots.map((shot) => ({
      ...shot,
      fromX: Number(shot.fromX.toFixed(1)),
      fromY: Number(shot.fromY.toFixed(1)),
      targetX: Number(shot.targetX.toFixed(1)),
      targetY: Number(shot.targetY.toFixed(1)),
      atMs: Number(shot.atMs.toFixed(1)),
      durationMs: Number(shot.durationMs.toFixed(1)),
      xg: Number(shot.xg.toFixed(3))
    })),
    sequences: sequences.map((sequence) => ({
      id: sequence.id,
      name: sequence.name,
      eventRefs: sequence.eventRefs.map((eventRef) => ({ kind: eventRef.kind, id: eventRef.id })),
      startAtMs: Number(sequence.startAtMs.toFixed(1)),
      endAtMs: Number(sequence.endAtMs.toFixed(1)),
      createdAt: sequence.createdAt
    })),
    base: {
      players: toExportedPlayers(basePlayers),
      ball: {
        ownerId: baseBallState.ownerId,
        position: {
          x: Number(baseBallState.x.toFixed(1)),
          y: Number(baseBallState.y.toFixed(1))
        }
      }
    }
  };
}

/**
 * 초기 보드에서 공 소유 상태를 생성합니다.
 *
 * @param players 공 위치를 맞출 선수 목록입니다.
 * @returns 기본 공 위치와 소유자 정보입니다.
 */
function getInitialBallState(players: PlayerNode[]): BallState {
  const owner = getPlayerById(players, INITIAL_BALL_OWNER_ID) ?? players[0];

  return {
    x: owner.x,
    y: owner.y,
    ownerId: owner.id,
    isAnimating: false
  };
}

/**
 * 런타임 값이 일반 객체인지 검사합니다.
 *
 * @param value 검사 대상 값입니다.
 * @returns 일반 객체면 `true`입니다.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * 런타임 값이 팀 타입인지 검사합니다.
 *
 * @param value 검사 대상 값입니다.
 * @returns `home` 또는 `away`이면 `true`입니다.
 */
function isTeam(value: unknown): value is Team {
  return value === "home" || value === "away";
}

/**
 * 가져온 JSON의 선수 목록을 내부 보드 형식으로 정규화합니다.
 *
 * @param value JSON에서 읽은 선수 배열입니다.
 * @returns 성공 시 정규화된 선수 목록, 실패 시 `null`입니다.
 */
function normalizeImportedPlayers(value: unknown): PlayerNode[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const players = value.map((entry) => {
    if (!isRecord(entry)) {
      return null;
    }

    if (
      typeof entry.id !== "string" ||
      typeof entry.label !== "string" ||
      !isTeam(entry.team) ||
      typeof entry.x !== "number" ||
      typeof entry.y !== "number"
    ) {
      return null;
    }

    const appearance = getPlayerAppearance(entry.team);

    return {
      id: entry.id,
      label: entry.label,
      team: entry.team,
      x: clampPosition(entry.x, PITCH_PADDING + PLAYER_RADIUS, PITCH_WIDTH - PITCH_PADDING - PLAYER_RADIUS),
      y: clampPosition(entry.y, PITCH_PADDING + PLAYER_RADIUS, PITCH_HEIGHT - PITCH_PADDING - PLAYER_RADIUS),
      fill: appearance.fill,
      stroke: appearance.stroke
    };
  });

  if (players.some((player) => player === null)) {
    return null;
  }

  const normalizedPlayers = players as PlayerNode[];
  const uniqueIds = new Set(normalizedPlayers.map((player) => player.id));

  if (uniqueIds.size !== normalizedPlayers.length) {
    return null;
  }

  return normalizedPlayers;
}

/**
 * 가져온 JSON의 패스 목록이 현재 선수 목록과 호환되는지 검사합니다.
 *
 * @param value JSON에서 읽은 패스 배열입니다.
 * @param players 정규화된 선수 목록입니다.
 * @returns 성공 시 패스 목록, 실패 시 `null`입니다.
 */
function normalizeImportedPasses(value: unknown, players: PlayerNode[]): PassLink[] | null {
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    return null;
  }

  const validPlayerIds = new Set(players.map((player) => player.id));
  const passes = value.map((entry) => {
    if (!isRecord(entry)) {
      return null;
    }

    if (
      typeof entry.id !== "string" ||
      typeof entry.fromId !== "string" ||
      typeof entry.toId !== "string" ||
      !validPlayerIds.has(entry.fromId) ||
      !validPlayerIds.has(entry.toId)
    ) {
      return null;
    }

    const fromPlayer = getPlayerById(players, entry.fromId);
    const toPlayer = getPlayerById(players, entry.toId);

    if (!fromPlayer || !toPlayer || !isSameTeamPass(fromPlayer, toPlayer)) {
      return null;
    }

    return {
      id: entry.id,
      fromId: entry.fromId,
      toId: entry.toId,
      atMs: typeof entry.atMs === "number" ? Math.max(entry.atMs, 0) : 0,
      durationMs:
        typeof entry.durationMs === "number" ? Math.max(entry.durationMs, 1) : BALL_ANIMATION_DURATION_MS
    };
  });

  if (passes.some((pass) => pass === null)) {
    return null;
  }

  return passes as PassLink[];
}

/**
 * 가져온 JSON의 이동 경로 목록이 현재 선수 목록과 호환되는지 검사합니다.
 *
 * @param value JSON에서 읽은 이동 경로 배열입니다.
 * @param players 정규화된 선수 목록입니다.
 * @returns 성공 시 이동 경로 목록, 실패 시 `null`입니다.
 */
function normalizeImportedMovements(value: unknown, players: PlayerNode[]): MovementPath[] | null {
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    return null;
  }

  const validPlayerIds = new Set(players.map((player) => player.id));
  const movements = value.map((entry) => {
    if (!isRecord(entry)) {
      return null;
    }

    if (
      typeof entry.id !== "string" ||
      typeof entry.playerId !== "string" ||
      !validPlayerIds.has(entry.playerId) ||
      !isTeam(entry.team) ||
      typeof entry.fromX !== "number" ||
      typeof entry.fromY !== "number" ||
      typeof entry.toX !== "number" ||
      typeof entry.toY !== "number"
    ) {
      return null;
    }

    const player = getPlayerById(players, entry.playerId);

    if (!player || player.team !== entry.team) {
      return null;
    }

    return {
      id: entry.id,
      playerId: entry.playerId,
      team: entry.team,
      fromX: clampPosition(entry.fromX, PITCH_PADDING + PLAYER_RADIUS, PITCH_WIDTH - PITCH_PADDING - PLAYER_RADIUS),
      fromY: clampPosition(entry.fromY, PITCH_PADDING + PLAYER_RADIUS, PITCH_HEIGHT - PITCH_PADDING - PLAYER_RADIUS),
      toX: clampPosition(entry.toX, PITCH_PADDING + PLAYER_RADIUS, PITCH_WIDTH - PITCH_PADDING - PLAYER_RADIUS),
      toY: clampPosition(entry.toY, PITCH_PADDING + PLAYER_RADIUS, PITCH_HEIGHT - PITCH_PADDING - PLAYER_RADIUS),
      atMs: typeof entry.atMs === "number" ? Math.max(entry.atMs, 0) : 0,
      durationMs:
        typeof entry.durationMs === "number" ? Math.max(entry.durationMs, 1) : MOVE_ANIMATION_DURATION_MS,
      carriesBall: entry.carriesBall === true
    };
  });

  if (movements.some((movement) => movement === null)) {
    return null;
  }

  return movements as MovementPath[];
}

/**
 * 가져온 JSON의 슈팅 이벤트 목록이 현재 선수 목록과 호환되는지 검사합니다.
 *
 * @param value JSON에서 읽은 슈팅 배열입니다.
 * @param players 정규화된 선수 목록입니다.
 * @returns 성공 시 슈팅 목록, 실패 시 `null`입니다.
 */
function normalizeImportedShots(value: unknown, players: PlayerNode[]): ShotEvent[] | null {
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    return null;
  }

  const validPlayerIds = new Set(players.map((player) => player.id));
  const shots = value.map((entry) => {
    if (
      !isRecord(entry) ||
      typeof entry.id !== "string" ||
      typeof entry.playerId !== "string" ||
      !validPlayerIds.has(entry.playerId) ||
      !isTeam(entry.team) ||
      typeof entry.fromX !== "number" ||
      typeof entry.fromY !== "number" ||
      typeof entry.targetX !== "number" ||
      typeof entry.targetY !== "number"
    ) {
      return null;
    }

    const shooter = getPlayerById(players, entry.playerId);

    if (!shooter || shooter.team !== entry.team) {
      return null;
    }

    return {
      id: entry.id,
      playerId: entry.playerId,
      team: entry.team,
      fromX: clampPosition(entry.fromX, PITCH_PADDING + PLAYER_RADIUS, PITCH_WIDTH - PITCH_PADDING - PLAYER_RADIUS),
      fromY: clampPosition(entry.fromY, PITCH_PADDING + PLAYER_RADIUS, PITCH_HEIGHT - PITCH_PADDING - PLAYER_RADIUS),
      targetX: clampPosition(entry.targetX, PITCH_PADDING, PITCH_WIDTH - PITCH_PADDING),
      targetY: clampPosition(entry.targetY, PITCH_PADDING, PITCH_HEIGHT - PITCH_PADDING),
      atMs: typeof entry.atMs === "number" ? Math.max(entry.atMs, 0) : 0,
      durationMs: typeof entry.durationMs === "number" ? Math.max(entry.durationMs, 1) : BALL_ANIMATION_DURATION_MS,
      xg: typeof entry.xg === "number" ? Math.max(entry.xg, 0) : getXgProxyValue(entry.fromX, entry.fromY, entry.team),
      outcome:
        entry.outcome === "goal" ||
        entry.outcome === "saved" ||
        entry.outcome === "off_target" ||
        entry.outcome === "blocked"
          ? entry.outcome
          : resolveShotOutcome(players, {
              id: entry.id,
              playerId: entry.playerId,
              team: entry.team,
              fromX: entry.fromX,
              fromY: entry.fromY,
              targetX: entry.targetX,
              targetY: entry.targetY,
              atMs: typeof entry.atMs === "number" ? Math.max(entry.atMs, 0) : 0,
              durationMs:
                typeof entry.durationMs === "number" ? Math.max(entry.durationMs, 1) : BALL_ANIMATION_DURATION_MS,
              xg:
                typeof entry.xg === "number"
                  ? Math.max(entry.xg, 0)
                  : getXgProxyValue(entry.fromX, entry.fromY, entry.team)
            })
    };
  });

  if (shots.some((shot) => shot === null)) {
    return null;
  }

  return shots as ShotEvent[];
}

/**
 * 가져온 JSON의 시퀀스 목록이 현재 이벤트 목록과 호환되는지 검사합니다.
 *
 * @param value JSON에서 읽은 시퀀스 배열입니다.
 * @param passes 정규화된 패스 목록입니다.
 * @param movements 정규화된 이동 경로 목록입니다.
 * @returns 성공 시 시퀀스 목록, 실패 시 `null`입니다.
 */
function normalizeImportedSequences(
  value: unknown,
  passes: PassLink[],
  movements: MovementPath[],
  shots: ShotEvent[]
): TacticSequence[] | null {
  if (value === undefined) {
    return buildFallbackSequences(passes, movements, shots);
  }

  if (!Array.isArray(value)) {
    return null;
  }

  const passIds = new Set(passes.map((pass) => pass.id));
  const movementIds = new Set(movements.map((movement) => movement.id));
  const shotIds = new Set(shots.map((shot) => shot.id));
  const sequences = value.map((entry) => {
    if (!isRecord(entry) || typeof entry.id !== "string" || typeof entry.name !== "string" || !Array.isArray(entry.eventRefs)) {
      return null;
    }

    const eventRefs = entry.eventRefs.map((eventEntry) => {
      if (!isRecord(eventEntry) || typeof eventEntry.id !== "string") {
        return null;
      }

      if (eventEntry.kind !== "pass" && eventEntry.kind !== "move" && eventEntry.kind !== "shot") {
        return null;
      }

      if (eventEntry.kind === "pass" && !passIds.has(eventEntry.id)) {
        return null;
      }

      if (eventEntry.kind === "move" && !movementIds.has(eventEntry.id)) {
        return null;
      }

      if (eventEntry.kind === "shot" && !shotIds.has(eventEntry.id)) {
        return null;
      }

      return {
        kind: eventEntry.kind,
        id: eventEntry.id
      };
    });

    if (eventRefs.some((eventRef) => eventRef === null)) {
      return null;
    }

    return {
      id: entry.id,
      name: entry.name,
      eventRefs: eventRefs as SequenceEventRef[],
      startAtMs: typeof entry.startAtMs === "number" ? Math.max(entry.startAtMs, 0) : 0,
      endAtMs: typeof entry.endAtMs === "number" ? Math.max(entry.endAtMs, 0) : 0,
      createdAt: typeof entry.createdAt === "string" ? entry.createdAt : new Date().toISOString()
    };
  });

  if (sequences.some((sequence) => sequence === null)) {
    return null;
  }

  return reconcileSequences(sequences as TacticSequence[], passes, movements, shots);
}

/**
 * 저장된 분석 히스토리가 현재 시퀀스 목록과 호환되는지 검사합니다.
 *
 * @param value JSON에서 읽은 분석 히스토리 객체입니다.
 * @param sequences 정규화된 시퀀스 목록입니다.
 * @returns 시퀀스별 분석 히스토리 맵입니다.
 */
function normalizeImportedAnalysisHistory(
  value: unknown,
  sequences: TacticSequence[]
): ExportedAnalysisHistory {
  if (!isRecord(value)) {
    return {};
  }

  const validSequenceIds = new Set(sequences.map((sequence) => sequence.id));
  const nextHistory: ExportedAnalysisHistory = {};

  Object.entries(value).forEach(([sequenceId, historyEntries]) => {
    if (!validSequenceIds.has(sequenceId) || !Array.isArray(historyEntries)) {
      return;
    }

    const normalizedEntries = historyEntries
      .map((entry) => {
        if (!isRecord(entry) || typeof entry.analyzed_at !== "string" || !isRecord(entry.result)) {
          return null;
        }

        const result = entry.result;
        const teamMetrics = isRecord(result.team_metrics) ? result.team_metrics : null;
        const defensiveShift = isRecord(result.defensive_shift) ? result.defensive_shift : null;
        const defensivePoints = defensiveShift && Array.isArray(defensiveShift.points) ? defensiveShift.points : [];
        const defensiveStages = defensiveShift && Array.isArray(defensiveShift.stages) ? defensiveShift.stages : [];

        if (
          typeof result.sequence_id !== "string" ||
          typeof result.sequence_name !== "string" ||
          typeof result.pass_count !== "number" ||
          typeof result.movement_count !== "number" ||
          typeof result.carry_count !== "number" ||
          typeof result.total_duration_ms !== "number" ||
          typeof result.average_pass_distance_m !== "number" ||
          typeof result.total_progression_m !== "number" ||
          typeof result.total_movement_distance_m !== "number" ||
          typeof result.average_event_gap_ms !== "number" ||
          typeof result.pressure_index !== "number" ||
          typeof result.support_width_m !== "number" ||
          !teamMetrics ||
          typeof teamMetrics.home_events !== "number" ||
          typeof teamMetrics.away_events !== "number" ||
          typeof teamMetrics.dominant_team !== "string" ||
          typeof result.coaching_note !== "string" ||
          !defensiveShift ||
          (defensiveShift.defending_team !== "home" && defensiveShift.defending_team !== "away") ||
          typeof defensiveShift.average_shift_distance_m !== "number" ||
          typeof defensiveShift.line_compactness_m !== "number" ||
          typeof defensiveShift.line_height_m !== "number" ||
          typeof defensiveShift.note !== "string"
        ) {
          return null;
        }

        const points = defensivePoints
          .map((point) => {
            if (
              !isRecord(point) ||
              typeof point.playerId !== "string" ||
              typeof point.label !== "string" ||
              (point.team !== "home" && point.team !== "away") ||
              typeof point.fromX !== "number" ||
              typeof point.fromY !== "number" ||
              typeof point.toX !== "number" ||
              typeof point.toY !== "number" ||
              typeof point.shiftDistanceMeters !== "number"
            ) {
              return null;
            }

            return {
              playerId: point.playerId,
              label: point.label,
              team: point.team,
              fromX: point.fromX,
              fromY: point.fromY,
              toX: point.toX,
              toY: point.toY,
              shiftDistanceMeters: point.shiftDistanceMeters
            };
          })
          .filter((point): point is DefensiveShiftPoint => point !== null);

        const stages = defensiveStages
          .map((stage) => {
            if (
              !isRecord(stage) ||
              typeof stage.eventId !== "string" ||
              (stage.eventKind !== "pass" && stage.eventKind !== "move") ||
              typeof stage.atMs !== "number" ||
              typeof stage.durationMs !== "number" ||
              typeof stage.note !== "string" ||
              typeof stage.averageShiftDistanceMeters !== "number" ||
              !Array.isArray(stage.points)
            ) {
              return null;
            }

            const stagePoints = stage.points
              .map((point) => {
                if (
                  !isRecord(point) ||
                  typeof point.playerId !== "string" ||
                  typeof point.label !== "string" ||
                  (point.team !== "home" && point.team !== "away") ||
                  typeof point.fromX !== "number" ||
                  typeof point.fromY !== "number" ||
                  typeof point.toX !== "number" ||
                  typeof point.toY !== "number" ||
                  typeof point.shiftDistanceMeters !== "number"
                ) {
                  return null;
                }

                return {
                  playerId: point.playerId,
                  label: point.label,
                  team: point.team,
                  fromX: point.fromX,
                  fromY: point.fromY,
                  toX: point.toX,
                  toY: point.toY,
                  shiftDistanceMeters: point.shiftDistanceMeters
                };
              })
              .filter((point): point is DefensiveShiftPoint => point !== null);

            return {
              eventId: stage.eventId,
              eventKind: stage.eventKind,
              atMs: stage.atMs,
              durationMs: stage.durationMs,
              note: stage.note,
              averageShiftDistanceMeters: stage.averageShiftDistanceMeters,
              points: stagePoints
            };
          })
          .filter((stage): stage is DefensiveShiftStage => stage !== null);

        return {
          analyzed_at: entry.analyzed_at,
          result: {
            sequence_id: result.sequence_id,
            sequence_name: result.sequence_name,
            pass_count: result.pass_count,
            movement_count: result.movement_count,
            carry_count: result.carry_count,
            total_duration_ms: result.total_duration_ms,
            average_pass_distance_m: result.average_pass_distance_m,
            total_progression_m: result.total_progression_m,
            total_movement_distance_m: result.total_movement_distance_m,
            average_event_gap_ms: result.average_event_gap_ms,
            pressure_index: result.pressure_index,
            support_width_m: result.support_width_m,
            team_metrics: {
              home_events: teamMetrics.home_events,
              away_events: teamMetrics.away_events,
              dominant_team: teamMetrics.dominant_team
            },
            coaching_note: result.coaching_note,
            defensive_shift: {
              defending_team: defensiveShift.defending_team,
              average_shift_distance_m: defensiveShift.average_shift_distance_m,
              line_compactness_m: defensiveShift.line_compactness_m,
              line_height_m: defensiveShift.line_height_m,
              note: defensiveShift.note,
              points,
              stages
            }
          }
        };
      })
      .filter((entry): entry is SequenceAnalysisHistoryEntry => entry !== null);

    if (normalizedEntries.length > 0) {
      nextHistory[sequenceId] = normalizedEntries;
    }
  });

  return nextHistory;
}

/**
 * 가져온 JSON의 플레이백 기준 스냅샷을 내부 상태로 정규화합니다.
 *
 * @param value JSON의 `base` 필드입니다.
 * @param fallbackPlayers 기본 대체 선수 목록입니다.
 * @param fallbackBallState 기본 대체 공 상태입니다.
 * @returns 정규화된 기준 선수/공 상태입니다.
 */
function normalizeImportedBaseState(
  value: unknown,
  fallbackPlayers: PlayerNode[],
  fallbackBallState: BallState
) {
  if (!isRecord(value) || !Array.isArray(value.players) || !isRecord(value.ball) || !isRecord(value.ball.position)) {
    return {
      players: fallbackPlayers,
      ballState: fallbackBallState
    };
  }

  const normalizedPlayers = normalizeImportedPlayers(value.players);

  if (!normalizedPlayers) {
    return {
      players: fallbackPlayers,
      ballState: fallbackBallState
    };
  }

  const ownerId =
    value.ball.ownerId === null || typeof value.ball.ownerId === "string"
      ? value.ball.ownerId
      : fallbackBallState.ownerId;
  const ballX = clampPosition(
    typeof value.ball.position.x === "number" ? value.ball.position.x : fallbackBallState.x,
    PITCH_PADDING + PLAYER_RADIUS,
    PITCH_WIDTH - PITCH_PADDING - PLAYER_RADIUS
  );
  const ballY = clampPosition(
    typeof value.ball.position.y === "number" ? value.ball.position.y : fallbackBallState.y,
    PITCH_PADDING + PLAYER_RADIUS,
    PITCH_HEIGHT - PITCH_PADDING - PLAYER_RADIUS
  );

  return {
    players: normalizedPlayers,
    ballState: {
      x: ballX,
      y: ballY,
      ownerId,
      isAnimating: false
    }
  };
}

/**
 * 가져온 공 정보에서 유효한 소유자를 결정합니다.
 *
 * @param ownerId JSON에 기록된 공 소유자 ID입니다.
 * @param players 현재 선수 목록입니다.
 * @param x 공 x 좌표입니다.
 * @param y 공 y 좌표입니다.
 * @returns 유효한 선수 ID 또는 가장 가까운 선수 ID입니다.
 */
function resolveImportedBallOwnerId(ownerId: string | null, players: PlayerNode[], x: number, y: number) {
  if (ownerId && getPlayerById(players, ownerId)) {
    return ownerId;
  }

  const nearestPlayer = players.reduce((closestPlayer, player) => {
    const closestDistance = Math.hypot(closestPlayer.x - x, closestPlayer.y - y);
    const nextDistance = Math.hypot(player.x - x, player.y - y);

    return nextDistance < closestDistance ? player : closestPlayer;
  }, players[0]);

  return nearestPlayer.id;
}

/**
 * 가져온 JSON을 내부 상태로 안전하게 바꿀 수 있는지 검사합니다.
 *
 * @param value 사용자가 불러온 JSON 값입니다.
 * @returns 성공 시 내부 상태로 변환된 데이터, 실패 시 오류 메시지입니다.
 */
function normalizeImportedBoard(value: unknown): ImportResult {
  if (!isRecord(value)) {
    return { ok: false, error: "JSON 루트가 객체 형태가 아닙니다." };
  }

  const players = normalizeImportedPlayers(value.players);

  if (!players) {
    return { ok: false, error: "players 배열 형식이 올바르지 않습니다." };
  }

  const passes = normalizeImportedPasses(value.passes, players);

  if (!passes) {
    return { ok: false, error: "passes 배열이 현재 선수 목록과 맞지 않습니다." };
  }

  const movements = normalizeImportedMovements(value.movements, players);

  if (!movements) {
    return { ok: false, error: "movements 배열 형식이 올바르지 않습니다." };
  }

  const shots = normalizeImportedShots(value.shots, players);

  if (!shots) {
    return { ok: false, error: "shots 배열 형식이 올바르지 않습니다." };
  }

  const sequences = normalizeImportedSequences(value.sequences, passes, movements, shots);

  if (!sequences) {
    return { ok: false, error: "sequences 배열 형식이 올바르지 않습니다." };
  }

  const analysisHistory = normalizeImportedAnalysisHistory(value.analysisHistory, sequences);

  if (!isRecord(value.ball) || !isRecord(value.ball.position)) {
    return { ok: false, error: "ball 정보가 누락되었거나 형식이 잘못되었습니다." };
  }

  if (
    (value.ball.ownerId !== null && typeof value.ball.ownerId !== "string") ||
    typeof value.ball.position.x !== "number" ||
    typeof value.ball.position.y !== "number"
  ) {
    return { ok: false, error: "ball 좌표 또는 소유자 형식이 잘못되었습니다." };
  }

  const ballX = clampPosition(
    value.ball.position.x,
    PITCH_PADDING + PLAYER_RADIUS,
    PITCH_WIDTH - PITCH_PADDING - PLAYER_RADIUS
  );
  const ballY = clampPosition(
    value.ball.position.y,
    PITCH_PADDING + PLAYER_RADIUS,
    PITCH_HEIGHT - PITCH_PADDING - PLAYER_RADIUS
  );
  const ownerId = resolveImportedBallOwnerId(value.ball.ownerId, players, ballX, ballY);
  const owner = getPlayerById(players, ownerId) ?? players[0];
  const baseState = normalizeImportedBaseState(value.base, players, {
    x: owner.x,
    y: owner.y,
    ownerId: owner.id,
    isAnimating: false
  });

  return {
    ok: true,
    players,
    passes,
    movements,
    shots,
    sequences,
    analysisHistory,
    ballState: {
      x: owner.x,
      y: owner.y,
      ownerId: owner.id,
      isAnimating: false
    },
    basePlayers: baseState.players,
    baseBallState: baseState.ballState
  };
}

/**
 * 현재 공 소유자를 사람이 읽기 쉬운 텍스트로 변환합니다.
 *
 * @param players 현재 선수 목록입니다.
 * @param ownerId 공 소유자 ID입니다.
 * @returns 예: `HOME 7` 형태의 문자열입니다.
 */
function formatOwnerLabel(players: PlayerNode[], ownerId: string | null) {
  if (!ownerId) {
    return "알 수 없음";
  }

  const owner = getPlayerById(players, ownerId);

  if (!owner) {
    return "알 수 없음";
  }

  return `${owner.team.toUpperCase()} ${owner.label}`;
}

/**
 * 전술 보드 메인 UI를 렌더링합니다.
 *
 * @returns Football-lab 1단계 인터랙티브 전술 보드입니다.
 */
export function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const recordingSessionRef = useRef<{ startedAt: number; baseOffsetMs: number } | null>(null);
  const dragStartRef = useRef<Record<string, { x: number; y: number }>>({});
  const playbackFrameRef = useRef<number | null>(null);
  const playbackLastTimestampRef = useRef<number | null>(null);
  const playbackElapsedRef = useRef(0);
  const initialBallState = getInitialBallState(initialPlayers);

  const [players, setPlayers] = useState(initialPlayers);
  const [passes, setPasses] = useState<PassLink[]>([]);
  const [movements, setMovements] = useState<MovementPath[]>([]);
  const [shots, setShots] = useState<ShotEvent[]>([]);
  const [sequences, setSequences] = useState<TacticSequence[]>([]);
  const [analysisHistory, setAnalysisHistory] = useState<ExportedAnalysisHistory>({});
  const [selectedPasserId, setSelectedPasserId] = useState<string | null>(null);
  const [pointerPosition, setPointerPosition] = useState<{ x: number; y: number } | null>(null);
  const [hoveredPassId, setHoveredPassId] = useState<string | null>(null);
  const [hoveredMovementId, setHoveredMovementId] = useState<string | null>(null);
  const [selectedMovementId, setSelectedMovementId] = useState<string | null>(null);
  const [editingMovementId, setEditingMovementId] = useState<string | null>(null);
  const [selectedSequenceId, setSelectedSequenceId] = useState<string | null>(null);
  const [activeRecordingSequenceId, setActiveRecordingSequenceId] = useState<string | null>(null);
  const [sequenceNameDraft, setSequenceNameDraft] = useState("");
  const [isShotModeEnabled, setIsShotModeEnabled] = useState(false);
  const [startingPasserDraftId, setStartingPasserDraftId] = useState(initialBallState.ownerId ?? initialPlayers[0].id);
  const [ballImage, setBallImage] = useState<HTMLImageElement | null>(null);
  const [ballAnimation, setBallAnimation] = useState<BallAnimation | null>(null);
  const [timelineBasePlayers, setTimelineBasePlayers] = useState<PlayerNode[]>(initialPlayers);
  const [timelineBaseBallState, setTimelineBaseBallState] = useState<BallState>(initialBallState);
  const [playbackStatus, setPlaybackStatus] = useState<"idle" | "playing" | "paused">("idle");
  const [playbackElapsedMs, setPlaybackElapsedMs] = useState(0);
  const [activePlaybackEvent, setActivePlaybackEvent] = useState<ActivePlaybackEvent | null>(null);
  const [playbackWindow, setPlaybackWindow] = useState<{
    sequenceId: string | null;
    label: string;
    startAtMs: number;
    endAtMs: number;
  } | null>(null);
  const [playbackSpeed, setPlaybackSpeed] = useState<(typeof PLAYBACK_SPEED_OPTIONS)[number]>(1);
  const [sequenceAnalysis, setSequenceAnalysis] = useState<SequenceAnalysisResult | null>(null);
  const [isComparisonModeEnabled, setIsComparisonModeEnabled] = useState(false);
  const [comparisonBaseAnalyzedAt, setComparisonBaseAnalyzedAt] = useState<string | null>(null);
  const [isSequenceAnalysisLoading, setIsSequenceAnalysisLoading] = useState(false);
  const [sequenceAnalysisError, setSequenceAnalysisError] = useState<string | null>(null);
  const [interactionMessage, setInteractionMessage] = useState(DEFAULT_INTERACTION_MESSAGE);
  const [ballState, setBallState] = useState<BallState>(initialBallState);

  const selectedPasser = selectedPasserId ? getPlayerById(players, selectedPasserId) : undefined;
  const activeScreen = getScreenFromPathname(location.pathname);
  const ballOwner = ballState.ownerId ? getPlayerById(players, ballState.ownerId) : undefined;
  const timelineEvents = buildTimelineEvents(passes, movements, shots);
  const isPlaybackRunning = playbackStatus === "playing" || playbackStatus === "paused";
  const shouldShowAllEvents = isPlaybackRunning && playbackWindow?.sequenceId === null;
  const activePlaybackPassId = activePlaybackEvent?.kind === "pass" ? activePlaybackEvent.id : null;
  const activePlaybackMovementId = activePlaybackEvent?.kind === "move" ? activePlaybackEvent.id : null;
  const activePlaybackShotId = activePlaybackEvent?.kind === "shot" ? activePlaybackEvent.id : null;
  const selectedSequence = selectedSequenceId ? sequences.find((sequence) => sequence.id === selectedSequenceId) : undefined;
  const sequenceScopedEvents = shouldShowAllEvents
    ? { passes, movements, shots }
    : getSequenceScopedEvents(playbackWindow?.sequenceId ?? selectedSequenceId, sequences, passes, movements, shots);
  const visiblePasses = sequenceScopedEvents.passes;
  const visibleMovements = sequenceScopedEvents.movements;
  const visibleShots = sequenceScopedEvents.shots;
  const automaticDefensiveShift = buildAutomaticDefensiveShift(
    timelineBasePlayers,
    timelineBaseBallState,
    visiblePasses,
    visibleMovements,
    visibleShots
  );
  const selectedSequenceHistory = selectedSequenceId ? analysisHistory[selectedSequenceId] ?? [] : [];
  const latestSelectedSequenceHistoryEntry = selectedSequenceHistory.at(-1) ?? null;
  const latestSelectedSequenceAnalysis =
    latestSelectedSequenceHistoryEntry?.result ??
    (sequenceAnalysis && sequenceAnalysis.sequence_id === selectedSequenceId ? sequenceAnalysis : null);
  const previousSequenceAnalysisEntry = selectedSequenceHistory.length > 1 ? selectedSequenceHistory.at(-2) ?? null : null;
  const pickedComparisonBaseEntry = comparisonBaseAnalyzedAt
    ? selectedSequenceHistory.find((entry) => entry.analyzed_at === comparisonBaseAnalyzedAt) ?? null
    : null;
  const comparisonBaseEntry =
    isComparisonModeEnabled &&
    pickedComparisonBaseEntry &&
    pickedComparisonBaseEntry.analyzed_at !== latestSelectedSequenceHistoryEntry?.analyzed_at
      ? pickedComparisonBaseEntry
      : previousSequenceAnalysisEntry;
  const effectiveDefensiveShift = latestSelectedSequenceAnalysis?.defensive_shift ?? automaticDefensiveShift;
  const playbackDefensiveShiftState = getPlaybackDefensiveShiftState(
    effectiveDefensiveShift,
    playbackWindow,
    playbackElapsedMs
  );
  const isPlaybackShiftActive =
    isPlaybackRunning &&
    Boolean(playbackWindow);
  const activePlaybackShiftStage = playbackDefensiveShiftState?.activeStage ?? null;
  const displayPlayers = isPlaybackShiftActive
    ? getShiftAdjustedPlayers(players, effectiveDefensiveShift, playbackDefensiveShiftState)
    : players;
  const inspectedPassId =
    activePlaybackEvent?.kind === "pass" ? activePlaybackEvent.id : hoveredPassId ?? visiblePasses.at(-1)?.id ?? null;
  const inspectedMovementId =
    activePlaybackEvent?.kind === "move" ? activePlaybackEvent.id : hoveredMovementId ?? selectedMovementId ?? null;
  const inspectedPass = inspectedPassId ? visiblePasses.find((pass) => pass.id === inspectedPassId) : undefined;
  const inspectedFromPlayer = inspectedPass ? getPlayerById(displayPlayers, inspectedPass.fromId) : undefined;
  const inspectedToPlayer = inspectedPass ? getPlayerById(displayPlayers, inspectedPass.toId) : undefined;
  const inspectedAnalysis =
    inspectedFromPlayer && inspectedToPlayer
      ? getPassAnalysis(displayPlayers, inspectedFromPlayer, inspectedToPlayer)
      : undefined;
  const inspectedMovement = inspectedMovementId
    ? visibleMovements.find((movement) => movement.id === inspectedMovementId)
    : undefined;
  const inspectedMovementAnalysis = inspectedMovement ? getMovementAnalysis(inspectedMovement) : undefined;
  const progressionTrendGeometry = buildTrendChartGeometry(
    selectedSequenceHistory.map((entry) => entry.result.total_progression_m),
    240,
    88,
    12
  );
  const pressureTrendGeometry = buildTrendChartGeometry(
    selectedSequenceHistory.map((entry) => entry.result.pressure_index * 100),
    240,
    88,
    12
  );
  const widthTrendGeometry = buildTrendChartGeometry(
    selectedSequenceHistory.map((entry) => entry.result.support_width_m),
    240,
    88,
    12
  );
  const dominantAnalysisTeam =
    latestSelectedSequenceAnalysis?.team_metrics.dominant_team === "away"
      ? "away"
      : latestSelectedSequenceAnalysis?.team_metrics.dominant_team === "home"
        ? "home"
        : getDominantTeamFromEvents(visiblePasses, visibleMovements, visibleShots, displayPlayers);
  const playerInvolvementData: AnalysisDistributionDatum[] = players
    .map((player) => {
      const passTouches = visiblePasses.filter((pass) => pass.fromId === player.id || pass.toId === player.id).length;
      const moveTouches = visibleMovements.filter((movement) => movement.playerId === player.id).length;
      const shotTouches = visibleShots.filter((shot) => shot.playerId === player.id).length;

      return {
        label: `${player.team === "home" ? "H" : "A"} ${player.label}`,
        value: passTouches + moveTouches + shotTouches,
        color: player.team === "home" ? "#38bdf8" : "#fb7185"
      };
    })
    .filter((entry) => entry.value > 0)
    .sort((left, right) => right.value - left.value)
    .slice(0, 6);
  const progressionZoneData: AnalysisDistributionDatum[] = [
    {
      label: "후방 빌드업",
      value: [...visiblePasses.map((pass) => getPlayerById(displayPlayers, pass.toId)?.x ?? 0), ...visibleMovements.map((movement) => movement.toX), ...visibleShots.map((shot) => shot.fromX)].filter((x) => x < PITCH_WIDTH / 3).length,
      color: "#38bdf8"
    },
    {
      label: "중원 전개",
      value: [...visiblePasses.map((pass) => getPlayerById(displayPlayers, pass.toId)?.x ?? 0), ...visibleMovements.map((movement) => movement.toX), ...visibleShots.map((shot) => shot.fromX)].filter((x) => x >= PITCH_WIDTH / 3 && x < (PITCH_WIDTH / 3) * 2).length,
      color: "#f59e0b"
    },
    {
      label: "최종 전진",
      value: [...visiblePasses.map((pass) => getPlayerById(displayPlayers, pass.toId)?.x ?? 0), ...visibleMovements.map((movement) => movement.toX), ...visibleShots.map((shot) => shot.fromX)].filter((x) => x >= (PITCH_WIDTH / 3) * 2).length,
      color: "#22c55e"
    }
  ];
  const lateralOccupancyData: AnalysisDistributionDatum[] = [
    {
      label: "좌측 채널",
      value: [...visiblePasses.map((pass) => getPlayerById(displayPlayers, pass.toId)?.y ?? 0), ...visibleMovements.map((movement) => movement.toY), ...visibleShots.map((shot) => shot.fromY)].filter((y) => y < PITCH_HEIGHT / 3).length,
      color: "#60a5fa"
    },
    {
      label: "하프스페이스/중앙",
      value: [...visiblePasses.map((pass) => getPlayerById(displayPlayers, pass.toId)?.y ?? 0), ...visibleMovements.map((movement) => movement.toY), ...visibleShots.map((shot) => shot.fromY)].filter((y) => y >= PITCH_HEIGHT / 3 && y < (PITCH_HEIGHT / 3) * 2).length,
      color: "#f97316"
    },
    {
      label: "우측 채널",
      value: [...visiblePasses.map((pass) => getPlayerById(displayPlayers, pass.toId)?.y ?? 0), ...visibleMovements.map((movement) => movement.toY), ...visibleShots.map((shot) => shot.fromY)].filter((y) => y >= (PITCH_HEIGHT / 3) * 2).length,
      color: "#a78bfa"
    }
  ];

  useEffect(() => {
    const image = new window.Image();
    image.src = ballImageUrl;
    image.onload = () => setBallImage(image);
  }, []);

  useEffect(() => {
    setSequenceNameDraft(selectedSequence?.name ?? "");
  }, [selectedSequence?.id, selectedSequence?.name]);

  useEffect(() => {
    setIsComparisonModeEnabled(false);
    setComparisonBaseAnalyzedAt(null);
  }, [selectedSequenceId]);

  useEffect(() => {
    setStartingPasserDraftId(timelineBaseBallState.ownerId ?? initialPlayers[0].id);
  }, [timelineBaseBallState.ownerId]);

  useEffect(() => {
    if (ballAnimation === null) {
      return;
    }

    let frameId = 0;

    const animate = (timestamp: number) => {
      const elapsed = timestamp - ballAnimation.startTime;
      const progress = Math.min(elapsed / ballAnimation.durationMs, 1);
      const nextX = ballAnimation.fromX + (ballAnimation.toX - ballAnimation.fromX) * progress;
      const nextY = ballAnimation.fromY + (ballAnimation.toY - ballAnimation.fromY) * progress;

      if (progress >= 1) {
        setBallState({
          x: ballAnimation.toX,
          y: ballAnimation.toY,
          ownerId: ballAnimation.targetPlayerId,
          isAnimating: false
        });
        if (ballAnimation.source === "manual") {
          setInteractionMessage(`패스 완료: ${formatOwnerLabel(players, ballAnimation.targetPlayerId)}가 공을 받았습니다.`);
        }
        setBallAnimation(null);
        return;
      }

      setBallState({
        x: nextX,
        y: nextY,
        ownerId: null,
        isAnimating: true
      });
      frameId = window.requestAnimationFrame(animate);
    };

    frameId = window.requestAnimationFrame(animate);

    return () => window.cancelAnimationFrame(frameId);
  }, [ballAnimation, players]);

  useEffect(() => {
    if (playbackStatus !== "playing") {
      return;
    }
    const playbackLimitMs = playbackWindow?.endAtMs ?? getTimelineEndMs(passes, movements, shots);

    const applyPlaybackFrame = (elapsedMs: number) => {
      const snapshot = getBoardSnapshotAtElapsed(
        timelineBasePlayers,
        timelineBaseBallState,
        passes,
        movements,
        shots,
        elapsedMs
      );

      setPlayers(snapshot.players);
      setBallState(snapshot.ballState);
      setActivePlaybackEvent(snapshot.activeEvent);

      if (snapshot.activeEvent?.kind === "pass") {
        const pass = passes.find((entry) => entry.id === snapshot.activeEvent?.id);
        const participants = pass ? getPassParticipants(snapshot.players, pass) : null;

        if (participants) {
          setInteractionMessage(
            `${playbackWindow?.label ?? "전체 타임라인"} 패스 재생 (${formatPlaybackSpeedLabel(playbackSpeed)}): ${participants.fromPlayer.team.toUpperCase()} ${participants.fromPlayer.label} -> ${participants.toPlayer.team.toUpperCase()} ${participants.toPlayer.label}`
          );
        }
      }

      if (snapshot.activeEvent?.kind === "move") {
        const movement = movements.find((entry) => entry.id === snapshot.activeEvent?.id);
        const movingPlayer = movement ? getPlayerById(snapshot.players, movement.playerId) : undefined;

        if (movement && movingPlayer) {
          setInteractionMessage(
            `${playbackWindow?.label ?? "전체 타임라인"} 이동 재생 (${formatPlaybackSpeedLabel(playbackSpeed)}): ${movingPlayer.team.toUpperCase()} ${movingPlayer.label} 이동 중`
          );
        }
      }

      if (snapshot.activeEvent?.kind === "shot") {
        const shot = shots.find((entry) => entry.id === snapshot.activeEvent?.id);
        const shooter = shot ? getPlayerById(snapshot.players, shot.playerId) : undefined;

        if (shot && shooter) {
          setInteractionMessage(
            `${playbackWindow?.label ?? "전체 타임라인"} 슈팅 재생 (${formatPlaybackSpeedLabel(playbackSpeed)}): ${shooter.team.toUpperCase()} ${shooter.label} ${getShotOutcomeLabel(shot.outcome)}, xG ${Math.round(shot.xg * 100)}%`
          );
        }
      }
    };

    const tick = (timestamp: number) => {
      if (playbackLastTimestampRef.current === null) {
        playbackLastTimestampRef.current = timestamp;
      }

      const deltaMs = (timestamp - playbackLastTimestampRef.current) * playbackSpeed;
      playbackLastTimestampRef.current = timestamp;
      playbackElapsedRef.current += deltaMs;
      setPlaybackElapsedMs(playbackElapsedRef.current);

      if (playbackElapsedRef.current >= playbackLimitMs) {
        applyPlaybackFrame(playbackLimitMs);
        setPlaybackStatus("idle");
        setActivePlaybackEvent(null);
        setInteractionMessage(`${playbackWindow?.label ?? "전체 타임라인"} 플레이백이 완료되었습니다.`);
        playbackLastTimestampRef.current = null;
        playbackFrameRef.current = null;
        return;
      }

      applyPlaybackFrame(playbackElapsedRef.current);
      playbackFrameRef.current = window.requestAnimationFrame(tick);
    };

    playbackFrameRef.current = window.requestAnimationFrame(tick);

    return () => {
      if (playbackFrameRef.current !== null) {
        window.cancelAnimationFrame(playbackFrameRef.current);
        playbackFrameRef.current = null;
      }
    };
  }, [
    movements,
    passes,
    shots,
    playbackSpeed,
    playbackStatus,
    playbackWindow,
    timelineBaseBallState,
    timelineBasePlayers
  ]);

  useEffect(() => {
    if (ballState.isAnimating || ballState.ownerId === null) {
      return;
    }

    const owner = getPlayerById(players, ballState.ownerId);

    if (!owner) {
      return;
    }

    setBallState((current) => {
      if (
        current.isAnimating ||
        current.ownerId !== owner.id ||
        (current.x === owner.x && current.y === owner.y)
      ) {
        return current;
      }

      return {
        x: owner.x,
        y: owner.y,
        ownerId: owner.id,
        isAnimating: false
      };
    });
  }, [players, ballState.isAnimating, ballState.ownerId]);

  /**
   * 현재 이벤트가 하나도 없을 때 플레이백 기준 스냅샷을 고정합니다.
   *
   * @param nextBasePlayers 플레이백 시작 선수 스냅샷입니다.
   * @param nextBaseBallState 플레이백 시작 공 상태입니다.
   */
  function ensureTimelineBaseSnapshot(nextBasePlayers: PlayerNode[], nextBaseBallState: BallState) {
    if (passes.length === 0 && movements.length === 0) {
      setTimelineBasePlayers(nextBasePlayers.map((player) => ({ ...player })));
      setTimelineBaseBallState({ ...nextBaseBallState, isAnimating: false });
    }
  }

  /**
   * 전체 타임라인 또는 선택된 시퀀스에 맞는 플레이백 범위를 계산합니다.
   *
   * @param sequenceId 재생할 시퀀스 ID입니다. `null`이면 전체 타임라인을 사용합니다.
   * @returns 재생 구간 시작/종료 시점과 라벨입니다.
   */
  function getTargetPlaybackWindow(sequenceId: string | null) {
    if (sequenceId) {
      const sequence = sequences.find((entry) => entry.id === sequenceId);

      if (sequence) {
        return {
          sequenceId: sequence.id,
          label: sequence.name,
          startAtMs: sequence.startAtMs,
          endAtMs: sequence.endAtMs
        };
      }
    }

    return {
      sequenceId: null,
      label: "전체 타임라인",
      startAtMs: 0,
      endAtMs: getTimelineEndMs(passes, movements, shots)
    };
  }

  /**
   * 기록 중인 시퀀스가 없으면 새 시퀀스를 만들고, 있으면 기존 ID를 재사용합니다.
   *
   * @param recordedAtMs 새 이벤트의 시작 시점(ms)입니다.
   * @returns 이벤트를 붙일 시퀀스 ID입니다.
   */
  function ensureRecordingSequence(recordedAtMs: number) {
    if (activeRecordingSequenceId && sequences.some((sequence) => sequence.id === activeRecordingSequenceId)) {
      return activeRecordingSequenceId;
    }

    const nextSequenceId = `sequence-${Date.now()}`;
    const nextSequence: TacticSequence = {
      id: nextSequenceId,
      name: `시퀀스 ${sequences.length + 1}`,
      eventRefs: [],
      startAtMs: recordedAtMs,
      endAtMs: recordedAtMs,
      createdAt: new Date().toISOString()
    };

    setSequences((currentSequences) => [...currentSequences, nextSequence]);
    setSelectedSequenceId(nextSequenceId);
    setActiveRecordingSequenceId(nextSequenceId);

    return nextSequenceId;
  }

  /**
   * 새로 기록한 이벤트를 현재 시퀀스에 추가하고 시간 범위를 갱신합니다.
   *
   * @param sequenceId 이벤트를 붙일 시퀀스 ID입니다.
   * @param eventRef 시퀀스에 추가할 이벤트 참조입니다.
   * @param atMs 이벤트 시작 시점(ms)입니다.
   * @param durationMs 이벤트 길이(ms)입니다.
   */
  function appendEventToSequence(
    sequenceId: string,
    eventRef: SequenceEventRef,
    atMs: number,
    durationMs: number
  ) {
    setSequences((currentSequences) =>
      currentSequences.map((sequence) =>
        sequence.id === sequenceId
          ? {
              ...sequence,
              eventRefs: [...sequence.eventRefs, eventRef],
              startAtMs: Math.min(sequence.startAtMs, atMs),
              endAtMs: Math.max(sequence.endAtMs, atMs + durationMs)
            }
          : sequence
      )
    );
  }

  /**
   * 타임라인 편집 후 패스/이동/시퀀스와 현재 보드 상태를 함께 동기화합니다.
   *
   * @param nextPasses 다음 패스 목록입니다.
   * @param nextMovements 다음 이동 경로 목록입니다.
   * @param nextSequences 다음 시퀀스 목록입니다.
   * @param message 사용자에게 보여줄 상태 메시지입니다.
   */
  function applyTimelineMutation(
    nextPasses: PassLink[],
    nextMovements: MovementPath[],
    nextShots: ShotEvent[],
    nextSequences: TacticSequence[],
    message: string
  ) {
    const reconciledSequences = reconcileSequences(nextSequences, nextPasses, nextMovements, nextShots);
    const nextSelectedSequenceId = selectedSequenceId && reconciledSequences.some((sequence) => sequence.id === selectedSequenceId)
      ? selectedSequenceId
      : reconciledSequences[0]?.id ?? null;
    const timelineEndMs = getTimelineEndMs(nextPasses, nextMovements, nextShots);
    const snapshot = getBoardSnapshotAtElapsed(
      timelineBasePlayers,
      timelineBaseBallState,
      nextPasses,
      nextMovements,
      nextShots,
      timelineEndMs
    );

    setPasses(nextPasses);
    setMovements(nextMovements);
    setShots(nextShots);
    setSequences(reconciledSequences);
    setSelectedSequenceId(nextSelectedSequenceId);
    setAnalysisHistory((currentHistory) =>
      Object.fromEntries(
        Object.entries(currentHistory).filter(([sequenceId]) =>
          reconciledSequences.some((sequence) => sequence.id === sequenceId)
        )
      )
    );
    setActiveRecordingSequenceId((currentSequenceId) =>
      currentSequenceId && reconciledSequences.some((sequence) => sequence.id === currentSequenceId)
        ? currentSequenceId
        : null
    );
    setSequenceAnalysis((currentAnalysis) =>
      currentAnalysis && reconciledSequences.some((sequence) => sequence.id === currentAnalysis.sequence_id)
        ? currentAnalysis
        : null
    );
    setSequenceAnalysisError(null);
    setIsShotModeEnabled(false);
    setSelectedMovementId((currentMovementId) =>
      currentMovementId && nextMovements.some((movement) => movement.id === currentMovementId) ? currentMovementId : null
    );
    setEditingMovementId((currentMovementId) =>
      currentMovementId && nextMovements.some((movement) => movement.id === currentMovementId) ? currentMovementId : null
    );
    setPlaybackWindow(null);
    setPlaybackStatus("idle");
    setPlaybackElapsedMs(0);
    playbackElapsedRef.current = 0;
    playbackLastTimestampRef.current = null;
    setActivePlaybackEvent(null);
    setPlayers(snapshot.players);
    setBallState(snapshot.ballState);
    setBallAnimation(null);
    recordingSessionRef.current = null;
    setInteractionMessage(message);
  }

  /**
   * 다음 입력부터 새 전술 시퀀스로 기록되도록 시퀀스 기록 세션을 분리합니다.
   */
  function startNewSequence() {
    setActiveRecordingSequenceId(null);
    setSelectedSequenceId(null);
    setSelectedPasserId(null);
    setIsShotModeEnabled(false);
    setHoveredPassId(null);
    setHoveredMovementId(null);
    setSelectedMovementId(null);
    recordingSessionRef.current = null;
    setInteractionMessage("다음 패스 또는 이동부터 새 시퀀스로 기록합니다. 이전 시퀀스 경로는 화면에서 숨겼습니다.");
  }

  /**
   * 첫 패스를 시작할 기본 공 소유 선수를 설정합니다.
   */
  function applyStartingPasser() {
    if (isPlaybackRunning || ballState.isAnimating) {
      setInteractionMessage("재생 중이거나 공이 이동 중일 때는 시작 패서를 바꿀 수 없습니다.");
      return;
    }

    if (selectedSequenceId || activeRecordingSequenceId) {
      setInteractionMessage("현재 열려 있는 시퀀스 작업이 있어 시작 패서를 변경할 수 없습니다. 작업 보드를 초기화한 뒤 다시 시도하세요.");
      return;
    }

    const nextOwner = getPlayerById(players, startingPasserDraftId);

    if (!nextOwner) {
      setInteractionMessage("선택한 시작 패서를 찾을 수 없습니다.");
      return;
    }

    setTimelineBaseBallState({
      x: nextOwner.x,
      y: nextOwner.y,
      ownerId: nextOwner.id,
      isAnimating: false
    });
    setBallState({
      x: nextOwner.x,
      y: nextOwner.y,
      ownerId: nextOwner.id,
      isAnimating: false
    });
    setSelectedPasserId(null);
    setInteractionMessage(`시작 패서를 ${nextOwner.team.toUpperCase()} ${nextOwner.label}로 설정했습니다.`);
  }

  /**
   * 선택한 시퀀스를 작업 보드에 불러와 그 시퀀스만 집중해서 볼 수 있게 합니다.
   *
   * @param sequenceId 불러올 시퀀스 ID입니다.
   */
  function focusSequence(sequenceId: string) {
    const targetWindow = getTargetPlaybackWindow(sequenceId);
    const snapshot = getBoardSnapshotAtElapsed(
      timelineBasePlayers,
      timelineBaseBallState,
      passes,
      movements,
      shots,
      targetWindow.startAtMs
    );

    setPlayers(snapshot.players);
    setBallState(snapshot.ballState);
    setSelectedSequenceId(sequenceId);
    setActiveRecordingSequenceId(null);
    setPlaybackWindow(null);
    setPlaybackStatus("idle");
    setPlaybackElapsedMs(targetWindow.startAtMs);
    playbackElapsedRef.current = targetWindow.startAtMs;
    setHoveredPassId(null);
    setHoveredMovementId(null);
    setSelectedMovementId(null);
  }

  /**
   * 선택한 시퀀스의 이름을 현재 입력값으로 저장합니다.
   */
  function renameSelectedSequence() {
    if (!selectedSequenceId) {
      setInteractionMessage("먼저 이름을 바꿀 시퀀스를 선택하세요.");
      return;
    }

    const trimmedName = sequenceNameDraft.trim();

    if (trimmedName.length === 0) {
      setInteractionMessage("시퀀스 이름은 비워둘 수 없습니다.");
      return;
    }

    setSequences((currentSequences) =>
      currentSequences.map((sequence) =>
        sequence.id === selectedSequenceId
          ? {
              ...sequence,
              name: trimmedName
            }
          : sequence
      )
    );
    setAnalysisHistory((currentHistory) => ({
      ...currentHistory,
      [selectedSequenceId]: (currentHistory[selectedSequenceId] ?? []).map((entry) => ({
        ...entry,
        result: {
          ...entry.result,
          sequence_name: trimmedName
        }
      }))
    }));
    setSequenceAnalysis((currentAnalysis) =>
      currentAnalysis && currentAnalysis.sequence_id === selectedSequenceId
        ? {
            ...currentAnalysis,
            sequence_name: trimmedName
          }
        : currentAnalysis
    );
    setInteractionMessage(`선택한 시퀀스 이름을 "${trimmedName}"으로 변경했습니다.`);
  }

  /**
   * 비교 모드를 켜거나 끄고, 켤 때는 기본 비교 기준을 직전 분석으로 맞춥니다.
   */
  function toggleComparisonMode() {
    if (selectedSequenceHistory.length < 2) {
      setInteractionMessage("비교 모드를 쓰려면 같은 시퀀스를 두 번 이상 분석해야 합니다.");
      return;
    }

    setIsComparisonModeEnabled((current) => {
      const nextEnabled = !current;

      if (nextEnabled) {
        setComparisonBaseAnalyzedAt((currentBase) => currentBase ?? selectedSequenceHistory.at(-2)?.analyzed_at ?? null);
        setInteractionMessage("비교 모드를 켰습니다. 차트 점이나 분석 기록을 클릭해 기준 분석을 고를 수 있습니다.");
      } else {
        setInteractionMessage("비교 모드를 끄고 직전 분석 대비만 표시합니다.");
      }

      return nextEnabled;
    });
  }

  /**
   * 선택한 분석 시점을 비교 기준으로 고정합니다.
   *
   * @param analyzedAt 사용자가 고른 분석 시각 문자열입니다.
   */
  function selectComparisonBase(analyzedAt: string) {
    if (!latestSelectedSequenceHistoryEntry) {
      return;
    }

    if (analyzedAt === latestSelectedSequenceHistoryEntry.analyzed_at) {
      setInteractionMessage("최신 분석 결과는 비교 기준으로 선택할 수 없습니다.");
      return;
    }

    const baseEntry = selectedSequenceHistory.find((entry) => entry.analyzed_at === analyzedAt);

    if (!baseEntry) {
      setInteractionMessage("선택한 비교 기준 분석을 찾을 수 없습니다.");
      return;
    }

    setIsComparisonModeEnabled(true);
    setComparisonBaseAnalyzedAt(analyzedAt);
    setInteractionMessage(
      `비교 기준을 ${new Date(analyzedAt).toLocaleString("ko-KR")} 분석으로 고정했습니다.`
    );
  }

  /**
   * 사용자 지정 비교 기준을 해제하고 직전 분석 대비 보기로 돌아갑니다.
   */
  function resetComparisonBase() {
    setComparisonBaseAnalyzedAt(null);
    setIsComparisonModeEnabled(false);
    setInteractionMessage("비교 기준을 해제하고 직전 분석 대비 보기로 돌아갑니다.");
  }

  /**
   * 선택한 시퀀스를 백엔드 분석 API로 보내 요약 지표를 받아옵니다.
   */
  async function analyzeSelectedSequence() {
    if (!selectedSequenceId) {
      setInteractionMessage("먼저 분석할 시퀀스를 선택하세요.");
      return;
    }

    const payload = createSequenceAnalysisPayload(
      players,
      passes,
      movements,
      shots,
      sequences,
      timelineBasePlayers,
      timelineBaseBallState,
      selectedSequenceId
    );

    setIsSequenceAnalysisLoading(true);
    setSequenceAnalysisError(null);

    try {
      const response = await fetch(`${API_BASE_URL}/analysis/sequence`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || "시퀀스 분석 요청에 실패했습니다.");
      }

      const rawResult = (await response.json()) as SequenceAnalysisResult;
      const result: SequenceAnalysisResult = {
        ...rawResult,
        threat_points: rawResult.threat_points ?? [],
        epv_heatmap: rawResult.epv_heatmap ?? [],
        shot_outcomes: rawResult.shot_outcomes ?? [],
        defensive_shift: {
          ...rawResult.defensive_shift,
          stages: rawResult.defensive_shift?.stages ?? []
        }
      };
      const historyEntry: SequenceAnalysisHistoryEntry = {
        analyzed_at: new Date().toISOString(),
        result
      };

      setAnalysisHistory((currentHistory) => ({
        ...currentHistory,
        [result.sequence_id]: [...(currentHistory[result.sequence_id] ?? []), historyEntry]
      }));
      setSequenceAnalysis(result);
      setInteractionMessage(`${result.sequence_name} 백엔드 분석을 완료했습니다.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "시퀀스 분석 요청에 실패했습니다.";
      setSequenceAnalysis(null);
      setSequenceAnalysisError(message);
      setInteractionMessage(`시퀀스 분석 실패: ${message}`);
    } finally {
      setIsSequenceAnalysisLoading(false);
    }
  }

  /**
   * 선택한 이동 경로를 편집 모드로 전환하고 시작점으로 선수를 되돌립니다.
   */
  function beginMovementEdit() {
    if (!selectedMovementId) {
      setInteractionMessage("먼저 편집할 이동 경로를 선택하세요.");
      return;
    }

    if (isPlaybackRunning || ballState.isAnimating) {
      setInteractionMessage("재생 중이거나 공이 이동 중일 때는 이동 경로를 편집할 수 없습니다.");
      return;
    }

    const movement = movements.find((entry) => entry.id === selectedMovementId);

    if (!movement) {
      setInteractionMessage("선택한 이동 경로를 찾을 수 없습니다.");
      return;
    }

    setEditingMovementId(movement.id);
    setPlayers((currentPlayers) =>
      currentPlayers.map((player) =>
        player.id === movement.playerId
          ? {
              ...player,
              x: movement.fromX,
              y: movement.fromY
            }
          : player
      )
    );
    if (movement.carriesBall) {
      setBallState({
        x: movement.fromX,
        y: movement.fromY,
        ownerId: movement.playerId,
        isAnimating: false
      });
    }
    setInteractionMessage("선택한 이동 경로를 편집합니다. 같은 선수를 새 위치로 다시 드래그하세요.");
  }

  /**
   * 현재 선택된 이동 경로를 타임라인에서 삭제합니다.
   */
  function removeSelectedMovement() {
    if (!selectedMovementId) {
      setInteractionMessage("먼저 삭제할 이동 경로를 선택하세요.");
      return;
    }

    const movementToRemove = movements.find((movement) => movement.id === selectedMovementId);

    if (!movementToRemove) {
      setInteractionMessage("선택한 이동 경로를 찾을 수 없습니다.");
      return;
    }

    const nextMovementsBase = movements.filter((movement) => movement.id !== selectedMovementId);
    const previousMovement = movements
      .filter(
        (movement) => movement.playerId === movementToRemove.playerId && movement.atMs < movementToRemove.atMs && movement.id !== movementToRemove.id
      )
      .sort((left, right) => left.atMs - right.atMs)
      .at(-1);
    const nextMovements = realignPlayerMovements(
      nextMovementsBase,
      movementToRemove.playerId,
      previousMovement ? undefined : { x: movementToRemove.fromX, y: movementToRemove.fromY }
    );

    applyTimelineMutation(
      passes,
      nextMovements,
      shots,
      sequences,
      "선택한 선수 이동 경로를 제거했습니다."
    );
  }

  /**
   * 시퀀스 하나를 목록과 타임라인에서 함께 삭제합니다.
   *
   * @param sequenceId 삭제할 시퀀스 ID입니다.
   */
  function deleteSequence(sequenceId: string) {
    const sequence = sequences.find((entry) => entry.id === sequenceId);

    if (!sequence) {
      return;
    }

    const passIdsToRemove = new Set(
      sequence.eventRefs.filter((eventRef) => eventRef.kind === "pass").map((eventRef) => eventRef.id)
    );
    const movementIdsToRemove = new Set(
      sequence.eventRefs.filter((eventRef) => eventRef.kind === "move").map((eventRef) => eventRef.id)
    );
    const shotIdsToRemove = new Set(
      sequence.eventRefs.filter((eventRef) => eventRef.kind === "shot").map((eventRef) => eventRef.id)
    );
    const nextPasses = passes.filter((pass) => !passIdsToRemove.has(pass.id));
    let nextMovements = movements.filter((movement) => !movementIdsToRemove.has(movement.id));
    const nextShots = shots.filter((shot) => !shotIdsToRemove.has(shot.id));
    const affectedPlayerIds = new Set(
      movements
        .filter((movement) => movementIdsToRemove.has(movement.id))
        .map((movement) => movement.playerId)
    );

    affectedPlayerIds.forEach((playerId) => {
      const removedMovements = movements
        .filter((movement) => movement.playerId === playerId && movementIdsToRemove.has(movement.id))
        .sort((left, right) => left.atMs - right.atMs);
      const firstRemovedMovement = removedMovements[0];
      const previousMovement = movements
        .filter((movement) => movement.playerId === playerId && movement.atMs < (firstRemovedMovement?.atMs ?? 0) && !movementIdsToRemove.has(movement.id))
        .sort((left, right) => left.atMs - right.atMs)
        .at(-1);

      nextMovements = realignPlayerMovements(
        nextMovements,
        playerId,
        firstRemovedMovement && !previousMovement
          ? { x: firstRemovedMovement.fromX, y: firstRemovedMovement.fromY }
          : undefined
      );
    });

    applyTimelineMutation(
      nextPasses,
      nextMovements,
      nextShots,
      sequences.filter((entry) => entry.id !== sequenceId),
      `${sequence.name}를 목록과 타임라인에서 제거했습니다.`
    );
  }

  /**
   * 새 이벤트를 기록할 현재 시나리오 시간을 계산합니다.
   *
   * @returns 타임라인 기준 이벤트 시작 시점(ms)입니다.
   */
  function getNextRecordedAtMs() {
    if (recordingSessionRef.current === null) {
      recordingSessionRef.current = {
        startedAt: performance.now(),
        baseOffsetMs: getTimelineEndMs(passes, movements, shots)
      };
    }

    return (
      recordingSessionRef.current.baseOffsetMs +
      (performance.now() - recordingSessionRef.current.startedAt)
    );
  }

  /**
   * 재생 엔진을 처음 위치로 되돌립니다.
   *
   * @param message 사용자에게 보여줄 상태 메시지입니다.
   */
  function stopPlayback(message: string) {
    if (playbackFrameRef.current !== null) {
      window.cancelAnimationFrame(playbackFrameRef.current);
      playbackFrameRef.current = null;
    }

    playbackLastTimestampRef.current = null;
    playbackElapsedRef.current = 0;
    setPlaybackElapsedMs(0);
    setPlaybackStatus("idle");
    setActivePlaybackEvent(null);
    const targetWindow = playbackWindow ?? getTargetPlaybackWindow(selectedSequenceId);
    const snapshot = getBoardSnapshotAtElapsed(
      timelineBasePlayers,
      timelineBaseBallState,
      passes,
      movements,
      shots,
      targetWindow.startAtMs
    );

    setPlayers(snapshot.players);
    setBallState(snapshot.ballState);
    setInteractionMessage(message);
  }

  /**
   * 슈팅 모드를 켜거나 끕니다.
   */
  function toggleShotMode() {
    if (isPlaybackRunning || ballState.isAnimating) {
      setInteractionMessage("재생 중이거나 공이 이동 중일 때는 슈팅 모드를 바꿀 수 없습니다.");
      return;
    }

    if (!ballOwner) {
      setInteractionMessage("현재 공 소유 선수가 없어 슈팅 모드를 사용할 수 없습니다.");
      return;
    }

    setSelectedPasserId(null);
    setIsShotModeEnabled((current) => {
      const nextValue = !current;
      setInteractionMessage(
        nextValue
          ? `${ballOwner.team.toUpperCase()} ${ballOwner.label} 슈팅 모드입니다. 경기장 안 원하는 지점을 클릭하세요.`
          : DEFAULT_INTERACTION_MESSAGE
      );
      return nextValue;
    });
  }

  /**
   * 현재 공 소유 선수가 클릭한 목표 지점으로 슈팅 이벤트를 기록합니다.
   *
   * @param targetX 슈팅 목표 X 좌표입니다.
   * @param targetY 슈팅 목표 Y 좌표입니다.
   */
  function recordShot(targetX: number, targetY: number) {
    if (!ballOwner) {
      setInteractionMessage("공 소유 선수가 없어 슈팅을 기록할 수 없습니다.");
      return;
    }

    ensureTimelineBaseSnapshot(players, ballState);
    const recordedAtMs = getNextRecordedAtMs();
    const sequenceId = ensureRecordingSequence(recordedAtMs);
    const nextShotId = `shot-${shots.length + 1}`;
    const rawShot = {
      id: nextShotId,
      playerId: ballOwner.id,
      team: ballOwner.team,
      fromX: ballOwner.x,
      fromY: ballOwner.y,
      targetX,
      targetY,
      atMs: recordedAtMs,
      durationMs: BALL_ANIMATION_DURATION_MS,
      xg: getXgProxyValue(ballOwner.x, ballOwner.y, ballOwner.team)
    };
    const nextShot: ShotEvent = {
      ...rawShot,
      outcome: resolveShotOutcome(players, rawShot)
    };

    setShots((currentShots) => [...currentShots, nextShot]);
    appendEventToSequence(sequenceId, { kind: "shot", id: nextShotId }, recordedAtMs, BALL_ANIMATION_DURATION_MS);
    setSelectedSequenceId(sequenceId);
    setBallAnimation({
      fromX: ballOwner.x,
      fromY: ballOwner.y,
      toX: targetX,
      toY: targetY,
      targetPlayerId: ballOwner.id,
      startTime: performance.now(),
      durationMs: BALL_ANIMATION_DURATION_MS,
      source: "manual",
      passId: null
    });
    setBallState({
      x: targetX,
      y: targetY,
      ownerId: null,
      isAnimating: true
    });
    setIsShotModeEnabled(false);
    setInteractionMessage(
      `${ballOwner.team.toUpperCase()} ${ballOwner.label}의 슈팅을 기록했습니다. ${getShotOutcomeLabel(nextShot.outcome)}, xG ${Math.round(nextShot.xg * 100)}%`
    );
  }

  /**
   * 사용자가 클릭한 선수가 패스를 시작하거나 받을 수 있는지 처리합니다.
   *
   * @param playerId 사용자가 클릭한 선수 ID입니다.
   */
  function handlePlayerClick(playerId: string) {
    const clickedPlayer = getPlayerById(players, playerId);

    if (!clickedPlayer) {
      return;
    }

    if (isPlaybackRunning) {
      setInteractionMessage("플레이백 재생 중에는 수동 패스를 만들 수 없습니다.");
      return;
    }

    if (ballState.isAnimating) {
      setInteractionMessage("공이 이동 중입니다. 애니메이션이 끝난 뒤 다시 시도하세요.");
      return;
    }

    if (isShotModeEnabled) {
      setInteractionMessage("슈팅 모드에서는 경기장 지점을 클릭해 슈팅을 기록하세요.");
      return;
    }

    if (selectedPasserId === null) {
      if (ballState.ownerId !== playerId) {
        setInteractionMessage(
          `현재 공은 ${formatOwnerLabel(players, ballState.ownerId)}가 가지고 있습니다. 공 소유 선수만 패스를 시작할 수 있습니다.`
        );
        return;
      }

      setSelectedPasserId(playerId);
      setInteractionMessage(`${clickedPlayer.team.toUpperCase()} ${clickedPlayer.label}의 패스 대상을 선택하세요.`);
      return;
    }

    if (selectedPasserId === playerId) {
      setSelectedPasserId(null);
      setInteractionMessage(DEFAULT_INTERACTION_MESSAGE);
      return;
    }

    const passerId = selectedPasserId;
    const passer = getPlayerById(players, passerId);

    if (!passer) {
      setSelectedPasserId(null);
      setInteractionMessage(DEFAULT_INTERACTION_MESSAGE);
      return;
    }

    if (!isSameTeamPass(passer, clickedPlayer)) {
      setInteractionMessage("상대 팀 선수에게는 패스할 수 없습니다. 같은 팀 선수를 선택하세요.");
      return;
    }

    const exists = passes.some((pass) => pass.fromId === passerId && pass.toId === playerId);

    if (exists) {
      setSelectedPasserId(null);
      setInteractionMessage("같은 방향의 패스는 이미 기록되어 있습니다.");
      return;
    }

    ensureTimelineBaseSnapshot(players, ballState);
    const recordedAtMs = getNextRecordedAtMs();
    const sequenceId = ensureRecordingSequence(recordedAtMs);
    const nextPassId = `pass-${passes.length + 1}`;

    setPasses((currentPasses) => [
      ...currentPasses,
      {
        id: nextPassId,
        fromId: passerId,
        toId: playerId,
        atMs: recordedAtMs,
        durationMs: BALL_ANIMATION_DURATION_MS
      }
    ]);
    appendEventToSequence(sequenceId, { kind: "pass", id: nextPassId }, recordedAtMs, BALL_ANIMATION_DURATION_MS);
    setSelectedSequenceId(sequenceId);

    setBallAnimation({
      fromX: passer.x,
      fromY: passer.y,
      toX: clickedPlayer.x,
      toY: clickedPlayer.y,
      targetPlayerId: clickedPlayer.id,
      startTime: performance.now(),
      durationMs: BALL_ANIMATION_DURATION_MS,
      source: "manual",
      passId: null
    });
    setBallState({
      x: passer.x,
      y: passer.y,
      ownerId: null,
      isAnimating: true
    });
    setSelectedPasserId(null);
    setHoveredPassId(null);
    setInteractionMessage(`${passer.team.toUpperCase()} ${passer.label} -> ${clickedPlayer.team.toUpperCase()} ${clickedPlayer.label} 패스 진행 중입니다.`);
  }

  /**
   * 드래그된 선수 좌표를 보드 상태에 반영합니다.
   *
   * @param playerId 이동한 선수 ID입니다.
   * @param x 새 x 좌표입니다.
   * @param y 새 y 좌표입니다.
   */
  function handlePlayerDrag(playerId: string, x: number, y: number) {
    if (isPlaybackRunning || ballState.isAnimating) {
      return;
    }

    setPlayers((currentPlayers) =>
      currentPlayers.map((player) =>
        player.id === playerId
          ? {
              ...player,
              x: clampPosition(x, PITCH_PADDING + PLAYER_RADIUS, PITCH_WIDTH - PITCH_PADDING - PLAYER_RADIUS),
              y: clampPosition(y, PITCH_PADDING + PLAYER_RADIUS, PITCH_HEIGHT - PITCH_PADDING - PLAYER_RADIUS)
            }
          : player
      )
    );
  }

  /**
   * 드래그 시작 위치를 저장해 이동 경로를 기록할 준비를 합니다.
   *
   * @param playerId 드래그를 시작한 선수 ID입니다.
   */
  function handlePlayerDragStart(playerId: string) {
    if (isPlaybackRunning) {
      setInteractionMessage("플레이백 중에는 선수 이동 경로를 새로 기록할 수 없습니다.");
      return;
    }

    if (ballState.isAnimating) {
      setInteractionMessage("공 애니메이션이 끝난 뒤에 선수 이동을 기록해 주세요.");
      return;
    }

    if (editingMovementId) {
      const editingMovement = movements.find((movement) => movement.id === editingMovementId);

      if (editingMovement && editingMovement.playerId !== playerId) {
        setInteractionMessage("편집 중인 이동 경로의 선수만 다시 드래그할 수 있습니다.");
        return;
      }
    }

    const player = getPlayerById(players, playerId);

    if (!player) {
      return;
    }

    dragStartRef.current[playerId] = { x: player.x, y: player.y };
  }

  /**
   * 드래그 종료 시 이동 경로를 생성하고 타임라인 이벤트로 기록합니다.
   *
   * @param playerId 이동한 선수 ID입니다.
   */
  function handlePlayerDragEnd(playerId: string) {
    if (isPlaybackRunning || ballState.isAnimating) {
      return;
    }

    const start = dragStartRef.current[playerId];
    const player = getPlayerById(players, playerId);

    if (!start || !player) {
      return;
    }

    const distance = Math.hypot(player.x - start.x, player.y - start.y);

    if (distance < MOVE_DISTANCE_THRESHOLD) {
      if (editingMovementId) {
        setEditingMovementId(null);
        setInteractionMessage("이동 편집이 취소되었습니다. 더 긴 드래그로 다시 시도하세요.");
      }
      delete dragStartRef.current[playerId];
      return;
    }

    if (editingMovementId) {
      const movementToEdit = movements.find((movement) => movement.id === editingMovementId);

      if (!movementToEdit) {
        setEditingMovementId(null);
        delete dragStartRef.current[playerId];
        return;
      }

      const nextMovements = realignPlayerMovements(
        movements.map((movement) =>
          movement.id === editingMovementId
            ? {
                ...movement,
                toX: player.x,
                toY: player.y
              }
            : movement
        ),
        playerId
      );

      applyTimelineMutation(
        passes,
        nextMovements,
        shots,
        sequences,
        "선택한 이동 경로를 새 도착 지점으로 수정했습니다."
      );
      setSelectedMovementId(editingMovementId);
      setEditingMovementId(null);
      delete dragStartRef.current[playerId];
      return;
    }

    ensureTimelineBaseSnapshot(
      players.map((entry) =>
        entry.id === playerId ? { ...entry, x: start.x, y: start.y } : { ...entry }
      ),
      ballState.ownerId === playerId
        ? { ...ballState, x: start.x, y: start.y, isAnimating: false }
        : ballState
    );

    const carriesBall = ballState.ownerId === playerId && !ballState.isAnimating;
    const recordedAtMs = getNextRecordedAtMs();
    const sequenceId = ensureRecordingSequence(recordedAtMs);
    const nextMovementId = `move-${movements.length + 1}`;

    setMovements((currentMovements) => [
      ...currentMovements,
      {
        id: nextMovementId,
        playerId,
        team: player.team,
        fromX: start.x,
        fromY: start.y,
        toX: player.x,
        toY: player.y,
        atMs: recordedAtMs,
        durationMs: MOVE_ANIMATION_DURATION_MS,
        carriesBall
      }
    ]);
    appendEventToSequence(sequenceId, { kind: "move", id: nextMovementId }, recordedAtMs, MOVE_ANIMATION_DURATION_MS);
    setSelectedSequenceId(sequenceId);
    setSelectedMovementId(nextMovementId);

    setInteractionMessage(
      `${player.team.toUpperCase()} ${player.label} 이동 경로를 기록했습니다.${carriesBall ? " 공 운반도 함께 기록됩니다." : ""}`
    );
    delete dragStartRef.current[playerId];
  }

  /**
   * 현재 전술 보드를 JSON 파일로 다운로드합니다.
   */
  function exportBoard() {
    const payload = createExportPayload(
      players,
      passes,
      movements,
      shots,
      sequences,
      analysisHistory,
      ballState,
      timelineBasePlayers,
      timelineBaseBallState
    );
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const downloadUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

    link.href = downloadUrl;
    link.download = `football-lab-tactics-${timestamp}.json`;
    link.click();

    window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 0);
    setInteractionMessage("현재 전술 보드를 JSON 파일로 저장했습니다.");
  }

  /**
   * 현재 패스 목록을 처음부터 시간순으로 재생합니다.
   */
  function startPlayback(sequenceId: string | null = selectedSequenceId) {
    if (timelineEvents.length === 0) {
      setInteractionMessage("재생할 이벤트가 없습니다. 패스나 선수 이동을 먼저 기록해 주세요.");
      return;
    }

    if (ballState.isAnimating || playbackStatus === "playing") {
      setInteractionMessage("이미 애니메이션 또는 플레이백이 진행 중입니다.");
      return;
    }

    const targetWindow = getTargetPlaybackWindow(sequenceId);
    const isResuming =
      playbackStatus === "paused" &&
      playbackWindow?.sequenceId === targetWindow.sequenceId &&
      playbackWindow.startAtMs === targetWindow.startAtMs &&
      playbackWindow.endAtMs === targetWindow.endAtMs;

    playbackElapsedRef.current = isResuming ? playbackElapsedMs : targetWindow.startAtMs;
    playbackLastTimestampRef.current = null;
    setSelectedPasserId(null);
    setHoveredPassId(null);
    setHoveredMovementId(null);
    if (!isResuming) {
      const snapshot = getBoardSnapshotAtElapsed(
        timelineBasePlayers,
        timelineBaseBallState,
        passes,
        movements,
        shots,
        targetWindow.startAtMs
      );

      setPlaybackWindow(targetWindow);
      setPlaybackElapsedMs(targetWindow.startAtMs);
      setActivePlaybackEvent(null);
      setPlayers(snapshot.players);
      setBallState(snapshot.ballState);
    }
    setPlaybackStatus("playing");
    setInteractionMessage(
      isResuming
        ? `${targetWindow.label} 플레이백을 ${formatPlaybackSpeedLabel(playbackSpeed)} 속도로 이어서 재생합니다.`
        : `${targetWindow.label} 플레이백을 ${formatPlaybackSpeedLabel(playbackSpeed)} 속도로 시작합니다.`
    );
  }

  /**
   * 플레이백을 일시정지합니다.
   */
  function pausePlayback() {
    if (playbackStatus !== "playing") {
      setInteractionMessage("현재 재생 중인 플레이백이 없습니다.");
      return;
    }

    if (playbackFrameRef.current !== null) {
      window.cancelAnimationFrame(playbackFrameRef.current);
      playbackFrameRef.current = null;
    }

    playbackLastTimestampRef.current = null;
    setPlaybackStatus("paused");
    setInteractionMessage("플레이백을 일시정지했습니다. 이어재생할 수 있습니다.");
  }

  /**
   * 플레이백을 처음 위치로 되돌립니다.
   */
  function resetPlayback() {
    if (timelineEvents.length === 0) {
      setInteractionMessage("재생할 이벤트가 없습니다. 패스나 선수 이동을 먼저 기록해 주세요.");
      return;
    }

    stopPlayback("플레이백 위치를 첫 이벤트 시작 시점으로 되돌렸습니다.");
  }

  /**
   * 숨겨진 파일 입력창을 열어 JSON 불러오기를 시작합니다.
   */
  function openImportDialog() {
    fileInputRef.current?.click();
  }

  /**
   * 사용자가 고른 JSON 파일을 읽어 보드 상태로 복원합니다.
   *
   * @param event 파일 입력 변경 이벤트입니다.
   */
  async function handleImportChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as unknown;
      const result = normalizeImportedBoard(parsed);

      if (!result.ok) {
        setInteractionMessage(`불러오기 실패: ${result.error}`);
        return;
      }

      setPlayers(result.players);
      setPasses(result.passes);
      setMovements(result.movements);
      setShots(result.shots);
      setSequences(result.sequences);
      setAnalysisHistory(result.analysisHistory);
      setBallState(result.ballState);
      setTimelineBasePlayers(result.basePlayers);
      setTimelineBaseBallState(result.baseBallState);
      setBallAnimation(null);
      setPlaybackStatus("idle");
      setPlaybackElapsedMs(0);
      playbackElapsedRef.current = 0;
      playbackLastTimestampRef.current = null;
      setActivePlaybackEvent(null);
      setSelectedPasserId(null);
      setPointerPosition(null);
      setHoveredPassId(null);
      setHoveredMovementId(null);
      setSelectedMovementId(null);
      setEditingMovementId(null);
      setSelectedSequenceId(result.sequences[0]?.id ?? null);
      setActiveRecordingSequenceId(null);
      setSequenceAnalysis(null);
      setSequenceAnalysisError(null);
      setPlaybackWindow(null);
      recordingSessionRef.current = null;
      setInteractionMessage("JSON 전술 보드를 성공적으로 불러왔습니다.");
    } catch {
      setInteractionMessage("불러오기 실패: JSON 파일을 읽을 수 없거나 형식이 잘못되었습니다.");
    } finally {
      event.target.value = "";
    }
  }

  /**
   * 보드를 초기 상태로 되돌립니다.
   */
  function resetBoard() {
    setPlayers(initialPlayers);
    setShots([]);
    setSelectedPasserId(null);
    setPointerPosition(null);
    setHoveredPassId(null);
    setHoveredMovementId(null);
    setSelectedMovementId(null);
    setEditingMovementId(null);
    setSelectedSequenceId(null);
    setActiveRecordingSequenceId(null);
    setSequenceAnalysis(null);
    setSequenceAnalysisError(null);
    setBallAnimation(null);
    setIsShotModeEnabled(false);
    setPlaybackStatus("idle");
    setPlaybackElapsedMs(0);
    playbackElapsedRef.current = 0;
    playbackLastTimestampRef.current = null;
    setActivePlaybackEvent(null);
    setPlaybackWindow(null);
    setTimelineBasePlayers(initialPlayers);
    setTimelineBaseBallState(getInitialBallState(initialPlayers));
    recordingSessionRef.current = null;
    setBallState(getInitialBallState(initialPlayers));
    setStartingPasserDraftId(getInitialBallState(initialPlayers).ownerId ?? initialPlayers[0].id);
    setInteractionMessage(DEFAULT_INTERACTION_MESSAGE);
  }

  /**
   * 현재 작업 보드만 초기화하고 저장된 시퀀스/분석 기록은 보존합니다.
   */
  function resetWorkingBoard() {
    if (playbackFrameRef.current !== null) {
      window.cancelAnimationFrame(playbackFrameRef.current);
      playbackFrameRef.current = null;
    }

    const nextInitialBallState = getInitialBallState(initialPlayers);
    setPlayers(initialPlayers);
    setShots([]);
    setSelectedPasserId(null);
    setPointerPosition(null);
    setHoveredPassId(null);
    setHoveredMovementId(null);
    setSelectedMovementId(null);
    setEditingMovementId(null);
    setSelectedSequenceId(null);
    setActiveRecordingSequenceId(null);
    setSequenceAnalysis(null);
    setSequenceAnalysisError(null);
    setBallAnimation(null);
    setIsShotModeEnabled(false);
    setPlaybackStatus("idle");
    setPlaybackElapsedMs(0);
    playbackElapsedRef.current = 0;
    playbackLastTimestampRef.current = null;
    setActivePlaybackEvent(null);
    setPlaybackWindow(null);
    setTimelineBasePlayers(initialPlayers);
    setTimelineBaseBallState(nextInitialBallState);
    recordingSessionRef.current = null;
    setBallState(nextInitialBallState);
    setStartingPasserDraftId(nextInitialBallState.ownerId ?? initialPlayers[0].id);
    setInteractionMessage("작업 보드만 초기화했습니다. 기존 시퀀스와 분석 기록은 유지됩니다.");
  }

  /**
   * 저장된 모든 시퀀스와 분석 기록까지 완전히 비웁니다.
   */
  function clearAllProjectData() {
    setPasses([]);
    setMovements([]);
    setShots([]);
    setSequences([]);
    setAnalysisHistory({});
    resetBoard();
    setInteractionMessage("프로젝트의 시퀀스, 경로, 분석 기록을 모두 삭제했습니다.");
  }

  /**
   * 브라우저 URL과 앱 화면 상태를 함께 갱신합니다.
   *
   * @param screen 이동할 화면 이름입니다.
   */
  function navigateToScreen(screen: AppScreen) {
    const nextPathname = getPathnameForScreen(screen);
    if (location.pathname !== nextPathname) {
      navigate(nextPathname);
    }
  }

  return (
    <main className="app-shell">
      <section className="hero">
        <p className="eyebrow">Stage 1 Prototype</p>
        <h1>Football-lab</h1>
        <p className="intro">
          사용자가 전술을 그리고, AI가 수비 반응과 공간 점유를 해석하는 축구 전술 실험실
        </p>
        <div className="screen-nav">
          <button
            type="button"
            className={`board-button${activeScreen === "home" ? " board-button-active" : ""}`}
            onClick={() => navigateToScreen("home")}
          >
            홈
          </button>
          <button
            type="button"
            className={`board-button${activeScreen === "simulation" ? " board-button-active" : ""}`}
            onClick={() => navigateToScreen("simulation")}
          >
            시뮬레이션
          </button>
          <button
            type="button"
            className={`board-button${activeScreen === "analysis" ? " board-button-active" : ""}`}
            onClick={() => navigateToScreen("analysis")}
          >
            분석
          </button>
        </div>
      </section>

      {activeScreen === "home" ? (
        <section className="home-panel home-panel-hero">
          <div className="home-card-grid">
            <article className="home-card home-card-guide">
              <p className="analysis-eyebrow">Guide Docs</p>
              <h2>작업 가이드</h2>
              <p>홈에서 시뮬레이션으로 이동해 전술 이벤트를 만든 뒤, 분석 화면에서 시퀀스별 지표와 시각화를 확인합니다.</p>
              <ul className="guide-list">
                <li>패스와 이동을 기록하면 시퀀스가 자동으로 분리됩니다.</li>
                <li>수비 반응은 별도 입력 없이 각 이벤트마다 자동으로 생성됩니다.</li>
                <li>작업 보드 초기화는 저장된 시퀀스를 지우지 않고 새 보드만 준비합니다.</li>
              </ul>
            </article>
            <article className="home-card home-card-workflow">
              <p className="analysis-eyebrow">Workflow</p>
              <h2>권장 흐름</h2>
              <div className="workflow-steps">
                <span>1. 홈에서 시뮬레이션으로 이동합니다.</span>
                <span>2. 빌드업 시퀀스를 하나 기록합니다.</span>
                <span>3. 분석 화면에서 전진성, 압박, xG, EPV를 확인합니다.</span>
              </div>
              <div className="home-actions">
                <button type="button" className="board-button board-button-strong" onClick={() => navigateToScreen("simulation")}>
                  시뮬레이션 시작
                </button>
                <button type="button" className="board-button" onClick={() => navigateToScreen("analysis")}>
                  분석 화면 보기
                </button>
              </div>
            </article>
          </div>
          <div className="home-footer">
            <span>© 2026 Football-lab</span>
            <span>Guide Docs와 변경 기록은 `AGENTS.md`에서 계속 업데이트됩니다.</span>
          </div>
        </section>
      ) : null}

      {activeScreen !== "home" ? (
      <section className={`board board-${activeScreen}`}>
        <div className="board-copy">
          <div className="control-center-card">
          <div className="board-copy-top">
            <div>
              <p className="analysis-eyebrow">{activeScreen === "simulation" ? "Control Center" : "Analysis Control"}</p>
              <h2>{activeScreen === "simulation" ? "11vs11 인터랙티브 시뮬레이션" : "분석 워크스페이스 제어"}</h2>
              <p>
                {activeScreen === "simulation"
                  ? "선수를 드래그해 위치를 조정하고, 공을 가진 선수를 먼저 선택한 뒤 받을 선수를 클릭해 패스를 그리세요. 드래그한 선수 이동 경로와 패스는 같은 타임라인에 기록되며, 수비는 이벤트마다 자동으로 반응합니다."
                  : "시뮬레이션에서 만든 시퀀스를 선택해 전진성, 압박, 폭 활용, 수비 반응, 선수 관여도를 별도 분석 화면에서 읽을 수 있습니다."}
              </p>
            </div>

            <div className="board-actions">
              <input
                ref={fileInputRef}
                type="file"
                accept="application/json,.json"
                className="hidden-file-input"
                onChange={handleImportChange}
              />
              <button type="button" className="board-button" onClick={openImportDialog}>
                JSON 불러오기
              </button>
              <button type="button" className="board-button" onClick={() => startPlayback(selectedSequenceId)}>
                {playbackStatus === "paused"
                  ? "플레이백 이어재생"
                  : selectedSequence
                    ? "선택 시퀀스 재생"
                    : "플레이백 재생"}
              </button>
              <button type="button" className="board-button" onClick={pausePlayback}>
                플레이백 일시정지
              </button>
              <button type="button" className="board-button" onClick={resetPlayback}>
                플레이백 리셋
              </button>
              <button type="button" className="board-button" onClick={exportBoard}>
                JSON 저장
              </button>
              <button type="button" className="board-button" onClick={startNewSequence}>
                새 시퀀스 시작
              </button>
              <button
                type="button"
                className={`board-button${isShotModeEnabled ? " board-button-active" : ""}`}
                onClick={toggleShotMode}
              >
                {isShotModeEnabled ? "슈팅 모드 해제" : "슈팅 모드"}
              </button>
              <button
                type="button"
                className="board-button"
                onClick={() => {
                  applyTimelineMutation([], movements, shots, sequences, "패스 경로를 모두 지웠습니다. 이동/슈팅 경로는 유지됩니다.");
                  setHoveredPassId(null);
                }}
              >
                패스 초기화
              </button>
              <button
                type="button"
                className="board-button"
                onClick={() => navigateToScreen(activeScreen === "simulation" ? "analysis" : "simulation")}
              >
                {activeScreen === "simulation" ? "분석 화면으로 이동" : "시뮬레이션으로 이동"}
              </button>
              <button type="button" className="board-button board-button-strong" onClick={resetWorkingBoard}>
                작업 보드 초기화
              </button>
              <button type="button" className="board-button" onClick={clearAllProjectData}>
                전체 기록 삭제
              </button>
            </div>
          </div>

          <div className="playback-speed-row">
            <span className="playback-speed-label">플레이백 속도</span>
            <div className="playback-speed-actions">
              {PLAYBACK_SPEED_OPTIONS.map((speed) => (
                <button
                  key={speed}
                  type="button"
                  className={`board-button playback-speed-button${playbackSpeed === speed ? " playback-speed-button-active" : ""}`}
                  onClick={() => {
                    setPlaybackSpeed(speed);
                    setInteractionMessage(`플레이백 속도를 ${formatPlaybackSpeedLabel(speed)}로 변경했습니다.`);
                  }}
                >
                  {formatPlaybackSpeedLabel(speed)}
                </button>
              ))}
            </div>
          </div>

          <div className="starting-passer-row">
            <span className="playback-speed-label">시작 패서 설정</span>
            <div className="starting-passer-actions">
              <select
                className="sequence-name-input starting-passer-select"
                value={startingPasserDraftId}
                onChange={(event) => setStartingPasserDraftId(event.target.value)}
              >
                {players.map((player) => (
                  <option key={player.id} value={player.id}>
                    {`${player.team.toUpperCase()} ${player.label}`}
                  </option>
                ))}
              </select>
              <button type="button" className="board-button" onClick={applyStartingPasser}>
                시작 패서 적용
              </button>
            </div>
          </div>

          <div className="status-panel">
            <p>
              선택된 패서:
              <strong>{selectedPasser ? ` ${selectedPasser.team.toUpperCase()} ${selectedPasser.label}` : " 없음"}</strong>
            </p>
            <p>
              생성된 패스:
              <strong>{` ${visiblePasses.length}개`}</strong>
            </p>
            <p>
              기록된 이동:
              <strong>{` ${visibleMovements.length}개`}</strong>
            </p>
            <p>
              슈팅 이벤트:
              <strong>{` ${visibleShots.length}개`}</strong>
            </p>
            <p>
              선택 시퀀스:
              <strong>{selectedSequence ? ` ${selectedSequence.name}` : " 전체 타임라인"}</strong>
            </p>
            <p>
              현재 볼 위치:
              <strong>{ballOwner ? ` ${ballOwner.team.toUpperCase()} ${ballOwner.label}` : " 이동 중"}</strong>
            </p>
            <p>
              시작 패서:
              <strong>{` ${formatOwnerLabel(players, timelineBaseBallState.ownerId)}`}</strong>
            </p>
            <p>
              플레이백 상태:
              <strong>
                {playbackStatus === "playing"
                  ? " 재생 중"
                  : playbackStatus === "paused"
                    ? " 일시정지"
                    : timelineEvents.length > 0
                      ? " 재생 가능"
                      : " 대기"}
              </strong>
            </p>
            <p>
              재생 속도:
              <strong>{` ${formatPlaybackSpeedLabel(playbackSpeed)}`}</strong>
            </p>
            <p>
              확률 기준:
              <strong> 거리 + 전진성 + 수비 압박</strong>
            </p>
          </div>

          <p className="status-message">{interactionMessage}</p>
          </div>

          <section className="sequence-panel">
            <div className="sequence-panel-header">
              <div>
                <p className="sequence-panel-eyebrow">Sequence List</p>
                <h3>전술 시퀀스 목록</h3>
              </div>
              <p className="sequence-panel-copy">
                패스와 이동을 묶음 단위로 저장하고, 선택한 시퀀스만 따로 재생할 수 있습니다.
              </p>
            </div>

            {selectedSequence ? (
              <div className="sequence-name-editor">
                <label className="sequence-name-label" htmlFor="sequence-name">
                  시퀀스 이름
                </label>
                <div className="sequence-name-row">
                  <input
                    id="sequence-name"
                    className="sequence-name-input"
                    value={sequenceNameDraft}
                    onChange={(event) => setSequenceNameDraft(event.target.value)}
                    placeholder="시퀀스 이름을 입력하세요"
                  />
                  <button type="button" className="board-button" onClick={renameSelectedSequence}>
                    이름 저장
                  </button>
                  <button type="button" className="board-button" onClick={analyzeSelectedSequence}>
                    {isSequenceAnalysisLoading ? "분석 중..." : "백엔드 분석"}
                  </button>
                </div>
              </div>
            ) : null}

            {selectedMovementId ? (
              <div className="sequence-toolbar">
                <button type="button" className="board-button" onClick={beginMovementEdit}>
                  선택 이동 편집
                </button>
                <button type="button" className="board-button" onClick={removeSelectedMovement}>
                  선택 이동 삭제
                </button>
              </div>
            ) : null}

            {sequences.length > 0 ? (
              <div className="sequence-list">
                {sequences.map((sequence) => {
                  const isSelected = sequence.id === selectedSequenceId;

                  return (
                    <article
                      key={sequence.id}
                      className={`sequence-card${isSelected ? " sequence-card-selected" : ""}`}
                    >
                      <button
                        type="button"
                        className="sequence-card-main"
                        onClick={() => {
                          focusSequence(sequence.id);
                          setSequenceAnalysisError(null);
                          setInteractionMessage(`${sequence.name}를 선택했습니다.`);
                        }}
                      >
                        <span className="sequence-card-title">{sequence.name}</span>
                        <span className="sequence-card-meta">{`${sequence.eventRefs.length}개 이벤트`}</span>
                        <span className="sequence-card-meta">{`길이 ${formatDurationMs(sequence.endAtMs - sequence.startAtMs)}`}</span>
                      </button>
                      <div className="sequence-card-actions">
                        <button type="button" className="board-button" onClick={() => startPlayback(sequence.id)}>
                          시퀀스 재생
                        </button>
                        <button type="button" className="board-button" onClick={() => deleteSequence(sequence.id)}>
                          시퀀스 삭제
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="sequence-empty">
                <p>아직 기록된 시퀀스가 없습니다.</p>
                <span>패스나 이동을 입력하면 자동으로 시퀀스가 만들어지고 목록에 추가됩니다.</span>
              </div>
            )}
          </section>

          {activeScreen === "simulation" ? (
            <section className="simulation-focus-card">
              <p className="analysis-eyebrow">Simulation Focus</p>
              <h3>시뮬레이션 화면</h3>
              <div className="analysis-summary">
                <p>현재 보기</p>
                <strong>{selectedSequence ? `${selectedSequence.name}만 표시 중` : "새 시퀀스 또는 전체 타임라인 대기 상태"}</strong>
                <span>패스를 만들고 선수를 이동시키면 수비 반응과 슈팅 결과가 이벤트마다 자동으로 갱신됩니다.</span>
              </div>
              <div className="analysis-summary analysis-summary-secondary">
                <p>자동 수비 반응</p>
                <strong>
                  {effectiveDefensiveShift
                    ? `${effectiveDefensiveShift.stages.length}개 이벤트에 대해 수비가 자동 반응합니다.`
                    : "아직 수비 반응을 만들 이벤트가 없습니다."}
                </strong>
                <span>공격 입력만 기록해도 빌드업 과정의 상대 수비 반응이 함께 붙습니다.</span>
              </div>
            </section>
          ) : null}
        </div>

        <div className="board-workspace">
          <div className="pitch-column">
            <Stage
              width={PITCH_WIDTH}
              height={PITCH_HEIGHT}
              className="pitch-stage"
              onMouseMove={(event) => {
                const stage = event.target.getStage();
                const nextPointer = stage?.getPointerPosition() ?? null;
                setPointerPosition(nextPointer);
              }}
              onTouchMove={(event) => {
                const stage = event.target.getStage();
                const nextPointer = stage?.getPointerPosition() ?? null;
                setPointerPosition(nextPointer);
              }}
              onMouseLeave={() => setPointerPosition(null)}
              onTouchEnd={() => setPointerPosition(null)}
              onClick={(event) => {
                if (event.target === event.target.getStage()) {
                  const stage = event.target.getStage();
                  const nextPointer = stage?.getPointerPosition() ?? null;

                  if (isShotModeEnabled && nextPointer) {
                    recordShot(nextPointer.x, nextPointer.y);
                    return;
                  }

                  setSelectedPasserId(null);
                  setInteractionMessage(DEFAULT_INTERACTION_MESSAGE);
                }
              }}
            >
              <Layer>
                <Rect x={0} y={0} width={PITCH_WIDTH} height={PITCH_HEIGHT} fill="#1f6f43" cornerRadius={24} />
                <Rect
                  x={PITCH_PADDING}
                  y={PITCH_PADDING}
                  width={PITCH_WIDTH - PITCH_PADDING * 2}
                  height={PITCH_HEIGHT - PITCH_PADDING * 2}
                  stroke="#d9f99d"
                  strokeWidth={4}
                  cornerRadius={18}
                />
                <Line
                  points={[PITCH_WIDTH / 2, PITCH_PADDING, PITCH_WIDTH / 2, PITCH_HEIGHT - PITCH_PADDING]}
                  stroke="#d9f99d"
                  strokeWidth={4}
                />
                <Circle x={PITCH_WIDTH / 2} y={PITCH_HEIGHT / 2} radius={60} stroke="#d9f99d" strokeWidth={4} />
                <Rect x={PITCH_PADDING} y={170} width={120} height={220} stroke="#d9f99d" strokeWidth={4} />
                <Rect x={PITCH_WIDTH - 144} y={170} width={120} height={220} stroke="#d9f99d" strokeWidth={4} />

                {!isPlaybackShiftActive && effectiveDefensiveShift?.points.map((point) => (
                  <Group key={`shift-${point.playerId}`}>
                    <Arrow
                      points={buildArrowPoints(point.fromX, point.fromY, point.toX, point.toY, 10)}
                      stroke="#f59e0b"
                      fill="#f59e0b"
                      strokeWidth={3}
                      dash={[6, 6]}
                      pointerLength={8}
                      pointerWidth={8}
                      opacity={0.72}
                      listening={false}
                    />
                    <Circle
                      x={point.toX}
                      y={point.toY}
                      radius={PLAYER_RADIUS - 4}
                      fill="rgba(245, 158, 11, 0.18)"
                      stroke="#f59e0b"
                      strokeWidth={2}
                      listening={false}
                    />
                    <Text
                      x={point.toX - 9}
                      y={point.toY - 9}
                      width={18}
                      align="center"
                      text={point.label}
                      fill="#fde68a"
                      fontSize={12}
                      fontStyle="bold"
                      listening={false}
                    />
                  </Group>
                ))}

                {visibleMovements.map((movement) => {
                  const isHovered = hoveredMovementId === movement.id;
                  const isPlaybackActive = activePlaybackMovementId === movement.id;
                  const isSelected = selectedMovementId === movement.id;
                  const movementColor = movement.team === "home" ? "#38bdf8" : "#fb7185";

                  return (
                    <Arrow
                      key={movement.id}
                      points={buildArrowPoints(movement.fromX, movement.fromY, movement.toX, movement.toY, 12)}
                      stroke={isHovered || isPlaybackActive || isSelected ? "#e2e8f0" : movementColor}
                      fill={isHovered || isPlaybackActive || isSelected ? "#e2e8f0" : movementColor}
                      strokeWidth={isPlaybackActive || isSelected ? 5 : 3}
                      dash={[10, 8]}
                      pointerLength={8}
                      pointerWidth={8}
                      opacity={0.75}
                      hitStrokeWidth={16}
                      onMouseEnter={() => setHoveredMovementId(movement.id)}
                      onMouseLeave={() => setHoveredMovementId((current) => (current === movement.id ? null : current))}
                      onClick={(event) => {
                        event.cancelBubble = true;
                        setSelectedMovementId(movement.id);
                        setInteractionMessage("선택한 이동 경로를 분석 패널과 편집 툴바에 연결했습니다.");
                      }}
                      onTap={(event) => {
                        event.cancelBubble = true;
                        setSelectedMovementId(movement.id);
                        setInteractionMessage("선택한 이동 경로를 분석 패널과 편집 툴바에 연결했습니다.");
                      }}
                    />
                  );
                })}

                {visiblePasses.map((pass) => {
                  const fromPlayer = getPlayerById(displayPlayers, pass.fromId);
                  const toPlayer = getPlayerById(displayPlayers, pass.toId);

                  if (!fromPlayer || !toPlayer) {
                    return null;
                  }

                  const analysis = getPassAnalysis(displayPlayers, fromPlayer, toPlayer);
                  const arrowPoints = buildArrowPoints(
                    fromPlayer.x,
                    fromPlayer.y,
                    toPlayer.x,
                    toPlayer.y,
                    PLAYER_RADIUS + ARROW_HEAD_SIZE
                  );
                  const isHovered = hoveredPassId === pass.id;
                  const isPlaybackActive = activePlaybackPassId === pass.id;
                  const labelX = (arrowPoints[0] + arrowPoints[2]) / 2;
                  const labelY = (arrowPoints[1] + arrowPoints[3]) / 2 - 18;

                  return (
                    <Group key={pass.id}>
                      <Arrow
                        points={arrowPoints}
                        stroke={isHovered ? "#e2e8f0" : isPlaybackActive ? "#38bdf8" : analysis.probability.color}
                        fill={isHovered ? "#e2e8f0" : isPlaybackActive ? "#38bdf8" : analysis.probability.color}
                        strokeWidth={isHovered || isPlaybackActive ? 6 : 5}
                        dash={[16, 10]}
                        lineCap="round"
                        lineJoin="round"
                        pointerLength={ARROW_HEAD_SIZE}
                        pointerWidth={ARROW_HEAD_SIZE}
                        hitStrokeWidth={18}
                        onMouseEnter={() => setHoveredPassId(pass.id)}
                        onMouseLeave={() => setHoveredPassId((current) => (current === pass.id ? null : current))}
                        onClick={(event) => {
                          event.cancelBubble = true;
                          if (isPlaybackRunning || ballState.isAnimating) {
                            setInteractionMessage("재생 중이거나 공이 이동 중일 때는 패스 경로를 삭제할 수 없습니다.");
                            return;
                          }
                          applyTimelineMutation(
                            passes.filter((currentPass) => currentPass.id !== pass.id),
                            movements,
                            shots,
                            sequences,
                            "선택한 패스 경로를 제거했습니다."
                          );
                          setHoveredPassId((current) => (current === pass.id ? null : current));
                        }}
                        onTap={(event) => {
                          event.cancelBubble = true;
                          if (isPlaybackRunning || ballState.isAnimating) {
                            setInteractionMessage("재생 중이거나 공이 이동 중일 때는 패스 경로를 삭제할 수 없습니다.");
                            return;
                          }
                          applyTimelineMutation(
                            passes.filter((currentPass) => currentPass.id !== pass.id),
                            movements,
                            shots,
                            sequences,
                            "선택한 패스 경로를 제거했습니다."
                          );
                          setHoveredPassId((current) => (current === pass.id ? null : current));
                        }}
                      />
                      <Rect
                        x={labelX - 22}
                        y={labelY - 12}
                        width={44}
                        height={24}
                        cornerRadius={999}
                        fill="rgba(15, 23, 42, 0.86)"
                        stroke={isHovered ? "#e2e8f0" : isPlaybackActive ? "#38bdf8" : analysis.probability.color}
                        strokeWidth={2}
                        listening={false}
                      />
                      <Text
                        x={labelX - 20}
                        y={labelY - 7}
                        width={40}
                        align="center"
                        text={analysis.probability.label}
                        fill="#f8fafc"
                        fontSize={12}
                        fontStyle="bold"
                        listening={false}
                      />
                    </Group>
                  );
                })}

                {visibleShots.map((shot) => {
                  const isPlaybackActive = activePlaybackShotId === shot.id;
                  const shotStyle = getShotOutcomeStyle(shot.outcome);

                  return (
                    <Group key={shot.id}>
                      <Arrow
                        points={buildArrowPoints(shot.fromX, shot.fromY, shot.targetX, shot.targetY, 8)}
                        stroke={isPlaybackActive ? "#f8fafc" : shotStyle.stroke}
                        fill={isPlaybackActive ? "#f8fafc" : shotStyle.stroke}
                        strokeWidth={isPlaybackActive ? 6 : 4}
                        dash={[6, 6]}
                        pointerLength={ARROW_HEAD_SIZE}
                        pointerWidth={ARROW_HEAD_SIZE}
                        opacity={0.9}
                      />
                      <Rect
                        x={shot.fromX - 26}
                        y={shot.fromY - 34}
                        width={52}
                        height={22}
                        cornerRadius={999}
                        fill={shotStyle.fill}
                        stroke={shotStyle.stroke}
                        strokeWidth={2}
                      />
                      <Text
                        x={shot.fromX - 24}
                        y={shot.fromY - 29}
                        width={48}
                        align="center"
                        text={`${getShotOutcomeLabel(shot.outcome)} ${Math.round(shot.xg * 100)}%`}
                        fill={shotStyle.accent}
                        fontSize={10}
                        fontStyle="bold"
                      />
                    </Group>
                  );
                })}

                {selectedPasser && pointerPosition ? (
                  <Arrow
                    points={buildArrowPoints(
                      selectedPasser.x,
                      selectedPasser.y,
                      pointerPosition.x,
                      pointerPosition.y,
                      ARROW_HEAD_SIZE
                    )}
                    stroke="#fde68a"
                    fill="#fde68a"
                    strokeWidth={3}
                    dash={[8, 8]}
                    opacity={0.7}
                    pointerLength={ARROW_HEAD_SIZE}
                    pointerWidth={ARROW_HEAD_SIZE}
                  />
                ) : null}

                {displayPlayers.map((player) => {
                  const isSelected = player.id === selectedPasserId;
                  const isOwner = player.id === ballState.ownerId && !ballState.isAnimating;

                  return (
                    <Group
                      key={player.id}
                      x={player.x}
                      y={player.y}
                      draggable={!isPlaybackRunning && !ballState.isAnimating}
                      dragBoundFunc={(position) => ({
                        x: clampPosition(
                          position.x,
                          PITCH_PADDING + PLAYER_RADIUS,
                          PITCH_WIDTH - PITCH_PADDING - PLAYER_RADIUS
                        ),
                        y: clampPosition(
                          position.y,
                          PITCH_PADDING + PLAYER_RADIUS,
                          PITCH_HEIGHT - PITCH_PADDING - PLAYER_RADIUS
                        )
                      })}
                      onDragMove={(event) => {
                        const { x, y } = event.target.position();
                        handlePlayerDrag(player.id, x, y);
                      }}
                      onDragStart={() => handlePlayerDragStart(player.id)}
                      onDragEnd={() => handlePlayerDragEnd(player.id)}
                      onClick={() => handlePlayerClick(player.id)}
                      onTap={() => handlePlayerClick(player.id)}
                    >
                      <Circle
                        radius={PLAYER_RADIUS}
                        fill={player.fill}
                        stroke={isSelected ? "#facc15" : player.stroke}
                        strokeWidth={isSelected ? 5 : 3}
                        shadowBlur={isSelected ? 14 : isOwner ? 10 : 6}
                        shadowOpacity={0.28}
                      />
                      {isOwner ? <Circle radius={PLAYER_RADIUS + 5} stroke="#38bdf8" strokeWidth={2} dash={[4, 3]} /> : null}
                      <Text
                        x={-9}
                        y={-9}
                        width={18}
                        align="center"
                        text={player.label}
                        fill={player.team === "home" ? "#0f172a" : "#fef2f2"}
                        fontSize={12}
                        fontStyle="bold"
                      />
                    </Group>
                  );
                })}

                {ballImage ? (
                  <KonvaImage
                    image={ballImage}
                    x={ballState.x - BALL_SIZE / 2}
                    y={ballState.y - BALL_SIZE / 2}
                    width={BALL_SIZE}
                    height={BALL_SIZE}
                    shadowColor="#0f172a"
                    shadowBlur={12}
                    shadowOpacity={0.28}
                    listening={false}
                  />
                ) : null}

                <Text x={30} y={32} text="HOME BUILD-UP" fill="#f8fafc" fontSize={20} fontStyle="bold" />
                <Text x={PITCH_WIDTH - 220} y={32} text="AWAY BLOCK" fill="#fee2e2" fontSize={20} fontStyle="bold" />
              </Layer>
            </Stage>

            <div className="probability-legend">
              <span className="legend-item">
                <span className="legend-swatch legend-swatch-safe" />
                안전한 패스
              </span>
              <span className="legend-item">
                <span className="legend-swatch legend-swatch-warn" />
                경합 가능
              </span>
              <span className="legend-item">
                <span className="legend-swatch legend-swatch-risk" />
                차단 위험
              </span>
            </div>
          </div>
        </div>

        {activeScreen === "analysis" ? (
          <aside className="analysis-panel analysis-screen-panel">
            <p className="analysis-eyebrow">Timeline Breakdown</p>
            <h3>분석 화면</h3>
            <Suspense
              fallback={
                <div className="analysis-visual-grid">
                  <div className="analysis-trend-card">
                    <p>분석 카드 로딩 중</p>
                    <span>Voronoi, 패스 네트워크, xG, EPV 시각화를 준비하고 있습니다.</span>
                  </div>
                </div>
              }
            >
              <AdvancedAnalysisPanel
                players={displayPlayers}
                passes={visiblePasses}
                movements={visibleMovements}
                shots={visibleShots}
                dominantTeam={dominantAnalysisTeam}
                playerInvolvementData={playerInvolvementData}
                progressionZoneData={progressionZoneData}
                lateralOccupancyData={lateralOccupancyData}
                threatPoints={latestSelectedSequenceAnalysis?.threat_points}
                epvHeatCells={latestSelectedSequenceAnalysis?.epv_heatmap}
                shotOutcomeData={latestSelectedSequenceAnalysis?.shot_outcomes.map((entry) => ({
                  label: entry.label,
                  value: entry.count,
                  color: getShotOutcomeStyle(entry.outcome).stroke
                }))}
              />
            </Suspense>
            {selectedSequence ? (
              <div className="analysis-summary analysis-summary-secondary">
                <p>시퀀스 선택</p>
                <strong>{selectedSequence.name}</strong>
                <span>{`${selectedSequence.eventRefs.length}개 이벤트, 길이 ${formatDurationMs(selectedSequence.endAtMs - selectedSequence.startAtMs)}`}</span>
                <span>{`분석 기록 ${selectedSequenceHistory.length}회`}</span>
              </div>
            ) : null}
            {inspectedMovement && inspectedMovementAnalysis ? (
              <>
                <div className="analysis-header">
                  <div>
                    <p className="analysis-route">
                      {`${inspectedMovement.team.toUpperCase()} ${getPlayerById(players, inspectedMovement.playerId)?.label ?? "?"} 이동`}
                    </p>
                    <p className="analysis-hint">
                      {activePlaybackMovementId
                        ? "플레이백 중인 현재 이동 경로를 자동으로 분석 중입니다."
                        : "현재 선택된 선수 이동 경로를 분석 중입니다."}
                    </p>
                  </div>
                  <span
                    className="analysis-badge"
                    style={{ borderColor: inspectedMovement.team === "home" ? "#38bdf8" : "#fb7185", color: inspectedMovement.team === "home" ? "#38bdf8" : "#fb7185" }}
                  >
                    {inspectedMovementAnalysis.carriesBall ? "공 운반 이동" : "오프더볼 이동"}
                  </span>
                </div>

                <div className="analysis-metrics">
                  <div className="metric-card">
                    <span>이동 거리</span>
                    <strong>{`${inspectedMovementAnalysis.distanceMeters.toFixed(1)}m`}</strong>
                    <p>선수가 커버한 총 이동 거리입니다.</p>
                  </div>
                  <div className="metric-card">
                    <span>이동 시간</span>
                    <strong>{`${(inspectedMovementAnalysis.durationMs / 1000).toFixed(2)}s`}</strong>
                    <p>재생 기준 이동 애니메이션 시간입니다.</p>
                  </div>
                  <div className="metric-card">
                    <span>평균 속도</span>
                    <strong>{`${inspectedMovementAnalysis.speedMetersPerSecond.toFixed(2)}m/s`}</strong>
                    <p>거리와 시간으로 계산한 평균 이동 속도입니다.</p>
                  </div>
                  <div className="metric-card">
                    <span>공 소유 여부</span>
                    <strong>{inspectedMovementAnalysis.carriesBall ? "볼 캐리" : "비소유 이동"}</strong>
                    <p>공을 운반한 움직임인지, 지원 움직임인지 구분합니다.</p>
                  </div>
                </div>

                <div className="analysis-summary">
                  <p>전술 해석</p>
                  <strong>
                    {inspectedMovementAnalysis.carriesBall
                      ? "이 이동은 공을 가진 채 전진하거나 탈압박 공간으로 운반하는 움직임입니다."
                      : "이 이동은 패스 옵션을 만들거나 공간 점유를 바꾸기 위한 오프더볼 움직임입니다."}
                  </strong>
                </div>
              </>
            ) : inspectedPass && inspectedFromPlayer && inspectedToPlayer && inspectedAnalysis ? (
              <>
                <div className="analysis-header">
                  <div>
                    <p className="analysis-route">
                      {`${inspectedFromPlayer.team.toUpperCase()} ${inspectedFromPlayer.label} -> ${inspectedToPlayer.team.toUpperCase()} ${inspectedToPlayer.label}`}
                    </p>
                    <p className="analysis-hint">
                      {activePlaybackPassId
                        ? "플레이백 중인 현재 패스를 자동으로 분석 중입니다."
                        : hoveredPassId
                          ? "현재 마우스를 올린 패스를 분석 중입니다."
                          : "가장 최근에 만든 패스를 분석 중입니다."}
                    </p>
                  </div>
                  <span
                    className="analysis-badge"
                    style={{ borderColor: inspectedAnalysis.probability.color, color: inspectedAnalysis.probability.color }}
                  >
                    {`${inspectedAnalysis.probability.label} ${inspectedAnalysis.probability.tier}`}
                  </span>
                </div>

                <div className="analysis-metrics">
                  <div className="metric-card">
                    <span>패스 거리</span>
                    <strong>{`${inspectedAnalysis.distanceMeters.toFixed(1)}m`}</strong>
                    <p>길수록 성공 확률이 낮아집니다.</p>
                  </div>
                  <div className="metric-card">
                    <span>전진 거리</span>
                    <strong>{`${inspectedAnalysis.progressionMeters.toFixed(1)}m`}</strong>
                    <p>전방으로 보내는 이득이 클수록 보너스를 받습니다.</p>
                  </div>
                  <div className="metric-card">
                    <span>최근접 수비 간격</span>
                    <strong>{`${inspectedAnalysis.nearestOpponentGapMeters.toFixed(1)}m`}</strong>
                    <p>패스 라인과 수비수가 가까울수록 차단 위험이 커집니다.</p>
                  </div>
                  <div className="metric-card">
                    <span>압박 패널티</span>
                    <strong>{`${Math.round(inspectedAnalysis.pressurePenalty * 100)}%`}</strong>
                    <p>수비 압박이 강할수록 성공 확률에서 감점됩니다.</p>
                  </div>
                </div>

                <div className="analysis-summary">
                  <p>모델 해석</p>
                  <strong>
                    {`${Math.round(inspectedAnalysis.directionBonus * 100)}% 전진 보너스와 ${Math.round(
                      inspectedAnalysis.pressurePenalty * 100
                    )}% 압박 패널티가 함께 반영되었습니다.`}
                  </strong>
                </div>
              </>
            ) : (
              <div className="analysis-empty">
                <p>아직 분석할 이벤트가 없습니다.</p>
                <span>패스나 선수 이동 경로를 만들면 상세 수치가 표시됩니다.</span>
              </div>
            )}

            <div className="backend-analysis-panel">
              <p className="analysis-eyebrow">API Analysis</p>
              <h3>백엔드 시퀀스 분석</h3>
              {isSequenceAnalysisLoading ? (
                <div className="analysis-empty">
                  <p>백엔드 분석 요청 중입니다.</p>
                  <span>선택한 시퀀스의 이벤트 밀도, 전진성, 압박 지표를 계산하고 있습니다.</span>
                </div>
              ) : latestSelectedSequenceAnalysis ? (
                <>
                  <div className="analysis-header">
                    <div>
                      <p className="analysis-route">{latestSelectedSequenceAnalysis.sequence_name}</p>
                      <p className="analysis-hint">
                        FastAPI가 선택한 시퀀스를 요약한 결과입니다.
                      </p>
                    </div>
                    <span className="analysis-badge" style={{ borderColor: "#38bdf8", color: "#38bdf8" }}>
                      {`${latestSelectedSequenceAnalysis.team_metrics.dominant_team.toUpperCase()} 우세`}
                    </span>
                  </div>

                  <div className="analysis-metrics">
                    <div className="metric-card">
                      <span>총 시퀀스 길이</span>
                      <strong>{formatDurationMs(latestSelectedSequenceAnalysis.total_duration_ms)}</strong>
                      <p>첫 이벤트부터 마지막 이벤트 종료까지의 시간입니다.</p>
                    </div>
                    <div className="metric-card">
                      <span>평균 패스 거리</span>
                      <strong>{`${latestSelectedSequenceAnalysis.average_pass_distance_m.toFixed(1)}m`}</strong>
                      <p>선택 시퀀스 안의 패스 길이 평균입니다.</p>
                    </div>
                    <div className="metric-card">
                      <span>총 전진 거리</span>
                      <strong>{`${latestSelectedSequenceAnalysis.total_progression_m.toFixed(1)}m`}</strong>
                      <p>전진 방향으로 얻은 누적 거리입니다.</p>
                    </div>
                    <div className="metric-card">
                      <span>압박 지수</span>
                      <strong>{`${Math.round(latestSelectedSequenceAnalysis.pressure_index * 100)}%`}</strong>
                      <p>패스 라인 주변 상대 밀집도를 단순 지수로 환산했습니다.</p>
                    </div>
                    <div className="metric-card">
                      <span>총 이동 거리</span>
                      <strong>{`${latestSelectedSequenceAnalysis.total_movement_distance_m.toFixed(1)}m`}</strong>
                      <p>시퀀스에 포함된 선수 이동 거리 총합입니다.</p>
                    </div>
                    <div className="metric-card">
                      <span>지원 폭</span>
                      <strong>{`${latestSelectedSequenceAnalysis.support_width_m.toFixed(1)}m`}</strong>
                      <p>이벤트가 차지한 평균 폭 활용 범위를 보여 줍니다.</p>
                    </div>
                    <div className="metric-card">
                      <span>이벤트 간격</span>
                      <strong>{formatDurationMs(latestSelectedSequenceAnalysis.average_event_gap_ms)}</strong>
                      <p>연속 이벤트 사이의 평균 시간 간격입니다.</p>
                    </div>
                    <div className="metric-card">
                      <span>볼 캐리 수</span>
                      <strong>{`${latestSelectedSequenceAnalysis.carry_count}회`}</strong>
                      <p>공을 운반한 이동 이벤트 수입니다.</p>
                    </div>
                    <div className="metric-card">
                      <span>슈팅 수</span>
                      <strong>{`${latestSelectedSequenceAnalysis.shot_count}회`}</strong>
                      <p>선택 시퀀스에 포함된 슈팅 이벤트 수입니다.</p>
                    </div>
                    <div className="metric-card">
                      <span>온타깃 슈팅</span>
                      <strong>{`${latestSelectedSequenceAnalysis.on_target_shot_count}회`}</strong>
                      <p>득점 또는 선방으로 기록된 유효 슈팅 수입니다.</p>
                    </div>
                    <div className="metric-card">
                      <span>득점 수</span>
                      <strong>{`${latestSelectedSequenceAnalysis.goal_count}회`}</strong>
                      <p>결과가 득점으로 분류된 슈팅 수입니다.</p>
                    </div>
                    <div className="metric-card">
                      <span>평균 수비 시프트</span>
                      <strong>{`${latestSelectedSequenceAnalysis.defensive_shift.average_shift_distance_m.toFixed(1)}m`}</strong>
                      <p>수비 라인이 공격 중심으로 이동한 평균 거리입니다.</p>
                    </div>
                    <div className="metric-card">
                      <span>수비 라인 폭</span>
                      <strong>{`${latestSelectedSequenceAnalysis.defensive_shift.line_compactness_m.toFixed(1)}m`}</strong>
                      <p>시프트 뒤 수비 라인의 세로 폭입니다.</p>
                    </div>
                    <div className="metric-card">
                      <span>수비 라인 높이</span>
                      <strong>{`${latestSelectedSequenceAnalysis.defensive_shift.line_height_m.toFixed(1)}m`}</strong>
                      <p>시프트 뒤 평균 수비 라인 높이를 나타냅니다.</p>
                    </div>
                  </div>

                  <div className="analysis-summary">
                    <p>코칭 메모</p>
                    <strong>{latestSelectedSequenceAnalysis.coaching_note}</strong>
                    <span>
                      {activePlaybackShiftStage
                        ? `${activePlaybackShiftStage.note} (${activePlaybackShiftStage.eventKind === "pass" ? "패스" : activePlaybackShiftStage.eventKind === "move" ? "이동" : "슈팅"} 단계)`
                        : latestSelectedSequenceAnalysis.defensive_shift.note}
                    </span>
                  </div>

                  {selectedSequenceHistory.length > 1 ? (
                    <div className="analysis-comparison-controls">
                      <button
                        type="button"
                        className={`board-button${isComparisonModeEnabled ? " board-button-active" : ""}`}
                        onClick={toggleComparisonMode}
                      >
                        {isComparisonModeEnabled ? "비교 모드 켜짐" : "비교 모드 켜기"}
                      </button>
                      <button type="button" className="board-button" onClick={resetComparisonBase}>
                        비교 기준 초기화
                      </button>
                      <span>
                        {comparisonBaseEntry
                          ? `기준 분석: ${new Date(comparisonBaseEntry.analyzed_at).toLocaleString("ko-KR")}`
                          : "기준 분석: 직전 분석"}
                      </span>
                    </div>
                  ) : null}

                  {comparisonBaseEntry ? (
                    <div className="analysis-summary analysis-summary-secondary">
                      <p>{isComparisonModeEnabled ? "선택 기준 분석 대비" : "이전 분석 대비"}</p>
                      <strong>
                        {`전진 거리 ${formatDelta(
                          latestSelectedSequenceAnalysis.total_progression_m - comparisonBaseEntry.result.total_progression_m,
                          "m"
                        )}, 압박 지수 ${formatDelta(
                          (latestSelectedSequenceAnalysis.pressure_index - comparisonBaseEntry.result.pressure_index) * 100,
                          "%",
                          0
                        )}`}
                      </strong>
                      <span>
                        {`평균 패스 거리 ${formatDelta(
                          latestSelectedSequenceAnalysis.average_pass_distance_m - comparisonBaseEntry.result.average_pass_distance_m,
                          "m"
                        )}, 총 이동 거리 ${formatDelta(
                          latestSelectedSequenceAnalysis.total_movement_distance_m - comparisonBaseEntry.result.total_movement_distance_m,
                          "m"
                        )}`}
                      </span>
                    </div>
                  ) : null}

                  {selectedSequenceHistory.length > 0 ? (
                    <div className="analysis-trend-grid">
                      <div className="analysis-trend-card">
                        <p>전진 거리 추이</p>
                        <svg viewBox="0 0 240 88" className="analysis-trend-chart" role="img" aria-label="전진 거리 추이 차트">
                          <path d={progressionTrendGeometry.path} fill="none" stroke="#22c55e" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
                          {progressionTrendGeometry.points.map((point) => (
                            <circle
                              key={`progression-${point.x}-${point.y}`}
                              cx={point.x}
                              cy={point.y}
                              r={selectedSequenceHistory[point.index]?.analyzed_at === comparisonBaseEntry?.analyzed_at ? "6" : "4"}
                              fill={selectedSequenceHistory[point.index]?.analyzed_at === latestSelectedSequenceHistoryEntry?.analyzed_at ? "#f8fafc" : "#22c55e"}
                              stroke={selectedSequenceHistory[point.index]?.analyzed_at === comparisonBaseEntry?.analyzed_at ? "#facc15" : "none"}
                              strokeWidth="2"
                              className="analysis-trend-point"
                              onClick={() => {
                                const entry = selectedSequenceHistory[point.index];
                                if (entry) {
                                  selectComparisonBase(entry.analyzed_at);
                                }
                              }}
                            />
                          ))}
                        </svg>
                        <span>{`최근 ${selectedSequenceHistory.length}회 분석, 점을 클릭하면 비교 기준으로 고정됩니다.`}</span>
                      </div>
                      <div className="analysis-trend-card">
                        <p>압박 지수 추이</p>
                        <svg viewBox="0 0 240 88" className="analysis-trend-chart" role="img" aria-label="압박 지수 추이 차트">
                          <path d={pressureTrendGeometry.path} fill="none" stroke="#f59e0b" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
                          {pressureTrendGeometry.points.map((point) => (
                            <circle
                              key={`pressure-${point.x}-${point.y}`}
                              cx={point.x}
                              cy={point.y}
                              r={selectedSequenceHistory[point.index]?.analyzed_at === comparisonBaseEntry?.analyzed_at ? "6" : "4"}
                              fill={selectedSequenceHistory[point.index]?.analyzed_at === latestSelectedSequenceHistoryEntry?.analyzed_at ? "#f8fafc" : "#f59e0b"}
                              stroke={selectedSequenceHistory[point.index]?.analyzed_at === comparisonBaseEntry?.analyzed_at ? "#facc15" : "none"}
                              strokeWidth="2"
                              className="analysis-trend-point"
                              onClick={() => {
                                const entry = selectedSequenceHistory[point.index];
                                if (entry) {
                                  selectComparisonBase(entry.analyzed_at);
                                }
                              }}
                            />
                          ))}
                        </svg>
                        <span>{`최신 ${Math.round((selectedSequenceHistory.at(-1)?.result.pressure_index ?? 0) * 100)}%`}</span>
                      </div>
                      <div className="analysis-trend-card">
                        <p>지원 폭 추이</p>
                        <svg viewBox="0 0 240 88" className="analysis-trend-chart" role="img" aria-label="지원 폭 추이 차트">
                          <path d={widthTrendGeometry.path} fill="none" stroke="#38bdf8" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
                          {widthTrendGeometry.points.map((point) => (
                            <circle
                              key={`width-${point.x}-${point.y}`}
                              cx={point.x}
                              cy={point.y}
                              r={selectedSequenceHistory[point.index]?.analyzed_at === comparisonBaseEntry?.analyzed_at ? "6" : "4"}
                              fill={selectedSequenceHistory[point.index]?.analyzed_at === latestSelectedSequenceHistoryEntry?.analyzed_at ? "#f8fafc" : "#38bdf8"}
                              stroke={selectedSequenceHistory[point.index]?.analyzed_at === comparisonBaseEntry?.analyzed_at ? "#facc15" : "none"}
                              strokeWidth="2"
                              className="analysis-trend-point"
                              onClick={() => {
                                const entry = selectedSequenceHistory[point.index];
                                if (entry) {
                                  selectComparisonBase(entry.analyzed_at);
                                }
                              }}
                            />
                          ))}
                        </svg>
                        <span>{`최신 ${selectedSequenceHistory.at(-1)?.result.support_width_m.toFixed(1) ?? "0.0"}m`}</span>
                      </div>
                    </div>
                  ) : null}

                  <div className="analysis-history-list">
                    {selectedSequenceHistory.slice().reverse().map((entry) => (
                      <button
                        key={entry.analyzed_at}
                        type="button"
                        className={`analysis-history-item${entry.analyzed_at === comparisonBaseEntry?.analyzed_at ? " analysis-history-item-selected" : ""}`}
                        onClick={() => selectComparisonBase(entry.analyzed_at)}
                      >
                        <strong>{new Date(entry.analyzed_at).toLocaleString("ko-KR")}</strong>
                        <span>{`전진 ${entry.result.total_progression_m.toFixed(1)}m / 압박 ${Math.round(entry.result.pressure_index * 100)}% / 폭 ${entry.result.support_width_m.toFixed(1)}m`}</span>
                      </button>
                    ))}
                  </div>
                </>
              ) : sequenceAnalysisError ? (
                <div className="analysis-empty">
                  <p>백엔드 분석을 불러오지 못했습니다.</p>
                  <span>{sequenceAnalysisError}</span>
                </div>
              ) : (
                <div className="analysis-empty">
                  <p>아직 백엔드 분석 결과가 없습니다.</p>
                  <span>시퀀스를 선택한 뒤 `백엔드 분석` 버튼을 누르면 API 응답이 여기에 표시됩니다.</span>
                </div>
              )}
            </div>
          </aside>
        ) : null}
      </section>
      ) : null}
    </main>
  );
}
