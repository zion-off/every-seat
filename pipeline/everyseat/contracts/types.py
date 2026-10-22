"""Type definitions mirroring the JSON Schemas in `schemas/`."""

from typing import Any, Literal, NotRequired, TypedDict

CueType = Literal["flash", "loud", "scare", "ad"]
CueAnchor = Literal["iris", "onset", "cut", "approx"]
IrisVerdict = Literal["PASS", "PASS_WITH_WARNING", "FAIL", "NOT_RUN"]


class IrisSummary(TypedDict):
    verdict: IrisVerdict
    max_luminance_swing: NotRequired[float]


class SenseVttHeader(TypedDict):
    version: Literal[1]
    title: str
    analyzer: str
    source_sha256: str
    fps: int
    iris: IrisSummary


class AudioRef(TypedDict):
    uri: str
    duration_s: float


class CuePayload(TypedDict):
    id: str
    type: CueType
    start: float
    end: float
    anchor: CueAnchor
    intensity: int
    preview: str
    lead_s: NotRequired[float]
    pre_s: NotRequired[float]
    post_s: NotRequired[float]
    audio_ref: NotRequired[AudioRef]
    evidence: NotRequired[dict[str, Any]]


FlashesSetting = Literal["soften", "off"]
LoudSetting = Literal["cap", "off"]
ScaresSetting = Literal["headsup", "off"]
AdSetting = Literal["on", "off"]


class LensSettings(TypedDict):
    flashes: FlashesSetting
    loud: LoudSetting
    scares: ScaresSetting
    ad: AdSetting


class LensPerson(TypedDict):
    name: str
    settings: LensSettings


RelayRole = Literal["tv", "phone", "companion"]


class HelloMessage(TypedDict):
    t: Literal["hello"]
    role: RelayRole
    household: str


class PingMessage(TypedDict):
    t: Literal["ping"]


class PongMessage(TypedDict):
    t: Literal["pong"]


class LensMessage(TypedDict):
    t: Literal["lens"]
    people: list[LensPerson]
    settings: LensSettings


class ClockMessage(TypedDict):
    t: Literal["clock"]
    mediaTime: float
    wallClock: int
    rate: float
    title: str


class SyncRequestMessage(TypedDict):
    t: Literal["sync?"]
    c: int


class SyncReplyMessage(TypedDict):
    t: Literal["sync!"]
    c: int
    s: int


RelayMessage = (
    HelloMessage
    | PingMessage
    | PongMessage
    | LensMessage
    | ClockMessage
    | SyncRequestMessage
    | SyncReplyMessage
)
