from typing import Literal

from pydantic import BaseModel, Field


class ProjectStatus(BaseModel):
    stage: int = Field(..., description="Current roadmap stage")
    title: str = Field(..., description="Human readable stage title")
    simulation_ready: bool = Field(..., description="Whether a playable simulation loop exists")


class HealthResponse(BaseModel):
    status: str = Field(..., description="Simple service health flag")
    project: ProjectStatus


class PlayerPoint(BaseModel):
    id: str = Field(..., description="Unique player identifier")
    label: str = Field(..., description="Shirt number or human readable player label")
    team: Literal["home", "away"] = Field(..., description="Player team side")
    x: float = Field(..., description="Canvas x position")
    y: float = Field(..., description="Canvas y position")


class PassRecord(BaseModel):
    id: str = Field(..., description="Unique pass identifier")
    fromId: str = Field(..., description="Pass origin player id")
    toId: str = Field(..., description="Pass target player id")
    atMs: float = Field(..., ge=0, description="Timeline start time in milliseconds")
    durationMs: float = Field(..., gt=0, description="Pass duration in milliseconds")


class MovementRecord(BaseModel):
    id: str = Field(..., description="Unique movement identifier")
    playerId: str = Field(..., description="Moving player id")
    team: Literal["home", "away"] = Field(..., description="Moving player team side")
    fromX: float = Field(..., description="Start x position")
    fromY: float = Field(..., description="Start y position")
    toX: float = Field(..., description="End x position")
    toY: float = Field(..., description="End y position")
    atMs: float = Field(..., ge=0, description="Timeline start time in milliseconds")
    durationMs: float = Field(..., gt=0, description="Movement duration in milliseconds")
    carriesBall: bool = Field(..., description="Whether the player carries the ball during the move")


class ShotRecord(BaseModel):
    id: str = Field(..., description="Unique shot identifier")
    playerId: str = Field(..., description="Shooting player id")
    team: Literal["home", "away"] = Field(..., description="Shooting player team side")
    fromX: float = Field(..., description="Shot origin x position")
    fromY: float = Field(..., description="Shot origin y position")
    targetX: float = Field(..., description="Shot target x position")
    targetY: float = Field(..., description="Shot target y position")
    atMs: float = Field(..., ge=0, description="Timeline start time in milliseconds")
    durationMs: float = Field(..., gt=0, description="Shot duration in milliseconds")
    xg: float = Field(..., ge=0, le=1, description="Shot expected-goal proxy")
    outcome: Literal["goal", "saved", "off_target", "blocked"] = Field(..., description="Shot outcome label")


class SequenceEventRef(BaseModel):
    kind: Literal["pass", "move", "shot"] = Field(..., description="Referenced event type")
    id: str = Field(..., description="Referenced event identifier")


class TacticSequenceRecord(BaseModel):
    id: str = Field(..., description="Unique sequence identifier")
    name: str = Field(..., description="User-facing sequence name")
    eventRefs: list[SequenceEventRef] = Field(..., description="Ordered event references in the sequence")
    startAtMs: float = Field(..., ge=0, description="Sequence start time")
    endAtMs: float = Field(..., ge=0, description="Sequence end time")
    createdAt: str = Field(..., description="ISO timestamp when the sequence was created")


class BallPosition(BaseModel):
    x: float = Field(..., description="Ball x position")
    y: float = Field(..., description="Ball y position")


class BallSnapshot(BaseModel):
    ownerId: str | None = Field(..., description="Current ball owner id")
    position: BallPosition


class BaseState(BaseModel):
    players: list[PlayerPoint] = Field(..., description="Initial player snapshot for playback")
    ball: BallSnapshot


class SequenceAnalysisRequest(BaseModel):
    sequence_id: str = Field(..., description="Sequence identifier to analyze")
    players: list[PlayerPoint] = Field(..., description="Current player list")
    passes: list[PassRecord] = Field(..., description="All recorded passes")
    movements: list[MovementRecord] = Field(..., description="All recorded movements")
    shots: list[ShotRecord] = Field(..., description="All recorded shots")
    sequences: list[TacticSequenceRecord] = Field(..., description="All recorded tactic sequences")
    base: BaseState = Field(..., description="Base playback snapshot")


class SequenceTeamMetrics(BaseModel):
    home_events: int = Field(..., description="Number of home-team events in the selected sequence")
    away_events: int = Field(..., description="Number of away-team events in the selected sequence")
    dominant_team: str = Field(..., description="Team that generated more timeline events")


class ThreatPoint(BaseModel):
    id: str = Field(..., description="Unique threat point identifier")
    x: float = Field(..., description="Threat point x position")
    y: float = Field(..., description="Threat point y position")
    team: Literal["home", "away"] = Field(..., description="Attacking team side")
    label: str = Field(..., description="Readable event label")
    xg: float = Field(..., ge=0, le=1, description="Expected-goal proxy at this point")
    source: Literal["pass", "move", "shot"] = Field(..., description="Event source for the threat point")


class EpvHeatCell(BaseModel):
    id: str = Field(..., description="Unique EPV heat cell identifier")
    x: float = Field(..., description="Cell x position")
    y: float = Field(..., description="Cell y position")
    width: float = Field(..., gt=0, description="Cell width")
    height: float = Field(..., gt=0, description="Cell height")
    value: float = Field(..., ge=0, le=1, description="Expected-possession-value proxy for the cell")


class ShotOutcomeSummary(BaseModel):
    outcome: Literal["goal", "saved", "off_target", "blocked"] = Field(..., description="Shot outcome identifier")
    label: str = Field(..., description="Localized shot outcome label")
    count: int = Field(..., ge=0, description="How many shots ended with this outcome")


class DefensiveShiftPoint(BaseModel):
    playerId: str = Field(..., description="Defender player identifier")
    label: str = Field(..., description="Readable defender label")
    team: Literal["home", "away"] = Field(..., description="Defending team side")
    fromX: float = Field(..., description="Original x position")
    fromY: float = Field(..., description="Original y position")
    toX: float = Field(..., description="Shifted x position")
    toY: float = Field(..., description="Shifted y position")
    shiftDistanceMeters: float = Field(..., description="Distance moved by the defensive shift")


class DefensiveShiftStage(BaseModel):
    eventId: str = Field(..., description="Timeline event identifier that triggered this stage")
    eventKind: Literal["pass", "move", "shot"] = Field(..., description="Type of timeline event")
    atMs: float = Field(..., description="Timeline start time for the triggering event")
    durationMs: float = Field(..., description="Timeline duration for the triggering event")
    note: str = Field(..., description="Human-readable note for this defensive reaction stage")
    averageShiftDistanceMeters: float = Field(..., description="Average defender movement at this stage")
    points: list[DefensiveShiftPoint] = Field(..., description="Defender target positions for this stage")


class DefensiveShiftSummary(BaseModel):
    defending_team: Literal["home", "away"] = Field(..., description="Team that is reacting defensively")
    average_shift_distance_m: float = Field(..., description="Average defender shift distance")
    line_compactness_m: float = Field(..., description="Vertical compactness span after shifting")
    line_height_m: float = Field(..., description="Average defensive line height after shifting")
    note: str = Field(..., description="Human-readable defensive reaction summary")
    points: list[DefensiveShiftPoint] = Field(..., description="Suggested shifted defender positions")
    stages: list[DefensiveShiftStage] = Field(..., description="Event-by-event defensive reaction stages")


class SequenceAnalysisResponse(BaseModel):
    sequence_id: str = Field(..., description="Analyzed sequence identifier")
    sequence_name: str = Field(..., description="Analyzed sequence label")
    pass_count: int = Field(..., description="Number of passes in the sequence")
    movement_count: int = Field(..., description="Number of player movements in the sequence")
    shot_count: int = Field(..., description="Number of shots in the sequence")
    on_target_shot_count: int = Field(..., description="Number of saved or goal shots in the sequence")
    goal_count: int = Field(..., description="Number of goal outcomes in the sequence")
    carry_count: int = Field(..., description="Number of ball-carry movements in the sequence")
    total_duration_ms: float = Field(..., description="Full sequence duration in milliseconds")
    average_pass_distance_m: float = Field(..., description="Average pass length in meters")
    total_progression_m: float = Field(..., description="Total forward progression in meters")
    total_movement_distance_m: float = Field(..., description="Total player movement distance in meters")
    average_event_gap_ms: float = Field(..., description="Average time gap between consecutive events")
    pressure_index: float = Field(..., description="Simple congestion pressure index derived from nearby opponents")
    support_width_m: float = Field(..., description="Average horizontal spread of involved attacking actions")
    team_metrics: SequenceTeamMetrics
    coaching_note: str = Field(..., description="Human-readable coaching interpretation")
    threat_points: list[ThreatPoint] = Field(..., description="xG proxy threat points returned by the backend")
    epv_heatmap: list[EpvHeatCell] = Field(..., description="EPV proxy heatmap grid returned by the backend")
    shot_outcomes: list[ShotOutcomeSummary] = Field(..., description="Shot outcome distribution for the sequence")
    defensive_shift: DefensiveShiftSummary
