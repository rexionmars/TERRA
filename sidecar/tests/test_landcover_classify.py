"""
The model paths, run over synthetic products.

What the split of the predict action bought here. The choice between the three
paths, the cumulative-stack loop that produces the retention series, and the
difference between "no valid data" and "a map with nothing in it" were all
inside a 393-line action reachable only through stdin and a subprocess.

The feature matrix and the classifier are stood in for. Nothing here loads a
model artifact, reads a COG, or touches the network.
"""

from __future__ import annotations

from datetime import datetime

import numpy as np
import pytest

from terra.landcover import classify, features

SHAPE = (4, 4)


def product(day):
    return {'date': datetime(2024, 1, day), 'id': f'S2_{day:02d}'}


class Encoder:
    """A label encoder over the classifier's own five classes."""

    classes_ = np.array([3, 21, 25, 39, 41])

    def inverse_transform(self, codes):
        return self.classes_[np.asarray(codes)]


class Forest:
    """A classifier that answers `predicted` for every row it is given."""

    def __init__(self, predicted=3):
        self.predicted = predicted
        self.code = int(np.where(Encoder.classes_ == predicted)[0][0])

    def predict(self, rows):
        return np.full(len(rows), self.code)

    def predict_proba(self, rows):
        out = np.zeros((len(rows), len(Encoder.classes_)))
        out[:, self.code] = 0.9
        return out


class Scaler:
    def transform(self, rows):
        return rows


@pytest.fixture
def matrix(monkeypatch):
    """build_feature_matrix answering from a value the test sets."""
    state = {'rows': np.ones((SHAPE[0] * SHAPE[1], 80))}

    def build(products, polygon, ref_profile, n_dates):
        if state['rows'] is None:
            return None, None
        return state['rows'], np.ones(SHAPE, dtype=bool)

    monkeypatch.setattr(features, 'build_feature_matrix', build)
    return state


def test_the_spectral_path_returns_its_feature_rows_for_the_fingerprint(matrix):
    out = classify.run(
        [product(1), product(6)], polygon=None, ref_profile=None,
        kind='spectral', mode='single', model_dir=None,
        artifacts=(Forest(), Scaler(), Encoder()), n_dates_model=22,
    )

    assert out.classification.shape == SHAPE
    assert (out.classification == 3).all()
    assert out.feature_matrix is not None
    assert out.temporal == []


def test_the_temporal_mode_reports_one_row_per_date_and_classifies_the_full_stack(matrix):
    """
    The final map is the full cumulative stack, so a temporal run and a single
    run over the same products classify the same pixels; only the series is
    extra.
    """
    products = [product(1), product(6), product(11)]

    out = classify.run(
        products, polygon=None, ref_profile=None,
        kind='spectral', mode='temporal', model_dir=None,
        artifacts=(Forest(), Scaler(), Encoder()), n_dates_model=22,
    )

    assert [row['date'] for row in out.temporal] == \
        ['2024-01-01', '2024-01-06', '2024-01-11']
    assert [row['n_dates_stack'] for row in out.temporal] == [1, 2, 3]
    assert out.classification.shape == SHAPE


def test_a_date_with_no_reference_mask_reports_no_retention(matrix):
    out = classify.run(
        [product(1)], polygon=None, ref_profile=None,
        kind='spectral', mode='temporal', model_dir=None,
        artifacts=(Forest(), Scaler(), Encoder()), n_dates_model=22,
        soja_mask=None,
    )

    row = out.temporal[0]
    assert row['soja_retention_pct'] is None
    assert row['dominant'] is None


def test_the_retention_is_the_share_of_reference_pixels_still_called_soja(matrix):
    mask = np.zeros(SHAPE, dtype=bool)
    mask[0, :] = True

    out = classify.run(
        [product(1)], polygon=None, ref_profile=None,
        kind='spectral', mode='temporal', model_dir=None,
        artifacts=(Forest(predicted=39), Scaler(), Encoder()), n_dates_model=22,
        soja_mask=mask,
    )

    # Every reference pixel came back as soja, and 39 is the soja class id.
    assert out.temporal[0]['soja_retention_pct'] == 100.0
    assert out.temporal[0]['dominant'] is not None


def test_no_valid_data_raises_rather_than_exiting(matrix):
    """
    The action turns this into a message and an exit status. A module that
    exits cannot be called by a test that expects to carry on.
    """
    matrix['rows'] = None

    with pytest.raises(classify.NoValidData):
        classify.run(
            [product(1)], polygon=None, ref_profile=None,
            kind='spectral', mode='single', model_dir=None,
            artifacts=(Forest(), Scaler(), Encoder()), n_dates_model=22,
        )


def test_progress_is_the_callers_and_the_run_writes_to_no_stream(matrix, capsys):
    seen = []

    classify.run(
        [product(1), product(6)], polygon=None, ref_profile=None,
        kind='spectral', mode='temporal', model_dir=None,
        artifacts=(Forest(), Scaler(), Encoder()), n_dates_model=22,
        progress=lambda pct, msg: seen.append((pct, msg)),
    )

    assert [pct for pct, _ in seen] == [55, 90]
    captured = capsys.readouterr()
    assert captured.out == '' and captured.err == ''
