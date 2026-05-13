from sqlalchemy.orm import Session
from ..models import ProviderConfig
from ..security import decrypt_api_key
from .openai_provider import OpenAIProvider
from .anthropic_provider import AnthropicProvider
from .huggingface_provider import HuggingFaceProvider

PROVIDER_REGISTRY: dict[str, type] = {
    "openai": OpenAIProvider,
    "anthropic": AnthropicProvider,
    "huggingface": HuggingFaceProvider,
}


def get_provider(provider_name: str, db: Session):
    if provider_name not in PROVIDER_REGISTRY:
        raise ValueError(f"Unknown provider: {provider_name}")

    config = db.query(ProviderConfig).filter_by(provider_name=provider_name).first()
    if not config or not config.is_enabled or not config.encrypted_api_key:
        raise ValueError(f"Provider '{provider_name}' is not configured")

    api_key = decrypt_api_key(config.encrypted_api_key)
    provider_class = PROVIDER_REGISTRY[provider_name]
    return provider_class(api_key=api_key, extra_config=config.extra_config)


def get_default_provider(db: Session):
    config = (
        db.query(ProviderConfig)
        .filter_by(is_default=True, is_enabled=True)
        .first()
    )
    if not config:
        raise ValueError("No default provider configured. Add an API key in Settings.")
    return get_provider(config.provider_name, db)
