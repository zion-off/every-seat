"""Amazon Nova models on Bedrock, configured explicitly."""

import os

import boto3
from strands.models import BedrockModel

NOVA_MODELS = {
    "nova-pro": "us.amazon.nova-pro-v1:0",
    "nova-2-lite": "us.amazon.nova-2-lite-v1:0",
}
# On-demand list prices in USD per million (input, output) tokens.
PRICES_PER_MILLION = {
    "us.amazon.nova-pro-v1:0": (0.80, 3.20),
    "us.amazon.nova-2-lite-v1:0": (0.30, 2.50),
}
DEFAULT_REGION = "us-east-1"


class ConfigError(RuntimeError):
    pass


def model_id(choice: str) -> str:
    """Accept a short name (`nova-pro`) or a full Nova model id."""
    resolved = NOVA_MODELS.get(choice, choice)
    if resolved not in PRICES_PER_MILLION:
        raise ConfigError(f"unsupported model {choice!r}: use one of {', '.join(NOVA_MODELS)}")
    return resolved


def aws_session() -> boto3.Session:
    """A session on the named AWS profile and region, never the default profile."""
    profile = os.environ.get("AWS_PROFILE", "")
    if not profile or profile == "default":
        raise ConfigError("set AWS_PROFILE to a named profile (the default profile is not used)")
    region = os.environ.get("AWS_REGION", DEFAULT_REGION)
    return boto3.Session(profile_name=profile, region_name=region)


def bedrock_model(model: str, *, max_tokens: int = 4096, temperature: float = 0.2) -> BedrockModel:
    """A Bedrock model that uses the named AWS profile and region, never the default profile.

    Strands defaults to a different model family and to another region, so both are always set.
    """
    return BedrockModel(
        model_id=model_id(model),
        boto_session=aws_session(),
        max_tokens=max_tokens,
        temperature=temperature,
    )


def cost_usd(model: str, input_tokens: int, output_tokens: int) -> float:
    price_in, price_out = PRICES_PER_MILLION[model_id(model)]
    return round((input_tokens * price_in + output_tokens * price_out) / 1_000_000, 6)
