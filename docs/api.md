# PromptLab API Reference

Base URL: `http://localhost:8000/api`  
Interactive docs: `http://localhost:8000/docs`

---

## Health

### `GET /api/health`
Returns server status and the number of configured (enabled) providers.

**Response**
```json
{ "status": "ok", "version": "1.0.0", "providers_configured": 2 }
```

---

## Personas

A **persona** is a named AI role with default generation parameters and a versioned system prompt.

### `GET /api/personas`
List all personas with their active system prompt.

**Response** `PersonaOut[]`

---

### `GET /api/personas/{persona_id}`
Get a single persona by ID.

**Response** `PersonaOut` | `404`

---

### `POST /api/personas`
Create a persona and its first system prompt.

**Request body**
| Field | Type | Default | Notes |
|---|---|---|---|
| `name` | string | — | required |
| `domain` | string | — | required |
| `description` | string | `""` | |
| `icon` | string | `"🤖"` | |
| `default_temperature` | float | `0.7` | |
| `default_top_p` | float | `0.9` | |
| `default_max_tokens` | int | `1024` | |
| `system_prompt` | string | — | required; becomes version 1 |

**Response** `201 PersonaOut`

---

### `PUT /api/personas/{persona_id}`
Update persona metadata (not the system prompt).  All fields optional.

**Request body** — any subset of `PersonaUpdate` fields (same as create minus `system_prompt`).

**Response** `PersonaOut` | `404`

---

### `PUT /api/personas/{persona_id}/prompt`
Save a new system prompt version for the persona. Deactivates all previous versions.

**Request body**
```json
{ "prompt_text": "You are a ..." }
```

**Response** `201 SystemPromptOut`

---

## Chat

### `POST /api/chat`
Send a single prompt to an LLM and persist the session + interaction.

**Request body**
| Field | Type | Default | Notes |
|---|---|---|---|
| `persona_id` | int | — | required |
| `user_prompt` | string | — | required |
| `temperature` | float | `0.7` | 0.0 – 2.0 |
| `top_p` | float | `0.9` | 0.0 – 1.0 |
| `max_tokens` | int | `1024` | 1 – 8192 |
| `system_prompt` | string | `null` | overrides persona's active prompt |
| `provider_name` | string | `null` | `null` → default provider |
| `model` | string | `null` | `null` → provider's default model |
| `reasoning_effort` | string | `null` | `"low"` \| `"medium"` \| `"high"` (reasoning models only) |

**Response** `ChatResponse`
```json
{
  "response": "...",
  "tokens_used": 312,
  "input_tokens": 80,
  "output_tokens": 232,
  "latency_ms": 1450,
  "provider": "anthropic",
  "model": "claude-sonnet-4-6",
  "interaction_id": 7,
  "session_id": 4
}
```

---

### `POST /api/compare`
Run two LLM configurations against the same prompt **concurrently** and return both results side-by-side.

**Request body**
```json
{
  "user_prompt": "Explain recursion",
  "config_a": { "persona_id": 1, "temperature": 0.7, "top_p": 0.9, "provider_name": "anthropic" },
  "config_b": { "persona_id": 1, "temperature": 1.0, "top_p": 0.9, "provider_name": "openai" }
}
```
Each `config_a` / `config_b` accepts the same fields as `CompareConfig`: `persona_id`, `temperature`, `top_p`, `max_tokens`, `system_prompt`, `provider_name`, `model`, `reasoning_effort`.

**Response** `CompareResponse` — all fields are nullable; `error_a` / `error_b` are set if one side failed.

---

## Sessions

A **session** is created automatically by `POST /api/chat`. Each session holds one or more interactions.

### `GET /api/sessions`
List all sessions (newest first) with interaction count.

**Response** `SessionSummary[]`

---

### `GET /api/sessions/{session_id}`
Full session detail including all interactions.

**Response** `SessionDetail` | `404`

---

### `DELETE /api/sessions/{session_id}`
Delete a session and its interactions.

**Response** `204 No Content` | `404`

---

## Providers

Providers are pre-seeded (`anthropic`, `openai`, `huggingface`). You cannot create or delete them — only configure their API key and default model.

### `GET /api/providers`
List all providers. API keys are never returned; a masked preview (`sk-...XXXX`) is included when a key is set.

**Response** `ProviderConfigResponse[]`

---

### `GET /api/providers/{provider_name}`
Get a single provider's config.

**Response** `ProviderConfigResponse` | `404`

---

### `PUT /api/providers/{provider_name}/key`
Set (or replace) the API key for a provider. Immediately tests the connection and returns the result. Auto-promotes to default provider if no default exists yet.

**Request body**
```json
{ "api_key": "sk-..." }
```

**Response** `ProviderTestResponse`
```json
{ "success": true, "message": "Connection successful", "latency_ms": 340 }
```

---

### `DELETE /api/providers/{provider_name}/key`
Remove the API key and disable the provider. Clears its default status if set.

**Response** `{ "success": true }`

---

### `PUT /api/providers/{provider_name}/default`
Promote a provider to the default. Only works if the provider has a key configured.

**Response** `{ "success": true, "default_provider": "anthropic" }`

---

### `PUT /api/providers/{provider_name}/model`
Update the provider's default model.

**Request body**
```json
{ "default_model": "claude-opus-4-8" }
```

**Response** `{ "success": true }`

---

### `POST /api/providers/{provider_name}/test`
Test the provider's current API key without changing anything.

**Response** `ProviderTestResponse`

---

## Internal Functions

### `llm_service.py`

| Function | Description |
|---|---|
| `generate_response(db, system_prompt, user_prompt, temperature, top_p, max_tokens, provider_name, model, reasoning_effort)` | Validates parameters, resolves provider and model, delegates to the provider's `generate()`, returns a result dict with `response`, `tokens_used`, `input_tokens`, `output_tokens`, `latency_ms`, `provider`, `model`. |
| `test_provider_connection(db, provider_name)` | Loads the provider and calls `validate_api_key()`. Returns `ProviderTestResponse` dict. |

### `crud.py`

| Function | Description |
|---|---|
| `get_personas_with_prompts(db)` | Returns all personas with their active system prompt attached. |
| `get_persona_with_prompt(db, persona_id)` | Single persona + active prompt, or `None`. |
| `create_persona_with_prompt(db, persona)` | Creates the persona row and its first `SystemPrompt` (version 1, active) in one transaction. |
| `update_persona(db, persona_id, update)` | Partial-updates persona metadata fields; leaves system prompt untouched. |
| `delete_persona(db, persona_id)` | Deletes persona and cascades to its prompts/sessions. |
| `get_active_system_prompt(db, persona_id)` | Returns the highest-version `is_active=True` prompt for a persona. |
| `create_system_prompt_version(db, persona_id, prompt_text)` | Deactivates all existing prompts, inserts a new version with `is_active=True`. |
| `get_recent_sessions(db)` | Returns all sessions newest-first, each enriched with persona name and interaction count. |
| `get_session_detail(db, session_id)` | Returns a session with its full ordered list of interactions. |
| `create_chat_session(db, data)` | Inserts a new `Session` row from a plain dict. |
| `delete_session(db, session_id)` | Deletes session (and cascades to interactions). |
| `create_interaction(db, data)` | Inserts an `Interaction` row linked to a session. |
| `set_provider_api_key(db, provider_name, plaintext_key)` | Encrypts and stores the key, enables the provider, auto-sets as default if none exists. |
| `remove_provider_api_key(db, provider_name)` | Clears the key, disables the provider, removes default status. |
| `set_default_provider(db, provider_name)` | Clears all defaults then marks the given provider as default. Raises if not enabled. |
| `update_provider_model(db, provider_name, default_model)` | Updates the `default_model` field on the provider config. |
| `get_provider_config_safe(db, provider_name)` | Returns provider config as a dict with the key masked (`key_preview`) — never returns the raw key. |
| `list_providers_safe(db)` | Calls `get_provider_config_safe` for every provider row. |
