from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

from .config import settings

_sqlite = settings.database_url.startswith("sqlite")
# Default is a local SQLite file (zero setup). Set DATABASE_URL=postgresql+psycopg://... for PostgreSQL in production.
engine = create_engine(settings.database_url, **({"connect_args": {"check_same_thread": False}} if _sqlite else {"pool_pre_ping": True}))
if _sqlite:
    @event.listens_for(engine, "connect")
    def _fk_on(conn, _):   # SQLite ignores foreign keys unless asked; the partial unique indexes work on both databases
        conn.execute("PRAGMA foreign_keys=ON")

SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
