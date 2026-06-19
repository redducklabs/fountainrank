"""Render Logto auth emails (verification code) — minimal, clean, brand-light.

One subject + HTML + text per Logto email `type`, sharing a single body template whose
intro line varies by type. Jinja2 autoescaping is on (HTML), so any value is safely
escaped. A `link` (forward-compat with magic-link) is rendered when present. English only
for now; non-English locales fall back to this copy.
"""

from jinja2 import Environment, select_autoescape

_env = Environment(autoescape=select_autoescape(["html", "xml"]))

_SUBJECTS = {
    "SignIn": "Your FountainRank sign-in code",
    "Register": "Verify your FountainRank email",
    "ForgotPassword": "Reset your FountainRank password",
    "Generic": "Your FountainRank verification code",
}
_INTROS = {
    "SignIn": "Use this code to sign in to FountainRank:",
    "Register": "Use this code to verify your email and finish creating your FountainRank account:",
    "ForgotPassword": "Use this code to reset your FountainRank password:",
    "Generic": "Your FountainRank verification code:",
}

_HTML = _env.from_string(
    """<!doctype html><html><body style="font-family:system-ui,Arial,sans-serif;color:#111">
<p>{{ intro }}</p>
{% if code %}<p style="font-size:28px;font-weight:700;letter-spacing:3px">{{ code }}</p>{% endif %}
{% if link %}<p><a href="{{ link }}">Continue to FountainRank</a></p>{% endif %}
<p style="color:#666;font-size:13px">If you didn't request this, you can ignore this email.</p>
<p style="color:#666;font-size:13px">— FountainRank</p>
</body></html>"""
)
_TEXT = _env.from_string(
    """{{ intro }}

{% if code %}{{ code }}
{% endif %}{% if link %}{{ link }}
{% endif %}
If you didn't request this, you can ignore this email.
— FountainRank
"""
)


def render(email_type: str, payload: dict) -> tuple[str, str, str]:
    etype = email_type if email_type in _SUBJECTS else "Generic"
    ctx = {"intro": _INTROS[etype], "code": payload.get("code"), "link": payload.get("link")}
    return _SUBJECTS[etype], _HTML.render(**ctx), _TEXT.render(**ctx)
