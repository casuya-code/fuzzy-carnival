"""Tests for xfade transition planning (native and custom; no rendering required)."""

import pytest

from app.services.video_transitions import (
    ALLOWED_TRANSITIONS,
    CUSTOM_TRANSITION_EXPRS,
    DEFAULT_TRANSITION,
    build_xfade_filtergraph,
    normalize_transition,
    parse_transitions,
)


def test_normalize_transition_validates_names():
    assert normalize_transition(" FADE ") == "fade"
    with pytest.raises(ValueError):
        normalize_transition("3d-cube")


def test_parse_transitions_pads_to_gap_count():
    assert parse_transitions('["wiperight"]', 3, "fade") == [
        "wiperight", "fade", "fade"
    ]
    assert parse_transitions(None, 2) == ["fade", "fade"]
    with pytest.raises(ValueError):
        parse_transitions('["nope"]', 1)


def test_xfade_offsets_account_for_previous_overlaps():
    graph, final_label, total = build_xfade_filtergraph(
        durations=[10.0, 6.0, 4.0],
        transitions=["fade", "wiperight"],
        duration_sec=0.5,
    )
    assert "offset=9.500" in graph
    assert "offset=15.000" in graph
    assert final_label == "x2"
    assert total == pytest.approx(19.0)


def test_transition_overlap_is_clamped_to_shorter_clip():
    graph, _label, _total = build_xfade_filtergraph(
        durations=[10.0, 0.4],
        transitions=[DEFAULT_TRANSITION],
        duration_sec=1.5,
    )
    assert "duration=0.200" in graph


def test_custom_transitions_are_allowlisted_and_quote_safe():
    assert set(CUSTOM_TRANSITION_EXPRS) <= ALLOWED_TRANSITIONS
    for name, expr in CUSTOM_TRANSITION_EXPRS.items():
        assert normalize_transition(name.upper()) == name
        assert "'" not in expr
        assert ";" not in expr


def test_custom_transition_uses_xfade_custom_expression():
    graph, _label, _total = build_xfade_filtergraph(
        durations=[5.0, 5.0],
        transitions=["glitch"],
        duration_sec=0.5,
    )
    assert "transition=custom:expr=" in graph
    assert "xfade=transition=wiperight:" in build_xfade_filtergraph(
        [5.0, 5.0], ["wiperight"], 0.5
    )[0]


def test_heart_and_exchange_are_custom_transitions():
    for name in ("heart", "exchange"):
        assert name in CUSTOM_TRANSITION_EXPRS
        graph, _label, _total = build_xfade_filtergraph(
            durations=[5.0, 5.0], transitions=[name], duration_sec=0.5
        )
        assert "transition=custom:expr=" in graph


def test_deferred_transitions_are_not_exposed_yet():
    deferred = {"collage", "cube3d", "pageturn"}
    assert not deferred & ALLOWED_TRANSITIONS
    for name in deferred:
        with pytest.raises(ValueError):
            normalize_transition(name)
