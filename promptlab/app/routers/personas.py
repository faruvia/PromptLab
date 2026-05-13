from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from ..database import get_db
from .. import crud, schemas

router = APIRouter(prefix="/personas", tags=["personas"])


@router.get("", response_model=list[schemas.PersonaOut])
def list_personas(db: Session = Depends(get_db)):
    return crud.get_personas_with_prompts(db)


@router.get("/{persona_id}", response_model=schemas.PersonaOut)
def get_persona(persona_id: int, db: Session = Depends(get_db)):
    result = crud.get_persona_with_prompt(db, persona_id)
    if not result:
        raise HTTPException(status_code=404, detail="Persona not found")
    return result


@router.post("", response_model=schemas.PersonaOut, status_code=status.HTTP_201_CREATED)
def create_persona(persona: schemas.PersonaCreate, db: Session = Depends(get_db)):
    try:
        return crud.create_persona_with_prompt(db, persona)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.put("/{persona_id}", response_model=schemas.PersonaOut)
def update_persona(
    persona_id: int,
    update: schemas.PersonaUpdate,
    db: Session = Depends(get_db),
):
    result = crud.update_persona(db, persona_id, update)
    if not result:
        raise HTTPException(status_code=404, detail="Persona not found")
    return result


@router.put(
    "/{persona_id}/prompt",
    response_model=schemas.SystemPromptOut,
    status_code=status.HTTP_201_CREATED,
)
def update_system_prompt(
    persona_id: int,
    body: schemas.SystemPromptCreate,
    db: Session = Depends(get_db),
):
    if not crud.get_persona(db, persona_id):
        raise HTTPException(status_code=404, detail="Persona not found")
    return crud.create_system_prompt_version(db, persona_id, body.prompt_text)
