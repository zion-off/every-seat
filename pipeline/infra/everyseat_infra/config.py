"""Deployment settings, read from CDK context so that no account-specific value is committed."""

import re
from dataclasses import dataclass

from constructs import Node

VPC_ID = re.compile(r"^vpc-[0-9a-f]{8}([0-9a-f]{9})?$")
SUBNET_ID = re.compile(r"^subnet-[0-9a-f]{8}([0-9a-f]{9})?$")
RUNTIME_ARN = re.compile(r"^arn:aws:bedrock-agentcore:[a-z0-9-]+:\d{12}:runtime/[A-Za-z0-9_-]+$")

USAGE = (
    "pass the network and, once the runtime exists, its ARN as context: "
    "-c vpc_id=vpc-... -c subnet_ids=subnet-...,subnet-... [-c agent_runtime_arn=arn:...]"
)


class SettingsError(ValueError):
    pass


@dataclass(frozen=True)
class Settings:
    vpc_id: str
    subnet_ids: tuple[str, ...]
    agent_runtime_arn: str = ""

    @classmethod
    def from_context(cls, node: Node) -> "Settings":
        vpc_id = node.try_get_context("vpc_id")
        subnets = node.try_get_context("subnet_ids")
        runtime_arn = node.try_get_context("agent_runtime_arn") or ""
        if not vpc_id or not subnets:
            raise SettingsError(f"vpc_id and subnet_ids are required: {USAGE}")
        if not VPC_ID.match(vpc_id):
            raise SettingsError(f"vpc_id {vpc_id!r} is not a VPC id")
        subnet_ids = tuple(part.strip() for part in str(subnets).split(",") if part.strip())
        bad = [s for s in subnet_ids if not SUBNET_ID.match(s)]
        if bad or not subnet_ids:
            raise SettingsError(f"subnet_ids must be a comma-separated list of subnet ids: {bad}")
        if runtime_arn and not RUNTIME_ARN.match(runtime_arn):
            raise SettingsError("agent_runtime_arn is not an AgentCore runtime ARN")
        return cls(vpc_id, subnet_ids, runtime_arn)
