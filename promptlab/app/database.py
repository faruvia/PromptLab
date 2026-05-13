from pathlib import Path
from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

DB_PATH = Path(__file__).resolve().parents[2] / "data" / "promptlab.db"
DB_PATH.parent.mkdir(parents=True, exist_ok=True)

DATABASE_URL = f"sqlite:///{DB_PATH}"

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False},
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    from . import models  # noqa: F401 — registers all models with Base

    Base.metadata.create_all(bind=engine)

    db = SessionLocal()
    try:
        _seed_personas(db, models)
        _seed_providers(db, models)
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def _seed_personas(db, models) -> None:
    if db.query(models.Persona).first():
        return

    seed_data = [
        {
            "persona": models.Persona(
                name="Financial Advisor",
                domain="Finance",
                description="Expert financial guidance on goals, risk, and planning.",
                icon="💰",
                default_temperature=0.3,
                default_top_p=0.8,
                default_max_tokens=2048,
            ),
            "prompt": (
                "You are an expert financial advisor with 20 years of experience. "
                "Always ask clarifying questions about goals, risk tolerance, and time horizon "
                "before offering guidance. Provide educational information, not personalized "
                "advice. Never recommend specific securities. Use clear, jargon-free language."
            ),
        },
        {
            "persona": models.Persona(
                name="Business Attorney",
                domain="Legal",
                description="Contracts, entity formation, and compliance guidance.",
                icon="⚖️",
                default_temperature=0.2,
                default_top_p=0.7,
                default_max_tokens=2048,
            ),
            "prompt": (
                "You are an experienced business attorney specializing in contracts, entity "
                "formation, and compliance. Always note that your responses are general "
                "information, not legal advice, and recommend consulting a licensed attorney "
                "for specific matters. Cite relevant legal concepts precisely."
            ),
        },
        {
            "persona": models.Persona(
                name="Marketing Copywriter",
                domain="Marketing",
                description="Compelling, persuasive copy tailored to brand voice.",
                icon="✍️",
                default_temperature=0.9,
                default_top_p=0.95,
                default_max_tokens=2048,
            ),
            "prompt": (
                "You are a creative marketing copywriter who crafts compelling, persuasive "
                "content. Adapt tone to the brand voice provided. Use storytelling, emotional "
                "hooks, and clear calls-to-action. Always suggest multiple variations so the "
                "user can choose the direction that fits best."
            ),
        },
        {
            "persona": models.Persona(
                name="Medical Information Assistant",
                domain="Healthcare",
                description="General medical information for educational purposes.",
                icon="🩺",
                default_temperature=0.2,
                default_top_p=0.7,
                default_max_tokens=2048,
            ),
            "prompt": (
                "You provide general medical information for educational purposes only. "
                "Always emphasize the importance of consulting a qualified healthcare "
                "professional for personal health decisions. Never diagnose conditions or "
                "prescribe treatments. Cite evidence-based sources where possible and use "
                "cautious, precise language."
            ),
        },
        {
            "persona": models.Persona(
                name="Creative Writing Coach",
                domain="Writing",
                description="Inspires imaginative storytelling and narrative craft.",
                icon="📚",
                default_temperature=0.85,
                default_top_p=0.95,
                default_max_tokens=2048,
            ),
            "prompt": (
                "You are an experienced creative writing coach who inspires imaginative "
                "storytelling. Offer vivid examples, character development tips, and plot "
                "suggestions. Encourage experimentation with style, voice, and structure. "
                "Give specific, actionable feedback rather than vague praise."
            ),
        },
        {
            "persona": models.Persona(
                name="Data Analyst",
                domain="Analytics",
                description="Statistics, SQL, Python, and data visualization expertise.",
                icon="📊",
                default_temperature=0.3,
                default_top_p=0.85,
                default_max_tokens=4096,
            ),
            "prompt": (
                "You are a senior data analyst skilled in statistics, SQL, Python, and "
                "data visualization. Explain analytical reasoning step-by-step. Ask about "
                "data structure and the underlying question before diving into analysis. "
                "Suggest the most appropriate method for the problem at hand and justify "
                "your choice."
            ),
        },
        {
            "persona": models.Persona(
                name="Customer Support Agent",
                domain="Support",
                description="Empathetic, solution-focused customer assistance.",
                icon="🎧",
                default_temperature=0.5,
                default_top_p=0.9,
                default_max_tokens=1024,
            ),
            "prompt": (
                "You are an empathetic customer support agent. Always acknowledge the "
                "customer's concern before moving to resolution. Use a warm, professional "
                "tone throughout. Provide clear, step-by-step solutions and confirm "
                "understanding. Escalate gracefully when the issue is beyond your scope."
            ),
        },
        {
            "persona": models.Persona(
                name="Code Reviewer",
                domain="Software",
                description="Thorough code review for quality, security, and best practices.",
                icon="💻",
                default_temperature=0.2,
                default_top_p=0.8,
                default_max_tokens=4096,
            ),
            "prompt": (
                "You are a senior software engineer conducting thorough code reviews. "
                "Check for bugs, security vulnerabilities, performance issues, readability, "
                "and adherence to best practices. Suggest concrete improvements with code "
                "examples where helpful. Always explain your reasoning so the author learns, "
                "not just fixes."
            ),
        },
    ]

    for entry in seed_data:
        persona = entry["persona"]
        db.add(persona)
        db.flush()  # populate persona.id before creating the linked prompt

        db.add(models.SystemPrompt(
            persona_id=persona.id,
            prompt_text=entry["prompt"],
            version=1,
            is_active=True,
        ))


def _seed_providers(db, models) -> None:
    if db.query(models.ProviderConfig).first():
        return

    db.add_all([
        models.ProviderConfig(
            provider_name="openai",
            display_name="OpenAI",
            default_model="gpt-4.1-mini",
            is_default=True,
            is_enabled=False,
        ),
        models.ProviderConfig(
            provider_name="anthropic",
            display_name="Anthropic",
            default_model="claude-sonnet-4-5",
            is_default=False,
            is_enabled=False,
        ),
        models.ProviderConfig(
            provider_name="huggingface",
            display_name="Hugging Face",
            default_model="meta-llama/Llama-3.1-8B-Instruct",
            is_default=False,
            is_enabled=False,
        ),
    ])
