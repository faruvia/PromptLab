from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from ..database import get_db
from .. import crud, schemas, llm_service

router = APIRouter(prefix="/providers", tags=["providers"])


@router.get("", response_model=list[schemas.ProviderConfigResponse])
def list_providers(db: Session = Depends(get_db)):
    return crud.list_providers_safe(db)


@router.get("/{provider_name}", response_model=schemas.ProviderConfigResponse)
def get_provider_info(provider_name: str, db: Session = Depends(get_db)):
    result = crud.get_provider_config_safe(db, provider_name)
    if not result:
        raise HTTPException(status_code=404, detail="Provider not found")
    return result


@router.put("/{provider_name}/key", response_model=schemas.ProviderTestResponse)
async def set_api_key(
    provider_name: str,
    update: schemas.ProviderKeyUpdate,
    db: Session = Depends(get_db),
):
    try:
        crud.set_provider_api_key(db, provider_name, update.api_key)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    result = await llm_service.test_provider_connection(db, provider_name)
    return result


@router.delete("/{provider_name}/key")
def remove_api_key(provider_name: str, db: Session = Depends(get_db)):
    try:
        crud.remove_provider_api_key(db, provider_name)
        return {"success": True}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.put("/{provider_name}/default")
def make_default(provider_name: str, db: Session = Depends(get_db)):
    try:
        config = crud.set_default_provider(db, provider_name)
        return {"success": True, "default_provider": config.provider_name}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.put("/{provider_name}/model")
def update_model(
    provider_name: str,
    update: schemas.ProviderModelUpdate,
    db: Session = Depends(get_db),
):
    try:
        crud.update_provider_model(db, provider_name, update.default_model)
        return {"success": True}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/{provider_name}/test", response_model=schemas.ProviderTestResponse)
async def test_connection(provider_name: str, db: Session = Depends(get_db)):
    return await llm_service.test_provider_connection(db, provider_name)
