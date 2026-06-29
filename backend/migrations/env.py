import asyncio
from logging.config import fileConfig

from alembic import context
from geoalchemy2 import alembic_helpers
from sqlalchemy.ext.asyncio import create_async_engine

from app.config import get_settings
from app.db import engine_connect_args
from app.models import Base

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata

# PostGIS's own objects (from CREATE EXTENSION postgis) must be excluded from
# autogenerate/check, or an extension-only DB looks like a pending DROP of
# spatial_ref_sys. geometry_columns/geography_columns are views, already ignored.
#
# The postgis/postgis Docker image sets the DB-level search_path to include
# "tiger" and "topology" schemas (installed by postgis_tiger_geocoder and
# postgis_topology). Alembic autogenerate then sees those schemas' tables as
# pending DROPs when their schema attribute comes back as None (resolved via
# search_path). We pin search_path to "public" on each connection and also
# filter by known managed table names as a belt-and-suspenders guard.
_POSTGIS_MANAGED_TABLES = {"spatial_ref_sys"}


def include_object(obj, name, type_, reflected, compare_to) -> bool:
    # Drop PostGIS's own managed table from comparison...
    if type_ == "table" and name in _POSTGIS_MANAGED_TABLES:
        return False
    # The functional GiST index on (location::geometry) for the near-global bbox
    # fallback (#113, migration 0011) is hand-managed, not declared in the ORM
    # metadata. Alembic cannot reliably compare expression indexes (it would
    # report a false "removed index" drift), so exclude it here. Its presence is
    # asserted by name in pg_indexes by test_fountains_geometry_gist_migration.
    if type_ == "index" and name == "ix_fountains_location_geometry":
        return False
    # ...then defer to GeoAlchemy2 (filters spatial system views + the auto gist
    # index so `alembic check` does not see them as drift).
    return alembic_helpers.include_object(obj, name, type_, reflected, compare_to)


def get_url() -> str:
    return get_settings().database_url


def run_migrations_offline() -> None:
    context.configure(
        url=get_url(),
        target_metadata=target_metadata,
        include_object=include_object,
        render_item=alembic_helpers.render_item,
        process_revision_directives=alembic_helpers.writer,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection) -> None:
    # search_path is pinned to "public" at connection time via asyncpg server_settings
    # (see run_migrations_online) so autogenerate ignores the PostGIS extension schemas
    # (tiger, topology) the postgis/postgis Docker image adds to the DB-level search_path.
    # It is NOT set with an in-band `SET` here: that statement auto-begins a SQLAlchemy
    # 2.0 transaction, which makes Alembic's begin_transaction() a no-op (it assumes the
    # caller owns the commit) and leaves the migration uncommitted under engine.connect().
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        include_object=include_object,
        render_item=alembic_helpers.render_item,
        process_revision_directives=alembic_helpers.writer,
    )
    with context.begin_transaction():
        context.run_migrations()


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


if context.is_offline_mode():
    run_migrations_offline()
else:
    asyncio.run(run_migrations_online())
