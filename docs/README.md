# 🧪 PromptLab

An educational web app to explore how **system prompts**, **temperature**, and **top-p**
shape LLM behavior across different expert personas and AI providers.

---

## Features

- **8 expert personas** — Financial Advisor, Business Attorney, Marketing Copywriter,
  Medical Information Assistant, Creative Writing Coach, Data Analyst, Customer Support
  Agent, and Code Reviewer — each pre-loaded with a carefully crafted system prompt and
  sensible parameter defaults
- **Multi-provider support** — OpenAI (fully implemented), Anthropic and HuggingFace
  (stubs ready for community contributions)
- **Encrypted local API key storage** — keys are stored with Fernet (AES-128) and never
  committed to Git; each developer keeps their own keys locally
- **Side-by-side comparison mode** — run the same prompt against two different temperature/
  top-p configurations (or two different providers) in parallel
- **Real-time educational explanations** — the right sidebar updates as you drag the
  sliders, explaining what each parameter value means and when to use it
- **Session history** — every chat is persisted with token counts and latency, visible
  in the left sidebar

---

## Tech Stack

| Layer      | Technology                                  |
|------------|---------------------------------------------|
| Backend    | Python 3.10+, FastAPI, SQLAlchemy 2, SQLite |
| Frontend   | Vanilla JS, Tailwind CSS CDN v3             |
| Markdown   | marked.js + highlight.js (github-dark)       |
| Encryption | cryptography (Fernet / AES-128)             |
| LLM APIs   | OpenAI SDK, anthropic SDK, huggingface_hub  |

---

## Prerequisites

- Python 3.10 or higher
- An OpenAI API key (free tier works; or any supported provider)

---

## Setup

```bash
git clone <your-repo-url>
cd PromptLab

# Create and activate a virtual environment
python -m venv .venv
source .venv/bin/activate        # macOS / Linux
# .venv\Scripts\Activate.ps1    # Windows PowerShell
# .venv\Scripts\activate.bat    # Windows cmd

pip install -r requirements.txt

# Start the app — FERNET_KEY auto-generates on first run
uvicorn promptlab.app.main:app --reload

# Open in browser
open http://localhost:8000       # macOS
# start http://localhost:8000   # Windows
```

On first launch, open the **⚙️ Settings** modal and add your OpenAI API key.
The app auto-seeds 8 personas and 3 provider records on startup.

> **Shortcut:** `make install && make run`

---

## Security & API Keys

PromptLab stores API keys encrypted using Fernet (AES-128):

- On first launch it generates a unique `FERNET_KEY` and saves it to `.env`
- Keys added through the Settings UI are encrypted before writing to SQLite
- Neither `.env` nor `data/promptlab.db` are committed to Git (see `.gitignore`)
- Every developer / user keeps their own independent local keys

**If you lose `.env`:** Stored API keys cannot be recovered — Fernet decryption requires
the original key. Delete `data/promptlab.db`, restart the app (a new key is generated),
and re-enter your API keys.

**For teams:** Each developer runs the app locally with their own keys. There is no shared
secret and nothing sensitive should ever be committed.

---

## Project Structure

```
PromptLab/
├── promptlab/
│   └── app/
│       ├── main.py                      FastAPI entry point + health endpoint
│       ├── database.py                  SQLAlchemy engine, session, seeding
│       ├── models.py                    ORM models (Persona, SystemPrompt, Session, …)
│       ├── schemas.py                   Pydantic v2 request / response schemas
│       ├── crud.py                      All database operations
│       ├── security.py                  Fernet encryption helpers
│       ├── llm_service.py               Provider dispatcher + response normaliser
│       └── routers/
│           ├── personas.py
│           ├── chat.py                  /api/chat  and  /api/compare
│           ├── sessions.py
│           └── providers.py
├── static/
│   ├── index.html                       Single-page UI
│   ├── app.js                           All frontend logic (~1 200 lines, no framework)
│   └── styles.css                       Tailwind supplement (sliders, animations, toasts)
├── data/                                SQLite DB — gitignored
├── requirements.txt
├── Makefile
└── .gitignore
```

---

## How to Use

1. **Add an API key** via the ⚙️ Settings modal (top-right)
2. **Pick an expert persona** from the left sidebar — the system prompt and default
   parameters load automatically
3. **Adjust temperature and top-p** — the right panel explains the effect in plain English
4. **Send a prompt** and observe how the parameters shape the response
5. **Try a preset example** — the dropdown above the input loads ready-made prompts
6. **Toggle Compare Mode** to run the same prompt against two different configurations
   simultaneously; click **🔬 Demo Compare** to auto-load a precision-vs-creativity demo
7. **Browse session history** in the left sidebar to revisit past chats

---

## Contributing

Community contributions are welcome, especially provider implementations.

### Adding a new provider

1. Copy `promptlab/app/providers/openai_provider.py` as a starting point
2. Implement the abstract methods in `base.py` (`generate`, `test_connection`)
3. Register the new class in `registry.py`
4. Add a card to `static/index.html` following the OpenAI card pattern
5. Add model names to `KNOWN_MODELS` in `static/app.js`

The Anthropic and HuggingFace stubs (`anthropic_provider.py`,
`huggingface_provider.py`) already contain TODO comments to guide you.

---

## API Reference

Interactive docs are at **http://localhost:8000/docs** (Swagger UI) and
**http://localhost:8000/redoc** (ReDoc).

| Method | Path                                | Description                       |
|--------|-------------------------------------|-----------------------------------|
| GET    | `/api/health`                       | Health check + providers count    |
| GET    | `/api/personas`                     | List all personas                 |
| GET    | `/api/personas/{id}`                | Get persona with active prompt    |
| POST   | `/api/personas`                     | Create persona                    |
| PUT    | `/api/personas/{id}/prompt`         | Save new prompt version           |
| GET    | `/api/sessions`                     | List recent sessions              |
| GET    | `/api/sessions/{id}`                | Session detail with interactions  |
| DELETE | `/api/sessions/{id}`                | Delete a session                  |
| POST   | `/api/chat`                         | Send a prompt, get a response     |
| POST   | `/api/compare`                      | Run two configs in parallel       |
| GET    | `/api/providers`                    | List provider configs             |
| PUT    | `/api/providers/{name}/key`         | Save / update an API key          |
| DELETE | `/api/providers/{name}/key`         | Remove a stored key               |
| PUT    | `/api/providers/{name}/default`     | Set as default provider           |
| PUT    | `/api/providers/{name}/model`       | Change default model              |
| POST   | `/api/providers/{name}/test`        | Test the saved connection         |

---

## Pre-push Checklist

Before pushing to GitHub, verify no secrets are leaking:

```bash
# 1. Confirm .env and data/ are NOT tracked
git status

# 2. Both should print as ignored
git check-ignore -v .env data/promptlab.db

# 3. Should return nothing (no API keys in source)
grep -r "sk-" --include="*.py" --include="*.js" --include="*.html" .

# 4. Hit the health endpoint
curl http://localhost:8000/api/health
# → {"status":"ok","version":"1.0.0","providers_configured":1}

# 5. Full smoke test
#    Add key → select persona → send prompt → verify response + token count
```

---

## License

MIT
