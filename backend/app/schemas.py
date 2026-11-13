from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class BookIn(BaseModel):
    slot_id: str


class RescheduleIn(BaseModel):
    slot_id: str


class AvailabilityIn(BaseModel):
    start: datetime = Field(description="ISO 8601 with timezone, e.g. 2026-11-14T10:00:00+05:30")
    end: datetime


class OutcomeIn(BaseModel):
    outcome: Literal["pass", "fail", "retake", "no_show"]
    notes: str | None = Field(default=None, max_length=2000)
    retake_after: datetime | None = None


class FlagIn(BaseModel):
    reason: str = Field(min_length=5, max_length=500)


class RemindIn(BaseModel):
    use_ai: bool = True


class SkillIn(BaseModel):
    skill: str
    level: str
    cleared: bool
