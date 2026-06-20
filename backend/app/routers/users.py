from typing import Annotated

from fastapi import APIRouter, Depends

from app.auth import get_current_user
from app.models import User
from app.schemas import MeResponse

router = APIRouter(prefix="/api/v1", tags=["users"])


@router.get("/me", response_model=MeResponse)
async def get_me(current_user: Annotated[User, Depends(get_current_user)]) -> User:
    # Auth failures are raised by get_current_user (401). Unexpected errors propagate
    # to the centralized exception handler in main.py (logged 500) — not swallowed here.
    return current_user
