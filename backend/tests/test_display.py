from app.display import ANONYMOUS_DISPLAY_NAME, public_display_name, resolved_display_name

SUB = "4zsznfwtd8cx"


def test_resolved_prefers_nickname():
    assert resolved_display_name(display_name="Real Name", logto_user_id=SUB, nickname="Nick") == "Nick"


def test_resolved_falls_back_to_display_name():
    assert resolved_display_name(display_name="Real Name", logto_user_id=SUB, nickname=None) == "Real Name"
    assert resolved_display_name(display_name="Real Name", logto_user_id=SUB, nickname="   ") == "Real Name"


def test_resolved_none_when_anonymous():
    # display_name fell back to the subject and no nickname -> Anonymous (None).
    assert resolved_display_name(display_name=SUB, logto_user_id=SUB, nickname=None) is None
    assert resolved_display_name(display_name=SUB, logto_user_id=SUB, nickname="") is None


def test_resolved_nickname_rescues_anonymous():
    assert resolved_display_name(display_name=SUB, logto_user_id=SUB, nickname="Nick") == "Nick"


def test_public_masks_to_anonymous():
    assert public_display_name(SUB, SUB, None) == ANONYMOUS_DISPLAY_NAME
    assert public_display_name("Real Name", SUB, None) == "Real Name"
    assert public_display_name(SUB, SUB, "Nick") == "Nick"
