from math import acos, hypot

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from app.models import (
    DefensiveShiftPoint,
    DefensiveShiftStage,
    DefensiveShiftSummary,
    EpvHeatCell,
    HealthResponse,
    MovementRecord,
    PassRecord,
    PlayerPoint,
    ProjectStatus,
    SequenceAnalysisRequest,
    SequenceAnalysisResponse,
    SequenceTeamMetrics,
    ShotRecord,
    ShotOutcomeSummary,
    TacticSequenceRecord,
    ThreatPoint,
)

PITCH_LENGTH_METERS = 105
PITCH_WIDTH_METERS = 68
PITCH_WIDTH = 900
PITCH_HEIGHT = 560
GOAL_WIDTH_METERS = 7.32
GOAL_HALF_WIDTH_CANVAS = (GOAL_WIDTH_METERS / PITCH_WIDTH_METERS) * PITCH_HEIGHT / 2

app = FastAPI(
    title="Football-lab API",
    version="0.1.0",
    summary="Tactics simulation and analysis prototype backend",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health", response_model=HealthResponse)
def healthcheck() -> HealthResponse:
    return HealthResponse(
        status="ok",
        project=ProjectStatus(
            stage=1,
            title="11vs11 simulation bootstrap",
            simulation_ready=False,
        ),
    )


def get_scaled_distance(from_x: float, from_y: float, to_x: float, to_y: float) -> float:
    scaled_dx = (to_x - from_x) * (PITCH_LENGTH_METERS / PITCH_WIDTH)
    scaled_dy = (to_y - from_y) * (PITCH_WIDTH_METERS / PITCH_HEIGHT)
    return hypot(scaled_dx, scaled_dy)


def clamp(value: float, minimum: float, maximum: float) -> float:
    return min(max(value, minimum), maximum)


def get_goal_center_x(team: str) -> float:
    return PITCH_WIDTH - 24 if team == "home" else 24


def get_goal_posts(team: str) -> tuple[tuple[float, float], tuple[float, float]]:
    center_x = get_goal_center_x(team)
    center_y = PITCH_HEIGHT / 2
    return (
        (center_x, center_y - GOAL_HALF_WIDTH_CANVAS),
        (center_x, center_y + GOAL_HALF_WIDTH_CANVAS),
    )


def get_shot_angle_degrees(x: float, y: float, team: str) -> float:
    left_post, right_post = get_goal_posts(team)
    left_dx = left_post[0] - x
    left_dy = left_post[1] - y
    right_dx = right_post[0] - x
    right_dy = right_post[1] - y
    left_length = hypot(left_dx, left_dy)
    right_length = hypot(right_dx, right_dy)

    if left_length == 0 or right_length == 0:
        return 0.0

    cosine = ((left_dx * right_dx) + (left_dy * right_dy)) / (left_length * right_length)
    cosine = clamp(cosine, -1, 1)
    return max(min(acos(cosine) * 57.2958, 180.0), 0.0)


def get_xg_proxy_value(x: float, y: float, team: str) -> float:
    goal_x = get_goal_center_x(team)
    goal_y = PITCH_HEIGHT / 2
    distance = get_scaled_distance(x, y, goal_x, goal_y)
    centrality = 1 - min(abs(y - goal_y) / (PITCH_HEIGHT / 2), 1)
    angle_factor = min(get_shot_angle_degrees(x, y, team) / 38, 1)
    distance_factor = 1 - min(distance / 40, 1)
    return round(max(distance_factor * 0.46 + angle_factor * 0.38 + centrality * 0.16, 0.02), 2)


def get_epv_value(x: float, y: float, team: str) -> float:
    progression = x / PITCH_WIDTH if team == "home" else (PITCH_WIDTH - x) / PITCH_WIDTH
    centrality = 1 - min(abs(y - PITCH_HEIGHT / 2) / (PITCH_HEIGHT / 2), 1)
    shot_access = get_xg_proxy_value(x, y, team)
    return round(max(progression * 0.52 + centrality * 0.18 + shot_access * 0.30, 0.01), 2)


def build_epv_heatmap(team: str, cols: int = 12, rows: int = 8) -> list[EpvHeatCell]:
    cell_width = PITCH_WIDTH / cols
    cell_height = PITCH_HEIGHT / rows
    cells: list[EpvHeatCell] = []

    for row in range(rows):
        for col in range(cols):
            x = col * cell_width
            y = row * cell_height
            cells.append(
                EpvHeatCell(
                    id=f"epv-{col}-{row}",
                    x=x,
                    y=y,
                    width=cell_width,
                    height=cell_height,
                    value=get_epv_value(x + cell_width / 2, y + cell_height / 2, team),
                )
            )

    return cells


def get_shot_outcome_label(outcome: str) -> str:
    if outcome == "goal":
        return "득점"
    if outcome == "saved":
        return "유효슈팅"
    if outcome == "blocked":
        return "차단"
    return "빗나감"


def build_shot_outcomes(sequence_shots: list[ShotRecord]) -> list[ShotOutcomeSummary]:
    ordered_outcomes = ["goal", "saved", "off_target", "blocked"]
    return [
        ShotOutcomeSummary(
            outcome=outcome,
            label=get_shot_outcome_label(outcome),
            count=sum(1 for shot in sequence_shots if shot.outcome == outcome),
        )
        for outcome in ordered_outcomes
    ]


def build_threat_points(
    players: list[PlayerPoint],
    sequence_passes: list[PassRecord],
    sequence_movements: list[MovementRecord],
    sequence_shots: list[ShotRecord],
    dominant_team: str,
) -> list[ThreatPoint]:
    threat_points: list[ThreatPoint] = []

    for shot in sequence_shots:
        if shot.team != dominant_team:
            continue

        shooter = get_player_by_id(players, shot.playerId)
        threat_points.append(
            ThreatPoint(
                id=f"shot-{shot.id}",
                x=shot.fromX,
                y=shot.fromY,
                team=shot.team,
                label=f"{shooter.label if shooter else shot.playerId} {get_shot_outcome_label(shot.outcome)}",
                xg=shot.xg,
                source="shot",
            )
        )

    for current_pass in sequence_passes:
        receiver = get_player_by_id(players, current_pass.toId)
        if receiver is None or receiver.team != dominant_team:
            continue

        threat_points.append(
            ThreatPoint(
                id=f"pass-{current_pass.id}",
                x=receiver.x,
                y=receiver.y,
                team=receiver.team,
                label=receiver.label,
                xg=get_xg_proxy_value(receiver.x, receiver.y, receiver.team),
                source="pass",
            )
        )

    for movement in sequence_movements:
        if movement.team != dominant_team:
            continue

        mover = get_player_by_id(players, movement.playerId)
        threat_points.append(
            ThreatPoint(
                id=f"move-{movement.id}",
                x=movement.toX,
                y=movement.toY,
                team=movement.team,
                label=mover.label if mover else movement.playerId,
                xg=get_xg_proxy_value(movement.toX, movement.toY, movement.team),
                source="move",
            )
        )

    threat_points.sort(key=lambda point: point.xg, reverse=True)
    return threat_points[:8]


def build_shift_points(
    defenders: list[PlayerPoint],
    focus_x: float,
    focus_y: float,
) -> list[DefensiveShiftPoint]:
    if not defenders:
        return []

    defending_team = defenders[0].team
    own_goal_x = 24 if defending_team == "home" else PITCH_WIDTH - 24
    min_spacing = 34.0
    max_spacing = 92.0
    raw_targets: list[dict[str, float | str]] = []
    defenders_by_priority = sorted(
        defenders,
        key=lambda defender: get_scaled_distance(defender.x, defender.y, focus_x, focus_y),
    )
    priority_rank_map = {defender.id: rank for rank, defender in enumerate(defenders_by_priority)}

    for defender in defenders:
        priority_rank = priority_rank_map[defender.id]
        distance_to_focus = get_scaled_distance(defender.x, defender.y, focus_x, focus_y)
        distance_to_goal = abs(defender.x - own_goal_x)
        depth_phase = distance_to_goal / max(PITCH_WIDTH, 1)
        priority_scale = 1.18 if priority_rank == 0 else 1.1 if priority_rank < 3 else 0.98 if priority_rank < 6 else 0.9
        forward_scale = 0.14 + depth_phase * 0.16 + max(0.0, 0.18 - min(distance_to_focus / 22, 0.18))
        lateral_scale = 0.26 + (1 - min(distance_to_focus / 28, 1)) * 0.2
        if priority_rank == 0:
            forward_scale += 0.05
            lateral_scale += 0.08
        elif priority_rank < 3:
            forward_scale += 0.03
            lateral_scale += 0.05

        shift_x = clamp((focus_x - defender.x) * forward_scale * priority_scale, -30, 34)
        shift_y = clamp((focus_y - defender.y) * lateral_scale * priority_scale, -42, 42)
        raw_targets.append(
            {
                "playerId": defender.id,
                "label": defender.label,
                "team": defender.team,
                "fromX": defender.x,
                "fromY": defender.y,
                "rawX": clamp(defender.x + shift_x, 24, PITCH_WIDTH - 24),
                "rawY": clamp(defender.y + shift_y, 24, PITCH_HEIGHT - 24),
                "priorityRank": float(priority_rank),
            }
        )

    sorted_targets = sorted(raw_targets, key=lambda target: float(target["fromY"]))
    base_center_y = sum(float(target["rawY"]) for target in sorted_targets) / len(sorted_targets)
    original_span = max(defender.y for defender in defenders) - min(defender.y for defender in defenders) if len(defenders) > 1 else 0
    target_spacing = clamp((original_span * 0.78) / max(len(defenders) - 1, 1), min_spacing, max_spacing)
    center_index = (len(sorted_targets) - 1) / 2

    for index, target in enumerate(sorted_targets):
        slot_y = base_center_y + (index - center_index) * target_spacing
        blended_y = float(target["rawY"]) * 0.58 + slot_y * 0.42
        target["toY"] = clamp(blended_y, 24, PITCH_HEIGHT - 24)

    for index in range(1, len(sorted_targets)):
        previous_y = float(sorted_targets[index - 1]["toY"])
        current_y = float(sorted_targets[index]["toY"])
        if current_y - previous_y < min_spacing:
            sorted_targets[index]["toY"] = clamp(previous_y + min_spacing, 24, PITCH_HEIGHT - 24)

    for index in range(len(sorted_targets) - 2, -1, -1):
        next_y = float(sorted_targets[index + 1]["toY"])
        current_y = float(sorted_targets[index]["toY"])
        if next_y - current_y < min_spacing:
            sorted_targets[index]["toY"] = clamp(next_y - min_spacing, 24, PITCH_HEIGHT - 24)

    line_anchor_x = sum(float(target["rawX"]) for target in raw_targets) / len(raw_targets)
    shift_points: list[DefensiveShiftPoint] = []

    for target in raw_targets:
        target_x = float(target["rawX"])
        priority_rank = int(float(target["priorityRank"]))
        line_blend = 0.52 if priority_rank < 2 else 0.62 if priority_rank < 5 else 0.7
        next_x = clamp(target_x * (1 - line_blend) + line_anchor_x * line_blend, 24, PITCH_WIDTH - 24)
        matched_target = next(item for item in sorted_targets if item["playerId"] == target["playerId"])
        next_y = float(matched_target["toY"])
        shift_points.append(
            DefensiveShiftPoint(
                playerId=str(target["playerId"]),
                label=str(target["label"]),
                team=defending_team,
                fromX=float(target["fromX"]),
                fromY=float(target["fromY"]),
                toX=next_x,
                toY=next_y,
                shiftDistanceMeters=get_scaled_distance(float(target["fromX"]), float(target["fromY"]), next_x, next_y),
            )
        )

    return shift_points


def summarize_shift_line(shift_points: list[DefensiveShiftPoint]) -> tuple[float, float, float]:
    if not shift_points:
        return 0.0, 0.0, 0.0

    shifted_widths = [point.toY * (PITCH_WIDTH_METERS / PITCH_HEIGHT) for point in shift_points]
    line_compactness_m = max(shifted_widths) - min(shifted_widths)
    line_height_m = (
        sum(point.toX for point in shift_points) / len(shift_points) * (PITCH_LENGTH_METERS / PITCH_WIDTH)
    )
    average_shift_distance_m = sum(point.shiftDistanceMeters for point in shift_points) / len(shift_points)
    return average_shift_distance_m, line_compactness_m, line_height_m


def build_shift_stage_note(
    defending_team: str,
    focus_y: float,
    average_shift_distance_m: float,
    line_compactness_m: float,
    shift_points: list[DefensiveShiftPoint],
) -> str:
    if not shift_points:
        return "수비 반응을 계산할 수 없습니다."

    top_marker = max(shift_points, key=lambda point: point.shiftDistanceMeters)
    compactness_note = "라인 간격을 좁게 유지합니다." if line_compactness_m <= 30 else "라인 폭을 유지하며 수평 슬라이드합니다."
    return (
        f"{defending_team.upper()} 수비가 {get_shift_side_note(focus_y)} 하프스페이스로 반응하며 "
        f"{top_marker.label}이 1차 마킹 우선권을 가져갑니다. 평균 시프트 {average_shift_distance_m:.1f}m, {compactness_note}"
    )


def get_shift_side_note(focus_y: float) -> str:
    return "우측" if focus_y > PITCH_HEIGHT / 2 else "좌측"


def get_player_by_id(players: list[PlayerPoint], player_id: str) -> PlayerPoint | None:
    return next((player for player in players if player.id == player_id), None)


def get_distance_to_segment_meters(
    point_x: float,
    point_y: float,
    from_x: float,
    from_y: float,
    to_x: float,
    to_y: float,
) -> float:
    dx = to_x - from_x
    dy = to_y - from_y
    length_squared = dx * dx + dy * dy

    if length_squared == 0:
        return get_scaled_distance(point_x, point_y, from_x, from_y)

    projection = ((point_x - from_x) * dx + (point_y - from_y) * dy) / length_squared
    t = min(max(projection, 0), 1)
    nearest_x = from_x + t * dx
    nearest_y = from_y + t * dy
    return get_scaled_distance(point_x, point_y, nearest_x, nearest_y)


def build_coaching_note(
    total_progression_m: float,
    carry_count: int,
    shot_count: int,
    goal_count: int,
    pressure_index: float,
    support_width_m: float,
    dominant_team: str,
) -> str:
    progression_note = "전진성은 제한적입니다."
    if total_progression_m >= 18:
        progression_note = "전진성이 분명한 시퀀스입니다."
    elif total_progression_m >= 9:
        progression_note = "짧은 전진을 반복하며 라인을 흔드는 시퀀스입니다."

    carry_note = "패스 중심 빌드업입니다." if carry_count == 0 else "볼 캐리와 패스가 섞인 전개입니다."
    finishing_note = "마무리 없이 전개까지만 진행된 시퀀스입니다."
    if shot_count > 0:
        finishing_note = "슈팅까지 연결된 전개입니다."
    if goal_count > 0:
        finishing_note = "슈팅이 실제 득점으로 이어졌습니다."
    pressure_note = (
        "주변 압박이 강해 빠른 의사결정이 필요합니다."
        if pressure_index >= 0.55
        else "주변 압박이 상대적으로 낮아 다음 연결 옵션을 만들기 좋습니다."
    )
    width_note = (
        "폭을 넓게 활용하며 상대 블록을 벌리는 장면입니다."
        if support_width_m >= 24
        else "폭보다는 좁은 간격의 조합 플레이가 중심입니다."
    )

    return f"{dominant_team.upper()} 주도 시퀀스입니다. {progression_note} {carry_note} {finishing_note} {pressure_note} {width_note}"


def build_defensive_shift(
    players: list[PlayerPoint],
    sequence: TacticSequenceRecord,
    sequence_passes: list[PassRecord],
    sequence_movements: list[MovementRecord],
    sequence_shots: list[ShotRecord],
    dominant_team: str,
) -> DefensiveShiftSummary:
    defending_team = "away" if dominant_team == "home" else "home"
    defending_players = [player for player in players if player.team == defending_team]
    attacking_points: list[tuple[float, float]] = []

    for current_pass in sequence_passes:
        from_player = get_player_by_id(players, current_pass.fromId)
        to_player = get_player_by_id(players, current_pass.toId)
        if from_player and from_player.team == dominant_team:
            attacking_points.append((from_player.x, from_player.y))
        if to_player and to_player.team == dominant_team:
            attacking_points.append((to_player.x, to_player.y))

    for movement in sequence_movements:
        if movement.team == dominant_team:
            attacking_points.append((movement.toX, movement.toY))

    for shot in sequence_shots:
        if shot.team == dominant_team:
            attacking_points.append((shot.fromX, shot.fromY))

    if not defending_players or not attacking_points:
        return DefensiveShiftSummary(
            defending_team=defending_team,
            average_shift_distance_m=0.0,
            line_compactness_m=0.0,
            line_height_m=0.0,
            note="수비 시프트를 계산할 충분한 공격 이벤트가 없습니다.",
            points=[],
            stages=[],
        )

    focus_x = sum(point[0] for point in attacking_points) / len(attacking_points)
    focus_y = sum(point[1] for point in attacking_points) / len(attacking_points)
    pass_map = {entry.id: entry for entry in sequence_passes}
    movement_map = {entry.id: entry for entry in sequence_movements}
    shot_map = {entry.id: entry for entry in sequence_shots}
    cumulative_attacking_points: list[tuple[float, float]] = []
    shift_stages: list[DefensiveShiftStage] = []

    for event_ref in sequence.eventRefs:
        event_points: list[tuple[float, float]] = []
        event_at_ms = 0.0
        event_duration_ms = 0.0

        if event_ref.kind == "pass":
            current_pass = pass_map.get(event_ref.id)
            if current_pass is None:
                continue
            event_at_ms = current_pass.atMs
            event_duration_ms = current_pass.durationMs
            from_player = get_player_by_id(players, current_pass.fromId)
            to_player = get_player_by_id(players, current_pass.toId)
            if from_player is not None and from_player.team == dominant_team:
                event_points.append((from_player.x, from_player.y))
            if to_player is not None and to_player.team == dominant_team:
                event_points.append((to_player.x, to_player.y))
        elif event_ref.kind == "move":
            movement = movement_map.get(event_ref.id)
            if movement is None:
                continue
            event_at_ms = movement.atMs
            event_duration_ms = movement.durationMs
            if movement.team == dominant_team:
                event_points.append((movement.toX, movement.toY))
        else:
            shot = shot_map.get(event_ref.id)
            if shot is None:
                continue
            event_at_ms = shot.atMs
            event_duration_ms = shot.durationMs
            if shot.team == dominant_team:
                event_points.append((shot.fromX, shot.fromY))

        if event_points:
            cumulative_attacking_points.extend(event_points)

        if not cumulative_attacking_points:
            continue

        stage_focus_x = sum(point[0] for point in cumulative_attacking_points) / len(cumulative_attacking_points)
        stage_focus_y = sum(point[1] for point in cumulative_attacking_points) / len(cumulative_attacking_points)
        stage_shift_points = build_shift_points(defending_players, stage_focus_x, stage_focus_y)
        stage_average_shift_m, stage_compactness_m, _ = summarize_shift_line(stage_shift_points)
        event_label = "패스" if event_ref.kind == "pass" else "선수 이동" if event_ref.kind == "move" else "슈팅"
        shift_stages.append(
            DefensiveShiftStage(
                eventId=event_ref.id,
                eventKind=event_ref.kind,
                atMs=event_at_ms,
                durationMs=event_duration_ms,
                note=(
                    f"{event_label} 이후 "
                    f"{build_shift_stage_note(defending_team, stage_focus_y, stage_average_shift_m, stage_compactness_m, stage_shift_points)}"
                ),
                averageShiftDistanceMeters=stage_average_shift_m,
                points=stage_shift_points,
            )
        )

    shift_points = shift_stages[-1].points if shift_stages else build_shift_points(defending_players, focus_x, focus_y)
    average_shift_distance_m, line_compactness_m, line_height_m = summarize_shift_line(shift_points)
    side_note = get_shift_side_note(focus_y)

    return DefensiveShiftSummary(
        defending_team=defending_team,
        average_shift_distance_m=average_shift_distance_m,
        line_compactness_m=line_compactness_m,
        line_height_m=line_height_m,
        note=(
            f"{defending_team.upper()} 수비가 {side_note} 하프스페이스 쪽으로 평균 {average_shift_distance_m:.1f}m 시프트합니다. "
            f"가까운 수비수는 우선 마킹하고, 뒤 라인은 간격을 유지하며 밀립니다."
        ),
        points=shift_points,
        stages=shift_stages,
    )


@app.post("/analysis/sequence", response_model=SequenceAnalysisResponse)
def analyze_sequence(payload: SequenceAnalysisRequest) -> SequenceAnalysisResponse:
    sequence = next((entry for entry in payload.sequences if entry.id == payload.sequence_id), None)

    if sequence is None:
        raise HTTPException(status_code=404, detail="Requested sequence was not found.")

    pass_map: dict[str, PassRecord] = {entry.id: entry for entry in payload.passes}
    movement_map: dict[str, MovementRecord] = {entry.id: entry for entry in payload.movements}
    shot_map: dict[str, ShotRecord] = {entry.id: entry for entry in payload.shots}
    sequence_passes: list[PassRecord] = []
    sequence_movements: list[MovementRecord] = []
    sequence_shots: list[ShotRecord] = []
    event_start_times: list[float] = []
    progression_values: list[float] = []
    width_samples: list[float] = []
    pass_pressure_samples: list[float] = []
    home_events = 0
    away_events = 0

    for event_ref in sequence.eventRefs:
        if event_ref.kind == "pass":
            current_pass = pass_map.get(event_ref.id)
            if current_pass is None:
                continue

            from_player = get_player_by_id(payload.players, current_pass.fromId)
            to_player = get_player_by_id(payload.players, current_pass.toId)
            if from_player is None or to_player is None:
                continue

            sequence_passes.append(current_pass)
            event_start_times.append(current_pass.atMs)
            width_samples.extend(
                sorted(
                    [
                        from_player.y * (PITCH_WIDTH_METERS / PITCH_HEIGHT),
                        to_player.y * (PITCH_WIDTH_METERS / PITCH_HEIGHT),
                    ]
                )
            )
            progression = (
                max((to_player.x - from_player.x) * (PITCH_LENGTH_METERS / PITCH_WIDTH), 0)
                if from_player.team == "home"
                else max((from_player.x - to_player.x) * (PITCH_LENGTH_METERS / PITCH_WIDTH), 0)
            )
            progression_values.append(progression)
            nearby_opponents = [
                get_distance_to_segment_meters(opponent.x, opponent.y, from_player.x, from_player.y, to_player.x, to_player.y)
                for opponent in payload.players
                if opponent.team != from_player.team
            ]
            if nearby_opponents:
                nearest_gap = min(nearby_opponents)
                pass_pressure_samples.append(max(0.0, 1 - min(nearest_gap / 9, 1)))
            if from_player.team == "home":
                home_events += 1
            else:
                away_events += 1
            continue

        if event_ref.kind == "move":
            movement = movement_map.get(event_ref.id)
            if movement is None:
                continue

            sequence_movements.append(movement)
            event_start_times.append(movement.atMs)
            player = get_player_by_id(payload.players, movement.playerId)
            if player is not None:
                width_samples.append(movement.toY * (PITCH_WIDTH_METERS / PITCH_HEIGHT))
            if movement.team == "home":
                home_events += 1
            else:
                away_events += 1
            continue

        shot = shot_map.get(event_ref.id)
        if shot is None:
            continue

        sequence_shots.append(shot)
        event_start_times.append(shot.atMs)
        width_samples.append(shot.fromY * (PITCH_WIDTH_METERS / PITCH_HEIGHT))
        progression = (
            max((shot.targetX - shot.fromX) * (PITCH_LENGTH_METERS / PITCH_WIDTH), 0)
            if shot.team == "home"
            else max((shot.fromX - shot.targetX) * (PITCH_LENGTH_METERS / PITCH_WIDTH), 0)
        )
        progression_values.append(progression)
        if shot.team == "home":
            home_events += 1
        else:
            away_events += 1

    if not sequence_passes and not sequence_movements and not sequence_shots:
        raise HTTPException(status_code=422, detail="Sequence has no analyzable events.")

    sorted_times = sorted(event_start_times)
    event_gaps = [
        sorted_times[index + 1] - sorted_times[index]
        for index in range(len(sorted_times) - 1)
    ]
    movement_distances = [
        get_scaled_distance(movement.fromX, movement.fromY, movement.toX, movement.toY)
        for movement in sequence_movements
    ]
    pass_distances = []
    for current_pass in sequence_passes:
        from_player = get_player_by_id(payload.players, current_pass.fromId)
        to_player = get_player_by_id(payload.players, current_pass.toId)
        if from_player is None or to_player is None:
            continue
        pass_distances.append(get_scaled_distance(from_player.x, from_player.y, to_player.x, to_player.y))

    width_span = 0.0
    if width_samples:
        width_span = max(width_samples) - min(width_samples)

    dominant_team = "home" if home_events >= away_events else "away"
    total_progression_m = sum(progression_values)
    pressure_index = sum(pass_pressure_samples) / len(pass_pressure_samples) if pass_pressure_samples else 0.0
    defensive_shift = build_defensive_shift(
        players=payload.players,
        sequence=sequence,
        sequence_passes=sequence_passes,
        sequence_movements=sequence_movements,
        sequence_shots=sequence_shots,
        dominant_team=dominant_team,
    )
    goal_count = sum(1 for shot in sequence_shots if shot.outcome == "goal")
    on_target_shot_count = sum(1 for shot in sequence_shots if shot.outcome in {"goal", "saved"})
    threat_points = build_threat_points(
        players=payload.players,
        sequence_passes=sequence_passes,
        sequence_movements=sequence_movements,
        sequence_shots=sequence_shots,
        dominant_team=dominant_team,
    )
    epv_heatmap = build_epv_heatmap(dominant_team)
    shot_outcomes = build_shot_outcomes(sequence_shots)

    return SequenceAnalysisResponse(
        sequence_id=sequence.id,
        sequence_name=sequence.name,
        pass_count=len(sequence_passes),
        movement_count=len(sequence_movements),
        shot_count=len(sequence_shots),
        on_target_shot_count=on_target_shot_count,
        goal_count=goal_count,
        carry_count=sum(1 for movement in sequence_movements if movement.carriesBall),
        total_duration_ms=max(sequence.endAtMs - sequence.startAtMs, 0.0),
        average_pass_distance_m=sum(pass_distances) / len(pass_distances) if pass_distances else 0.0,
        total_progression_m=total_progression_m,
        total_movement_distance_m=sum(movement_distances),
        average_event_gap_ms=sum(event_gaps) / len(event_gaps) if event_gaps else 0.0,
        pressure_index=pressure_index,
        support_width_m=width_span,
        team_metrics=SequenceTeamMetrics(
            home_events=home_events,
            away_events=away_events,
            dominant_team=dominant_team,
        ),
        coaching_note=build_coaching_note(
            total_progression_m=total_progression_m,
            carry_count=sum(1 for movement in sequence_movements if movement.carriesBall),
            shot_count=len(sequence_shots),
            goal_count=goal_count,
            pressure_index=pressure_index,
            support_width_m=width_span,
            dominant_team=dominant_team,
        ),
        threat_points=threat_points,
        epv_heatmap=epv_heatmap,
        shot_outcomes=shot_outcomes,
        defensive_shift=defensive_shift,
    )
