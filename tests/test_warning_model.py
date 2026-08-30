import sys, unittest
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "pipeline"))
from turkiye_warning_model import align, anomaly, band, changes, clamp, fallback, monthly_pressure, robust_z

class ModelTests(unittest.TestCase):
    def test_clamp(self): self.assertEqual((clamp(-2), clamp(120)), (0, 100))
    def test_bands(self): self.assertEqual([band(x) for x in (0, 25, 45, 65, 80)], ["BASELINE", "WATCH", "ELEVATED", "HIGH", "SEVERE"])
    def test_robust_z_direction(self): self.assertGreater(robust_z(20, [1,2,3,4,5,6,7,8]), 1)
    def test_anomaly_ignores_favorable(self): self.assertEqual(anomaly(-4), 0)
    def test_changes(self): self.assertAlmostEqual(changes([100, 110])[-1], 10)
    def test_inner_join(self):
        d1, d2 = date(2026,1,1), date(2026,1,2)
        self.assertEqual(align([(d1, 40)], [(d1, 70), (d2, 80)]), [(d1, 2800)])
    def test_monthly_adverse_direction(self):
        rows=[(date(2023+i//12, i%12+1, 1), 100+i%5) for i in range(40)]
        rows[-1]=(rows[-1][0], 70)
        out=monthly_pressure(rows,-1,"reserve_buffer",.2,"m","r","u")
        self.assertGreater(out["score"], 40)
    def test_recent_component_fallback_is_keyless_and_expires(self):
        now=datetime.now(timezone.utc)
        component={"key":"lira_dislocation","score":51,"available":True,"weight":.3,"evidence":[]}
        recent={"meta":{"generated":(now-timedelta(hours=2)).isoformat()},"components":{"lira_dislocation":component}}
        kept=fallback(recent,"lira_dislocation",now,RuntimeError("offline"))
        self.assertEqual(kept["score"],51);self.assertTrue(kept["retained"]);self.assertNotIn("retained",component)
        stale={"meta":{"generated":(now-timedelta(hours=73)).isoformat()},"components":{"lira_dislocation":component}}
        self.assertFalse(fallback(stale,"lira_dislocation",now,RuntimeError("offline"))["available"])
    def test_workflow_verifies_before_refresh(self):
        workflow=(Path(__file__).resolve().parents[1]/".github"/"workflows"/"pipeline.yml").read_text(encoding="utf-8")
        self.assertIn("Verify keyless offline contracts",workflow)
        self.assertLess(workflow.index("python -m unittest discover"),workflow.index("Refresh public data"))

if __name__ == "__main__": unittest.main()
