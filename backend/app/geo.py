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
