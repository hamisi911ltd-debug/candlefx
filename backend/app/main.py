from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from app.api import auth, market, payhero, prediction
from app.config import get_settings
from app.core.logging import configure_logging
from app.core.rate_limit import limiter

configure_logging()
settings = get_settings()

app = FastAPI(title="Candle Prediction Simulator API", version="0.1.0")

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api")
app.include_router(market.router, prefix="/api")
app.include_router(prediction.router, prefix="/api")
app.include_router(payhero.router, prefix="/api")


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}
