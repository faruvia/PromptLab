# PromptLab — Architecture

## Purpose

PromptLab is a web application for exploring how system prompts, temperature, and top-p parameters shape LLM behaviour across different expert personas and AI providers. It provides a single-chat mode and a side-by-side comparison mode.

---

## High-Level Architecture

```
Browser (Vanilla JS + Tailwind CSS)
         │  HTTP/JSON
         ▼
FastAPI ASGI App  (promptlab/app/main.py)
  ├── /static          → serves static/index.html + assets
  ├── /api/personas    → personas router
  ├── /api/chat        → chat + compare router
  ├── /api/sessions    → sessions router
  └── /api/providers   → providers router
         │
         ├── crud.py          (data access layer)
         ├── llm_service.py   (orchestration + validation)
         ├── security.py      (Fernet encryption)
         └── providers/
               ├── base.py         (abstract LLMProvider)
               ├── registry.py     (name → class lookup)
               ├── openai_provider.py
               ├── anthropic_provider.py
               └── huggingface_provider.py
         │
         ▼
SQLite  (data/promptlab.db via SQLAlchemy 2)
```

---

## Layered Design

The backend follows a strict four-layer separation:

| Layer | File(s) | Responsibility |
|---|---|---|
| **Router** | `routers/*.py` | HTTP routing, request validation, HTTP error mapping |
| **Service** | `llm_service.py` | Business logic — parameter validation, provider dispatch, timing |
| **Data access** | `crud.py` | All SQLAlchemy queries; no HTTP or provider knowledge |
| **Persistence** | `models.py`, `database.py` | ORM model definitions, engine, session factory, seed data |

No layer skips another — routers never query the DB directly, and `crud.py` never calls LLM providers.

---

## Frontend

Single-page application served from `static/`:

| File | Role |
|---|---|
| `static/index.html` | Shell HTML — nav, tab panels, modal containers |
| `static/app.js` | All interactivity — fetch calls, DOM updates, state |
| `static/styles.css` | Custom CSS on top of Tailwind CDN |

The frontend has no build step. All JS is vanilla ES2022 modules loaded directly by the browser.

---

## Data Model

```
Persona (1) ──────────── (many) SystemPrompt
   │                              version: int
   │                              is_active: bool   ← only one true at a time
   │
   └── (many) Session
                 temperature, top_p, max_tokens
                 model_name, provider_name
                 │
                 └── (many) Interaction
                               user_prompt
                               response
                               tokens_used, latency_ms

ProviderConfig  (independent)
  provider_name, display_name
  encrypted_api_key  ← Fernet-encrypted at rest
  default_model
  is_default, is_enabled
```

### Key Relationships

- **Persona → SystemPrompt** — one-to-many, versioned. Only one version is `is_active=True` at a time. `create_system_prompt_version` deactivates all prior versions before inserting a new one. Cascade-deletes on persona delete.
- **Persona → Session** — sessions record the exact parameters used at the time of the chat (immutable snapshot). Persona deletion sets `persona_id` to `NULL` on sessions (preserves history).
- **Session → Interaction** — each session can have multiple turns. Ordered by `id`.
- **ProviderConfig** — independent of personas/sessions. Stores one row per provider, seeded on first startup.

---

## Provider System

### Abstract Base (`providers/base.py`)

```
LLMProvider (ABC)
  ├── provider_name: str     (class attribute)
  ├── display_name: str
  ├── supported_models: list[str]
  ├── generate(system_prompt, user_prompt, temperature, top_p,
  │            max_tokens, model, reasoning_effort) → dict
  └── validate_api_key() → bool
```

All providers implement the same two async methods. The return dict from `generate()` always has the shape: `{response, tokens_used, input_tokens, output_tokens, latency_ms, model, provider}`.

### Registry (`providers/registry.py`)

```python
PROVIDER_REGISTRY = {
    "openai":      OpenAIProvider,
    "anthropic":   AnthropicProvider,
    "huggingface": HuggingFaceProvider,
}
```

`get_provider(name, db)` looks up the registry, fetches the encrypted key from the DB, decrypts it, and instantiates the concrete class. `get_default_provider(db)` finds the row where `is_default=True` and `is_enabled=True`, then delegates to `get_provider`.

### Provider Status

| Provider | Implementation | Notes |
|---|---|---|
| OpenAI | Full | Handles standard + reasoning models (`o`-series, `gpt-5.x`) via `reasoning_effort` |
| Anthropic | Stub | `generate()` raises `NotImplementedError` |
| Hugging Face | Stub | `generate()` raises `NotImplementedError` |

---

## Request Flows

### Single Chat — `POST /api/chat`

```
Client
  → POST /api/chat  {persona_id, user_prompt, temperature, top_p, ...}
  → chat router
      ├── crud.get_persona(db, persona_id)           → 404 if missing
      ├── crud.get_active_system_prompt(db, ...)     → 404 if none
      └── llm_service.generate_response(...)
            ├── validate temperature / top_p / max_tokens
            ├── get_provider / get_default_provider
            └── provider.generate(...)               → LLM API call
      ├── crud.create_chat_session(db, {...})        → persists session
      └── crud.create_interaction(db, {...})         → persists turn
  ← ChatResponse {response, tokens_used, latency_ms, model, provider, ...}
```

### Side-by-Side Compare — `POST /api/compare`

The compare endpoint runs both configurations **concurrently** using `asyncio.gather`. Each configuration gets its own dedicated SQLAlchemy session (`SessionLocal()`) to avoid shared state between concurrent tasks.

```
POST /api/compare  {user_prompt, config_a, config_b}
  → asyncio.gather(run_config(config_a), run_config(config_b))
       config_a ─── own_db_a ─── provider_a.generate()
       config_b ─── own_db_b ─── provider_b.generate()
  ← CompareResponse  {response_a, response_b, latency_a, latency_b, ...}
      partial failures allowed: one panel can succeed while the other errors
```

---

## Security

### API Key Encryption (`security.py`)

Provider API keys are encrypted with **Fernet (AES-128-CBC + HMAC-SHA256)** before storage. The encryption key (`FERNET_KEY`) is:

1. Read from `.env` on startup.
2. Auto-generated and written to `.env` if absent.
3. Never logged — a `SecretsFilter` on the root logger redacts `sk-...` and `hf_...` patterns from all log output.

```
User enters API key
  → security.encrypt_api_key(plaintext)  → ciphertext
  → stored in ProviderConfig.encrypted_api_key

Provider instantiation
  → security.decrypt_api_key(ciphertext) → plaintext
  → passed to provider constructor
  → never stored in memory beyond the request
```

### Logging Redaction (`main.py` — `SecretsFilter`)

The `SecretsFilter` strips three patterns from every log record before it is written:
- `sk-<20+ chars>` → `sk-***REDACTED***`
- `hf_<20+ chars>` → `hf_***REDACTED***`
- `"api_key": "..."` → `"api_key":"***REDACTED***"`

---

## Startup Sequence

```
uvicorn starts → FastAPI app created
  → CORSMiddleware registered (allow_origins=["*"])
  → 4 routers mounted under /api
  → /static mounted
  → @app.on_event("startup") fires
      → init_db()
          → Base.metadata.create_all(engine)   (creates tables)
          → _seed_personas()     (8 personas, skipped if any exist)
          → _seed_providers()    (3 providers, skipped if any exist)
```

**Seed personas** (8 total):

| Persona | Domain | Temperature | Top-P |
|---|---|---|---|
| Financial Advisor | Finance | 0.3 | 0.8 |
| Business Attorney | Legal | 0.2 | 0.7 |
| Marketing Copywriter | Marketing | 0.9 | 0.95 |
| Medical Information Assistant | Healthcare | 0.2 | 0.7 |
| Creative Writing Coach | Writing | 0.85 | 0.95 |
| Data Analyst | Analytics | 0.3 | 0.85 |
| Customer Support Agent | Support | 0.5 | 0.9 |
| Code Reviewer | Software | 0.2 | 0.8 |

---

## Database

| Detail | Value |
|---|---|
| Engine | SQLite |
| File path | `data/promptlab.db` (created on startup) |
| ORM | SQLAlchemy 2 with `Mapped` + `mapped_column` typed annotations |
| Session lifecycle | One session per request via `get_db()` FastAPI dependency; closed in `finally` |
| Compare exception | Two independent sessions opened per `asyncio.gather` task to prevent concurrent access conflicts |

---

## API Surface

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/health` | Liveness check + enabled provider count |
| `GET` | `/api/personas` | List all personas with active prompt |
| `POST` | `/api/personas` | Create persona + initial system prompt |
| `GET` | `/api/personas/{id}` | Get single persona |
| `PUT` | `/api/personas/{id}` | Partial update persona fields |
| `PUT` | `/api/personas/{id}/prompt` | Create new versioned system prompt |
| `POST` | `/api/chat` | Single chat turn |
| `POST` | `/api/compare` | Concurrent two-config comparison |
| `GET` | `/api/sessions` | List sessions (newest first) |
| `GET` | `/api/sessions/{id}` | Session detail with interactions |
| `DELETE` | `/api/sessions/{id}` | Delete session + interactions |
| `GET` | `/api/providers` | List all providers (no key values) |
| `GET` | `/api/providers/{name}` | Single provider config |
| `PUT` | `/api/providers/{name}/key` | Set API key (encrypts + validates) |
| `DELETE` | `/api/providers/{name}/key` | Remove API key |
| `PUT` | `/api/providers/{name}/default` | Set as default provider |
| `PUT` | `/api/providers/{name}/model` | Set default model |
| `POST` | `/api/providers/{name}/test` | Test connection |

---

## Adding a New Provider

1. Create `promptlab/app/providers/<name>_provider.py` extending `LLMProvider`.
2. Implement `generate()` and `validate_api_key()`.
3. Add `"<name>": <ClassName>` to `PROVIDER_REGISTRY` in `providers/registry.py`.
4. Add a seed row in `_seed_providers()` in `database.py` (only applies to fresh databases — existing databases need a migration or manual insert).

---

## File Reference

```
PromptLab/
├── promptlab/
│   └── app/
│       ├── main.py              ← FastAPI app, middleware, router registration
│       ├── database.py          ← Engine, session factory, init_db, seed data
│       ├── models.py            ← SQLAlchemy ORM models (Persona, Session, etc.)
│       ├── schemas.py           ← Pydantic request/response models
│       ├── crud.py              ← All database queries
│       ├── llm_service.py       ← Provider dispatch, parameter validation
│       ├── security.py          ← Fernet encrypt/decrypt, key masking
│       └── providers/
│           ├── base.py          ← LLMProvider abstract class
│           ├── registry.py      ← Provider lookup + instantiation
│           ├── openai_provider.py
│           ├── anthropic_provider.py
│           └── huggingface_provider.py
├── static/
│   ├── index.html               ← SPA shell
│   ├── app.js                   ← All frontend logic
│   └── styles.css               ← Custom CSS
├── data/
│   └── promptlab.db             ← SQLite database (gitignored)
├── docs/                        ← All project documentation
├── CLAUDE.md                    ← Project conventions for Claude Code
└── requirements.txt             ← Python dependencies
```
