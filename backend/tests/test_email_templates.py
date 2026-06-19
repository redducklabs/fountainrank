import pytest

from app.email.templates import render


@pytest.mark.parametrize("etype", ["SignIn", "Register", "ForgotPassword", "Generic"])
def test_render_includes_code_in_subject_html_text(etype):
    subject, html, text = render(etype, {"code": "123456"})
    assert subject  # non-empty subject per type
    assert "123456" in html
    assert "123456" in text
    assert "FountainRank" in html


def test_unknown_type_falls_back_to_generic():
    subject, html, text = render("SomethingElse", {"code": "999000"})
    generic_subject, _, _ = render("Generic", {"code": "999000"})
    assert subject == generic_subject
    assert "999000" in text


def test_autoescape_escapes_html_in_values():
    # A code is digits in practice, but escaping must be on so a hostile value can't inject.
    _, html, _ = render("SignIn", {"code": "<script>x</script>"})
    assert "<script>" not in html
    assert "&lt;script&gt;" in html


def test_link_rendered_when_present():
    _, html, text = render("SignIn", {"code": "123456", "link": "https://fountainrank.com/x"})
    assert "https://fountainrank.com/x" in html
    assert "https://fountainrank.com/x" in text
