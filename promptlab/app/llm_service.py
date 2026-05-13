import time
from sqlalchemy.orm import Session
from .providers.registry import get_provider, get_default_provider
from .models import ProviderConfig


async def generate_response(
    db: Session,
    system_prompt: str,
    user_prompt: str,
    temperature: float,
    top_p: float,
    max_tokens: int = 1024,
    provider_name: str | None = None,
    model: str | None = None,
) -> dict:
    if not (0.0 <= temperature <= 2.0):
        raise ValueError("Temperature must be between 0.0 and 2.0")
    if not (0.0 <= top_p <= 1.0):
        raise ValueError("Top-P must be between 0.0 and 1.0")
    if not (1 <= max_tokens <= 8192):
        raise ValueError("Max tokens must be between 1 and 8192")

    provider = (
        get_provider(provider_name, db) if provider_name else get_default_provider(db)
    )

    if not model:
        config = db.query(ProviderConfig).filter_by(
            provider_name=provider.provider_name
        ).first()
        model = (config.default_model if config else None) or provider.supported_models[0]

    return await provider.generate(
        system_prompt=system_prompt,
        user_prompt=user_prompt,
        temperature=temperature,
        top_p=top_p,
        max_tokens=max_tokens,
        model=model,
    )


async def test_provider_connection(db: Session, provider_name: str) -> dict:
    try:
        provider = get_provider(provider_name, db)
        start = time.perf_counter()
        is_valid = await provider.validate_api_key()
        latency_ms = int((time.perf_counter() - start) * 1000)
        return {
            "success": is_valid,
            "message": "Connection successful" if is_valid else "Validation failed",
            "latency_ms": latency_ms,
        }
    except NotImplementedError as exc:
        return {"success": False, "message": str(exc), "latency_ms": None}
    except Exception as exc:
        return {"success": False, "message": f"Error: {str(exc)[:200]}", "latency_ms": None}
