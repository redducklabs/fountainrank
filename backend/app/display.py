"""Public author display names.

Provisioning falls back to the Logto subject for ``users.display_name`` when a token
carries no ``name``/``username`` (see ``app/auth.py``). That subject must never reach an
unauthenticated reader, so any PUBLIC surface (notes now; leaderboards later) routes the
name through ``public_display_name``.
"""

ANONYMOUS_DISPLAY_NAME = "Anonymous"


def public_display_name(display_name: str, logto_user_id: str) -> str:
    """Return a public-safe author name — never the raw Logto subject.

    When provisioning fell back to the subject (display_name == logto_user_id), show a
    generic label until the user syncs a real profile.
    """
    return ANONYMOUS_DISPLAY_NAME if display_name == logto_user_id else display_name
