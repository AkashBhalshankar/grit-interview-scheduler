"""Runs the REAL db/schema.sql (SQLite accepts the same DDL, incl. partial unique indexes) and proves the database itself
refuses a double booking, even if application code were buggy or two requests raced."""
import pathlib, sqlite3, threading, tempfile, os
import pytest

SCHEMA = (pathlib.Path(__file__).resolve().parents[1] / "db" / "schema.sql").read_text()
TS = "2026-11-14T10:00:00+00:00"


@pytest.fixture()
def db():
    f = tempfile.NamedTemporaryFile(suffix=".db", delete=False); f.close()
    c = sqlite3.connect(f.name, isolation_level=None); c.execute("PRAGMA foreign_keys=ON"); c.executescript(SCHEMA)
    for i in (1, 2, 3):
        c.execute("INSERT INTO students(id,name,email,batch,track,badge,state,created_at) VALUES (?,?,?,?,?,?,?,?)", (f"st{i}", f"S{i}", f"s{i}@x", 2024, "AI Product Mastery", "Novice", "ELIGIBLE", TS))
    c.execute("INSERT INTO interviewers VALUES ('iv1','I','i@x')")
    for i in (1, 2):
        c.execute("INSERT INTO slots(id,interviewer_id,starts_at,ends_at,status,created_at) VALUES (?,?,?,?, 'open', ?)", (f"sl{i}", "iv1", f"2026-11-1{i}T10:00:00+00:00", f"2026-11-1{i}T10:30:00+00:00", TS))
    yield c, f.name
    c.close(); os.unlink(f.name)


def book(c, bid, slot, student, status="active"):
    c.execute("INSERT INTO bookings(id,slot_id,student_id,badge,status,created_at) VALUES (?,?,?,?,?,?)", (bid, slot, student, "Novice", status, TS))


def test_two_students_cannot_hold_the_same_slot(db):
    c, _ = db; book(c, "b1", "sl1", "st1")
    with pytest.raises(sqlite3.IntegrityError, match="slot_id"):
        book(c, "b2", "sl1", "st2")


def test_one_active_booking_per_student(db):
    c, _ = db; book(c, "b1", "sl1", "st1")
    with pytest.raises(sqlite3.IntegrityError, match="student_id"):
        book(c, "b2", "sl2", "st1")


def test_cancelled_booking_frees_slot_and_student(db):
    c, _ = db; book(c, "b1", "sl1", "st1")
    c.execute("UPDATE bookings SET status='cancelled_by_student' WHERE id='b1'")
    book(c, "b2", "sl1", "st2"); book(c, "b3", "sl2", "st1")           # same slot re-used, student books again


def test_one_result_per_booking_and_valid_state(db):
    c, _ = db; book(c, "b1", "sl1", "st1")
    c.execute("INSERT INTO interviews VALUES ('i1','b1','iv1','pass',NULL,NULL,?, 'iv1')", (TS,))
    with pytest.raises(sqlite3.IntegrityError):
        c.execute("INSERT INTO interviews VALUES ('i2','b1','iv1','fail','x',NULL,?, 'iv1')", (TS,))
    with pytest.raises(sqlite3.IntegrityError):
        c.execute("UPDATE students SET state='WHATEVER' WHERE id='st1'")


def test_interviewer_cannot_publish_same_start_twice(db):
    c, _ = db
    with pytest.raises(sqlite3.IntegrityError):
        c.execute("INSERT INTO slots(id,interviewer_id,starts_at,ends_at,status,created_at) VALUES ('dup','iv1','2026-11-11T10:00:00+00:00','2026-11-11T10:30:00+00:00','open',?)", (TS,))


def test_race_exactly_one_winner(db):
    _, path = db; wins, lost = [], []
    def go(i):
        c = sqlite3.connect(path, isolation_level=None, timeout=10); c.execute("PRAGMA foreign_keys=ON")
        try: book(c, f"r{i}", "sl2", f"st{i}"); wins.append(i)
        except sqlite3.IntegrityError: lost.append(i)
        finally: c.close()
    ts = [threading.Thread(target=go, args=(i,)) for i in (1, 2, 3)]
    [t.start() for t in ts]; [t.join() for t in ts]
    assert len(wins) == 1 and len(lost) == 2
