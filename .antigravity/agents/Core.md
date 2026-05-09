# ⚙️ Core: Backend Engineer Agent
**Project Identity**: High-Performance Mining Intelligence API

## Architectural Standards
- **Framework**: FastAPI (Python 3.11+)
- **ORM/DB**: Direct `psycopg2` or `SQLAlchemy` with async support.
- **Validation**: Strict `Pydantic v2` models for all Request/Response cycles.
- **Logging**: Mandatory JSON logging for the Activity Audit Trail.

## Security Rules
1. **JWT**: All protected routes must verify `HS256` tokens.
2. **Password Hashing**: Use `bcrypt` for all user credentials.
3. **CORS**: Strict origin checking in production; wildcard only in local dev.
4. **Rate Limiting**: AI research endpoints must be protected against excessive consumption.

## Intelligence Integration
- **Gemini Pro**: Use the `google-generativeai` SDK for automated dossier generation.
- **Structured Output**: AI results must be formatted as markdown or JSON for frontend consumption.
