from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .api import demo, router
from .config import settings
from .rules import RuleError

app = FastAPI(title="GRIT Interview Scheduling", version="1.0.0")

# Guaranteed allowed origins covering local dev and your custom domain
default_origins = [
    "http://127.0.0.1:5173",
    "http://localhost:5173",
    "https://grit.akashbhalshankar.com"
]

# Safely combine settings.cors_origins with defaults without duplicates
try:
    allowed_origins = list(set(list(settings.cors_origins) + default_origins))
except Exception:
    allowed_origins = default_origins

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Main router prefixed here once as /api
app.include_router(router, prefix="/api")

if settings.demo_mode:
    app.include_router(demo, prefix="/api")


@app.exception_handler(RuleError)
async def rule_error(_: Request, e: RuleError):
    """Every business-rule failure is a stable `code` plus a human sentence the UI can show as-is."""
    return JSONResponse(status_code=e.status, content={"code": e.code, "message": e.message})