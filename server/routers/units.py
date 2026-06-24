from fastapi import APIRouter, HTTPException
import state

router = APIRouter()


@router.get("/units/{unit_id}")
def get_unit(unit_id: str):
    data = state.get_unit(unit_id)
    if data is None:
        raise HTTPException(status_code=404, detail="Unidad no encontrada o sin datos aun")
    return data
