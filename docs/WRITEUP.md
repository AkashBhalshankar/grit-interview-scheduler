# GRIT Interview Scheduling: Round 1 write-up

**Live prototype:** `<add your deployed link>` · **Stack:** React + FastAPI + PostgreSQL · Student, Interviewer and Interview-team views, plus a *Before / after* page. A demo clock (+1 hour / +1 day) lets a reviewer jump to interview time and record a result.

## 1. States of a student's interview journey
| State | Meaning | What moves it on |
|---|---|---|
| NOT_ELIGIBLE | Skills for the badge not all cleared | All skills cleared → ELIGIBLE |
| ELIGIBLE | Can book | Books a slot → BOOKED · malpractice flag → ON_HOLD · skill invalidated → NOT_ELIGIBLE |
| BOOKED | Holds exactly one slot | Pass → PASSED · Fail → FAILED · Retake later or no-show → RETAKE_PENDING · Cancel / slot released → ELIGIBLE |
| PASSED | Badge + Miles awarded | Malpractice flag → NULLIFIED |
| FAILED | Not cleared; 14-day wait, 3 attempts | Wait ends → ELIGIBLE (after 3 fails the team must grant an attempt) |
| RETAKE_PENDING | Interviewer asked for a retake, or no-show (wait 7 days / 3 days × no-shows) | Wait ends → ELIGIBLE |
| NULLIFIED | Badge and Miles removed after a later flag | Team overturns appeal → PASSED |
| ON_HOLD | Flagged before a badge exists; slot released | Team reinstates → ELIGIBLE |

Every action goes through one transition table (`states.py`, mirrored in `states.js`); an illegal move raises `ILLEGAL_TRANSITION`, and a test fails if the two tables drift. Waits end lazily: the state flips to ELIGIBLE the first time anyone reads or acts after `next_eligible_at`.

## 2. Edge cases handled, and assumptions
- **Two students, one slot:** database refuses the second; the loser sees "Someone just took this slot". Slot lists never show a booked slot.
- **Reschedule:** one transaction. If the new slot is gone, the old booking is untouched (tested).
- **Late change:** students cannot cancel or reschedule within 6 hours; the team can. Interviewer can release a slot any time before it starts: student is notified, it never counts as an attempt.
- **Too soon / too far:** slots bookable 12 hours to 14 days ahead. Interviewers cannot add past slots, off-grid times, duplicates, or more than 24 slots at once; closing a booked slot warns that it releases the student.
- **Outcome recording:** only the slot's interviewer, only after the start; no-show only 10 minutes after; fail and retake need ≥10 characters of feedback; a second submit is refused (`ALREADY_RECORDED`). Interviewer forgets: "Outcome overdue" after 24 hours on both the interviewer and team views.
- **Retakes:** a different interviewer (the previous one's slots are hidden); if none is left the team uses *Allow now*.
- **Skill invalidated after booking:** booking cancelled, state back to NOT_ELIGIBLE, student told why.
- **Malpractice flagged later:** PASSED → NULLIFIED (Miles removed, leaderboard tier falls back); anyone else → ON_HOLD and any slot is freed. Reason is mandatory and logged.
- **Reminders:** one per student per 24 hours; only to students who can book now.
- **Time:** stored in UTC, shown in IST everywhere.

**Assumptions:** one badge interview at a time per student; 30-minute online slots; interviewers are matched by track; the time limits above are config values (`Policy`), not hard-coded; login comes from GRIT SSO (prototype has a role switcher); Miles per badge is illustrative.

## 3. Data model and double-booking prevention
`students` (state, fail_count, no_shows, next_eligible_at, badge_awarded_at) · `student_skills` · `interviewers` · `interviewer_tracks` · `slots` (interviewer_id, starts_at, ends_at, status open/booked/cancelled, **unique (interviewer_id, starts_at)**) · `bookings` (slot_id, student_id, badge, status, meet_link) · `interviews` (booking_id **unique**, outcome, notes, retake_after) · `notifications` · `audit_log`.

```sql
CREATE UNIQUE INDEX uq_booking_active_slot    ON bookings (slot_id)           WHERE status = 'active';
CREATE UNIQUE INDEX uq_booking_active_student ON bookings (student_id, badge) WHERE status = 'active';
```
Booking runs in one transaction: lock the student and slot rows (`FOR UPDATE`), re-check every rule, insert the booking, flip the slot. The two partial indexes are the final guard, so even a bug or a race cannot create two active bookings for a slot or for a student; cancelled and completed rows are history and do not block re-booking. I ran the real `schema.sql` with three concurrent writers on one slot: exactly one wins.

## 4. The three most important student messages
**Interview booked**  
> You're booked! Your AI Product Mastery Novice interview is on Fri 20 Nov, 4:00 PM IST with Priya Nair. Your join link appears here 15 minutes before the start. Keep your camera on and carry a valid ID. You can reschedule until Fri 20 Nov, 10:00 AM IST.

**You passed!**  
> Cleared for takeoff! You passed the AI Product Mastery Novice interview. Your Miles and Novice Badge are now on your dashboard.

**Retake later**  
> Not a pass yet, but you're close. Your interviewer has asked for a retake on or after 4 Dec. Feedback: "Solid UI work. Revisit prompt design and evaluation basics." Your cleared skills stay safe. You can book a new slot from 4 Dec, with a different interviewer.

## 5. Before / after screens
The *Before / after* page builds each screen from the real app: book, interview time passes, interviewer records the result. It shows student **home**, **badges** and the **team list** for Passed, Retake later, Not cleared and Flagged later. Home changes headline, tone, stepper, Miles (450 pending → 450 awarded), leaderboard (Pre-Qualiflyer → Qualiflyer) and the next action; Badges flips locked → earned (or nullified); the team list moves the student out of "Booked".

## 6. AI bonus
*Recommended for you* ranks open slots (soonest, daytime, lighter interviewer load, one pick per interviewer) with a plain-language reason per pick; it can only choose real slots. The team's reminder can be drafted by Claude from facts only, with a template fallback. AI never books, cancels or records anything.
