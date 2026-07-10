from sqlalchemy import select

from app.geo import point_geography, within_radius


async def test_within_radius_true_when_point_inside(session):
    # A fountain point and a query point ~5.5 m north; 50 m radius -> inside.
    loc = point_geography(40.0, -73.0)
    expr = within_radius(loc, 40.00005, -73.0, 50.0)
    result = (await session.execute(select(expr))).scalar_one()
    assert result is True


async def test_within_radius_false_when_point_outside(session):
    loc = point_geography(40.0, -73.0)
    expr = within_radius(loc, 41.0, -73.0, 50.0)  # ~111 km away
    result = (await session.execute(select(expr))).scalar_one()
    assert result is False
