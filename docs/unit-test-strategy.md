# Unit Test Strategy

## Overview

This document defines the unit testing strategy for PromptLab — a FastAPI + SQLAlchemy application with LLM provider integrations. It covers what to test, how to structure tests, which tools to use, and the mocking strategy for external dependencies.

---

## Testing Stack

| Tool | Purpose |
|---|---|
| `pytest` | Test runner and assertion framework |
| `pytest-asyncio` | Run `async` test functions (needed for provider and service tests) |
| `httpx` + FastAPI `TestClient` | Integration tests against the full ASGI app |
| `pytest-mock` / `unittest.mock` | Mock LLM providers and filesystem side-effects |
| SQLite in-memory (`sqlite:///:memory:`) | Isolated database per test — no file left behind |

Install:
```bash
pip install pytest pytest-asyncio httpx pytest-mock
```

---

## Test File Structure

```
tests/
├── conftest.py                  ← shared fixtures (DB session, app client)
├── unit/
│   ├── test_security.py         ← encrypt / decrypt / mask
│   ├── test_crud.py             ← all CRUD functions (persona, session, provider)
│   ├── test_llm_service.py      ← generate_response validation + routing
│   └── test_schemas.py          ← Pydantic model validation edge cases
└── integration/
    ├── test_personas_router.py  ← /api/personas endpoints
    ├── test_sessions_router.py  ← /api/sessions endpoints
    ├── test_chat_router.py      ← /api/chat + /api/compare
    └── test_providers_router.py ← /api/providers endpoints
```

---

## Shared Fixtures — `tests/conftest.py`

```python
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from promptlab.app.main import app
from promptlab.app.database import get_db, Base

TEST_DB_URL = "sqlite:///:memory:"

@pytest.fixture()
def db_session():
    engine = create_engine(TEST_DB_URL, connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(engine)

@pytest.fixture()
def client(db_session):
    app.dependency_overrides[get_db] = lambda: db_session
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()
```

---

## Unit Tests

### 1. `security.py` — `tests/unit/test_security.py`

The security module has no external dependencies; test it directly.

| Function | Cases to cover |
|---|---|
| `encrypt_api_key(plaintext)` | Returns a non-empty string different from input |
| `encrypt_api_key("")` | Raises `ValueError` |
| `decrypt_api_key(encrypt_api_key(x))` | Round-trips to original value |
| `decrypt_api_key("invalid-ciphertext")` | Raises `ValueError` with key-mismatch message |
| `mask_api_key("sk-abcdef1234")` | Returns `"sk-...1234"` format |
| `mask_api_key("short")` | Returns `"••••••••"` (too short to preview) |

```python
from promptlab.app.security import encrypt_api_key, decrypt_api_key, mask_api_key
import pytest

def test_encrypt_decrypt_roundtrip():
    key = "sk-test-api-key-12345"
    assert decrypt_api_key(encrypt_api_key(key)) == key

def test_encrypt_empty_raises():
    with pytest.raises(ValueError):
        encrypt_api_key("")

def test_decrypt_invalid_raises():
    with pytest.raises(ValueError, match="FERNET_KEY mismatch"):
        decrypt_api_key("not-valid-ciphertext")

def test_mask_normal_key():
    result = mask_api_key("sk-abcdef1234")
    assert result.startswith("sk-")
    assert result.endswith("1234")
    assert "..." in result

def test_mask_short_key():
    assert mask_api_key("abc") == "••••••••"
```

---

### 2. `crud.py` — `tests/unit/test_crud.py`

All CRUD functions use the in-memory SQLite `db_session` fixture. No mocking needed — SQLite is fast enough for pure data-layer tests.

#### Persona CRUD

| Function | Cases |
|---|---|
| `create_persona_with_prompt` | Persists persona + creates version-1 active system prompt |
| `get_persona` | Returns `None` for missing ID |
| `get_personas_with_prompts` | Returns sorted list with `active_prompt` populated |
| `update_persona` | Partial update via `exclude_unset=True`; unchanged fields stay |
| `delete_persona` | Returns `False` for non-existent ID; `True` on success |

#### SystemPrompt versioning

| Function | Cases |
|---|---|
| `create_system_prompt_version` | Deactivates all prior prompts; new version number increments correctly |
| `get_active_system_prompt` | Returns the highest-version active prompt |

#### Session / Interaction

| Function | Cases |
|---|---|
| `create_chat_session` | Saves and returns session with ID |
| `get_recent_sessions` | Returns sessions newest-first with `interaction_count` |
| `get_session_detail` | Returns `None` for unknown ID; interactions sorted by ID |
| `delete_session` | Cascade deletes interactions |

#### Provider Config

| Function | Cases |
|---|---|
| `set_provider_api_key` | Encrypts key; auto-promotes to default if none exists |
| `remove_provider_api_key` | Clears key; removes default flag |
| `set_default_provider` | Raises if provider not enabled; demotes previous default |
| `update_provider_model` | Raises for unknown provider name |

```python
from promptlab.app import crud, schemas

def test_create_persona_creates_active_prompt(db_session):
    data = schemas.PersonaCreate(
        name="Analyst", domain="Finance",
        system_prompt="You are a financial analyst."
    )
    result = crud.create_persona_with_prompt(db_session, data)
    assert result["name"] == "Analyst"
    assert result["active_prompt"]["version"] == 1
    assert result["active_prompt"]["is_active"] is True

def test_get_persona_missing_returns_none(db_session):
    assert crud.get_persona(db_session, 9999) is None

def test_system_prompt_versioning(db_session):
    data = schemas.PersonaCreate(name="Bot", domain="Test", system_prompt="v1")
    created = crud.create_persona_with_prompt(db_session, data)
    pid = created["id"]
    v2 = crud.create_system_prompt_version(db_session, pid, "v2")
    assert v2.version == 2
    assert v2.is_active is True
    active = crud.get_active_system_prompt(db_session, pid)
    assert active.prompt_text == "v2"
```

---

### 3. `llm_service.py` — `tests/unit/test_llm_service.py`

`generate_response` has two concerns: **input validation** (testable without network calls) and **provider dispatch** (requires mocking).

#### Validation — no mock needed

| Parameter | Invalid value | Expected error |
|---|---|---|
| `temperature` | `2.1` | `ValueError: Temperature must be between 0.0 and 2.0` |
| `temperature` | `-0.1` | Same |
| `top_p` | `1.1` | `ValueError: Top-P must be between 0.0 and 1.0` |
| `max_tokens` | `0` | `ValueError: Max tokens must be between 1 and 8192` |
| `max_tokens` | `8193` | Same |

#### Provider dispatch — mock the provider

```python
import pytest
from unittest.mock import AsyncMock, patch
from promptlab.app import llm_service

@pytest.mark.asyncio
async def test_invalid_temperature_raises(db_session):
    with pytest.raises(ValueError, match="Temperature"):
        await llm_service.generate_response(
            db=db_session, system_prompt="s", user_prompt="u",
            temperature=3.0, top_p=0.9
        )

@pytest.mark.asyncio
async def test_generate_dispatches_to_provider(db_session, mocker):
    mock_provider = AsyncMock()
    mock_provider.generate.return_value = {
        "response": "hello", "tokens_used": 10,
        "input_tokens": 5, "output_tokens": 5,
        "latency_ms": 100, "model": "gpt-4o", "provider": "openai"
    }
    mock_provider.supported_models = ["gpt-4o"]
    mocker.patch(
        "promptlab.app.llm_service.get_default_provider",
        return_value=mock_provider
    )
    result = await llm_service.generate_response(
        db=db_session, system_prompt="sys", user_prompt="hello",
        temperature=0.7, top_p=0.9
    )
    assert result["response"] == "hello"
    mock_provider.generate.assert_called_once()
```

---

### 4. `schemas.py` — `tests/unit/test_schemas.py`

Pydantic models self-validate; only test non-obvious edge cases.

| Model | Case |
|---|---|
| `ProviderKeyUpdate` | `api_key` shorter than 10 chars → `ValidationError` |
| `ChatRequest` | `temperature` default is `0.7`; `provider_name` defaults to `None` |
| `PersonaCreate` | `system_prompt` is required — omitting it → `ValidationError` |
| `CompareRequest` | Both `config_a` and `config_b` are required |

---

## Integration Tests

Integration tests use the `client` fixture (FastAPI `TestClient` + in-memory DB). They verify the full request/response cycle including routing, dependency injection, and HTTP status codes.

### `test_personas_router.py`

| Endpoint | Test case |
|---|---|
| `GET /api/personas` | Returns empty list on fresh DB |
| `POST /api/personas` | 201 with persona + active_prompt in body |
| `GET /api/personas/{id}` | 404 for unknown ID |
| `PATCH /api/personas/{id}` | Partial update; unchanged fields preserved |
| `DELETE /api/personas/{id}` | 204; subsequent GET returns 404 |

### `test_chat_router.py`

The chat endpoint calls `llm_service.generate_response`, which calls a real LLM provider. Always mock the provider in tests.

```python
def test_chat_returns_response(client, mocker):
    # Create a persona first
    persona = client.post("/api/personas", json={
        "name": "Test", "domain": "Test",
        "system_prompt": "Be helpful."
    }).json()

    mocker.patch(
        "promptlab.app.routers.chat.llm_service.generate_response",
        return_value={
            "response": "Hi!", "tokens_used": 5,
            "input_tokens": 3, "output_tokens": 2,
            "latency_ms": 50, "model": "gpt-4o", "provider": "openai",
            "session_id": 1, "interaction_id": 1
        }
    )
    resp = client.post("/api/chat", json={
        "persona_id": persona["id"],
        "user_prompt": "Hello"
    })
    assert resp.status_code == 200
    assert resp.json()["response"] == "Hi!"

def test_chat_404_for_missing_persona(client):
    resp = client.post("/api/chat", json={
        "persona_id": 9999, "user_prompt": "Hello"
    })
    assert resp.status_code == 404
```

### `test_providers_router.py`

| Endpoint | Test case |
|---|---|
| `GET /api/providers` | Lists all seeded providers |
| `PUT /api/providers/{name}/key` | 200; key stored encrypted |
| `PUT /api/providers/{name}/key` | 422 if key shorter than 10 chars |
| `DELETE /api/providers/{name}/key` | Clears key; `has_key` becomes `false` |

---

## Mocking Strategy

| Dependency | How to mock | Why |
|---|---|---|
| LLM provider (`openai`, `anthropic`, etc.) | `mocker.patch("...llm_service.get_default_provider")` returning `AsyncMock` | Avoid live API calls and costs |
| Database | In-memory SQLite via `db_session` fixture + `dependency_overrides` | Isolated, fast, no cleanup |
| `security._CIPHER` | Not mocked — test encrypt/decrypt with the real auto-generated key | Key is generated fresh per process; no env needed |
| `time.perf_counter` | Mock only if testing exact latency values (rarely needed) | Normally not worth mocking |

---

## What Not to Unit Test

| Item | Reason |
|---|---|
| SQLAlchemy model definitions (`models.py`) | ORM mapping is verified by the DB fixture; no separate test needed |
| Tailwind/frontend JS | Out of scope for Python unit tests |
| Provider implementation details (OpenAI token counting) | Third-party SDK responsibility; mock at the `generate()` boundary |
| Fernet key generation side-effects | Covered indirectly by `test_security.py` round-trip |

---

## Running Tests

```bash
# All tests
pytest tests/

# Unit tests only (fast, no network)
pytest tests/unit/

# Single file
pytest tests/unit/test_crud.py -v

# With coverage
pytest tests/ --cov=promptlab --cov-report=term-missing
```

---

## Priority Order

| Phase | Focus | Value |
|---|---|---|
| 1 | `security.py` | Highest — crypto bugs are silent and hard to detect |
| 2 | `crud.py` | High — data correctness is the foundation of everything |
| 3 | `llm_service.py` validation | Medium — catches bad inputs before they reach providers |
| 4 | Router integration tests | Medium — verifies HTTP contracts and error codes |
| 5 | Schema edge cases | Low — Pydantic handles most of this; only test non-obvious constraints |
