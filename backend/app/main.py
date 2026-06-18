from fastapi import FastAPI

from app.config import get_settings
from app.routers import health, rating_types


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title=settings.app_name)
    app.include_router(health.router)
    app.include_router(rating_types.router)
    return app


app = create_app()
