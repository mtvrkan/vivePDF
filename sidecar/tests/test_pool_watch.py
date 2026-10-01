from types import SimpleNamespace

import pytest

from vivepdf.ops._pool_watch import PoolWatch, WorkerLost


def _pool(*exitcodes: int | None) -> SimpleNamespace:
    return SimpleNamespace(_pool=[SimpleNamespace(exitcode=code) for code in exitcodes])


def _job(ready: bool) -> SimpleNamespace:
    return SimpleNamespace(ready=lambda: ready)


def test_running_workers_pass() -> None:
    PoolWatch(_pool(None, None)).check([_job(False)])


def test_a_stopped_worker_with_unfinished_jobs_is_reported() -> None:
    with pytest.raises(WorkerLost):
        PoolWatch(_pool(None, 1)).check([_job(True), _job(False)])


def test_workers_leaving_after_every_job_finished_are_not_a_loss() -> None:
    PoolWatch(_pool(0, 0)).check([_job(True), _job(True)])


def test_replacement_workers_do_not_hide_a_lost_one() -> None:
    pool = _pool(1)
    watch = PoolWatch(pool)
    pool._pool = [SimpleNamespace(exitcode=None)]
    with pytest.raises(WorkerLost):
        watch.check([_job(False)])
