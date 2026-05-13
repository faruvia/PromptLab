"""
TODO — Community contribution welcome!

To implement:
1. Use anthropic.AsyncAnthropic from the anthropic SDK
2. Note: system prompt is a SEPARATE parameter, not a message role
   Example: client.messages.create(system=system_prompt, messages=[user_msg], ...)
3. Extract usage from response.usage.input_tokens and output_tokens
4. Models: claude-sonnet-4-5, claude-opus-4-7, claude-haiku-4-5
5. Docs: https://docs.anthropic.com/en/api/messages

Follow the pattern in openai_provider.py.
"""

from .base import LLMProvider


class AnthropicProvider(LLMProvider):
    provider_name = "anthropic"
    display_name = "Anthropic"
    supported_models = ["claude-sonnet-4-5", "claude-opus-4-7", "claude-haiku-4-5"]

    async def generate(
        self,
        system_prompt: str,
        user_prompt: str,
        temperature: float,
        top_p: float,
        max_tokens: int,
        model: str,
    ) -> dict:
        raise NotImplementedError(
            "Anthropic provider not yet implemented. See the TODO comment "
            "in app/providers/anthropic_provider.py — contributions welcome!"
        )

    async def validate_api_key(self) -> bool:
        raise NotImplementedError("Anthropic provider not yet implemented.")
