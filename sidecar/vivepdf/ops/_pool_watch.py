from collections.abc import Iterable
from typing import Any


class WorkerLost(Exception):
    pass


class PoolWatch:
    def __init__(self, pool: Any) -> None:
        self.started = tuple(pool._pool)

    def check(self, jobs: Iterable[Any]) -> None:
        stopped = any(process.exitcode is not None for process in self.started)
        if stopped and not all(job.ready() for job in jobs):
            raise WorkerLost("a worker process stopped before its jobs finished")
