import time
from openai import AsyncOpenAI, APIError, AuthenticationError, RateLimitError
from .base import LLMProvider


class OpenAIProvider(LLMProvider):
    provider_name = "openai"
    display_name = "OpenAI"
    supported_models = [
        "gpt-5.5",
        "gpt-4.1",
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
        reasoning_effort: str | None = None,
    ) -> dict:
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ]

        # Reasoning models (o-series, gpt-5.x) use max_completion_tokens and
        # reasoning_effort instead of temperature / top_p.
        is_reasoning = model.startswith("o") or model.startswith("gpt-5")
        token_param = "max_completion_tokens" if is_reasoning else "max_tokens"
        params: dict = {"model": model, "messages": messages, token_param: max_tokens}
        if is_reasoning:
            params["reasoning_effort"] = reasoning_effort or "medium"
        else:
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

        choice = response.choices[0]
        msg = choice.message

        # content can be None for reasoning models that return only internal
        # reasoning tokens, or a list of typed blocks on newer model versions.
        content = msg.content
        if content is None:
            refusal = getattr(msg, "refusal", None)
            content = f"[Refused: {refusal}]" if refusal else ""
        elif isinstance(content, list):
            # Structured content blocks — extract text parts only.
            content = "\n".join(
                (b["text"] if isinstance(b, dict) else getattr(b, "text", ""))
                for b in content
                if (isinstance(b, dict) and b.get("type") == "text")
                or (hasattr(b, "type") and b.type == "text")
            )

        return {
            "response": content,
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
