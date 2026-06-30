"""Public author display names.

Provisioning falls back to the Logto subject for ``users.display_name`` when a token
carries no ``name``/``username`` (see ``app/auth.py``). That subject must never reach a
reader, so any PUBLIC surface (notes, leaderboards) routes the name through
``public_display_name``, and the self-view (``/me``) routes it through
``resolved_display_name`` (returning ``None`` rather than the subject).

A user may also set a ``nickname`` (see ``users.nickname``) that overrides the IdP-synced
``display_name``; both helpers take it and prefer it when present.
"""

ANONYMOUS_DISPLAY_NAME = "Anonymous"


def resolved_display_name(
    display_name: str, logto_user_id: str, nickname: str | None = None
) -> str | None:
    """The public-safe author name, or ``None`` when the account still resolves to the raw
    Logto subject (i.e. would show "Anonymous"). Resolution order: nickname (when set and
    non-blank) → IdP ``display_name`` → ``None``. A set nickname is validated at write time to
    never equal the subject, so it can never mask."""
    name = (nickname or "").strip() or display_name
    return None if name == logto_user_id else name


def public_display_name(display_name: str, logto_user_id: str, nickname: str | None = None) -> str:
    """Return a public-safe author name — never the raw Logto subject. Masks to a generic
    label when the account has no real name (no nickname and ``display_name`` fell back to the
    subject)."""
    return resolved_display_name(display_name, logto_user_id, nickname) or ANONYMOUS_DISPLAY_NAME
