"""Amazon Polly neural speech."""

from xml.sax.saxutils import escape

from everyseat.agent.model import aws_session
from everyseat.describe import DescribeError
from everyseat.describe.voices import SAMPLE_RATE, Speech

DEFAULT_VOICE = "Joanna"
# On-demand list price of the neural engine, USD per million characters.
NEURAL_USD_PER_MILLION_CHARACTERS = 16.0


class PollyVoice:
    """Renders raw PCM (16 kHz, 16-bit, mono) so the duration is exactly bytes over bytes per
    second. A rate above 100% is the last resort for a clip that is still too long.
    """

    usd_per_million_characters = NEURAL_USD_PER_MILLION_CHARACTERS

    def __init__(self, voice_id: str = DEFAULT_VOICE):
        self.voice_id = voice_id
        self.name = f"polly neural {voice_id}"
        self.client = aws_session().client("polly")

    def speak(self, text: str, rate_percent: int = 100) -> Speech:
        if rate_percent == 100:
            body, text_type = text, "text"
        else:
            body = f'<speak><prosody rate="{rate_percent}%">{escape(text)}</prosody></speak>'
            text_type = "ssml"
        try:
            response = self.client.synthesize_speech(
                Engine="neural",
                VoiceId=self.voice_id,
                OutputFormat="pcm",
                SampleRate=str(SAMPLE_RATE),
                TextType=text_type,
                Text=body,
            )
            pcm = response["AudioStream"].read()
        except Exception as exc:  # botocore raises many kinds; the cause is in the message
            raise DescribeError(f"Polly could not speak the text: {exc}") from exc
        if not pcm:
            raise DescribeError("Polly returned no audio")
        return Speech(pcm, SAMPLE_RATE, len(text))
