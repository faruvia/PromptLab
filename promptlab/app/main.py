import logging
import re
from pathlib import Path

from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from .database import init_db, get_db
from .routers import personas, chat, sessions, providers


class SecretsFilter(logging.Filter):
    _PATTERNS = [
        (re.compile(r"sk-[A-Za-z0-9_\-]{20,}"), "sk-***REDACTED***"),
        (re.compile(r"hf_[A-Za-z0-9]{20,}"), "hf_***REDACTED***"),
        (re.compile(r'"api_key"\s*:\s*"[^"]+"'), '"api_key":"***REDACTED***"'),
    ]

    def filter(self, record: logging.LogRecord) -> bool:
        msg = str(record.getMessage())
        for pattern, replacement in self._PATTERNS:
            msg = pattern.sub(replacement, msg)
        record.msg = msg
        record.args = ()
        return True


logging.basicConfig(level=logging.INFO)
logging.getLogger().addFilter(SecretsFilter())

app = FastAPI(title="PromptLab", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(personas.router, prefix="/api")
app.include_router(chat.router, prefix="/api")
app.include_router(sessions.router, prefix="/api")
app.include_router(providers.router, prefix="/api")

STATIC_DIR = Path(__file__).resolve().parents[2] / "static"
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.on_event("startup")
def startup() -> None:
    init_db()


@app.get("/")
def root():
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/api/health")
def health(db: Session = Depends(get_db)):
    from . import models
    configured = db.query(models.ProviderConfig).filter_by(is_enabled=True).count()
    return {"status": "ok", "version": "1.0.0", "providers_configured": configured}
