import time
from openai import AsyncOpenAI, APIError, AuthenticationError, RateLimitError
from .base import LLMProvider


class OpenAIProvider(LLMProvider):
    provider_name = "openai"
    display_name = "OpenAI"
    supported_models = [
        "gpt-5.5",
        "gpt-5.5-mini",
        "gpt-4.1",
        "gpt-4.1-mini",
        "gpt-4.1-nano",
        "gpt-4o",
        "o3-mini",
    ]

    def __init__(self, api_key: str, extra_config: dict | None = None):
        super().__init__(api_key, extra_config)
        kwargs: dict = {"api_key": api_key}
        if self.extra_config.get("base_url"):
            kwargs["base_url"] = self.extra_config["base_url"]
        self.client = AsyncOpenAI(**kwargs)

    async def generate(
        self,
        system_prompt: str,
        user_prompt: str,
        temperature: float,
        top_p: float,
        max_tokens: int,
        model: str,
    ) -> dict:
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ]

        # Reasoning models (o-series) and newer GPT models use max_completion_tokens
        # and do not support temperature or top_p.
        is_reasoning = model.startswith("o") or model.startswith("gpt-5")
        token_param = "max_completion_tokens" if is_reasoning else "max_tokens"
        params: dict = {"model": model, "messages": messages, token_param: max_tokens}
        if not is_reasoning:
            params["temperature"] = temperature
            params["top_p"] = top_p

        start = time.perf_counter()
        try:
            response = await self.client.chat.completions.create(**params)
        except AuthenticationError as exc:
            raise ValueError(f"OpenAI authentication failed: {exc}") from exc
        except RateLimitError as exc:
            raise ValueError(f"OpenAI rate limit hit: {exc}") from exc
        except APIError as exc:
            raise ValueError(f"OpenAI API error: {exc}") from exc

        latency_ms = int((time.perf_counter() - start) * 1000)

        return {
            "response": response.choices[0].message.content,
            "tokens_used": response.usage.total_tokens,
            "input_tokens": response.usage.prompt_tokens,
            "output_tokens": response.usage.completion_tokens,
            "latency_ms": latency_ms,
            "model": response.model,
            "provider": self.provider_name,
        }

    async def validate_api_key(self) -> bool:
        try:
            await self.client.chat.completions.create(
                model="gpt-4.1-mini",
                messages=[{"role": "user", "content": "hi"}],
                max_tokens=1,
            )
            return True
        except (AuthenticationError, APIError):
            return False
