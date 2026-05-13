import asyncio
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from ..database import get_db
from .. import crud, schemas, llm_service

router = APIRouter(tags=["chat"])


@router.post("/chat", response_model=schemas.ChatResponse)
async def chat(request: schemas.ChatRequest, db: Session = Depends(get_db)):
    persona = crud.get_persona(db, request.persona_id)
    if not persona:
        raise HTTPException(status_code=404, detail="Persona not found")

    active_prompt = crud.get_active_system_prompt(db, request.persona_id)
    if not active_prompt:
        raise HTTPException(
            status_code=404,
            detail="No active system prompt found for this persona",
        )

    system_prompt_text = request.system_prompt or active_prompt.prompt_text

    try:
        result = await llm_service.generate_response(
            db=db,
            system_prompt=system_prompt_text,
            user_prompt=request.user_prompt,
            temperature=request.temperature,
            top_p=request.top_p,
            max_tokens=request.max_tokens,
            provider_name=request.provider_name,
            model=request.model,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    session = crud.create_chat_session(
        db,
        {
            "persona_id": request.persona_id,
            "system_prompt_id": active_prompt.id,
            "temperature": request.temperature,
            "top_p": request.top_p,
            "max_tokens": request.max_tokens,
            "model_name": result["model"],
            "provider_name": result["provider"],
        },
    )

    interaction = crud.create_interaction(
        db,
        {
            "session_id": session.id,
            "user_prompt": request.user_prompt,
            "response": result["response"],
            "tokens_used": result["tokens_used"],
            "latency_ms": result["latency_ms"],
        },
    )

    return {
        "response": result["response"],
        "tokens_used": result["tokens_used"],
        "input_tokens": result.get("input_tokens"),
        "output_tokens": result.get("output_tokens"),
        "latency_ms": result["latency_ms"],
        "provider": result["provider"],
        "model": result["model"],
        "interaction_id": interaction.id,
        "session_id": session.id,
    }


@router.post("/compare", response_model=schemas.CompareResponse)
async def compare(request: schemas.CompareRequest, db: Session = Depends(get_db)):
    async def run_config(config: schemas.CompareConfig) -> dict:
        persona = crud.get_persona(db, config.persona_id)
        if not persona:
            raise ValueError(f"Persona {config.persona_id} not found")
        active = crud.get_active_system_prompt(db, config.persona_id)
        if not active:
            raise ValueError(
                f"No active system prompt for persona {config.persona_id}"
            )
        system = config.system_prompt or active.prompt_text
        return await llm_service.generate_response(
            db=db,
            system_prompt=system,
            user_prompt=request.user_prompt,
            temperature=config.temperature,
            top_p=config.top_p,
            max_tokens=config.max_tokens,
            provider_name=config.provider_name,
            model=config.model,
        )

    try:
        result_a, result_b = await asyncio.gather(
            run_config(request.config_a),
            run_config(request.config_b),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    return {
        "response_a": result_a["response"],
        "response_b": result_b["response"],
        "latency_a": result_a["latency_ms"],
        "latency_b": result_b["latency_ms"],
        "tokens_a": result_a["tokens_used"],
        "tokens_b": result_b["tokens_used"],
        "input_tokens_a": result_a.get("input_tokens"),
        "output_tokens_a": result_a.get("output_tokens"),
        "input_tokens_b": result_b.get("input_tokens"),
        "output_tokens_b": result_b.get("output_tokens"),
        "provider_a": result_a["provider"],
        "provider_b": result_b["provider"],
        "model_a": result_a["model"],
        "model_b": result_b["model"],
    }
