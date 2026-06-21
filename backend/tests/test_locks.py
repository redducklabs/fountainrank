from app.locks import ADD_FOUNTAIN_LOCK_KEY


def test_add_fountain_lock_key_is_fntr():
    assert ADD_FOUNTAIN_LOCK_KEY == 0x464E5452


def test_router_uses_shared_lock_key():
    import app.routers.fountains as f

    assert f.ADD_FOUNTAIN_LOCK_KEY is ADD_FOUNTAIN_LOCK_KEY
