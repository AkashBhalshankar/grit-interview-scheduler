# Loom Video Script: GRIT Interview Scheduler

## 1. Introduction (0:00 - 0:45)
*   **Context:** "The goal was to build a reliable interview scheduling system for GRIT that handles student bookings, interviewer availability, and outcome tracking while maintaining strict data integrity."
*   **Challenge:** "The system needs to manage complex state transitions (e.g., eligible -> booked -> passed/failed) and prevent common concurrency issues like double-booking, all while providing a polished student dashboard."

## 2. Technical Approach: Robustness by Design (0:45 - 2:00)
*   **Rules Engine & Parity:** "To ensure consistency, I implemented a unified state machine. The business rules (`states.py` and `states.js`) are shared between the frontend and backend. This guarantees that UI behavior and backend validation are always in perfect sync."
*   **Transactional Integrity:** "For booking, I used transactional atomicity in the backend. When a booking occurs, the system uses `FOR UPDATE` locks in the database to prevent race conditions. The schema also uses partial indexes to ensure that a student can never hold two active bookings and a slot can never be double-booked, even under high concurrency."
*   **State Machine:** "Every transition, from eligibility checks to outcome recording, is validated against this central state machine. Illegal transitions are impossible by design."

## 3. Prototype Walkthrough (2:00 - 3:30)
*   **Student Dashboard:** "Students see a clear status. Booking is restricted to eligible students and provides immediate confirmation."
*   **Interviewer Interface:** "Interviewers can manage their availability easily. The outcome recording flow enforces feedback requirements (e.g., character limits for failures) and ensures only authorized interviewers can record results."
*   **Before/After Impact:** "Crucially, the prototype includes a *Before/After* visualization. You can see the student dashboard transform: Miles are updated, the badge is unlocked, and the leaderboard status shifts immediately upon the interviewer recording a 'Pass' result."

## 4. Conclusion (3:30 - 4:00)
*   **Summary:** "This design balances technical reliability—using atomic transactions and a shared rule engine—with a focus on clear student communication and immediate feedback."
*   **Closing:** "This approach provides a scalable and maintainable foundation for the entire GRIT platform."

---

## 5. Light/Concise Version (Quick Pitch)

*   **Introduction:** "This is a reliable interview scheduling system for GRIT that ensures state integrity and clear student feedback."
*   **Key Features:** "The prototype handles student booking, interviewer availability, and outcome tracking. The 'Before/After' view demonstrates the real-time dashboard updates when a student passes or retakes."
*   **Technical Edge:** "I used a shared state machine for logic parity between frontend and backend, plus atomic database transactions to guarantee zero double-booking."
*   **Summary:** "It’s a scalable, robust solution built to be both user-friendly for students and rigorous for the interview team."

