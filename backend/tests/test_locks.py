from app.locks import ADD_FOUNTAIN_LOCK_KEY


def test_add_fountain_lock_key_is_fntr():
    assert ADD_FOUNTAIN_LOCK_KEY == 0x464E5452


def test_router_uses_shared_lock_key():
    import app.routers.fountains as f

    assert f.ADD_FOUNTAIN_LOCK_KEY is ADD_FOUNTAIN_LOCK_KEY


async def test_acquire_add_fountain_lock_logs_wait_and_acquired(session, caplog):
    import logging

    from app.locks import acquire_add_fountain_lock

    with caplog.at_level(logging.INFO, logger="app.locks"):
        await acquire_add_fountain_lock(session, context="unit-test")
    msgs = [r.message for r in caplog.records if r.name == "app.locks"]
    assert "advisory_lock_wait" in msgs
    assert "advisory_lock_acquired" in msgs
