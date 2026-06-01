# Known Findings and Constraints

## Vessel/AIS investigation already performed outside the application

A standalone diagnostic script tested AISStream. This script is not known to be part of the application's existing implementation and must not be integrated automatically.

Observed results:
- A Singapore AISStream bounding box received live AIS frames.
- Gulf-only boxes for Gulf of Oman, Fujairah, Hormuz, Dubai/Jebel Ali, Ras Tanura and a wider Persian Gulf region connected and then closed abnormally with zero frames.
- A combined subscription containing a Persian Gulf target box and a Singapore heartbeat box stayed connected and received Singapore heartbeat messages. Target Gulf delivery had not yet been proven from the supplied output.

Implication:
- These tests establish facts only about the external AISStream diagnostic path.
- They do not establish what provider, database or map query the existing application uses.
- Before changing the app, inspect its own vessel provider, tables, caches, endpoints and UI filters.
- Do not interpret missing Middle East AIS records as proof that no tanker traffic exists.

## Requirement for vessel features

The product owner wants:
- Worldwide tanker visibility.
- Middle East, Persian Gulf, Hormuz and Gulf of Oman focused views.
- Truthful indication when coverage is missing or uncertain.
- Existing app database and providers examined before new ingestion is added.

## Non-negotiable constraint

No agent should propose rebuilding the system from scratch without a written evidence-based architecture audit proving the current implementation cannot be evolved safely or efficiently.
