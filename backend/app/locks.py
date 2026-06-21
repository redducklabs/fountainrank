"""Shared Postgres advisory-lock keys.

Promoted from routers/fountains.py so the add-fountain endpoint and the OSM
importer serialize their spatial check-then-write against the SAME key (a
transaction-level advisory lock; releases on commit/rollback). Two writers
keyed differently would each pass the proximity check before the other commits
and both insert a near-duplicate.
"""

# "FNTR" — the single global add/merge serialization key (low write volume).
ADD_FOUNTAIN_LOCK_KEY = 0x464E5452
