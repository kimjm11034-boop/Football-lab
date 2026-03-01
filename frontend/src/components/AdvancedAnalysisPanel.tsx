import { useState, type ReactNode } from "react";
import { Delaunay } from "d3-delaunay";

const PITCH_WIDTH = 900;
const PITCH_HEIGHT = 560;
const PITCH_PADDING = 24;

type Team = "home" | "away";
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
};

type MovementPath = {
  id: string;
  playerId: string;
  team: Team;
  toX: number;
  toY: number;
};

type ShotEvent = {
  id: string;
  playerId: string;
  team: Team;
  fromX: number;
  fromY: number;
  xg: number;
  outcome: ShotOutcome;
};

type AnalysisDistributionDatum = {
  label: string;
  value: number;
  color: string;
};

type VoronoiCell = {
  playerId: string;
  team: Team;
  points: string;
};

type PassNetworkEdge = {
  id: string;
  from: PlayerNode;
  to: PlayerNode;
  count: number;
};

type ThreatPoint = {
  id: string;
  x: number;
  y: number;
  team: Team;
  label: string;
  xg: number;
};

type EpvHeatCell = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  value: number;
};

type ShotOutcomeDatum = {
  label: string;
  value: number;
  color: string;
};

type AnalysisCardId =
  | "voronoi"
  | "network"
  | "threat"
  | "epv"
  | "shot-outcomes"
  | "involvement"
  | "progression"
  | "occupancy";

type AnalysisCardDefinition = {
  id: AnalysisCardId;
  title: string;
  description: string;
  content: ReactNode;
};

type AdvancedAnalysisPanelProps = {
  players: PlayerNode[];
  passes: PassLink[];
  movements: MovementPath[];
  shots: ShotEvent[];
  dominantTeam: Team;
  playerInvolvementData: AnalysisDistributionDatum[];
  progressionZoneData: AnalysisDistributionDatum[];
  lateralOccupancyData: AnalysisDistributionDatum[];
  threatPoints?: ThreatPoint[];
  epvHeatCells?: EpvHeatCell[];
  shotOutcomeData?: ShotOutcomeDatum[];
};

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
 * 한 위치가 노리는 골문 중심 X 좌표를 구합니다.
 *
 * @param team 공격 팀입니다.
 * @returns 해당 팀 공격 방향의 골문 중심 X 좌표입니다.
 */
function getGoalCenterX(team: Team) {
  return team === "home" ? PITCH_WIDTH - PITCH_PADDING : PITCH_PADDING;
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
  const distance = Math.hypot(x - goalX, y - goalY);
  const centrality = 1 - Math.min(Math.abs(y - goalY) / (PITCH_HEIGHT / 2), 1);
  const distanceFactor = 1 - Math.min(distance / 360, 1);
  return Number(Math.max(distanceFactor * 0.72 + centrality * 0.28, 0.02).toFixed(2));
}

/**
 * 슈팅 결과를 한국어 라벨로 바꿉니다.
 *
 * @param outcome 슈팅 결과 코드입니다.
 * @returns 화면 표시용 라벨입니다.
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
 * 슈팅 결과별 카드 색상을 반환합니다.
 *
 * @param outcome 슈팅 결과 코드입니다.
 * @returns 바 차트와 라벨에 사용할 색상입니다.
 */
function getShotOutcomeColor(outcome: ShotOutcome) {
  switch (outcome) {
    case "goal":
      return "#22c55e";
    case "saved":
      return "#38bdf8";
    case "blocked":
      return "#ef4444";
    default:
      return "#f59e0b";
  }
}

/**
 * 최대값 기준 막대 퍼센트를 계산합니다.
 *
 * @param value 현재 항목 값입니다.
 * @param maxValue 비교 기준 최대값입니다.
 * @returns 0~100 사이 퍼센트입니다.
 */
function getBarWidthPercent(value: number, maxValue: number) {
  if (maxValue <= 0) {
    return 0;
  }

  return Math.min((value / maxValue) * 100, 100);
}

/**
 * Delaunay/Voronoi로 선수 영향 구역 다이어그램을 만듭니다.
 *
 * @param players 현재 렌더링 중인 선수 목록입니다.
 * @returns SVG 다각형으로 그릴 수 있는 셀 목록입니다.
 */
function buildVoronoiCells(players: PlayerNode[]): VoronoiCell[] {
  if (players.length < 2) {
    return [];
  }

  const delaunay = Delaunay.from(players.map((player) => [player.x, player.y]));
  const voronoi = delaunay.voronoi([0, 0, PITCH_WIDTH, PITCH_HEIGHT]);

  return players
    .map((player, index) => {
      const polygon = voronoi.cellPolygon(index);

      if (!polygon) {
        return null;
      }

      return {
        playerId: player.id,
        team: player.team,
        points: Array.from(polygon as Iterable<[number, number]>)
          .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
          .join(" ")
      };
    })
    .filter((cell): cell is VoronoiCell => cell !== null);
}

/**
 * 같은 방향 패스를 묶어 패스 네트워크 엣지 가중치를 계산합니다.
 *
 * @param players 현재 렌더링 중인 선수 목록입니다.
 * @param passes 현재 화면에 표시 중인 패스 목록입니다.
 * @returns 네트워크 선 목록입니다.
 */
function buildPassNetworkEdges(players: PlayerNode[], passes: PassLink[]): PassNetworkEdge[] {
  const edgeMap = new Map<string, number>();

  passes.forEach((pass) => {
    const edgeId = `${pass.fromId}->${pass.toId}`;
    edgeMap.set(edgeId, (edgeMap.get(edgeId) ?? 0) + 1);
  });

  return Array.from(edgeMap.entries())
    .map(([edgeId, count]) => {
      const [fromId, toId] = edgeId.split("->");
      const from = getPlayerById(players, fromId);
      const to = getPlayerById(players, toId);

      if (!from || !to) {
        return null;
      }

      return {
        id: edgeId,
        from,
        to,
        count
      };
    })
    .filter((edge): edge is PassNetworkEdge => edge !== null);
}

/**
 * 선택 시퀀스 안에서 위협적인 도착 지점을 xG 프록시 포인트로 변환합니다.
 *
 * @param players 현재 렌더링 중인 선수 목록입니다.
 * @param passes 현재 화면에 표시 중인 패스 목록입니다.
 * @param movements 현재 화면에 표시 중인 이동 목록입니다.
 * @param shots 현재 화면에 표시 중인 슈팅 목록입니다.
 * @param dominantTeam 현재 시퀀스 우세 팀입니다.
 * @returns 위협 지점 목록입니다.
 */
function buildThreatPoints(
  players: PlayerNode[],
  passes: PassLink[],
  movements: MovementPath[],
  shots: ShotEvent[],
  dominantTeam: Team
): ThreatPoint[] {
  const nextPoints: ThreatPoint[] = [];

  shots.forEach((shot) => {
    if (shot.team !== dominantTeam) {
      return;
    }

    nextPoints.push({
      id: `shot-${shot.id}`,
      x: shot.fromX,
      y: shot.fromY,
      team: shot.team,
      label: `${getPlayerById(players, shot.playerId)?.label ?? shot.playerId} ${getShotOutcomeLabel(shot.outcome)}`,
      xg: shot.xg
    });
  });

  passes.forEach((pass) => {
    const receiver = getPlayerById(players, pass.toId);
    if (!receiver || receiver.team !== dominantTeam) {
      return;
    }

    nextPoints.push({
      id: `pass-${pass.id}`,
      x: receiver.x,
      y: receiver.y,
      team: receiver.team,
      label: receiver.label,
      xg: getXgProxyValue(receiver.x, receiver.y, receiver.team)
    });
  });

  movements.forEach((movement) => {
    if (movement.team !== dominantTeam) {
      return;
    }

    nextPoints.push({
      id: `move-${movement.id}`,
      x: movement.toX,
      y: movement.toY,
      team: movement.team,
      label: getPlayerById(players, movement.playerId)?.label ?? movement.playerId,
      xg: getXgProxyValue(movement.toX, movement.toY, movement.team)
    });
  });

  return nextPoints.sort((left, right) => right.xg - left.xg).slice(0, 8);
}

/**
 * 위치 한 칸의 EPV 프록시 값을 계산합니다.
 *
 * @param x 그리드 중심 X 좌표입니다.
 * @param y 그리드 중심 Y 좌표입니다.
 * @param team 공격 팀입니다.
 * @returns 0~1 사이 EPV 프록시 값입니다.
 */
function getEpvValue(x: number, y: number, team: Team) {
  const progression = team === "home" ? x / PITCH_WIDTH : (PITCH_WIDTH - x) / PITCH_WIDTH;
  const centrality = 1 - Math.min(Math.abs(y - PITCH_HEIGHT / 2) / (PITCH_HEIGHT / 2), 1);
  return Number((progression * 0.72 + centrality * 0.28).toFixed(2));
}

/**
 * 분석 화면에 그릴 EPV 그리드 셀 목록을 만듭니다.
 *
 * @param team 현재 시퀀스 우세 팀입니다.
 * @param cols 가로 칸 수입니다.
 * @param rows 세로 칸 수입니다.
 * @returns SVG 직사각형 히트맵 셀 목록입니다.
 */
function buildEpvHeatCells(team: Team, cols: number, rows: number): EpvHeatCell[] {
  const cellWidth = PITCH_WIDTH / cols;
  const cellHeight = PITCH_HEIGHT / rows;
  const cells: EpvHeatCell[] = [];

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const x = col * cellWidth;
      const y = row * cellHeight;
      cells.push({
        id: `epv-${col}-${row}`,
        x,
        y,
        width: cellWidth,
        height: cellHeight,
        value: getEpvValue(x + cellWidth / 2, y + cellHeight / 2, team)
      });
    }
  }

  return cells;
}

/**
 * 슈팅 결과를 분포 카드용 데이터로 변환합니다.
 *
 * @param shots 현재 화면에 표시 중인 슈팅 목록입니다.
 * @returns 결과별 개수와 색상 목록입니다.
 */
function buildShotOutcomeData(shots: ShotEvent[]): ShotOutcomeDatum[] {
  const outcomes: ShotOutcome[] = ["goal", "saved", "off_target", "blocked"];

  return outcomes.map((outcome) => ({
    label: getShotOutcomeLabel(outcome),
    value: shots.filter((shot) => shot.outcome === outcome).length,
    color: getShotOutcomeColor(outcome)
  }));
}

/**
 * 분석 화면의 무거운 시각화 카드 묶음을 렌더링합니다.
 *
 * @param props 분석에 필요한 선수/이벤트/분포 데이터입니다.
 * @returns Voronoi, 패스 네트워크, xG, EPV와 분포 카드를 렌더링합니다.
 */
export default function AdvancedAnalysisPanel({
  players,
  passes,
  movements,
  shots,
  dominantTeam,
  playerInvolvementData,
  progressionZoneData,
  lateralOccupancyData,
  threatPoints,
  epvHeatCells,
  shotOutcomeData
}: AdvancedAnalysisPanelProps) {
  const voronoiCells = buildVoronoiCells(players);
  const passNetworkEdges = buildPassNetworkEdges(players, passes);
  const resolvedThreatPoints = threatPoints ?? buildThreatPoints(players, passes, movements, shots, dominantTeam);
  const resolvedEpvHeatCells = epvHeatCells ?? buildEpvHeatCells(dominantTeam, 12, 8);
  const resolvedShotOutcomeData = shotOutcomeData ?? buildShotOutcomeData(shots);
  const playerInvolvementMax = Math.max(...playerInvolvementData.map((item) => item.value), 1);
  const progressionZoneMax = Math.max(...progressionZoneData.map((item) => item.value), 1);
  const lateralOccupancyMax = Math.max(...lateralOccupancyData.map((item) => item.value), 1);
  const shotOutcomeMax = Math.max(...resolvedShotOutcomeData.map((item) => item.value), 1);
  const [expandedCardId, setExpandedCardId] = useState<AnalysisCardId | null>(null);
  const cards: AnalysisCardDefinition[] = [
    {
      id: "voronoi",
      title: "Voronoi 영향 구역",
      description: "가장 가까운 선수 기준으로 점유 영향 구역을 보여 줍니다.",
      content: (
        <svg viewBox={`0 0 ${PITCH_WIDTH} ${PITCH_HEIGHT}`} className="analysis-mini-pitch" role="img" aria-label="Voronoi 영향 구역">
          <rect x="0" y="0" width={PITCH_WIDTH} height={PITCH_HEIGHT} rx="24" fill="#164e2f" />
          {voronoiCells.map((cell) => (
            <polygon
              key={cell.playerId}
              points={cell.points}
              fill={cell.team === "home" ? "rgba(56, 189, 248, 0.22)" : "rgba(251, 113, 133, 0.22)"}
              stroke={cell.team === "home" ? "#38bdf8" : "#fb7185"}
              strokeWidth="2"
            />
          ))}
          {players.map((player) => (
            <g key={`voronoi-player-${player.id}`}>
              <circle cx={player.x} cy={player.y} r="10" fill={player.fill} stroke={player.stroke} strokeWidth="2" />
              <text x={player.x} y={player.y + 4} textAnchor="middle" fill={player.team === "home" ? "#0f172a" : "#fff1f2"} fontSize="10" fontWeight="700">
                {player.label}
              </text>
            </g>
          ))}
        </svg>
      )
    },
    {
      id: "network",
      title: "패스 네트워크",
      description: "선 굵기는 같은 방향 패스 반복 수, 원 크기는 관여도를 뜻합니다.",
      content: (
        <svg viewBox={`0 0 ${PITCH_WIDTH} ${PITCH_HEIGHT}`} className="analysis-mini-pitch" role="img" aria-label="패스 네트워크">
          <rect x="0" y="0" width={PITCH_WIDTH} height={PITCH_HEIGHT} rx="24" fill="#123524" />
          {passNetworkEdges.map((edge) => (
            <line
              key={edge.id}
              x1={edge.from.x}
              y1={edge.from.y}
              x2={edge.to.x}
              y2={edge.to.y}
              stroke={edge.from.team === "home" ? "#38bdf8" : "#fb7185"}
              strokeOpacity="0.8"
              strokeWidth={2 + edge.count * 1.5}
            />
          ))}
          {players.map((player) => {
            const involvement = passes.filter((pass) => pass.fromId === player.id || pass.toId === player.id).length;
            return (
              <g key={`network-player-${player.id}`}>
                <circle cx={player.x} cy={player.y} r={10 + involvement * 1.2} fill={player.fill} stroke="#f8fafc" strokeWidth="2" />
                <text x={player.x} y={player.y + 4} textAnchor="middle" fill={player.team === "home" ? "#0f172a" : "#fff1f2"} fontSize="10" fontWeight="700">
                  {player.label}
                </text>
              </g>
            );
          })}
        </svg>
      )
    },
    {
      id: "threat",
      title: "xG 프록시 위협 지점",
      description: "실제 슈팅 결과와 패스/이동 도착 지점을 함께 골 위협 기준으로 읽습니다.",
      content: (
        <svg viewBox={`0 0 ${PITCH_WIDTH} ${PITCH_HEIGHT}`} className="analysis-mini-pitch" role="img" aria-label="xG 프록시 위협 지점">
          <rect x="0" y="0" width={PITCH_WIDTH} height={PITCH_HEIGHT} rx="24" fill="#153b2a" />
          {resolvedThreatPoints.map((point) => (
            <g key={point.id}>
              <circle
                cx={point.x}
                cy={point.y}
                r={10 + point.xg * 16}
                fill={point.team === "home" ? "rgba(34, 197, 94, 0.28)" : "rgba(249, 115, 22, 0.28)"}
                stroke={point.team === "home" ? "#22c55e" : "#f97316"}
                strokeWidth="2"
              />
              <text x={point.x} y={point.y - 12} textAnchor="middle" fill="#f8fafc" fontSize="11" fontWeight="700">
                {`${point.label} ${Math.round(point.xg * 100)}%`}
              </text>
            </g>
          ))}
        </svg>
      )
    },
    {
      id: "epv",
      title: "EPV 프록시 히트맵",
      description: "전진성과 중앙성으로 공간의 예상 점유 가치를 단순화해 보여 줍니다.",
      content: (
        <svg viewBox={`0 0 ${PITCH_WIDTH} ${PITCH_HEIGHT}`} className="analysis-mini-pitch" role="img" aria-label="EPV 프록시 히트맵">
          <rect x="0" y="0" width={PITCH_WIDTH} height={PITCH_HEIGHT} rx="24" fill="#0f172a" />
          {resolvedEpvHeatCells.map((cell) => (
            <rect
              key={cell.id}
              x={cell.x}
              y={cell.y}
              width={cell.width}
              height={cell.height}
              fill={`rgba(250, 204, 21, ${Math.max(cell.value * 0.58, 0.08)})`}
              stroke="rgba(148, 163, 184, 0.12)"
              strokeWidth="1"
            />
          ))}
        </svg>
      )
    },
    {
      id: "shot-outcomes",
      title: "슈팅 결과 분포",
      description: "득점, 유효슈팅, 빗나감, 차단의 분포를 비교합니다.",
      content: (
        <div className="analysis-bar-list">
          {resolvedShotOutcomeData.some((entry) => entry.value > 0) ? (
            resolvedShotOutcomeData.map((entry) => (
              <div key={entry.label} className="analysis-bar-row">
                <span>{entry.label}</span>
                <div className="analysis-bar-track">
                  <div
                    className="analysis-bar-fill"
                    style={{ width: `${getBarWidthPercent(entry.value, shotOutcomeMax)}%`, background: entry.color }}
                  />
                </div>
                <strong>{entry.value}</strong>
              </div>
            ))
          ) : (
            <span>아직 기록된 슈팅이 없습니다.</span>
          )}
        </div>
      )
    },
    {
      id: "involvement",
      title: "선수 관여도",
      description: "시퀀스에서 가장 많이 관여한 선수를 빠르게 확인합니다.",
      content: (
        <div className="analysis-bar-list">
          {playerInvolvementData.length > 0 ? (
            playerInvolvementData.map((entry) => (
              <div key={entry.label} className="analysis-bar-row">
                <span>{entry.label}</span>
                <div className="analysis-bar-track">
                  <div
                    className="analysis-bar-fill"
                    style={{ width: `${getBarWidthPercent(entry.value, playerInvolvementMax)}%`, background: entry.color }}
                  />
                </div>
                <strong>{entry.value}</strong>
              </div>
            ))
          ) : (
            <span>아직 관여도 데이터를 계산할 시퀀스가 없습니다.</span>
          )}
        </div>
      )
    },
    {
      id: "progression",
      title: "전진 구역 분포",
      description: "빌드업이 어느 구역에서 주로 끝나는지 보여 줍니다.",
      content: (
        <div className="analysis-bar-list">
          {progressionZoneData.map((entry) => (
            <div key={entry.label} className="analysis-bar-row">
              <span>{entry.label}</span>
              <div className="analysis-bar-track">
                <div
                  className="analysis-bar-fill"
                  style={{ width: `${getBarWidthPercent(entry.value, progressionZoneMax)}%`, background: entry.color }}
                />
              </div>
              <strong>{entry.value}</strong>
            </div>
          ))}
        </div>
      )
    },
    {
      id: "occupancy",
      title: "폭 점유 분포",
      description: "좌우 채널과 하프스페이스 점유 밸런스를 확인합니다.",
      content: (
        <div className="analysis-bar-list">
          {lateralOccupancyData.map((entry) => (
            <div key={entry.label} className="analysis-bar-row">
              <span>{entry.label}</span>
              <div className="analysis-bar-track">
                <div
                  className="analysis-bar-fill"
                  style={{ width: `${getBarWidthPercent(entry.value, lateralOccupancyMax)}%`, background: entry.color }}
                />
              </div>
              <strong>{entry.value}</strong>
            </div>
          ))}
        </div>
      )
    }
  ];
  const expandedCard = expandedCardId ? cards.find((card) => card.id === expandedCardId) ?? null : null;

  return (
    <>
      <div className="analysis-visual-grid">
        {cards.map((card) => (
          <article key={card.id} className="analysis-trend-card">
            <div className="analysis-card-header">
              <p>{card.title}</p>
              <button type="button" className="analysis-card-expand" onClick={() => setExpandedCardId(card.id)}>
                확대 보기
              </button>
            </div>
            {card.content}
            <span>{card.description}</span>
          </article>
        ))}
      </div>
      {expandedCard ? (
        <div className="analysis-modal-backdrop" role="presentation" onClick={() => setExpandedCardId(null)}>
          <div
            className="analysis-modal"
            role="dialog"
            aria-modal="true"
            aria-label={`${expandedCard.title} 확대 보기`}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="analysis-card-header">
              <p>{expandedCard.title}</p>
              <button type="button" className="analysis-card-expand" onClick={() => setExpandedCardId(null)}>
                닫기
              </button>
            </div>
            <div className="analysis-modal-content">{expandedCard.content}</div>
            <span>{expandedCard.description}</span>
          </div>
        </div>
      ) : null}
    </>
  );
}
