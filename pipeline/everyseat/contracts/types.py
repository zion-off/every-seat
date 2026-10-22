"""Type definitions mirroring the lens and relay JSON Schemas in `schemas/`."""

from typing import Literal, TypedDict

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
