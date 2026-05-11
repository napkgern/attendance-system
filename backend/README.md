# Fingerprint Attendance System - Backend

Cloud backend for the multi-device fingerprint attendance system. It handles authentication, subject/session management, fingerprint enrollment, and attendance scanning.

## Database

The project now connects to PostgreSQL/Supabase through `pg`.

1. Open Supabase SQL Editor.
2. Run `schema.postgres.sql` to create the tables.
3. Copy your Supabase PostgreSQL connection string.
4. Create `backend/.env` from `backend/.env.example`.
5. Put the connection string in `DATABASE_URL`.

Example:

```env
DATABASE_URL=postgresql://postgres:[YOUR-PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres
DB_SSL=require
```

## Setup

```bash
npm install
npm run db:check
npm start
```

## Environment

- `DATABASE_URL`: Supabase/PostgreSQL connection URI.
- `DB_SSL`: Use `require` for Supabase.
- `JWT_SECRET`: Secret used for signing login tokens.
- `TEACHER_PASSCODE`: Passcode required for teacher registration.
- `PORT`: API port, defaults to `3000`.

## Tech Stack

- Backend: Node.js, Express
- Database: PostgreSQL/Supabase
- Frontend: Vanilla JS, CSS3, HTML5
- Hardware Integration: HTTP/JSON REST API
