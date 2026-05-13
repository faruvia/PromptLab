"""
TODO — Community contribution welcome!

To implement:
1. Use huggingface_hub.AsyncInferenceClient
2. Use extra_config.get("endpoint_url") for custom inference endpoints,
   otherwise use the public HF Inference API
3. Note: not all HF models support all parameters
4. Docs: https://huggingface.co/docs/huggingface_hub
"""

from .base import LLMProvider


class HuggingFaceProvider(LLMProvider):
    provider_name = "huggingface"
    display_name = "Hugging Face"
    supported_models = [
        "meta-llama/Llama-3.1-8B-Instruct",
        "mistralai/Mistral-7B-Instruct-v0.3",
        "google/gemma-2-9b-it",
    ]

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
            "HuggingFace provider not yet implemented. See TODO in "
            "app/providers/huggingface_provider.py — contributions welcome!"
        )

    async def validate_api_key(self) -> bool:
        raise NotImplementedError("HuggingFace provider not yet implemented.")
