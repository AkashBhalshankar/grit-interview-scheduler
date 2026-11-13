# GRIT Interview Scheduling (Round 1 prototype)

Students book a Level Clearance Interview, interviewers publish availability and record outcomes, the interview team sees who has and hasn't booked. Write-up: `docs/WRITEUP.pdf` (2 pages).

```
frontend/   React 19, esbuild. In-browser engine (src/domain) mirrors the backend rules; runs with no server.
backend/    FastAPI + SQLAlchemy + PostgreSQL. rules.py / states.py are pure; service.py is one transaction per action.
docs/       WRITEUP.pdf, WRITEUP.md, parity.json (fixture that locks the JS and Python rules together)
```

## Setup (start here)
**You need:** Node 20+ (frontend), Python 3.11+ (backend, optional). No database install needed: it uses a local SQLite file by default.

1. Unzip `grit-interview-scheduler.zip` and open a terminal in the unzipped folder.
2. **Frontend (works on its own, no backend needed):**
   ```
   cd frontend
   npm install
   npm run dev        # opens http://localhost:5173
   ```
   To make a deployable build: `npm run build` (output in `frontend/dist`, a prebuilt copy is already included).
3. **Backend (optional):**
   ```
   cd backend
   python -m venv .venv && source .venv/bin/activate     # Windows: .venv\Scripts\activate
   pip install -r requirements.txt
   python -m app.seed                                     # creates grit.db + demo data (no Postgres needed)
   uvicorn app.main:app --reload                          # API docs at http://localhost:8000/docs
   ```
   For PostgreSQL instead, set `DATABASE_URL=postgresql+psycopg://user:pass@localhost:5432/grit` first, or run `docker compose up --build` from the project root.
4. **Check it works:** `cd frontend && npm test` and `cd backend && python -m pytest`.
5. **Go live:** push the `frontend` folder to GitHub, import it in Vercel (build command `npm run build`, output directory `dist`), and paste the link into the write-up.

## More detail: run the prototype (no backend needed)
```
cd frontend && npm install && npm run build   # -> dist/  (a prebuilt dist/ is already included)
npx serve dist                                # or: npm run dev
```
Deploy: Vercel/Netlify, build command `npm run build`, output directory `dist`.
Use the top bar to switch **Student / Interviewer / Interview team / Before-after**, the dropdown to view as any seeded student, and the bottom bar's **demo clock** (+1 hour / +1 day) to reach interview time and record a result. State is saved in the browser; "Reset demo data" restarts.

## Run the backend
```
docker compose up --build          # Postgres + API (http://localhost:8000/docs) + web
# or: cd backend && pip install -r requirements.txt && python -m app.seed && uvicorn app.main:app --reload
```
Env: `DATABASE_URL`, `DEMO_MODE=1` (demo clock via `X-Demo-Offset-Minutes`, `/api/demo/*`), optional `ANTHROPIC_API_KEY` for AI-drafted reminders. Point the web app at it by setting `apiUrl` in `frontend/public/config.js` (used for reminder drafting).

## Tests
```
cd frontend && npm test          # 19 tests: engine rules, double booking, atomic reschedule, outcomes, before/after
cd backend  && python -m pytest  # 23 tests: rules, state table, AI ranking, schema.sql double-booking guard (3 concurrent writers)
python backend/tests/parity.py   # regenerate docs/parity.json after changing a message or rule
```

## Honest limits
- The prototype UI runs on the in-browser engine. `backend/app/service.py`, `api.py`, `main.py` and `seed.py` are written against the same rules but were only compile-checked where this was built (FastAPI/SQLAlchemy could not be installed there). Run `docker compose up` and `/docs` once before relying on them. The rules they call, the state table, the AI ranking and `schema.sql` are tested.
- GRIT's official palette is in a brand-kit image that wasn't machine-readable, so colours are an approximation; change the tokens at the top of `frontend/src/theme.css`.
- No login: roles are switchable for review. Production uses GRIT SSO. Miles per badge (450) and all names are demo data.
