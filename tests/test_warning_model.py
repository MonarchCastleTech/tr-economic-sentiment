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

    def test_retained_source_does_not_gain_a_new_window(self):
        now=datetime.now(timezone.utc)
        old={"meta":{"generated":(now-timedelta(hours=71)).isoformat()},"components":{"lira_dislocation":{"score":51,"available":True,"weight":.3}}}
        retained=fallback(old,"lira_dislocation",now,RuntimeError("offline"))
        refreshed={"meta":{"generated":now.isoformat()},"components":{"lira_dislocation":retained}}
        self.assertFalse(fallback(refreshed,"lira_dislocation",now+timedelta(hours=2),RuntimeError("offline"))["available"])

    def test_fx_failure_does_not_block_other_sources(self):
        import json, tempfile
        from unittest.mock import patch
        import turkiye_warning_model as model
        def fail(*args): raise RuntimeError("exchange-rate source unavailable")
        def component(key): return {"key":key,"score":20,"weight":model.WEIGHTS[key],"available":True,"retained":False}
        with tempfile.TemporaryDirectory() as directory:
            output=Path(directory)/"output.json"
            with patch.object(model,"OUTPUT",output), patch.object(model,"collect_fx_days",fail), patch.object(model,"fred_series",lambda *args:[]), patch.object(model,"monthly_pressure",side_effect=lambda rows, direction, key, *args:component(key)), patch.object(model,"collect_narrative",lambda now:component("narrative_strain")):
                model.main()
            result=json.loads(output.read_text(encoding="utf-8"))
        self.assertEqual(result["meta"]["coverage"],"3/5")
        self.assertFalse(result["components"]["lira_dislocation"]["available"])
        self.assertFalse(result["components"]["imported_energy"]["available"])

if __name__ == "__main__": unittest.main()
