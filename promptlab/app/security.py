import os
from pathlib import Path
from cryptography.fernet import Fernet, InvalidToken
from dotenv import load_dotenv, set_key

PROJECT_ROOT = Path(__file__).resolve().parents[2]
ENV_PATH = PROJECT_ROOT / ".env"


def _ensure_env_file() -> None:
    if not ENV_PATH.exists():
        example = PROJECT_ROOT / ".env.example"
        ENV_PATH.write_text(example.read_text() if example.exists() else "FERNET_KEY=\n")


def _get_or_create_fernet_key() -> bytes:
    _ensure_env_file()
    load_dotenv(ENV_PATH)
    key_str = os.getenv("FERNET_KEY", "").strip()
    if not key_str:
        new_key = Fernet.generate_key().decode()
        set_key(str(ENV_PATH), "FERNET_KEY", new_key)
        print("\n" + "=" * 70)
        print("[PromptLab] Generated new FERNET_KEY and saved to .env")
        print("KEEP .env SAFE — without it, stored API keys cannot be decrypted.")
        print("NEVER commit .env to version control.")
        print("=" * 70 + "\n")
        return new_key.encode()
    return key_str.encode()


_CIPHER = Fernet(_get_or_create_fernet_key())


def encrypt_api_key(plaintext: str) -> str:
    if not plaintext:
        raise ValueError("Cannot encrypt empty string")
    return _CIPHER.encrypt(plaintext.encode()).decode()


def decrypt_api_key(ciphertext: str) -> str:
    if not ciphertext:
        raise ValueError("Cannot decrypt empty string")
    try:
        return _CIPHER.decrypt(ciphertext.encode()).decode()
    except InvalidToken:
        raise ValueError("FERNET_KEY mismatch. Re-enter your API key in Settings.")


def mask_api_key(key: str) -> str:
    if not key or len(key) < 8:
        return "••••••••"
    return f"{key[:3]}...{key[-4:]}"
