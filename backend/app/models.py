"""SQLAlchemy models. Mirrors db/schema.sql (the reference DDL), including the partial unique indexes."""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint, text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from .states import ALL_STATES

TS = DateTime(timezone=True)


class Base(DeclarativeBase):
    pass


class Student(Base):
    __tablename__ = "students"
    __table_args__ = (
        CheckConstraint("state IN (" + ",".join(f"'{s}'" for s in ALL_STATES) + ")", name="ck_students_state"),
    )
    id: Mapped[str] = mapped_column(String, primary_key=True)
    name: Mapped[str] = mapped_column(String)
    email: Mapped[str] = mapped_column(String, unique=True)
    batch: Mapped[int] = mapped_column(Integer)
    track: Mapped[str] = mapped_column(String)
    badge: Mapped[str] = mapped_column(String)
    state: Mapped[str] = mapped_column(String, default="NOT_ELIGIBLE")
    fail_count: Mapped[int] = mapped_column(Integer, default=0)
    no_shows: Mapped[int] = mapped_column(Integer, default=0)
    next_eligible_at: Mapped[datetime | None] = mapped_column(TS, nullable=True)
    badge_awarded_at: Mapped[datetime | None] = mapped_column(TS, nullable=True)
    nullified_at: Mapped[datetime | None] = mapped_column(TS, nullable=True)
    state_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(TS)


class StudentSkill(Base):
    __tablename__ = "student_skills"
    student_id: Mapped[str] = mapped_column(ForeignKey("students.id"), primary_key=True)
    skill: Mapped[str] = mapped_column(String, primary_key=True)
    level: Mapped[str] = mapped_column(String, primary_key=True)
    cleared: Mapped[bool] = mapped_column(Boolean, default=False)


class Interviewer(Base):
    __tablename__ = "interviewers"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    name: Mapped[str] = mapped_column(String)
    email: Mapped[str] = mapped_column(String, unique=True)


class InterviewerTrack(Base):
    __tablename__ = "interviewer_tracks"
    interviewer_id: Mapped[str] = mapped_column(ForeignKey("interviewers.id"), primary_key=True)
    track: Mapped[str] = mapped_column(String, primary_key=True)


class Slot(Base):
    __tablename__ = "slots"
    __table_args__ = (
        UniqueConstraint("interviewer_id", "starts_at", name="uq_slot_interviewer_start"),
        CheckConstraint("ends_at > starts_at", name="ck_slot_range"),
        CheckConstraint("status IN ('open','booked','cancelled')", name="ck_slot_status"),
    )
    id: Mapped[str] = mapped_column(String, primary_key=True)
    interviewer_id: Mapped[str] = mapped_column(ForeignKey("interviewers.id"))
    starts_at: Mapped[datetime] = mapped_column(TS)
    ends_at: Mapped[datetime] = mapped_column(TS)
    status: Mapped[str] = mapped_column(String, default="open")
    created_at: Mapped[datetime] = mapped_column(TS)


class Booking(Base):
    __tablename__ = "bookings"
    __table_args__ = (
        CheckConstraint(
            "status IN ('active','completed','no_show','cancelled_by_student','cancelled_by_interviewer','cancelled_by_team')",
            name="ck_booking_status",
        ),
        # THE double-booking guard (see db/schema.sql). Enforced by the database, not by application code.
        Index("uq_booking_active_slot", "slot_id", unique=True,
              postgresql_where=text("status = 'active'"), sqlite_where=text("status = 'active'")),
        Index("uq_booking_active_student", "student_id", "badge", unique=True,
              postgresql_where=text("status = 'active'"), sqlite_where=text("status = 'active'")),
    )
    id: Mapped[str] = mapped_column(String, primary_key=True)
    slot_id: Mapped[str] = mapped_column(ForeignKey("slots.id"))
    student_id: Mapped[str] = mapped_column(ForeignKey("students.id"))
    badge: Mapped[str] = mapped_column(String)
    status: Mapped[str] = mapped_column(String, default="active")
    meet_link: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(TS)
    cancelled_at: Mapped[datetime | None] = mapped_column(TS, nullable=True)


class Interview(Base):
    __tablename__ = "interviews"
    __table_args__ = (CheckConstraint("outcome IN ('pass','fail','retake','no_show')", name="ck_interview_outcome"),)
    id: Mapped[str] = mapped_column(String, primary_key=True)
    booking_id: Mapped[str] = mapped_column(ForeignKey("bookings.id"), unique=True)
    interviewer_id: Mapped[str] = mapped_column(ForeignKey("interviewers.id"))
    outcome: Mapped[str] = mapped_column(String)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    retake_after: Mapped[datetime | None] = mapped_column(TS, nullable=True)
    recorded_at: Mapped[datetime] = mapped_column(TS)
    recorded_by: Mapped[str] = mapped_column(String)


class Notification(Base):
    __tablename__ = "notifications"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    student_id: Mapped[str] = mapped_column(ForeignKey("students.id"), index=True)
    kind: Mapped[str] = mapped_column(String)
    title: Mapped[str] = mapped_column(String)
    body: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(TS)
    read_at: Mapped[datetime | None] = mapped_column(TS, nullable=True)


class AuditLog(Base):
    __tablename__ = "audit_log"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    at: Mapped[datetime] = mapped_column(TS)
    actor_role: Mapped[str] = mapped_column(String)
    actor_id: Mapped[str] = mapped_column(String)
    action: Mapped[str] = mapped_column(String)
    entity: Mapped[str] = mapped_column(String)
    entity_id: Mapped[str] = mapped_column(String)
    detail: Mapped[str | None] = mapped_column(Text, nullable=True)
