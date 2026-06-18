# Phase 1 — Data Model + Fountains API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the FountainRank core domain — PostGIS-backed fountains, ratings, and a Bayesian ranking score — behind a versioned `/api/v1` REST surface (nearby/bbox/detail reads + authenticated add/rate writes).

**Architecture:** SQLAlchemy 2 async ORM models (`User`, `Fountain`, `RatingType`, `Rating`) with a `geography(Point,4326)` location column (GeoAlchemy2). Hand-written Alembic migrations create the schema and seed the four rating dimensions; `geoalchemy2.alembic_helpers` keeps `alembic check` drift-free. Write endpoints sit behind a single `get_current_user` FastAPI dependency that is a **dev stub in Phase 1** (disabled by default in production) and is swapped for real Logto JWT validation in Phase 2 with no change to the JIT-provisioning tail. Denormalized ranking fields on `Fountain` are recomputed in service logic on every rating change.

**Tech Stack:** Python 3.13, FastAPI, SQLAlchemy 2 (async) + asyncpg, GeoAlchemy2, Alembic, PostgreSQL 17 + PostGIS 3.x, Pydantic v2, pytest/pytest-asyncio. Frontend contract flows through `packages/api-client` (openapi-typescript) — gitignored, regenerated.

## Global Constraints

- **Python** `>=3.13,<3.14`; pinned deps in `backend/pyproject.toml` (`fastapi==0.137.1`, `sqlalchemy[asyncio]==2.0.51`, `asyncpg==0.31.0`, `alembic==1.18.4`, `geoalchemy2==0.20.0`, `pydantic==2.13.4`). Do **not** add or bump dependencies in this phase; everything needed is already present.
- **Windows host:** use backslash paths with Read/Write/Edit (`D:\repos\fountainrank\...`). The Bash tool is Git Bash (forward slashes, `/d/repos/fountainrank/...`).
- **The local CI mirror is `./run.ps1 check -Backend`** = `ruff check` + `ruff format --check` + `alembic upgrade head` + `alembic check` (no drift) + `pytest`, against the compose `db` on **port 5436** (`./run.ps1 up` starts it). `alembic check` reporting **no drift is a hard gate** — every schema task must leave it clean.
- **asyncpg never gets `?sslmode=`** in `DATABASE_URL`; TLS is configured via `connect_args` (already wired in `app/db.py`). Local/test DB is plaintext on 5436.
- **Conventional Commits**, frequent commits, one task at a time. **No AI attribution** in commits/PRs. **No time estimates** anywhere.
- **Coordinate order:** the API speaks `latitude`/`longitude`. PostGIS `ST_MakePoint`/WKT take `(longitude, latitude)`. Centralize this in `app/geo.py` so the swap lives in exactly one place.
- **Phase boundary:** auth is Phase 2, photos Phase 4, leaderboards Phase 5. Do **not** build `/me`, `/leaderboard`, or photo endpoints here. The `Photo` entity is **not** created in this phase.
- **Source-control:** Phase 0 is over — this work goes on a **branch → PR → CI green + Codex `VERDICT: APPROVED` → squash-merge**. Do not commit to `main` directly.

---

## File Structure

**New backend modules:**
- `backend/app/models.py` — `Base` (DeclarativeBase + naming convention) and the four ORM models. One cohesive module; the models change together.
- `backend/app/schemas.py` — Pydantic request/response models for the API contract.
- `backend/app/geo.py` — PostGIS expression helpers (`point_geography`, `latitude_of`, `longitude_of`). The single home for lon/lat ordering.
- `backend/app/auth.py` — `get_current_user` dev-auth seam + `get_or_create_user` JIT provisioning.
- `backend/app/ranking.py` — `recompute_fountain_ranking` denormalization/ranking service.
- `backend/app/routers/rating_types.py` — `GET /api/v1/rating-types`.
- `backend/app/routers/fountains.py` — fountains router (add, rate, nearby, bbox, detail) + the `serialize_fountain_detail` helper.

**Modified backend files:**
- `backend/app/config.py` — new settings (auth gate, ranking constant, geo caps/threshold).
- `backend/app/main.py` — register the two new routers.
- `backend/migrations/env.py` — point `target_metadata` at `Base.metadata`; wire `geoalchemy2.alembic_helpers` while preserving the existing `search_path`/`spatial_ref_sys` handling.
- `backend/migrations/versions/0002_phase1_core_schema.py` — **new** migration: users/fountains/rating_types/ratings + indexes.
- `backend/migrations/versions/0003_seed_rating_types.py` — **new** data migration: seed Clarity/Taste/Pressure/Appearance.
- `backend/tests/conftest.py` — add `engine`, `session`, autouse `clean_db` (truncate), `test_user`, and `client` (auth-overridden) fixtures.

**New tests:**
- `backend/tests/test_schema_migration.py` — schema exists + Python-side UUID PK + spatial round-trip.
- `backend/tests/test_rating_types_api.py`
- `backend/tests/test_auth_seam.py`
- `backend/tests/test_ranking.py`
- `backend/tests/test_fountains_add.py`
- `backend/tests/test_ratings_api.py`
- `backend/tests/test_fountains_query.py` (nearby + bbox)
- `backend/tests/test_fountains_detail.py`
- `backend/tests/test_openapi.py` — **extend** the existing contract-guard test.

**Frontend (verification only, no source edits expected):**
- `packages/api-client/openapi.json` + `src/schema.d.ts` — gitignored, regenerated via `./run.ps1 generate`. Verify `./run.ps1 check -ApiClient`, `-Web`, `-Mobile` stay green.

---

## Interface Reference (shared across tasks)

These are the exact names/signatures later tasks rely on. Defined in the task noted; repeated here so out-of-order readers agree.

**`app/models.py`** (Task 1):
- `Base` — `DeclarativeBase` subclass; `Base.metadata` carries the naming convention.
- `User(id: UUID, logto_user_id: str, display_name: str, email: str, avatar_url: str|None, is_admin: bool, created_at: datetime)`
- `Fountain(id: UUID, location: <Geography POINT 4326>, is_working: bool, comments: str|None, added_by_user_id: UUID, created_at: datetime, last_rated_at: datetime|None, rating_count: int, average_rating: float|None, ranking_score: float|None)`
- `RatingType(id: int, name: str, description: str, sort_order: int)`
- `Rating(id: UUID, fountain_id: UUID, user_id: UUID, rating_type_id: int, stars: int, created_at: datetime, updated_at: datetime)` — unique `(fountain_id, user_id, rating_type_id)`.

**`app/geo.py`** (Task 5):
- `point_geography(latitude: float, longitude: float) -> ColumnElement` — `geography(Point,4326)` expression.
- `latitude_of(col) -> ColumnElement`, `longitude_of(col) -> ColumnElement`.

**`app/auth.py`** (Task 3):
- `async get_current_user(...) -> User` — FastAPI dependency (raises 401 when disabled/unauthenticated).
- `async get_or_create_user(session, *, logto_user_id: str, email: str, display_name: str) -> User`.

**`app/ranking.py`** (Task 4):
- `async recompute_fountain_ranking(session: AsyncSession, fountain_id: UUID) -> None` — updates the fountain's `rating_count`, `average_rating`, `ranking_score`, `last_rated_at` in the session (caller commits).

**`app/routers/fountains.py`** (Task 5):
- `router: APIRouter` (prefix `/api/v1`).
- `async serialize_fountain_detail(session: AsyncSession, fountain: Fountain) -> FountainDetail`.

**`app/schemas.py`** (Task 2 onward):
- `Coordinates(latitude: float[-90,90], longitude: float[-180,180])`
- `RatingInput(rating_type_id: int, stars: int[1,5])`
- `RatingTypeOut(id, name, description, sort_order)` — `from_attributes=True`
- `DimensionSummary(rating_type_id: int, name: str, average_rating: float|None, vote_count: int)`
- `FountainPin(id: UUID, location: Coordinates, is_working: bool, average_rating: float|None, rating_count: int, distance_m: float|None)`
- `FountainDetail(id: UUID, location: Coordinates, is_working: bool, comments: str|None, average_rating: float|None, rating_count: int, ranking_score: float|None, created_at: datetime, last_rated_at: datetime|None, dimensions: list[DimensionSummary])`
- `AddFountainRequest(location: Coordinates, is_working: bool=True, comments: str|None=None, ratings: list[RatingInput]=[])`
- `RateRequest(ratings: list[RatingInput])` — non-empty.

---

## Task 1: ORM models, Alembic wiring, and core schema migration

**Files:**
- Create: `backend/app/models.py`
- Modify: `backend/migrations/env.py`
- Create: `backend/migrations/versions/0002_phase1_core_schema.py`
- Test: `backend/tests/test_schema_migration.py`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `Base`, `User`, `Fountain`, `RatingType`, `Rating` (see Interface Reference). A migrated, drift-free schema.

- [ ] **Step 1: Write `app/models.py`**

```python
import uuid
from datetime import datetime

from geoalchemy2 import Geography
from geoalchemy2.elements import WKBElement
from sqlalchemy import (
    CheckConstraint,
    DateTime,
    Double,
    ForeignKey,
    Index,
    MetaData,
    SmallInteger,
    String,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

# Deterministic constraint/index names so hand-written migrations and the ORM
# metadata agree exactly — `alembic check` compares by name.
NAMING_CONVENTION = {
    "ix": "ix_%(table_name)s_%(column_0_name)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING_CONVENTION)


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    logto_user_id: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    display_name: Mapped[str] = mapped_column(String, nullable=False)
    email: Mapped[str] = mapped_column(String, nullable=False)
    avatar_url: Mapped[str | None] = mapped_column(String, nullable=True)
    is_admin: Mapped[bool] = mapped_column(nullable=False, server_default=text("false"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class RatingType(Base):
    __tablename__ = "rating_types"

    # Stable seed ids (1=Clarity, 2=Taste, 3=Pressure, 4=Appearance); not autoincrement.
    id: Mapped[int] = mapped_column(SmallInteger, primary_key=True, autoincrement=False)
    name: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    description: Mapped[str] = mapped_column(String, nullable=False)
    sort_order: Mapped[int] = mapped_column(nullable=False)


class Fountain(Base):
    __tablename__ = "fountains"

    id: Mapped[uuid.UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    location: Mapped[WKBElement] = mapped_column(
        Geography(geometry_type="POINT", srid=4326, spatial_index=True), nullable=False
    )
    is_working: Mapped[bool] = mapped_column(nullable=False, server_default=text("true"))
    comments: Mapped[str | None] = mapped_column(String, nullable=True)
    added_by_user_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    last_rated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Denormalized ranking fields (recomputed by app/ranking.py).
    rating_count: Mapped[int] = mapped_column(nullable=False, server_default=text("0"))
    # Explicit Double (not bare Mapped[float], which infers a generic Float) so the
    # ORM type matches the migration's sa.Double() — no `alembic check` type ambiguity.
    average_rating: Mapped[float | None] = mapped_column(Double, nullable=True)
    ranking_score: Mapped[float | None] = mapped_column(Double, nullable=True)


class Rating(Base):
    __tablename__ = "ratings"
    __table_args__ = (
        UniqueConstraint(
            "fountain_id", "user_id", "rating_type_id", name="uq_ratings_fountain_user_type"
        ),
        # The `ck` naming convention is `ck_%(table_name)s_%(constraint_name)s`, so the
        # SHORT name "stars_range" renders as `ck_ratings_stars_range` — matching the
        # migration. Passing the full `ck_ratings_stars_range` here double-prefixes it to
        # `ck_ratings_ck_ratings_stars_range` and breaks name-parity with the migration.
        CheckConstraint("stars >= 1 AND stars <= 5", name="stars_range"),
        Index("ix_ratings_fountain_id", "fountain_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    fountain_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("fountains.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    rating_type_id: Mapped[int] = mapped_column(
        SmallInteger, ForeignKey("rating_types.id"), nullable=False
    )
    stars: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )
```

- [ ] **Step 2: Wire `migrations/env.py` to the models + GeoAlchemy2 helpers**

Replace the `target_metadata` and `include_object` block. Keep the existing `search_path`-pinning `run_migrations_online` and the `spatial_ref_sys` guard, but **compose** the project guard with `geoalchemy2.alembic_helpers.include_object`, and add `render_item` + `process_revision_directives` so autogenerate (and therefore `alembic check`) treats the spatial index and geography types correctly.

```python
from geoalchemy2 import alembic_helpers

from app.models import Base

target_metadata = Base.metadata

_POSTGIS_MANAGED_TABLES = {"spatial_ref_sys"}


def include_object(obj, name, type_, reflected, compare_to) -> bool:
    # Drop PostGIS's own managed table from comparison...
    if type_ == "table" and name in _POSTGIS_MANAGED_TABLES:
        return False
    # ...then defer to GeoAlchemy2 (filters spatial system views + the auto gist
    # index so `alembic check` does not see them as drift).
    return alembic_helpers.include_object(obj, name, type_, reflected, compare_to)
```

In **both** `run_migrations_offline` and `do_run_migrations`, add to the `context.configure(...)` call:

```python
        include_object=include_object,
        render_item=alembic_helpers.render_item,
        process_revision_directives=alembic_helpers.writer,
```

Then update `run_migrations_online` so the migration engine uses the **same asyncpg TLS** as the application engine. Phase 1 runs production schema migrations against DO Managed Postgres, which must be **verify-full**, not asyncpg's default unverified SSL — so compose `engine_connect_args` (from `app.db`) with the existing `search_path` pin instead of leaving the engine bare:

```python
from app.config import get_settings  # already imported at top of env.py
from app.db import engine_connect_args


async def run_migrations_online() -> None:
    settings = get_settings()
    engine = create_async_engine(
        get_url(),
        connect_args={
            # asyncpg TLS (an ssl.SSLContext) when DB_SSL_ROOT_CERT is set (prod); {} locally.
            **engine_connect_args(settings),
            # search_path pinned at connection establishment (no SQL before Alembic's txn).
            "server_settings": {"search_path": "public"},
        },
    )
    async with engine.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await engine.dispose()
```

Locally (no cert) this yields only `server_settings`; in production it includes both `ssl` and `server_settings`. (`app.db.engine_connect_args` raises `FileNotFoundError` on a missing cert path — the desired fail-closed behavior.)

- [ ] **Step 3: Write the core-schema migration `0002_phase1_core_schema.py`**

```python
"""phase 1 core schema: users, fountains, rating_types, ratings

Revision ID: 0002_phase1_core_schema
Revises: 0001_enable_postgis
Create Date: 2026-06-18
"""

import geoalchemy2
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID as PgUUID

revision = "0002_phase1_core_schema"
down_revision = "0001_enable_postgis"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", PgUUID(as_uuid=True), nullable=False),
        sa.Column("logto_user_id", sa.String(), nullable=False),
        sa.Column("display_name", sa.String(), nullable=False),
        sa.Column("email", sa.String(), nullable=False),
        sa.Column("avatar_url", sa.String(), nullable=True),
        sa.Column("is_admin", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_users"),
        sa.UniqueConstraint("logto_user_id", name="uq_users_logto_user_id"),
    )
    op.create_table(
        "rating_types",
        sa.Column("id", sa.SmallInteger(), autoincrement=False, nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("description", sa.String(), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_rating_types"),
        sa.UniqueConstraint("name", name="uq_rating_types_name"),
    )
    op.create_table(
        "fountains",
        sa.Column("id", PgUUID(as_uuid=True), nullable=False),
        sa.Column(
            "location",
            geoalchemy2.types.Geography(geometry_type="POINT", srid=4326, from_text="ST_GeogFromText", name="geography"),
            nullable=False,
        ),
        sa.Column("is_working", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("comments", sa.String(), nullable=True),
        sa.Column("added_by_user_id", PgUUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("last_rated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("rating_count", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("average_rating", sa.Double(), nullable=True),
        sa.Column("ranking_score", sa.Double(), nullable=True),
        sa.PrimaryKeyConstraint("id", name="pk_fountains"),
        sa.ForeignKeyConstraint(["added_by_user_id"], ["users.id"], name="fk_fountains_added_by_user_id_users"),
    )
    # GeoAlchemy2's spatial_index=True normally auto-creates this; we create it
    # explicitly in the hand-written migration. alembic_helpers ignores it in checks.
    op.create_index(
        "idx_fountains_location", "fountains", ["location"], unique=False, postgresql_using="gist"
    )
    op.create_table(
        "ratings",
        sa.Column("id", PgUUID(as_uuid=True), nullable=False),
        sa.Column("fountain_id", PgUUID(as_uuid=True), nullable=False),
        sa.Column("user_id", PgUUID(as_uuid=True), nullable=False),
        sa.Column("rating_type_id", sa.SmallInteger(), nullable=False),
        sa.Column("stars", sa.SmallInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_ratings"),
        sa.ForeignKeyConstraint(["fountain_id"], ["fountains.id"], ondelete="CASCADE", name="fk_ratings_fountain_id_fountains"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE", name="fk_ratings_user_id_users"),
        sa.ForeignKeyConstraint(["rating_type_id"], ["rating_types.id"], name="fk_ratings_rating_type_id_rating_types"),
        sa.UniqueConstraint("fountain_id", "user_id", "rating_type_id", name="uq_ratings_fountain_user_type"),
        sa.CheckConstraint("stars >= 1 AND stars <= 5", name="ck_ratings_stars_range"),
    )
    op.create_index("ix_ratings_fountain_id", "ratings", ["fountain_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_ratings_fountain_id", table_name="ratings")
    op.drop_table("ratings")
    op.drop_index("idx_fountains_location", table_name="fountains", postgresql_using="gist")
    op.drop_table("fountains")
    op.drop_table("rating_types")
    op.drop_table("users")
```

- [ ] **Step 4: Write the failing schema test `tests/test_schema_migration.py`**

```python
import uuid

from sqlalchemy import text


async def test_core_tables_exist(session):
    rows = (
        await session.execute(
            text(
                "SELECT table_name FROM information_schema.tables "
                "WHERE table_schema = 'public' "
                "AND table_name IN ('users','fountains','rating_types','ratings') "
                "ORDER BY table_name"
            )
        )
    ).scalars().all()
    assert rows == ["fountains", "rating_types", "ratings", "users"]


async def test_fountain_location_round_trips_via_postgis(session):
    user_id = uuid.uuid4()
    await session.execute(
        text(
            "INSERT INTO users (id, logto_user_id, display_name, email) "
            "VALUES (:id, :lid, 'T', 't@example.com')"
        ),
        {"id": user_id, "lid": f"lid-{user_id}"},
    )
    fid = uuid.uuid4()
    await session.execute(
        text(
            "INSERT INTO fountains (id, location, added_by_user_id) "
            "VALUES (:id, ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography, :uid)"
        ),
        {"id": fid, "lng": -122.4194, "lat": 37.7749, "uid": user_id},
    )
    lat = (
        await session.execute(
            text("SELECT ST_Y(location::geometry) FROM fountains WHERE id = :id"), {"id": fid}
        )
    ).scalar_one()
    assert abs(lat - 37.7749) < 1e-6
    await session.rollback()
```

(`session`, autouse `clean_db` come from `conftest.py` — Task 1 must add the minimal fixtures below so this test can run. The full fixture set is finalized in Task 5's conftest work; for Task 1 add just `engine`, `session`, and the autouse `clean_db` truncate.)

- [ ] **Step 5: Add the minimal fixtures to `tests/conftest.py`**

Append (keep the existing `client` fixture untouched for now — it will be reworked in Task 5):

```python
from sqlalchemy import text as _sa_text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.config import get_settings


@pytest.fixture
async def engine():
    eng = create_async_engine(get_settings().database_url)
    yield eng
    await eng.dispose()


@pytest.fixture
async def session(engine):
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as s:
        yield s


@pytest.fixture(autouse=True)
async def clean_db(engine):
    # Isolation: wipe mutable domain tables before each test. rating_types is
    # migration-seeded reference data and is intentionally preserved.
    async with engine.begin() as conn:
        await conn.execute(_sa_text("TRUNCATE ratings, fountains, users RESTART IDENTITY CASCADE"))
    yield
```

- [ ] **Step 6: Run the schema steps and verify drift-free**

Run: `./run.ps1 check -Backend`
Expected: ruff clean, `alembic upgrade head` applies `0002`, **`alembic check` reports no new upgrade operations** (no drift), and `pytest` passes including the two new schema tests. If `alembic check` reports drift, reconcile the migration DDL with the model (column type, server_default text, or constraint name mismatch) until clean — do not silence it.

- [ ] **Step 7: Commit**

```bash
git add backend/app/models.py backend/migrations/env.py backend/migrations/versions/0002_phase1_core_schema.py backend/tests/test_schema_migration.py backend/tests/conftest.py
git commit -m "feat(backend): add Phase 1 core schema (users/fountains/rating_types/ratings) + drift-free GeoAlchemy2 Alembic wiring"
```

---

## Task 2: Seed rating types + `GET /api/v1/rating-types`

**Files:**
- Create: `backend/migrations/versions/0003_seed_rating_types.py`
- Create: `backend/app/schemas.py`
- Create: `backend/app/routers/rating_types.py`
- Modify: `backend/app/main.py`
- Test: `backend/tests/test_rating_types_api.py`

**Interfaces:**
- Consumes: `RatingType` (Task 1).
- Produces: `RatingTypeOut`, `Coordinates`, `RatingInput` schemas; the rating-types router. Four seeded rows.

- [ ] **Step 1: Write the seed migration `0003_seed_rating_types.py`**

```python
"""seed rating types: Clarity, Taste, Pressure, Appearance

Revision ID: 0003_seed_rating_types
Revises: 0002_phase1_core_schema
Create Date: 2026-06-18
"""

import sqlalchemy as sa
from alembic import op

revision = "0003_seed_rating_types"
down_revision = "0002_phase1_core_schema"
branch_labels = None
depends_on = None

_RATING_TYPES = (
    (1, "Clarity", "How clear and clean the water looks", 1),
    (2, "Taste", "How the water tastes", 2),
    (3, "Pressure", "Water pressure / flow strength", 3),
    (4, "Appearance", "Condition and cleanliness of the fountain", 4),
)


def upgrade() -> None:
    rating_types = sa.table(
        "rating_types",
        sa.column("id", sa.SmallInteger),
        sa.column("name", sa.String),
        sa.column("description", sa.String),
        sa.column("sort_order", sa.Integer),
    )
    op.bulk_insert(
        rating_types,
        [
            {"id": i, "name": n, "description": d, "sort_order": s}
            for (i, n, d, s) in _RATING_TYPES
        ],
    )


def downgrade() -> None:
    op.execute("DELETE FROM rating_types WHERE id IN (1, 2, 3, 4)")
```

- [ ] **Step 2: Create `app/schemas.py` with the first contract types**

```python
import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class Coordinates(BaseModel):
    latitude: float = Field(ge=-90.0, le=90.0)
    longitude: float = Field(ge=-180.0, le=180.0)


class RatingInput(BaseModel):
    rating_type_id: int
    stars: int = Field(ge=1, le=5)


class RatingTypeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    description: str
    sort_order: int


class DimensionSummary(BaseModel):
    rating_type_id: int
    name: str
    average_rating: float | None
    vote_count: int


class FountainPin(BaseModel):
    id: uuid.UUID
    location: Coordinates
    is_working: bool
    average_rating: float | None
    rating_count: int
    distance_m: float | None = None


class FountainDetail(BaseModel):
    id: uuid.UUID
    location: Coordinates
    is_working: bool
    comments: str | None
    average_rating: float | None
    rating_count: int
    ranking_score: float | None
    created_at: datetime
    last_rated_at: datetime | None
    dimensions: list[DimensionSummary]


class AddFountainRequest(BaseModel):
    location: Coordinates
    is_working: bool = True
    comments: str | None = None
    ratings: list[RatingInput] = Field(default_factory=list)


class RateRequest(BaseModel):
    ratings: list[RatingInput] = Field(min_length=1)
```

- [ ] **Step 3: Write the failing test `tests/test_rating_types_api.py`**

```python
async def test_list_rating_types_returns_seeded_dimensions(client):
    resp = await client.get("/api/v1/rating-types")
    assert resp.status_code == 200
    body = resp.json()
    assert [rt["name"] for rt in body] == ["Clarity", "Taste", "Pressure", "Appearance"]
    assert body[0] == {
        "id": 1,
        "name": "Clarity",
        "description": "How clear and clean the water looks",
        "sort_order": 1,
    }
```

- [ ] **Step 4: Run it to confirm it fails**

Run: `cd backend && uv run pytest tests/test_rating_types_api.py -v`
Expected: FAIL (404 — route not registered yet).

- [ ] **Step 5: Create `app/routers/rating_types.py`**

```python
from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.models import RatingType
from app.schemas import RatingTypeOut

router = APIRouter(prefix="/api/v1", tags=["rating-types"])


@router.get("/rating-types", response_model=list[RatingTypeOut])
async def list_rating_types(session: AsyncSession = Depends(get_session)) -> list[RatingType]:
    result = await session.execute(select(RatingType).order_by(RatingType.sort_order))
    return list(result.scalars().all())
```

- [ ] **Step 6: Register the router in `app/main.py`**

```python
from app.routers import health, rating_types


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title=settings.app_name)
    app.include_router(health.router)
    app.include_router(rating_types.router)
    return app
```

- [ ] **Step 7: Run the test + full backend check**

Run: `./run.ps1 check -Backend`
Expected: `alembic upgrade head` applies `0003`, `alembic check` clean, all tests pass (the new test now returns the four seeded rows in sort order).

- [ ] **Step 8: Commit**

```bash
git add backend/migrations/versions/0003_seed_rating_types.py backend/app/schemas.py backend/app/routers/rating_types.py backend/app/main.py backend/tests/test_rating_types_api.py
git commit -m "feat(backend): seed rating dimensions + GET /api/v1/rating-types"
```

---

## Task 3: Dev-auth seam + JIT user provisioning

**Files:**
- Modify: `backend/app/config.py`
- Create: `backend/app/auth.py`
- Test: `backend/tests/test_auth_seam.py`

**Interfaces:**
- Consumes: `User` (Task 1), `get_session` (`app/db.py`).
- Produces: `get_current_user` dependency, `get_or_create_user(session, *, logto_user_id, email, display_name)`. `Settings.dev_auth_enabled` (default `False`).

- [ ] **Step 1: Add settings to `app/config.py`**

Add these fields to `Settings` (keep the existing ones):

```python
    # --- Phase 1 ---
    # Dev-only write-auth seam. FALSE in production so add/rate stay closed until
    # Phase 2's Logto JWT validation lands. Local dev + tests set this True.
    dev_auth_enabled: bool = False
    # Bayesian ranking confidence constant `m` (see ranking.py / spec §8).
    ranking_confidence_m: int = 5
    # Reject a new fountain if one already exists within this many meters (spec §7).
    duplicate_threshold_m: float = 10.0
    # Map-read guardrails.
    nearby_default_radius_m: float = 1000.0
    nearby_max_radius_m: float = 50_000.0
    max_results: int = 500
```

- [ ] **Step 2: Write the failing test `tests/test_auth_seam.py`**

```python
import pytest
from httpx import ASGITransport, AsyncClient

from app.auth import get_or_create_user
from app.config import Settings, get_settings
from app.main import app


async def test_get_or_create_user_is_idempotent(session):
    first = await get_or_create_user(
        session, logto_user_id="logto-abc", email="a@example.com", display_name="A"
    )
    await session.commit()
    again = await get_or_create_user(
        session, logto_user_id="logto-abc", email="ignored@example.com", display_name="ignored"
    )
    assert again.id == first.id  # reused, not duplicated


@pytest.fixture
def settings_override():
    def _apply(**kwargs):
        app.dependency_overrides[get_settings] = lambda: Settings(**kwargs)
    yield _apply
    app.dependency_overrides.pop(get_settings, None)


async def test_write_rejected_when_dev_auth_disabled(settings_override):
    settings_override(dev_auth_enabled=False)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        resp = await ac.post(
            "/api/v1/fountains",
            json={"location": {"latitude": 1.0, "longitude": 2.0}, "is_working": True},
            headers={"X-Dev-User": "logto-abc"},
        )
    assert resp.status_code == 401


async def test_write_rejected_when_header_missing(settings_override):
    settings_override(dev_auth_enabled=True)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        resp = await ac.post(
            "/api/v1/fountains",
            json={"location": {"latitude": 1.0, "longitude": 2.0}, "is_working": True},
        )
    assert resp.status_code == 401
```

> Note: the two endpoint-level tests depend on `POST /api/v1/fountains` existing (Task 5). When implementing Task 3 first, write `test_get_or_create_user_is_idempotent` and run it now; mark the two gating tests with `@pytest.mark.skip(reason="enabled in Task 5")` and remove the skips in Task 5. (They must NOT use the `client` fixture, which overrides `get_current_user`.)

- [ ] **Step 3: Run the idempotency test to confirm it fails**

Run: `cd backend && uv run pytest tests/test_auth_seam.py::test_get_or_create_user_is_idempotent -v`
Expected: FAIL (`app.auth` does not exist).

- [ ] **Step 4: Create `app/auth.py`**

```python
from fastapi import Depends, Header, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings, get_settings
from app.db import get_session
from app.models import User


async def get_or_create_user(
    session: AsyncSession, *, logto_user_id: str, email: str, display_name: str
) -> User:
    """Find the local User for a Logto subject, provisioning one on first sight.
    Phase 2's real JWT path reuses this unchanged."""
    existing = (
        await session.execute(select(User).where(User.logto_user_id == logto_user_id))
    ).scalar_one_or_none()
    if existing is not None:
        return existing
    user = User(logto_user_id=logto_user_id, email=email, display_name=display_name)
    session.add(user)
    await session.flush()
    return user


async def get_current_user(
    x_dev_user: str | None = Header(default=None, alias="X-Dev-User"),
    x_dev_email: str | None = Header(default=None, alias="X-Dev-Email"),
    x_dev_name: str | None = Header(default=None, alias="X-Dev-Name"),
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> User:
    """Phase 1 dev-auth seam. Phase 2 swaps the identity extraction below for
    Logto JWT validation (verify iss/aud via JWKS, take `sub`); the
    get_or_create_user tail is identical. Disabled by default so production never
    exposes an unauthenticated write path before Phase 2."""
    if not settings.dev_auth_enabled:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="authentication required")
    if not x_dev_user:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="missing X-Dev-User header")
    return await get_or_create_user(
        session,
        logto_user_id=x_dev_user,
        email=x_dev_email or f"{x_dev_user}@dev.local",
        display_name=x_dev_name or x_dev_user,
    )
```

- [ ] **Step 5: Run the idempotency test + backend ruff/format**

Run: `cd backend && uv run pytest tests/test_auth_seam.py::test_get_or_create_user_is_idempotent -v && uv run ruff check . && uv run ruff format --check .`
Expected: PASS + clean lint.

- [ ] **Step 6: Commit**

```bash
git add backend/app/config.py backend/app/auth.py backend/tests/test_auth_seam.py
git commit -m "feat(backend): add Phase 1 dev-auth seam + JIT user provisioning (disabled in prod)"
```

---

## Task 4: Ranking recompute service

**Files:**
- Create: `backend/app/ranking.py`
- Test: `backend/tests/test_ranking.py`

**Interfaces:**
- Consumes: `Fountain`, `Rating` (Task 1), `Settings.ranking_confidence_m` (Task 3).
- Produces: `async recompute_fountain_ranking(session, fountain_id) -> None`.

- [ ] **Step 1: Write the failing test `tests/test_ranking.py`**

```python
import uuid

from app.models import Fountain, Rating, User
from app.ranking import recompute_fountain_ranking


async def _make_fountain(session) -> Fountain:
    user = User(logto_user_id=f"u-{uuid.uuid4()}", email="u@example.com", display_name="U")
    session.add(user)
    await session.flush()
    f = Fountain(
        location="SRID=4326;POINT(-122.4194 37.7749)",
        is_working=True,
        added_by_user_id=user.id,
    )
    session.add(f)
    await session.flush()
    return f, user


async def test_recompute_with_no_ratings_is_zeroed(session):
    f, _ = await _make_fountain(session)
    await recompute_fountain_ranking(session, f.id)
    await session.refresh(f)
    assert f.rating_count == 0
    assert f.average_rating is None
    assert f.ranking_score is None


async def test_recompute_sets_denormalized_fields(session):
    f, user = await _make_fountain(session)
    for rt, stars in ((1, 5), (2, 3)):
        session.add(Rating(fountain_id=f.id, user_id=user.id, rating_type_id=rt, stars=stars))
    await session.flush()
    await recompute_fountain_ranking(session, f.id)
    await session.refresh(f)
    assert f.rating_count == 1  # one distinct user
    assert abs(f.average_rating - 4.0) < 1e-9  # mean of 5 and 3
    assert f.ranking_score is not None
    assert f.last_rated_at is not None


async def test_recompute_clears_state_when_ratings_removed(session):
    from sqlalchemy import delete

    f, user = await _make_fountain(session)
    session.add(Rating(fountain_id=f.id, user_id=user.id, rating_type_id=1, stars=4))
    await session.flush()
    await recompute_fountain_ranking(session, f.id)
    await session.refresh(f)
    assert f.last_rated_at is not None

    await session.execute(delete(Rating).where(Rating.fountain_id == f.id))
    await session.flush()
    await recompute_fountain_ranking(session, f.id)
    await session.refresh(f)
    assert f.rating_count == 0
    assert f.average_rating is None
    assert f.ranking_score is None
    assert f.last_rated_at is None  # cleared, not stale
```

> The string `"SRID=4326;POINT(...)"` assigned to a `Geography` column is accepted by GeoAlchemy2 (EWKT). This keeps the test free of geo-helper imports.

- [ ] **Step 2: Run to confirm failure**

Run: `cd backend && uv run pytest tests/test_ranking.py -v`
Expected: FAIL (`app.ranking` missing).

- [ ] **Step 3: Create `app/ranking.py`**

```python
import uuid
from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models import Fountain, Rating


async def recompute_fountain_ranking(session: AsyncSession, fountain_id: uuid.UUID) -> None:
    """Recompute and store a fountain's denormalized rating fields. The caller owns
    the transaction (commit happens upstream)."""
    vote_count, average = (
        await session.execute(
            select(
                func.count(func.distinct(Rating.user_id)),
                func.avg(Rating.stars),
            ).where(Rating.fountain_id == fountain_id)
        )
    ).one()
    vote_count = int(vote_count or 0)
    average = float(average) if average is not None else None

    # Global mean rating C across all rating rows (IMDb-style weighted average).
    global_mean = (await session.execute(select(func.avg(Rating.stars)))).scalar()
    global_mean = float(global_mean) if global_mean is not None else None

    m = get_settings().ranking_confidence_m
    if average is None or global_mean is None or vote_count == 0:
        ranking_score = None
    else:
        v = vote_count
        ranking_score = (v / (v + m)) * average + (m / (v + m)) * global_mean

    fountain = (
        await session.execute(select(Fountain).where(Fountain.id == fountain_id))
    ).scalar_one()
    fountain.rating_count = vote_count
    fountain.average_rating = average
    fountain.ranking_score = ranking_score
    if vote_count > 0:
        fountain.last_rated_at = datetime.now(tz=timezone.utc)
    else:
        # Make the no-ratings state complete + deterministic (e.g. after a rating is
        # retracted or denormalized state is repaired): clear the stale timestamp too.
        fountain.last_rated_at = None
```

- [ ] **Step 4: Run the tests**

Run: `cd backend && uv run pytest tests/test_ranking.py -v`
Expected: PASS (both tests).

- [ ] **Step 5: Commit**

```bash
git add backend/app/ranking.py backend/tests/test_ranking.py
git commit -m "feat(backend): add fountain ranking recompute service (Bayesian weighted score)"
```

---

## Task 5: `POST /api/v1/fountains` (add) + geo helpers + detail serializer + conftest finalize

**Files:**
- Create: `backend/app/geo.py`
- Create: `backend/app/routers/fountains.py`
- Modify: `backend/app/main.py`
- Modify: `backend/tests/conftest.py`
- Modify: `backend/tests/test_auth_seam.py` (remove the two skips)
- Test: `backend/tests/test_fountains_add.py`

**Interfaces:**
- Consumes: `AddFountainRequest`, `FountainDetail`, `DimensionSummary`, `Coordinates` (Task 2); `get_current_user` (Task 3); `recompute_fountain_ranking` (Task 4).
- Produces: `app/geo.py` helpers; `fountains.router`; `async serialize_fountain_detail(session, fountain) -> FountainDetail`.

- [ ] **Step 1: Create `app/geo.py`**

```python
from geoalchemy2 import Geography, Geometry
from sqlalchemy import cast, func
from sqlalchemy.sql.elements import ColumnElement


def point_geography(latitude: float, longitude: float) -> ColumnElement:
    """A geography(Point,4326) SQL expression. PostGIS takes (lon, lat) order."""
    return cast(func.ST_SetSRID(func.ST_MakePoint(longitude, latitude), 4326), Geography)


def latitude_of(location_col) -> ColumnElement:
    return func.ST_Y(cast(location_col, Geometry))


def longitude_of(location_col) -> ColumnElement:
    return func.ST_X(cast(location_col, Geometry))
```

- [ ] **Step 2: Finalize `tests/conftest.py` fixtures (auth-overridden client + test_user)**

Replace the existing `client` fixture and add `test_user`. Final state of `conftest.py`:

```python
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text as _sa_text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.auth import get_current_user
from app.config import get_settings
from app.main import app
from app.models import User


@pytest.fixture
async def engine():
    eng = create_async_engine(get_settings().database_url)
    yield eng
    await eng.dispose()


@pytest.fixture
async def session(engine):
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as s:
        yield s


@pytest.fixture(autouse=True)
async def clean_db(engine):
    async with engine.begin() as conn:
        await conn.execute(_sa_text("TRUNCATE ratings, fountains, users RESTART IDENTITY CASCADE"))
    yield


@pytest.fixture
async def test_user(clean_db, session) -> User:
    user = User(logto_user_id="dev-user-1", email="dev1@example.com", display_name="Dev One")
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user


@pytest.fixture
async def client(test_user) -> AsyncClient:
    # API tests run with the write-auth seam pinned to a known user. The seam's own
    # gating/provisioning is covered separately in tests/test_auth_seam.py.
    async def override_current_user() -> User:
        return test_user

    app.dependency_overrides[get_current_user] = override_current_user
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.pop(get_current_user, None)
```

> `test_user` depends on `clean_db` so the truncate runs **before** the user is inserted (fixture ordering guarantee). Endpoints read only `current_user.id`, so the cross-session object is safe.

- [ ] **Step 3: Write the failing test `tests/test_fountains_add.py`**

```python
async def test_add_fountain_returns_detail(client):
    resp = await client.post(
        "/api/v1/fountains",
        json={
            "location": {"latitude": 37.7749, "longitude": -122.4194},
            "is_working": True,
            "comments": "Cold and clean",
        },
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["location"]["latitude"] == 37.7749
    assert body["location"]["longitude"] == -122.4194
    assert body["is_working"] is True
    assert body["comments"] == "Cold and clean"
    assert body["rating_count"] == 0
    assert body["average_rating"] is None
    assert len(body["dimensions"]) == 4  # all dimensions present, zero votes
    assert all(d["vote_count"] == 0 for d in body["dimensions"])


async def test_add_fountain_with_inline_ratings_recomputes(client):
    resp = await client.post(
        "/api/v1/fountains",
        json={
            "location": {"latitude": 40.0, "longitude": -73.0},
            "ratings": [{"rating_type_id": 1, "stars": 5}, {"rating_type_id": 2, "stars": 3}],
        },
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["rating_count"] == 1
    assert abs(body["average_rating"] - 4.0) < 1e-9


async def test_add_fountain_rejects_proximity_duplicate(client):
    point = {"latitude": 37.7749, "longitude": -122.4194}
    first = await client.post("/api/v1/fountains", json={"location": point})
    assert first.status_code == 201
    dup = await client.post("/api/v1/fountains", json={"location": point})
    assert dup.status_code == 409


async def test_add_fountain_rejects_unknown_rating_type(client):
    resp = await client.post(
        "/api/v1/fountains",
        json={
            "location": {"latitude": 1.0, "longitude": 2.0},
            "ratings": [{"rating_type_id": 99, "stars": 5}],
        },
    )
    assert resp.status_code == 422


async def test_add_fountain_rejects_out_of_range_stars(client):
    resp = await client.post(
        "/api/v1/fountains",
        json={
            "location": {"latitude": 1.0, "longitude": 2.0},
            "ratings": [{"rating_type_id": 1, "stars": 9}],
        },
    )
    assert resp.status_code == 422
```

- [ ] **Step 4: Run to confirm failure**

Run: `cd backend && uv run pytest tests/test_fountains_add.py -v`
Expected: FAIL (route missing).

- [ ] **Step 5: Create `app/routers/fountains.py` with the add endpoint + shared helpers**

```python
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user
from app.config import Settings, get_settings
from app.db import get_session
from app.geo import latitude_of, longitude_of, point_geography
from app.models import Fountain, Rating, RatingType, User
from app.ranking import recompute_fountain_ranking
from app.schemas import (
    AddFountainRequest,
    Coordinates,
    DimensionSummary,
    FountainDetail,
    RatingInput,
)

router = APIRouter(prefix="/api/v1", tags=["fountains"])


async def _validate_rating_types(session: AsyncSession, ratings: list[RatingInput]) -> None:
    if not ratings:
        return
    ids = {r.rating_type_id for r in ratings}
    known = set(
        (await session.execute(select(RatingType.id).where(RatingType.id.in_(ids)))).scalars().all()
    )
    unknown = ids - known
    if unknown:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"unknown rating_type_id(s): {sorted(unknown)}",
        )


async def _upsert_ratings(
    session: AsyncSession, *, fountain_id: uuid.UUID, user_id: uuid.UUID, ratings: list[RatingInput]
) -> None:
    # Atomic upsert via ON CONFLICT on the (fountain_id, user_id, rating_type_id) unique
    # constraint. A SELECT-then-INSERT would race two concurrent submissions for the same
    # user/fountain/dimension (both see no row, both INSERT) -> one hits IntegrityError ->
    # a 500. ON CONFLICT DO UPDATE makes the create-or-edit atomic. Dedupe within the
    # request (last value wins) so a single statement never touches the same conflict key
    # twice — Postgres rejects "ON CONFLICT ... cannot affect row a second time".
    stars_by_type = {r.rating_type_id: r.stars for r in ratings}
    if not stars_by_type:
        return
    stmt = pg_insert(Rating).values(
        [
            {
                "id": uuid.uuid4(),
                "fountain_id": fountain_id,
                "user_id": user_id,
                "rating_type_id": rating_type_id,
                "stars": stars,
            }
            for rating_type_id, stars in stars_by_type.items()
        ]
    )
    stmt = stmt.on_conflict_do_update(
        index_elements=["fountain_id", "user_id", "rating_type_id"],
        set_={"stars": stmt.excluded.stars, "updated_at": func.now()},
    )
    await session.execute(stmt)
    await session.flush()


async def serialize_fountain_detail(session: AsyncSession, fountain: Fountain) -> FountainDetail:
    lat, lng = (
        await session.execute(
            select(latitude_of(Fountain.location), longitude_of(Fountain.location)).where(
                Fountain.id == fountain.id
            )
        )
    ).one()
    dim_rows = (
        await session.execute(
            select(
                RatingType.id,
                RatingType.name,
                func.avg(Rating.stars),
                func.count(func.distinct(Rating.user_id)),
            )
            .select_from(RatingType)
            .outerjoin(
                Rating,
                (Rating.rating_type_id == RatingType.id) & (Rating.fountain_id == fountain.id),
            )
            .group_by(RatingType.id, RatingType.name)
            .order_by(RatingType.id)
        )
    ).all()
    dimensions = [
        DimensionSummary(
            rating_type_id=rid,
            name=name,
            average_rating=float(avg) if avg is not None else None,
            vote_count=int(votes or 0),
        )
        for (rid, name, avg, votes) in dim_rows
    ]
    return FountainDetail(
        id=fountain.id,
        location=Coordinates(latitude=float(lat), longitude=float(lng)),
        is_working=fountain.is_working,
        comments=fountain.comments,
        average_rating=fountain.average_rating,
        rating_count=fountain.rating_count,
        ranking_score=fountain.ranking_score,
        created_at=fountain.created_at,
        last_rated_at=fountain.last_rated_at,
        dimensions=dimensions,
    )


@router.post("/fountains", response_model=FountainDetail, status_code=status.HTTP_201_CREATED)
async def add_fountain(
    payload: AddFountainRequest,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> FountainDetail:
    await _validate_rating_types(session, payload.ratings)

    point = point_geography(payload.location.latitude, payload.location.longitude)
    conflict = (
        await session.execute(
            select(Fountain.id)
            .where(func.ST_DWithin(Fountain.location, point, settings.duplicate_threshold_m))
            .limit(1)
        )
    ).scalar_one_or_none()
    if conflict is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail=f"a fountain already exists within {settings.duplicate_threshold_m} m",
        )

    fountain = Fountain(
        location=point,
        is_working=payload.is_working,
        comments=payload.comments,
        added_by_user_id=user.id,
    )
    session.add(fountain)
    await session.flush()

    if payload.ratings:
        await _upsert_ratings(
            session, fountain_id=fountain.id, user_id=user.id, ratings=payload.ratings
        )
        await recompute_fountain_ranking(session, fountain.id)

    await session.commit()
    await session.refresh(fountain)
    return await serialize_fountain_detail(session, fountain)
```

- [ ] **Step 6: Register the fountains router in `app/main.py`**

```python
from app.routers import fountains, health, rating_types
# ...
    app.include_router(health.router)
    app.include_router(rating_types.router)
    app.include_router(fountains.router)
```

- [ ] **Step 7: Remove the two `@pytest.mark.skip` markers in `tests/test_auth_seam.py`**

The gating tests (`test_write_rejected_when_dev_auth_disabled`, `test_write_rejected_when_header_missing`) now have a real endpoint to hit. Delete the skip decorators.

- [ ] **Step 8: Run the add tests, the (now-unskipped) auth tests, and full backend check**

Run: `./run.ps1 check -Backend`
Expected: `alembic check` clean; `test_fountains_add.py` (5 tests) + `test_auth_seam.py` (3 tests) + everything prior pass.

- [ ] **Step 9: Commit**

```bash
git add backend/app/geo.py backend/app/routers/fountains.py backend/app/main.py backend/tests/conftest.py backend/tests/test_auth_seam.py backend/tests/test_fountains_add.py
git commit -m "feat(backend): POST /api/v1/fountains (add) with proximity dedup + inline ratings"
```

---

## Task 6: `POST /api/v1/fountains/{id}/ratings` (upsert)

**Files:**
- Modify: `backend/app/routers/fountains.py`
- Test: `backend/tests/test_ratings_api.py`

**Interfaces:**
- Consumes: `RateRequest`, the `_validate_rating_types`/`_upsert_ratings`/`serialize_fountain_detail` helpers (Task 5), `recompute_fountain_ranking` (Task 4).
- Produces: the rate handler at `/fountains/{fountain_id}/ratings`.

- [ ] **Step 1: Write the failing test `tests/test_ratings_api.py`**

```python
async def _add_fountain(client) -> str:
    resp = await client.post(
        "/api/v1/fountains", json={"location": {"latitude": 37.7749, "longitude": -122.4194}}
    )
    assert resp.status_code == 201
    return resp.json()["id"]


async def test_submit_ratings_updates_denormalized_fields(client):
    fid = await _add_fountain(client)
    resp = await client.post(
        f"/api/v1/fountains/{fid}/ratings",
        json={"ratings": [{"rating_type_id": 1, "stars": 4}, {"rating_type_id": 3, "stars": 2}]},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["rating_count"] == 1
    assert abs(body["average_rating"] - 3.0) < 1e-9
    clarity = next(d for d in body["dimensions"] if d["rating_type_id"] == 1)
    assert clarity["average_rating"] == 4.0
    assert clarity["vote_count"] == 1


async def test_submit_ratings_is_upsert(client):
    fid = await _add_fountain(client)
    await client.post(
        f"/api/v1/fountains/{fid}/ratings", json={"ratings": [{"rating_type_id": 1, "stars": 1}]}
    )
    resp = await client.post(
        f"/api/v1/fountains/{fid}/ratings", json={"ratings": [{"rating_type_id": 1, "stars": 5}]}
    )
    body = resp.json()
    clarity = next(d for d in body["dimensions"] if d["rating_type_id"] == 1)
    assert clarity["average_rating"] == 5.0  # replaced, not duplicated
    assert clarity["vote_count"] == 1


async def test_submit_ratings_unknown_fountain_404(client):
    import uuid

    resp = await client.post(
        f"/api/v1/fountains/{uuid.uuid4()}/ratings",
        json={"ratings": [{"rating_type_id": 1, "stars": 5}]},
    )
    assert resp.status_code == 404


async def test_submit_ratings_unknown_type_422(client):
    fid = await _add_fountain(client)
    resp = await client.post(
        f"/api/v1/fountains/{fid}/ratings", json={"ratings": [{"rating_type_id": 42, "stars": 5}]}
    )
    assert resp.status_code == 422


async def test_submit_ratings_dedupes_same_type_in_one_request(client):
    # Two values for the same dimension in one payload must settle to a single row
    # (last wins) — exercises the ON CONFLICT path's in-request dedupe, not a 500.
    fid = await _add_fountain(client)
    resp = await client.post(
        f"/api/v1/fountains/{fid}/ratings",
        json={"ratings": [{"rating_type_id": 1, "stars": 2}, {"rating_type_id": 1, "stars": 5}]},
    )
    assert resp.status_code == 200
    body = resp.json()
    clarity = next(d for d in body["dimensions"] if d["rating_type_id"] == 1)
    assert clarity["vote_count"] == 1
    assert clarity["average_rating"] == 5.0
```

- [ ] **Step 2: Run to confirm failure**

Run: `cd backend && uv run pytest tests/test_ratings_api.py -v`
Expected: FAIL (route missing).

- [ ] **Step 3: Append the rate handler to `app/routers/fountains.py`**

Add the import for `RateRequest` to the existing `app.schemas` import line, then add:

```python
@router.post("/fountains/{fountain_id}/ratings", response_model=FountainDetail)
async def submit_ratings(
    fountain_id: uuid.UUID,
    payload: RateRequest,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> FountainDetail:
    fountain = (
        await session.execute(select(Fountain).where(Fountain.id == fountain_id))
    ).scalar_one_or_none()
    if fountain is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="fountain not found")

    await _validate_rating_types(session, payload.ratings)
    await _upsert_ratings(
        session, fountain_id=fountain.id, user_id=user.id, ratings=payload.ratings
    )
    await recompute_fountain_ranking(session, fountain.id)
    await session.commit()
    await session.refresh(fountain)
    return await serialize_fountain_detail(session, fountain)
```

- [ ] **Step 4: Run the ratings tests + ruff**

Run: `cd backend && uv run pytest tests/test_ratings_api.py -v && uv run ruff check .`
Expected: PASS (4 tests) + clean.

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/fountains.py backend/tests/test_ratings_api.py
git commit -m "feat(backend): POST /api/v1/fountains/{id}/ratings upsert + ranking recompute"
```

---

## Task 7: `GET /api/v1/fountains` (nearby)

**Files:**
- Modify: `backend/app/routers/fountains.py`
- Test: `backend/tests/test_fountains_query.py`

**Interfaces:**
- Consumes: `FountainPin`, `Coordinates` (Task 2); geo helpers (Task 5); `Settings` caps (Task 3).
- Produces: the nearby handler `GET /fountains`.

- [ ] **Step 1: Write the failing test `tests/test_fountains_query.py`** (nearby cases; bbox added in Task 8)

```python
async def _add(client, lat, lng):
    resp = await client.post("/api/v1/fountains", json={"location": {"latitude": lat, "longitude": lng}})
    assert resp.status_code == 201
    return resp.json()["id"]


async def test_nearby_returns_within_radius_ordered_by_distance(client):
    # Two points ~1.5 km apart in SF; query from the first with a 2 km radius.
    near = await _add(client, 37.7749, -122.4194)
    far = await _add(client, 37.7884, -122.4194)  # ~1.5 km north
    resp = await client.get("/api/v1/fountains", params={"lat": 37.7749, "lng": -122.4194, "radius_m": 2000})
    assert resp.status_code == 200
    body = resp.json()
    ids = [p["id"] for p in body]
    assert ids == [near, far]  # nearest first
    assert body[0]["distance_m"] < body[1]["distance_m"]
    assert body[0]["distance_m"] < 1.0  # essentially at the query point


async def test_nearby_excludes_outside_radius(client):
    await _add(client, 37.7749, -122.4194)
    await _add(client, 37.8049, -122.4194)  # ~3.3 km north
    resp = await client.get("/api/v1/fountains", params={"lat": 37.7749, "lng": -122.4194, "radius_m": 1000})
    body = resp.json()
    assert len(body) == 1
```

- [ ] **Step 2: Run to confirm failure**

Run: `cd backend && uv run pytest tests/test_fountains_query.py -v`
Expected: FAIL (route missing).

- [ ] **Step 3: Append the nearby handler to `app/routers/fountains.py`**

Add `from fastapi import Query` to the FastAPI import, `FountainPin` to the schemas import, then:

```python
@router.get("/fountains", response_model=list[FountainPin])
async def nearby_fountains(
    lat: float = Query(ge=-90.0, le=90.0),
    lng: float = Query(ge=-180.0, le=180.0),
    radius_m: float | None = Query(default=None, gt=0.0),
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> list[FountainPin]:
    radius = min(radius_m or settings.nearby_default_radius_m, settings.nearby_max_radius_m)
    point = point_geography(lat, lng)
    distance = func.ST_Distance(Fountain.location, point)
    rows = (
        await session.execute(
            select(
                Fountain.id,
                latitude_of(Fountain.location),
                longitude_of(Fountain.location),
                Fountain.is_working,
                Fountain.average_rating,
                Fountain.rating_count,
                distance,
            )
            .where(func.ST_DWithin(Fountain.location, point, radius))
            .order_by(distance)
            .limit(settings.max_results)
        )
    ).all()
    return [
        FountainPin(
            id=rid,
            location=Coordinates(latitude=float(rlat), longitude=float(rlng)),
            is_working=working,
            average_rating=avg,
            rating_count=count,
            distance_m=float(dist),
        )
        for (rid, rlat, rlng, working, avg, count, dist) in rows
    ]
```

- [ ] **Step 4: Run the nearby tests**

Run: `cd backend && uv run pytest tests/test_fountains_query.py -v`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/fountains.py backend/tests/test_fountains_query.py
git commit -m "feat(backend): GET /api/v1/fountains nearby (ST_DWithin + distance)"
```

---

## Task 8: `GET /api/v1/fountains/bbox` (viewport)

**Files:**
- Modify: `backend/app/routers/fountains.py`
- Test: `backend/tests/test_fountains_query.py` (extend)

**Interfaces:**
- Consumes: `FountainPin`, geo helpers, `Settings.max_results`.
- Produces: `GET /fountains/bbox`. **Must be declared before** `GET /fountains/{id}` (Task 9) so "bbox" is not captured as an id.

- [ ] **Step 1: Add the failing bbox tests to `tests/test_fountains_query.py`**

```python
async def test_bbox_returns_only_points_inside(client):
    inside = await _add(client, 37.7749, -122.4194)
    await _add(client, 40.0, -73.0)  # NYC, far outside an SF box
    resp = await client.get(
        "/api/v1/fountains/bbox",
        params={"min_lat": 37.70, "min_lng": -122.50, "max_lat": 37.80, "max_lng": -122.40},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert [p["id"] for p in body] == [inside]
    assert body[0]["distance_m"] is None  # no reference point for bbox


async def test_bbox_rejects_inverted_bounds(client):
    resp = await client.get(
        "/api/v1/fountains/bbox",
        params={"min_lat": 37.80, "min_lng": -122.40, "max_lat": 37.70, "max_lng": -122.50},
    )
    assert resp.status_code == 422
```

- [ ] **Step 2: Run to confirm failure**

Run: `cd backend && uv run pytest tests/test_fountains_query.py::test_bbox_returns_only_points_inside -v`
Expected: FAIL (404/422 — route missing).

- [ ] **Step 3: Append the bbox handler to `app/routers/fountains.py`** — place it **above** the `add_fountain`/nearby? No: place it so the GET routes are ordered `/fountains` (nearby), `/fountains/bbox`, then later `/fountains/{id}`. Add it directly after the nearby handler:

```python
@router.get("/fountains/bbox", response_model=list[FountainPin])
async def fountains_in_bbox(
    min_lat: float = Query(ge=-90.0, le=90.0),
    min_lng: float = Query(ge=-180.0, le=180.0),
    max_lat: float = Query(ge=-90.0, le=90.0),
    max_lng: float = Query(ge=-180.0, le=180.0),
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> list[FountainPin]:
    if min_lat > max_lat or min_lng > max_lng:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="min_lat/min_lng must be <= max_lat/max_lng",
        )
    envelope = cast(func.ST_MakeEnvelope(min_lng, min_lat, max_lng, max_lat, 4326), Geography)
    rows = (
        await session.execute(
            select(
                Fountain.id,
                latitude_of(Fountain.location),
                longitude_of(Fountain.location),
                Fountain.is_working,
                Fountain.average_rating,
                Fountain.rating_count,
            )
            .where(func.ST_Intersects(Fountain.location, envelope))
            .limit(settings.max_results)
        )
    ).all()
    return [
        FountainPin(
            id=rid,
            location=Coordinates(latitude=float(rlat), longitude=float(rlng)),
            is_working=working,
            average_rating=avg,
            rating_count=count,
            distance_m=None,
        )
        for (rid, rlat, rlng, working, avg, count) in rows
    ]
```

Add the imports this handler needs to the **top of `app/routers/fountains.py`** (ruff `E402` forbids in-function imports here): add `cast` to the existing `from sqlalchemy import func, select` line (→ `from sqlalchemy import cast, func, select`) and add `from geoalchemy2 import Geography` to the third-party import group (alphabetically before `fastapi`).

- [ ] **Step 4: Run the bbox test + ruff**

Run: `cd backend && uv run pytest tests/test_fountains_query.py -v && uv run ruff check .`
Expected: PASS (3 query tests) + clean imports.

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/fountains.py backend/tests/test_fountains_query.py
git commit -m "feat(backend): GET /api/v1/fountains/bbox viewport query"
```

---

## Task 9: `GET /api/v1/fountains/{id}` (detail)

**Files:**
- Modify: `backend/app/routers/fountains.py`
- Test: `backend/tests/test_fountains_detail.py`

**Interfaces:**
- Consumes: `serialize_fountain_detail` (Task 5).
- Produces: `GET /fountains/{fountain_id}` — declared **after** `/fountains/bbox`.

- [ ] **Step 1: Write the failing test `tests/test_fountains_detail.py`**

```python
import uuid


async def test_detail_returns_dimension_breakdown(client):
    add = await client.post(
        "/api/v1/fountains",
        json={
            "location": {"latitude": 37.7749, "longitude": -122.4194},
            "comments": "Park fountain",
            "ratings": [{"rating_type_id": 1, "stars": 5}, {"rating_type_id": 2, "stars": 3}],
        },
    )
    fid = add.json()["id"]
    resp = await client.get(f"/api/v1/fountains/{fid}")
    assert resp.status_code == 200
    body = resp.json()
    assert body["id"] == fid
    assert body["comments"] == "Park fountain"
    assert body["rating_count"] == 1
    assert len(body["dimensions"]) == 4
    clarity = next(d for d in body["dimensions"] if d["rating_type_id"] == 1)
    assert clarity["average_rating"] == 5.0 and clarity["vote_count"] == 1
    pressure = next(d for d in body["dimensions"] if d["rating_type_id"] == 3)
    assert pressure["average_rating"] is None and pressure["vote_count"] == 0


async def test_detail_unknown_id_404(client):
    resp = await client.get(f"/api/v1/fountains/{uuid.uuid4()}")
    assert resp.status_code == 404
```

- [ ] **Step 2: Run to confirm failure**

Run: `cd backend && uv run pytest tests/test_fountains_detail.py -v`
Expected: FAIL (route missing).

- [ ] **Step 3: Append the detail handler to `app/routers/fountains.py`** (after the bbox handler)

```python
@router.get("/fountains/{fountain_id}", response_model=FountainDetail)
async def fountain_detail(
    fountain_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
) -> FountainDetail:
    fountain = (
        await session.execute(select(Fountain).where(Fountain.id == fountain_id))
    ).scalar_one_or_none()
    if fountain is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="fountain not found")
    return await serialize_fountain_detail(session, fountain)
```

- [ ] **Step 4: Run the detail tests + full backend check**

Run: `./run.ps1 check -Backend`
Expected: `alembic check` clean; all backend tests pass (detail 2 tests + everything prior).

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/fountains.py backend/tests/test_fountains_detail.py
git commit -m "feat(backend): GET /api/v1/fountains/{id} detail with per-dimension breakdown"
```

---

## Task 10: OpenAPI contract guard + cross-workspace verification

**Files:**
- Modify: `backend/tests/test_openapi.py`
- Verify (no edits expected): `packages/api-client/*`, `web/*`, `mobile/*`.

**Interfaces:**
- Consumes: the full router set (Tasks 2–9).
- Produces: a contract-guard assertion that the Phase 1 schemas are present in the exported OpenAPI; a verified regenerated api-client.

- [ ] **Step 1: Extend `tests/test_openapi.py`** (keep the existing health assertions; append)

```python
def test_openapi_exposes_phase1_contract():
    schema = app.openapi()
    paths = schema["paths"]
    assert "/api/v1/rating-types" in paths
    assert "/api/v1/fountains" in paths
    assert "/api/v1/fountains/bbox" in paths
    assert "/api/v1/fountains/{fountain_id}" in paths
    assert "/api/v1/fountains/{fountain_id}/ratings" in paths

    components = schema["components"]["schemas"]
    for name in ("FountainDetail", "FountainPin", "AddFountainRequest", "RatingTypeOut"):
        assert name in components
```

(Import `app` is already at the top of the file.)

- [ ] **Step 2: Run the backend OpenAPI test**

Run: `cd backend && uv run pytest tests/test_openapi.py -v`
Expected: PASS.

- [ ] **Step 3: Regenerate the api-client and verify it typechecks against the new contract**

Run: `./run.ps1 generate`
Then: `./run.ps1 check -ApiClient`
Expected: `openapi.json` + `src/schema.d.ts` regenerate (gitignored — nothing to commit); api-client ESLint + `tsc --noEmit` + vitest pass. The existing `/healthz` client test still passes (new paths are additive).

- [ ] **Step 4: Verify web + mobile typecheck against the regenerated schema**

Run: `./run.ps1 check -Web` then `./run.ps1 check -Mobile`
Expected: both green. No web/mobile source changes are expected (Phase 1 only adds endpoints; consumers are unchanged). If either fails, the failure is a real contract regression — fix the backend schema, do not edit generated files.

- [ ] **Step 5: Commit**

```bash
git add backend/tests/test_openapi.py
git commit -m "test(backend): guard Phase 1 OpenAPI contract (paths + component schemas)"
```

---

## Task 11: Local dev ergonomics + docs

**Files:**
- Modify: `run.ps1` (enable the dev-auth seam for the host `backend` dev command)
- Modify: `backend/README.md` (document the `/api/v1` surface + dev-auth headers)
- Modify: `docs/specs/2026-06-16-architecture-and-foundation-design.md` (§9: mark the contract "defined in Phase 1")

**Interfaces:**
- Consumes: everything.
- Produces: a runnable local write path + accurate docs.

- [ ] **Step 1: Enable dev auth in the host `backend` dev command in `run.ps1`**

In the `'backend'` switch branch, set the env var before launching uvicorn so local manual testing can exercise writes (this does **not** touch production, which defaults `dev_auth_enabled=False`):

```powershell
    'backend' {
        Start-Db
        Invoke-Native -Exe 'uv' -Arguments @('run', 'alembic', 'upgrade', 'head') -WorkingDir $BackendDir
        $env:DEV_AUTH_ENABLED = 'true'
        Invoke-Native -Exe 'uv' -Arguments @('run', 'uvicorn', 'app.main:app', '--port', '3021', '--reload') -WorkingDir $BackendDir
    }
```

- [ ] **Step 2: Document the API + dev-auth in `backend/README.md`**

Add a short "API (Phase 1)" section listing the endpoints and noting that write endpoints require `dev_auth_enabled` + an `X-Dev-User: <logto-subject>` header in Phase 1 (replaced by a Logto bearer token in Phase 2). Reference env var names only — **do not** create or write any `.env` file.

- [ ] **Step 3: Update spec §9**

Change the "Indicative endpoints (full contract defined in Phase 1)" lead-in to note the Phase 1 endpoints are now implemented, and that `/me`, `/leaderboard`, and photo endpoints remain deferred to Phases 2/5/4. Keep the table accurate to what shipped (no `POST /photos` yet).

- [ ] **Step 4: Run the full local CI mirror**

Run: `./run.ps1 check`
Expected: **all** of backend + workspace-js (web/mobile/api-client lint+typecheck+test) + web build green.

- [ ] **Step 5: Commit**

```bash
git add run.ps1 backend/README.md docs/specs/2026-06-16-architecture-and-foundation-design.md
git commit -m "docs: document Phase 1 fountains API + enable dev-auth for local backend"
```

---

## Final: open the PR

After Task 11, with `./run.ps1 check` fully green:

- [ ] Push the branch and open a PR to `main` (`gh pr create`). PR body: summarize the Phase 1 data model + endpoints, note the dev-auth seam is disabled in prod, link this plan. No AI attribution.
- [ ] Monitor CI (`backend`, `workspace-js`, `mobile-doctor`, `security-audit`) to green with `gh run watch`.
- [ ] Run the Codex PR review loop to `VERDICT: APPROVED`; address every comment.
- [ ] Squash-merge once CI is green **and** Codex approved.
- [ ] Do **not** tag a release (`v*.*.*`) — that triggers `deploy.yml`. Production deploy of Phase 1 is a separate, deliberate step (and write endpoints remain disabled in prod until Phase 2 sets `dev_auth_enabled`/JWT auth).

---

## Self-Review (author checklist — completed during planning)

**Spec coverage (§6 data model, §7 geo, §8 ranking, §9 API, §20 Phase 1):**
- §6 entities → Task 1 models (User/Fountain/RatingType/Rating; Photo deferred per phase boundary). ✓
- §6 unique `(fountain_id,user_id,rating_type_id)` → Task 1 `uq_ratings_fountain_user_type`. ✓
- §7 `ST_DWithin` nearby + `ST_Distance` → Task 7; duplicate-on-add 10 m → Task 5; `ST_MakeEnvelope` bbox → Task 8. ✓
- §8 per-fountain average + distinct-user vote count + Bayesian `ranking_score`, recomputed on rating change, denormalized → Task 4 + invoked in Tasks 5/6. ✓
- §9 endpoints: `/rating-types` (T2), `POST /fountains` (T5), `POST /fountains/{id}/ratings` (T6), `GET /fountains` nearby (T7), `/fountains/bbox` (T8), `/fountains/{id}` detail (T9). `/me`, `/leaderboard`, `POST /photos` intentionally out of Phase 1. ✓
- §20 Phase 1 "PostGIS schema, migrations, nearby/bbox/detail/add, ranking computation" → all covered. ✓

**Placeholder scan:** every code/test step carries complete code; no TBD/TODO/"handle edge cases". ✓

**Type consistency:** `serialize_fountain_detail`, `recompute_fountain_ranking`, `get_current_user`, `get_or_create_user`, `point_geography`/`latitude_of`/`longitude_of`, and the `FountainDetail`/`FountainPin`/`Coordinates`/`RatingInput` schemas are referenced with identical names/signatures across Tasks 1–11. ✓

**Known risks flagged for the implementer/reviewer:**
- `alembic check` drift is the sharpest edge — the hand-written `0002` must match the ORM exactly (column types via `sa.Double`/`server_default` text, named constraints, gist index ignored by `alembic_helpers`). If drift appears, regenerate `0002` via `uv run alembic revision --autogenerate` (with env.py wired to `alembic_helpers`) and reconcile. This is verified by the `alembic check` gate in Tasks 1/2/9/11, not assumed.
- Cross-session `test_user` object: endpoints read only `current_user.id`; do not attach it to the request session.
- Route order: `GET /fountains/bbox` must precede `GET /fountains/{fountain_id}`.
- Global-mean `C` in the Bayesian score is recomputed only for the rated fountain on write; a global re-score sweep across all fountains is deferred (acceptable for Phase 1 — leaderboards are Phase 5).

## Codex Loop A — round 1 revisions applied

Addressed all 8 findings of `temp/codex-reviews/phase-1-data-model-and-fountains-api-plan-review-1.md`:
1. [BLOCKER] Migration imports `from sqlalchemy.dialects.postgresql import UUID as PgUUID` and uses `PgUUID(...)` (no `sa.dialects.postgresql.UUID`).
2. [BLOCKER] `ratings` check constraint named `"stars_range"` so the `ck` convention renders `ck_ratings_stars_range`, matching the migration (no double-prefix).
3. [MAJOR] `average_rating`/`ranking_score` declared `mapped_column(Double, …)` to match the migration's `sa.Double()`.
4. [MAJOR] `run_migrations_online` composes `engine_connect_args(settings)` (verify-full TLS) with the `search_path` pin.
5. [MAJOR] `recompute_fountain_ranking` clears `last_rated_at = None` when no ratings; added a remove-then-recompute test.
6. [MAJOR] `_upsert_ratings` uses `INSERT … ON CONFLICT DO UPDATE` with in-request dedupe (atomic, no 500 race); added a duplicate-in-one-request test.
7. [MINOR] bbox handler rejects inverted bounds with 422; added a test.
8. [NIT] Removed the stale `gen_random_uuid` claim — PKs are Python-side `uuid.uuid4` by design.
