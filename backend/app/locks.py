"""Shared Postgres advisory-lock keys.

Promoted from routers/fountains.py so the add-fountain endpoint and the OSM
importer serialize their spatial check-then-write against the SAME key (a
transaction-level advisory lock; releases on commit/rollback). Two writers
keyed differently would each pass the proximity check before the other commits
and both insert a near-duplicate.
"""

# "FNTR" — the single global add/merge serialization key (low write volume).
ADD_FOUNTAIN_LOCK_KEY = 0x464E5452

# Per-user advisory-lock namespaces for the fountain-photos feature (design §6). Used with
# the two-argument `pg_advisory_xact_lock(namespace, user_key)` form, where `user_key` is a
# deterministic per-user hash — distinct from each other and from `ADD_FOUNTAIN_LOCK_KEY` so
# these locks can never collide.
PHOTO_UPLOAD_LOCK_NS = 0x50554C44  # "PULD" — upload-reservation rate gate.
CONTENT_REPORT_LOCK_NS = 0x50525054  # "PRPT" — content report rate gate.
