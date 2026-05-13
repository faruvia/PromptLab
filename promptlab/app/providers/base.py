from abc import ABC, abstractmethod


class LLMProvider(ABC):
    provider_name: str = ""
    display_name: str = ""
    supported_models: list[str] = []

    def __init__(self, api_key: str, extra_config: dict | None = None):
        self.api_key = api_key
        self.extra_config = extra_config or {}

    @abstractmethod
    async def generate(
        self,
        system_prompt: str,
        user_prompt: str,
        temperature: float,
        top_p: float,
        max_tokens: int,
        model: str,
    ) -> dict:
        """Returns: {response, tokens_used, input_tokens, output_tokens,
                     latency_ms, model, provider}"""
        pass

    @abstractmethod
    async def validate_api_key(self) -> bool:
        """Lightweight test call to verify the key works."""
        pass

    def list_models(self) -> list[str]:
        return self.supported_models
