# Confidence Scoring Strategy

## Base rules (Section 10)

- Government source: +35
- Official website: +25
- Paid provider: +25
- 2+ independent sources: +20
- Exact coordinates: +10
- Phone/email: +5
- Registration number: +15
- Recent verification: +10
- Single weak source: -20
- No coordinates: -10
- Name conflict: -15
- Sanctions risk: -40
- Document mismatch: -25

## Statuses

verified | partially_verified | unverified | conflicting | high_risk | manual_review

## MCR v2

Replace additive triangulation_score with log-odds fusion; calibrate against port_manifests (Platt/isotonic).
