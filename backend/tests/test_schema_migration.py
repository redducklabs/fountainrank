import uuid

from sqlalchemy import text


async def test_core_tables_exist(session):
    rows = (
        (
            await session.execute(
                text(
                    "SELECT table_name FROM information_schema.tables "
                    "WHERE table_schema = 'public' "
                    "AND table_name IN ('users','fountains','rating_types','ratings') "
                    "ORDER BY table_name"
                )
            )
        )
        .scalars()
        .all()
    )
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
