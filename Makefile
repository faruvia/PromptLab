.PHONY: install run dev clean reset seed lint help

# ── Python / venv helpers ────────────────────────────────────────────────────
VENV     := .venv
PYTHON   := $(VENV)/bin/python
PIP      := $(VENV)/bin/pip
UVICORN  := $(VENV)/bin/uvicorn
APP      := promptlab.app.main:app
PORT     := 8000

# ── Default target ───────────────────────────────────────────────────────────
help:
	@echo ""
	@echo "  PromptLab — available targets"
	@echo ""
	@echo "  make install   Create .venv and install dependencies"
	@echo "  make run       Start the server on port $(PORT)"
	@echo "  make dev       Same as run (alias)"
	@echo "  make seed      Drop and reseed the database"
	@echo "  make reset     Delete the database (restart app to reseed)"
	@echo "  make clean     Remove Python cache files"
	@echo "  make lint      Run ruff linter (install separately if needed)"
	@echo ""

# ── Setup ────────────────────────────────────────────────────────────────────
install:
	python -m venv $(VENV)
	$(PIP) install --upgrade pip
	$(PIP) install -r requirements.txt
	@echo ""
	@echo "  Done. Run 'make run' to start PromptLab."

# ── Run ──────────────────────────────────────────────────────────────────────
run:
	$(UVICORN) $(APP) --reload --port $(PORT)

dev: run

# ── Database ─────────────────────────────────────────────────────────────────
seed:
	rm -f data/promptlab.db
	$(PYTHON) -c "from promptlab.app.database import init_db; init_db()"
	@echo "Database reseeded with 8 personas and 3 provider records."

reset:
	rm -f data/promptlab.db
	@echo "Database removed. Restart the app (make run) to reseed automatically."

# ── Code quality ─────────────────────────────────────────────────────────────
lint:
	$(VENV)/bin/ruff check promptlab/

# ── Clean ────────────────────────────────────────────────────────────────────
clean:
	find . -type d -name __pycache__ -not -path './.venv/*' -exec rm -rf {} + 2>/dev/null || true
	find . -type f -name '*.pyc'     -not -path './.venv/*' -delete 2>/dev/null || true
	rm -rf .pytest_cache .mypy_cache .ruff_cache
	@echo "Cache files removed."
