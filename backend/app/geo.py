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


def within_radius(
    location_col, latitude: float, longitude: float, radius_m: float
) -> ColumnElement:
    """True when `location_col` is within `radius_m` metres of (latitude, longitude).

    All proximity checks route through here so the (lon, lat) ordering lives in exactly
    one place (see point_geography). `ST_DWithin` on geography uses metres and is
    inclusive at the boundary.
    """
    return func.ST_DWithin(
        cast(location_col, Geography), point_geography(latitude, longitude), radius_m
    )
