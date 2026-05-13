from sqlalchemy.orm import Session as DBSession
from . import models, schemas, security


# ---------- Internal helpers ----------

def _persona_to_dict(persona: models.Persona, active_prompt: models.SystemPrompt | None) -> dict:
    return {
        "id": persona.id,
        "name": persona.name,
        "domain": persona.domain,
        "description": persona.description,
        "icon": persona.icon,
        "default_temperature": persona.default_temperature,
        "default_top_p": persona.default_top_p,
        "default_max_tokens": persona.default_max_tokens,
        "created_at": persona.created_at,
        "active_prompt": (
            {
                "id": active_prompt.id,
                "version": active_prompt.version,
                "prompt_text": active_prompt.prompt_text,
                "is_active": active_prompt.is_active,
                "created_at": active_prompt.created_at,
            }
            if active_prompt
            else None
        ),
    }


# ---------- Persona ----------

def get_personas(db: DBSession) -> list[models.Persona]:
    return db.query(models.Persona).order_by(models.Persona.name).all()


def get_persona(db: DBSession, persona_id: int) -> models.Persona | None:
    return db.query(models.Persona).filter(models.Persona.id == persona_id).first()


def get_personas_with_prompts(db: DBSession) -> list[dict]:
    personas = db.query(models.Persona).order_by(models.Persona.name).all()
    return [_persona_to_dict(p, get_active_system_prompt(db, p.id)) for p in personas]


def get_persona_with_prompt(db: DBSession, persona_id: int) -> dict | None:
    persona = get_persona(db, persona_id)
    if not persona:
        return None
    return _persona_to_dict(persona, get_active_system_prompt(db, persona_id))


def create_persona_with_prompt(db: DBSession, persona: schemas.PersonaCreate) -> dict:
    db_persona = models.Persona(
        name=persona.name,
        domain=persona.domain,
        description=persona.description,
        icon=persona.icon,
        default_temperature=persona.default_temperature,
        default_top_p=persona.default_top_p,
        default_max_tokens=persona.default_max_tokens,
    )
    db.add(db_persona)
    db.flush()

    sp = models.SystemPrompt(
        persona_id=db_persona.id,
        prompt_text=persona.system_prompt,
        version=1,
        is_active=True,
    )
    db.add(sp)
    db.commit()
    db.refresh(db_persona)
    db.refresh(sp)
    return _persona_to_dict(db_persona, sp)


def update_persona(db: DBSession, persona_id: int, update: schemas.PersonaUpdate) -> dict | None:
    db_persona = get_persona(db, persona_id)
    if not db_persona:
        return None
    for field, value in update.model_dump(exclude_unset=True).items():
        setattr(db_persona, field, value)
    db.commit()
    db.refresh(db_persona)
    return _persona_to_dict(db_persona, get_active_system_prompt(db, persona_id))


def delete_persona(db: DBSession, persona_id: int) -> bool:
    db_persona = get_persona(db, persona_id)
    if not db_persona:
        return False
    db.delete(db_persona)
    db.commit()
    return True


# ---------- SystemPrompt ----------

def get_active_system_prompt(db: DBSession, persona_id: int) -> models.SystemPrompt | None:
    return (
        db.query(models.SystemPrompt)
        .filter_by(persona_id=persona_id, is_active=True)
        .order_by(models.SystemPrompt.version.desc())
        .first()
    )


def create_system_prompt_version(
    db: DBSession, persona_id: int, prompt_text: str
) -> models.SystemPrompt:
    db.query(models.SystemPrompt).filter_by(persona_id=persona_id).update(
        {"is_active": False}
    )

    latest = (
        db.query(models.SystemPrompt)
        .filter_by(persona_id=persona_id)
        .order_by(models.SystemPrompt.version.desc())
        .first()
    )
    next_version = (latest.version + 1) if latest else 1

    sp = models.SystemPrompt(
        persona_id=persona_id,
        prompt_text=prompt_text,
        version=next_version,
        is_active=True,
    )
    db.add(sp)
    db.commit()
    db.refresh(sp)
    return sp


# ---------- Session ----------

def get_session(db: DBSession, session_id: int) -> models.Session | None:
    return db.query(models.Session).filter(models.Session.id == session_id).first()


def get_sessions(db: DBSession) -> list[models.Session]:
    return db.query(models.Session).order_by(models.Session.created_at.desc()).all()


def get_recent_sessions(db: DBSession) -> list[dict]:
    sessions = (
        db.query(models.Session).order_by(models.Session.created_at.desc()).all()
    )
    result = []
    for s in sessions:
        persona = (
            db.query(models.Persona).filter_by(id=s.persona_id).first()
            if s.persona_id
            else None
        )
        count = (
            db.query(models.Interaction).filter_by(session_id=s.id).count()
        )
        result.append(
            {
                "id": s.id,
                "persona_id": s.persona_id,
                "persona_name": persona.name if persona else None,
                "model_name": s.model_name,
                "provider_name": s.provider_name,
                "created_at": s.created_at,
                "interaction_count": count,
            }
        )
    return result


def get_session_detail(db: DBSession, session_id: int) -> dict | None:
    s = db.query(models.Session).filter_by(id=session_id).first()
    if not s:
        return None
    interactions = (
        db.query(models.Interaction)
        .filter_by(session_id=session_id)
        .order_by(models.Interaction.id)
        .all()
    )
    return {
        "id": s.id,
        "persona_id": s.persona_id,
        "system_prompt_id": s.system_prompt_id,
        "temperature": s.temperature,
        "top_p": s.top_p,
        "max_tokens": s.max_tokens,
        "model_name": s.model_name,
        "provider_name": s.provider_name,
        "created_at": s.created_at,
        "interactions": [
            {
                "id": i.id,
                "user_prompt": i.user_prompt,
                "response": i.response,
                "tokens_used": i.tokens_used,
                "latency_ms": i.latency_ms,
                "created_at": i.created_at,
            }
            for i in interactions
        ],
    }


def create_chat_session(db: DBSession, data: dict) -> models.Session:
    session = models.Session(**data)
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


def delete_session(db: DBSession, session_id: int) -> bool:
    db_session = get_session(db, session_id)
    if not db_session:
        return False
    db.delete(db_session)
    db.commit()
    return True


# ---------- Interaction ----------

def create_interaction(db: DBSession, data: dict) -> models.Interaction:
    interaction = models.Interaction(**data)
    db.add(interaction)
    db.commit()
    db.refresh(interaction)
    return interaction


# ---------- Provider ----------

def set_provider_api_key(
    db: DBSession, provider_name: str, plaintext_key: str
) -> models.ProviderConfig:
    config = db.query(models.ProviderConfig).filter_by(provider_name=provider_name).first()
    if not config:
        raise ValueError(f"Unknown provider: {provider_name}")
    config.encrypted_api_key = security.encrypt_api_key(plaintext_key)
    config.is_enabled = True
    db.commit()
    db.refresh(config)
    return config


def remove_provider_api_key(
    db: DBSession, provider_name: str
) -> models.ProviderConfig:
    config = db.query(models.ProviderConfig).filter_by(provider_name=provider_name).first()
    if not config:
        raise ValueError(f"Unknown provider: {provider_name}")
    config.encrypted_api_key = None
    config.is_enabled = False
    if config.is_default:
        config.is_default = False
    db.commit()
    db.refresh(config)
    return config


def set_default_provider(
    db: DBSession, provider_name: str
) -> models.ProviderConfig:
    config = db.query(models.ProviderConfig).filter_by(provider_name=provider_name).first()
    if not config:
        raise ValueError(f"Unknown provider: {provider_name}")
    if not config.is_enabled:
        raise ValueError(f"Cannot set default — no key configured for '{provider_name}'")
    db.query(models.ProviderConfig).update({"is_default": False})
    config.is_default = True
    db.commit()
    db.refresh(config)
    return config


def update_provider_model(
    db: DBSession, provider_name: str, default_model: str
) -> models.ProviderConfig:
    config = db.query(models.ProviderConfig).filter_by(provider_name=provider_name).first()
    if not config:
        raise ValueError(f"Unknown provider: {provider_name}")
    config.default_model = default_model
    db.commit()
    db.refresh(config)
    return config


def get_provider_config_safe(db: DBSession, provider_name: str) -> dict | None:
    config = db.query(models.ProviderConfig).filter_by(provider_name=provider_name).first()
    if not config:
        return None

    from .providers.registry import PROVIDER_REGISTRY
    provider_class = PROVIDER_REGISTRY.get(provider_name)
    supported_models = provider_class.supported_models if provider_class else []

    key_preview: str | None = None
    if config.encrypted_api_key:
        try:
            key_preview = security.mask_api_key(
                security.decrypt_api_key(config.encrypted_api_key)
            )
        except ValueError:
            key_preview = "••••••••"

    return {
        "provider_name": config.provider_name,
        "display_name": config.display_name,
        "is_enabled": config.is_enabled,
        "is_default": config.is_default,
        "default_model": config.default_model,
        "supported_models": supported_models,
        "has_key": config.encrypted_api_key is not None,
        "key_preview": key_preview,
    }


def list_providers_safe(db: DBSession) -> list[dict]:
    configs = db.query(models.ProviderConfig).all()
    return [get_provider_config_safe(db, c.provider_name) for c in configs]
