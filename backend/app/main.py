from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .api import demo, router
from .config import settings
from .rules import RuleError

app = FastAPI(title="GRIT Interview Scheduling", version="1.0.0")
app.add_middleware(CORSMiddleware, allow_origins=list(settings.cors_origins), allow_methods=["*"], allow_headers=["*"])
app.include_router(router)
if settings.demo_mode:
    app.include_router(demo)


@app.exception_handler(RuleError)
async def rule_error(_: Request, e: RuleError):
    """Every business-rule failure is a stable `code` plus a human sentence the UI can show as-is."""
    return JSONResponse(status_code=e.status, content={"code": e.code, "message": e.message})
