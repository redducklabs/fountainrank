-- Frozen place hierarchy backfill for migration 0025.
-- Do not import or mirror app.membership dynamically from this migration. This SQL is the
-- historical algorithm for revision 0025 and must remain stable even if application code changes.

UPDATE place_boundaries pb
SET place_kind = CASE
    WHEN pb.subtype = 'country' THEN 'country'
    WHEN pb.subtype = ANY(COALESCE(cfg.eligible_region_subtypes, ARRAY['region']))
        THEN 'region'
    WHEN pb.subtype = ANY(COALESCE(cfg.eligible_city_subtypes, ARRAY['locality', 'localadmin']))
        THEN 'city'
    ELSE NULL
END
FROM place_boundaries src
LEFT JOIN place_scope_config cfg ON cfg.country_code = src.country_code
WHERE pb.id = src.id
  AND pb.place_kind IS DISTINCT FROM CASE
    WHEN src.subtype = 'country' THEN 'country'
    WHEN src.subtype = ANY(COALESCE(cfg.eligible_region_subtypes, ARRAY['region']))
        THEN 'region'
    WHEN src.subtype = ANY(COALESCE(cfg.eligible_city_subtypes, ARRAY['locality', 'localadmin']))
        THEN 'city'
    ELSE NULL
END;

UPDATE place_boundaries SET is_canonical = false WHERE is_canonical;

UPDATE place_boundaries
SET parent_id = NULL
WHERE place_kind IS DISTINCT FROM 'region';

UPDATE place_boundaries child
SET parent_id = p.country_id
FROM (
    SELECT c.id AS child_id, ctry.id AS country_id
    FROM place_boundaries c
    LEFT JOIN LATERAL (
        SELECT pb.id
        FROM place_boundaries pb
        WHERE pb.place_kind = 'country'
          AND pb.country_code = c.country_code
        ORDER BY pb.overture_id ASC
        LIMIT 1
    ) ctry ON TRUE
    WHERE c.place_kind = 'region'
) p
WHERE child.id = p.child_id
  AND child.parent_id IS DISTINCT FROM p.country_id;

UPDATE fountains f
SET country_place_id = m.country_place_id,
    region_place_id = m.region_place_id,
    city_place_id = m.city_place_id
FROM (
    SELECT
        f2.id AS fountain_id,
        cc.country_place_id,
        region.region_place_id,
        city.city_place_id
    FROM fountains f2
    LEFT JOIN LATERAL (
        SELECT pb.id AS country_place_id, pb.country_code
        FROM place_boundary_cells c
        JOIN place_boundaries pb ON pb.id = c.place_id
        WHERE pb.place_kind = 'country'
          AND ST_Covers(c.geom, f2.location::geometry)
        ORDER BY pb.overture_id ASC
        LIMIT 1
    ) cc ON TRUE
    LEFT JOIN LATERAL (
        SELECT pb.id AS region_place_id
        FROM place_boundary_cells c
        JOIN place_boundaries pb ON pb.id = c.place_id
        WHERE pb.country_code = cc.country_code
          AND pb.place_kind = 'region'
          AND ST_Covers(c.geom, f2.location::geometry)
        ORDER BY ST_Area(pb.boundary) ASC, pb.overture_id ASC
        LIMIT 1
    ) region ON TRUE
    LEFT JOIN LATERAL (
        SELECT pb.id AS city_place_id
        FROM place_boundary_cells c
        JOIN place_boundaries pb ON pb.id = c.place_id
        WHERE pb.country_code = cc.country_code
          AND pb.place_kind = 'city'
          AND ST_Covers(c.geom, f2.location::geometry)
        ORDER BY (CASE pb.subtype
            WHEN 'locality' THEN 3
            WHEN 'localadmin' THEN 2
            WHEN 'county' THEN 1
            ELSE 0
        END) DESC,
        ST_Area(pb.boundary) ASC, pb.overture_id ASC
        LIMIT 1
    ) city ON TRUE
) m
WHERE f.id = m.fountain_id
  AND (f.country_place_id IS DISTINCT FROM m.country_place_id
       OR f.region_place_id IS DISTINCT FROM m.region_place_id
       OR f.city_place_id IS DISTINCT FROM m.city_place_id);

WITH ranked AS (
    SELECT id, ROW_NUMBER() OVER (
        PARTITION BY country_code, slug
        ORDER BY ST_Area(boundary) DESC, overture_id ASC
    ) AS rn
    FROM place_boundaries
    WHERE place_kind = 'region'
)
UPDATE place_boundaries SET is_canonical = true
WHERE id IN (SELECT id FROM ranked WHERE rn = 1);

UPDATE place_boundaries city
SET parent_id = p.parent_id
FROM (
    SELECT c.id AS city_id,
           CASE
               WHEN COALESCE(cardinality(cfg.eligible_region_subtypes), 1) = 0 THEN country.id
               ELSE region.id
           END AS parent_id
    FROM place_boundaries c
    LEFT JOIN place_scope_config cfg ON cfg.country_code = c.country_code
    LEFT JOIN LATERAL (
        SELECT pb.id
        FROM place_boundaries pb
        WHERE pb.place_kind = 'country'
          AND pb.country_code = c.country_code
        ORDER BY pb.overture_id ASC
        LIMIT 1
    ) country ON TRUE
    LEFT JOIN LATERAL (
        SELECT pb.id
        FROM place_boundary_cells cell
        JOIN place_boundaries pb ON pb.id = cell.place_id
        WHERE pb.place_kind = 'region'
          AND pb.is_canonical = true
          AND pb.country_code = c.country_code
          AND ST_Covers(cell.geom, ST_PointOnSurface(c.boundary::geometry))
        ORDER BY ST_Area(pb.boundary) ASC, pb.overture_id ASC
        LIMIT 1
    ) region ON TRUE
    WHERE c.place_kind = 'city'
) p
WHERE city.id = p.city_id
  AND city.parent_id IS DISTINCT FROM p.parent_id;

WITH counts AS (
    SELECT place_id, count(*) AS n
    FROM (
        SELECT city_place_id AS place_id FROM fountains
        WHERE is_hidden = false AND city_place_id IS NOT NULL
        UNION ALL
        SELECT region_place_id FROM fountains
        WHERE is_hidden = false AND region_place_id IS NOT NULL
        UNION ALL
        SELECT country_place_id FROM fountains
        WHERE is_hidden = false AND country_place_id IS NOT NULL
    ) x
    GROUP BY place_id
)
UPDATE place_boundaries pb
SET fountain_count = COALESCE(counts.n, 0)
FROM place_boundaries pb2
LEFT JOIN counts ON counts.place_id = pb2.id
WHERE pb.id = pb2.id
  AND pb.fountain_count IS DISTINCT FROM COALESCE(counts.n, 0);

WITH eligible AS (
    SELECT pb.id, pb.country_code, pb.parent_id, pb.slug, pb.subtype, pb.fountain_count,
           pb.overture_id
    FROM place_boundaries pb
    WHERE pb.place_kind = 'city' AND pb.parent_id IS NOT NULL
),
ranked AS (
    SELECT id, ROW_NUMBER() OVER (
        PARTITION BY country_code, parent_id, slug
        ORDER BY (CASE subtype
            WHEN 'locality' THEN 3
            WHEN 'localadmin' THEN 2
            WHEN 'county' THEN 1
            ELSE 0
        END) DESC, fountain_count DESC, overture_id ASC
    ) AS rn
    FROM eligible
)
UPDATE place_boundaries SET is_canonical = true
WHERE id IN (SELECT id FROM ranked WHERE rn = 1);

UPDATE fountains f
SET city_place_id = remap.canonical_city_id
FROM (
    SELECT f2.id AS fountain_id,
           CASE
               WHEN city.parent_id IS NULL THEN NULL
               ELSE canonical.id
           END AS canonical_city_id
    FROM fountains f2
    JOIN place_boundaries city ON city.id = f2.city_place_id
    LEFT JOIN place_boundaries canonical
      ON canonical.country_code = city.country_code
     AND canonical.parent_id = city.parent_id
     AND canonical.slug = city.slug
     AND canonical.place_kind = 'city'
     AND canonical.is_canonical = true
) remap
WHERE f.id = remap.fountain_id
  AND f.city_place_id IS DISTINCT FROM remap.canonical_city_id;

WITH counts AS (
    SELECT place_id, count(*) AS n
    FROM (
        SELECT city_place_id AS place_id FROM fountains
        WHERE is_hidden = false AND city_place_id IS NOT NULL
        UNION ALL
        SELECT region_place_id FROM fountains
        WHERE is_hidden = false AND region_place_id IS NOT NULL
        UNION ALL
        SELECT country_place_id FROM fountains
        WHERE is_hidden = false AND country_place_id IS NOT NULL
    ) x
    GROUP BY place_id
)
UPDATE place_boundaries pb
SET fountain_count = COALESCE(counts.n, 0)
FROM place_boundaries pb2
LEFT JOIN counts ON counts.place_id = pb2.id
WHERE pb.id = pb2.id
  AND pb.fountain_count IS DISTINCT FROM COALESCE(counts.n, 0);
