# Account sanctions implementation plan (#13)

1. Add migration `0030_account_sanctions`, ORM fields/checks/index, and expand moderation-action
   constraints, including explicit admin/system audit actors. Add real upgrade/downgrade and
   name-parity tests, including the documented refusal once sanction history exists.
2. Add method-aware sanction enforcement to the shared auth dependency, including atomic automatic
   suspension expiry under `FOR UPDATE`, a same-transaction system expiry audit, stable 403 details,
   and the explicit `DELETE /me` exemption. Add read/write boundary tests across every router and a
   deterministic expiry-vs-ban race test.
3. Add sanction request/response schemas and the admin transition endpoint with row locking,
   self/admin-target protection, idempotency, validation, and same-transaction audit writes.
4. Enrich the admin-only moderation queue with contributor IDs and current sanction state for photo,
   note, and fountain contributors.
5. Add web and mobile queue controls for suspend, ban, and lift, with reason/expiry inputs,
   destructive confirmation, error states, cache invalidation, and tests. Expose sanction state on
   `/me` and render a clear sanctioned-user explanation. Update the style guide.
6. Regenerate the shared client; run backend, workspace, Expo Doctor, migration, build, and security
   checks. Obtain independent review, address findings, open a PR, wait for green CI, and squash
   merge.
