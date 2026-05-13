from datetime import datetime
from pydantic import BaseModel, ConfigDict, Field


# ---------- SystemPrompt ----------

class SystemPromptOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    version: int
    prompt_text: str
    is_active: bool
    created_at: datetime


class SystemPromptCreate(BaseModel):
    prompt_text: str


# ---------- Persona ----------

class PersonaCreate(BaseModel):
    name: str
    domain: str
    description: str = ""
    icon: str = "🤖"
    default_temperature: float = 0.7
    default_top_p: float = 0.9
    default_max_tokens: int = 1024
    system_prompt: str  # required: text for the first active SystemPrompt


class PersonaUpdate(BaseModel):
    name: str | None = None
    domain: str | None = None
    description: str | None = None
    icon: str | None = None
    default_temperature: float | None = None
    default_top_p: float | None = None
    default_max_tokens: int | None = None


class PersonaOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    domain: str
    description: str
    icon: str
    default_temperature: float
    default_top_p: float
    default_max_tokens: int
    created_at: datetime
    active_prompt: SystemPromptOut | None = None


# ---------- Session ----------

class InteractionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_prompt: str
    response: str
    tokens_used: int | None
    latency_ms: int | None
    created_at: datetime


class SessionSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    persona_id: int | None
    persona_name: str | None = None
    model_name: str
    provider_name: str | None
    created_at: datetime
    interaction_count: int = 0


class SessionDetail(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    persona_id: int | None
    system_prompt_id: int | None
    temperature: float
    top_p: float
    max_tokens: int
    model_name: str
    provider_name: str | None
    created_at: datetime
    interactions: list[InteractionOut] = []


# ---------- Chat ----------

class ChatRequest(BaseModel):
    persona_id: int
    user_prompt: str
    temperature: float = 0.7
    top_p: float = 0.9
    max_tokens: int = 1024
    system_prompt: str | None = None   # overrides active persona prompt
    provider_name: str | None = None   # None → use default provider
    model: str | None = None           # None → provider's default model


class ChatResponse(BaseModel):
    response: str
    tokens_used: int | None
    input_tokens: int | None = None
    output_tokens: int | None = None
    latency_ms: int | None
    provider: str
    model: str
    interaction_id: int
    session_id: int


class CompareConfig(BaseModel):
    persona_id: int
    temperature: float
    top_p: float
    max_tokens: int = 1024
    system_prompt: str | None = None
    provider_name: str | None = None
    model: str | None = None


class CompareRequest(BaseModel):
    user_prompt: str
    config_a: CompareConfig
    config_b: CompareConfig


class CompareResponse(BaseModel):
    response_a: str
    response_b: str
    latency_a: int | None
    latency_b: int | None
    tokens_a: int | None
    tokens_b: int | None
    input_tokens_a: int | None = None
    output_tokens_a: int | None = None
    input_tokens_b: int | None = None
    output_tokens_b: int | None = None
    provider_a: str
    provider_b: str
    model_a: str | None = None
    model_b: str | None = None


# ---------- Provider ----------

class ProviderConfigResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    provider_name: str
    display_name: str
    is_enabled: bool
    is_default: bool
    default_model: str | None
    supported_models: list[str]
    has_key: bool
    key_preview: str | None


class ProviderKeyUpdate(BaseModel):
    api_key: str = Field(..., min_length=10)


class ProviderModelUpdate(BaseModel):
    default_model: str


class ProviderTestResponse(BaseModel):
    success: bool
    message: str
    latency_ms: int | None = None
