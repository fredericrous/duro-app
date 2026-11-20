"""Launch's readiness wait: python3 -m unittest discover -s <this dir>."""

import unittest

import verify


class CpuSeconds(unittest.TestCase):
    def test_sums_every_ps_time_shape(self) -> None:
        self.assertAlmostEqual(verify.cpu_seconds("0:01.50\n1:02.25\n1:00:00.00\n1-00:00:01.00"),
                               1.5 + 62.25 + 3600 + 86401)

    def test_no_members_is_zero(self) -> None:
        self.assertEqual(verify.cpu_seconds(""), 0.0)


def samples(rate: float, seconds: int) -> list[tuple[float, float]]:
    """One sample a second from t=0, gaining `rate` CPU-s per second."""
    return [(float(t), rate * t) for t in range(seconds + 1)]


class Stalled(unittest.TestCase):
    def test_loaded_cold_start_keeps_waiting(self) -> None:
        # 75 CPU-s over 170 s, the slowest measured start (load ~220).
        history = samples(75 / 170, 170)
        self.assertFalse(any(verify.stalled(history[: i + 1], t) for i, (t, _) in enumerate(history)))

    def test_idle_server_stalls_once_the_window_passes(self) -> None:
        history = samples(0.04, 40)  # 1.2 CPU-s in 30 s, the idle maximum seen
        self.assertFalse(verify.stalled(history[:30], 29.0))
        self.assertTrue(verify.stalled(history[:31], 30.0))

    def test_work_then_idle_stalls_after_a_window(self) -> None:
        busy = samples(1.0, 20)
        idle = [(20.0 + t, 20.0) for t in range(1, 40)]
        history = busy + idle
        self.assertFalse(verify.stalled(history[:45], history[44][0]))
        self.assertTrue(verify.stalled(history, history[-1][0]))

    def test_a_member_exiting_is_not_a_stall(self) -> None:
        # Busy at 0.5 CPU-s/s; at t=40 a member holding 14 CPU-s exits.
        history = [(float(t), 0.5 * t - (14.0 if t >= 40 else 0.0)) for t in range(81)]
        self.assertFalse(any(verify.stalled(history[: i + 1], t) for i, (t, _) in enumerate(history)))


# Lines 135-136 of a cold start whose dep scan skipped `.server` imports (t11).
FOUND = ("8:32:11 AM [vite] (client) ✨ new dependencies optimized: accept-language-parser, jose, "
         "@effect/sql-pg/PgClient, node-forge, nodemailer, openid-client")
RELOAD = "8:32:11 AM [vite] (client) ✨ optimized dependencies changed. reloading"


class DepReload(unittest.TestCase):
    def test_the_reload_line_is_quoted(self) -> None:
        log = "\n".join(["  ➜  Local:   http://127.0.0.1:53439/", FOUND, RELOAD, "GET / 200"])
        self.assertEqual(verify.dep_reload(log), RELOAD)

    def test_new_dependencies_alone_reload_nothing(self) -> None:
        self.assertEqual(verify.dep_reload(FOUND), "")

    def test_a_clean_log_has_none(self) -> None:
        self.assertEqual(verify.dep_reload("  ➜  Local:   http://127.0.0.1:53439/\n"), "")


def quiet_at(history: list[tuple[float, float]], t: int) -> bool:
    return verify.idle_for(history[: t + 1], float(t), verify.QUIET_WINDOW_S, verify.QUIET_CPU_S)


class Settle(unittest.TestCase):
    def test_an_idle_server_is_quiet_after_one_window(self) -> None:
        history = samples(0.04, 10)  # the idle maximum seen
        self.assertFalse(quiet_at(history, 2))
        self.assertTrue(quiet_at(history, 3))

    def test_a_rebundle_after_ready_is_not_quiet(self) -> None:
        # Idle, then vite re-bundles for 2 s at a full core, then idle.
        history = [(float(t), 0.04 * t + min(max(t - 1, 0), 2) * 1.0) for t in range(12)]
        self.assertFalse(any(quiet_at(history, t) for t in range(1, 6)))
        self.assertTrue(quiet_at(history, 6))


class Cap(unittest.TestCase):
    def test_a_capped_launch_tears_down_under_the_tool_ceiling(self) -> None:
        last_pass_ends = verify.CAP_S + verify.PASS_WORST_S + verify.SETTLE_WORST_S + verify.TEARDOWN_WORST_S
        self.assertLess(last_pass_ends, verify.TOOL_CEILING_S)
        self.assertGreaterEqual(verify.CAP_S, 2 * 170)  # the slowest start measured


if __name__ == "__main__":
    unittest.main()
