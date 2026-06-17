import asyncio
from logging.config import fileConfig

from alembic import context
from sqlalchemy import MetaData, text
from sqlalchemy.ext.asyncio import create_async_engine

from app.config import get_settings

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# No ORM models yet (Phase 1 introduces them). An empty MetaData gives Alembic a
# valid comparison target so `alembic check` runs the autogenerate path and can
# report no drift.
target_metadata = MetaData()

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
    if type_ == "table" and name in _POSTGIS_MANAGED_TABLES:
        return False
    return True


def get_url() -> str:
    return get_settings().database_url


def run_migrations_offline() -> None:
    context.configure(
        url=get_url(),
        target_metadata=target_metadata,
        include_object=include_object,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection) -> None:
    # Pin search_path to public so autogenerate ignores PostGIS extension schemas
    # (tiger, topology) that the postgis/postgis Docker image adds to the DB-level
    # search_path. Without this, every Tiger-geocoder table appears as a pending DROP.
    connection.execute(text("SET search_path TO public"))
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        include_object=include_object,
    )
    with context.begin_transaction():
        context.run_migrations()


async def run_migrations_online() -> None:
    engine = create_async_engine(get_url())
    async with engine.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await engine.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    asyncio.run(run_migrations_online())
