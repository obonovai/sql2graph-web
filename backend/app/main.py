"""FastAPI app entrypoint. Run with: ``uvicorn app.main:app --reload`` from backend/."""

from __future__ import annotations

import logging
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .api import router

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
# Graph-DB drivers are noisy; validators already capture and forward their errors.
for _noisy in ("neo4j", "gremlinpython"):
    logging.getLogger(_noisy).setLevel(logging.CRITICAL)

app = FastAPI(title="rows2graph-web", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)

# In production, serve the built SPA from the same origin (no CORS needed).
_dist = Path(__file__).resolve().parents[2] / "frontend" / "dist"
if _dist.is_dir():
    app.mount("/", StaticFiles(directory=str(_dist), html=True), name="spa")
