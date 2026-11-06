# Part of the APK.audio project — http://APK.audio — made by Anthony Kuzub
# MIT Licence. Free, for everyone, for ever. Full text in LICENSE at the root.
"""The IfcOpenShell check of an exported power chain (IFC-CORE-DELTAS power-2/3 VERIFY). Test-time
only: IfcOpenShell is LGPL and never vendored, never loaded by the page.

    python3 -I scripts/validate-ifc.py power.ifc [more.ifc ...]

prints one JSON object per file:
  schema         FILE_SCHEMA (IFC4X3_ADD2)
  statements     ifcopenshell.validate with express_rules=True: every schema and where-rule finding
  pset_problems  every Pset_/Qto_ against the IFC4X3 templates and every APK_ set against apk_psets.py,
                 by the BIM repo's oracle (tools/ifc/oracle.py) when it is beside this app
  ids            apk-av.ids through ifctester: [name, passed, applicable, first reasons] per specification
  undeclared_breaking  the breakers (and breaker types) that state no ICU60947: no default capacity, so the
                 IDS breaker spec flags them until the designer declares one — reported, not an exit failure
  circuits       per IfcDistributionCircuit: Name, the classes ifcopenshell.util.system.get_system_elements
                 returns, and its APK_PowerRollup
  racks          per rack assembly: kit_report.walk's weight (declared total wins, else the sum of direct
                 parts) and APK_RackQuantities.LoadedGrossWeight
  checks         the chain's own shape: every CIRCUITBREAKER has RatedCurrent + ConductorFunction (on it or its
                 type) and sits in the board's IfcRelAggregates; every circuit holds exactly one breaker; every
                 load's supply port is connected; a rack's LoadedGrossWeight equals kit_report's walk
Exit status 1 when any file has a statement, a Pset problem, a failed board/breaker IDS spec or a failed check.
"""
import json
import sys
from pathlib import Path

import ifcopenshell
import ifcopenshell.util.element as UE
import ifcopenshell.util.system as US
import ifcopenshell.validate

HERE = Path(__file__).resolve().parent
TOOLS = HERE.parents[4] / "POD.database/DATABASE.server.BIM/SRC/tools/ifc"
BREAKING = "Circuit breakers carry breaking capacity"
OWN_SPECS = ("Distribution boards carry their rating", BREAKING)


def _tools():
    if (TOOLS / "oracle.py").exists():
        sys.path.insert(0, str(TOOLS))
        import oracle  # noqa: E402
        import kit_report  # noqa: E402
        return oracle, kit_report
    return None, None


def statements(f):
    log = ifcopenshell.validate.json_logger()
    ifcopenshell.validate.validate(f, log, express_rules=True)
    return [str(s.get("message", s)) if isinstance(s, dict) else str(s) for s in log.statements]


def checks(f, kit_report):
    bad = []
    boards = f.by_type("IfcElectricDistributionBoard")
    in_board = set()
    for b in boards:
        for p in UE.get_parts(b) or []:
            in_board.add(p.id())
    for cb in f.by_type("IfcProtectiveDevice"):
        if UE.get_predefined_type(cb) != "CIRCUITBREAKER":
            continue
        e = UE.get_psets(cb).get("Pset_ElectricalDeviceCommon", {})
        if "RatedCurrent" not in e or "ConductorFunction" not in e:
            bad.append("breaker %s lacks RatedCurrent or ConductorFunction" % cb.Name)
        if cb.id() not in in_board:
            bad.append("breaker %s is not aggregated in a board" % cb.Name)
    for c in f.by_type("IfcDistributionCircuit"):
        els = US.get_system_elements(c)
        if sum(1 for x in els if x.is_a("IfcProtectiveDevice")) != 1:
            bad.append("circuit %s holds %d breakers" % (c.Name, sum(1 for x in els if x.is_a("IfcProtectiveDevice"))))
    connected = {r.RelatedPort.id() for r in f.by_type("IfcRelConnectsPorts")}
    for el in f.by_type("IfcElement"):
        if "APK_PowerLoad" not in UE.get_psets(el, psets_only=True) or "LoadId" not in UE.get_psets(el)["APK_PowerLoad"]:
            continue
        sinks = [p for p in (ifcopenshell.util.system.get_ports(el) or []) if p.FlowDirection == "SINK"]
        if not any(p.id() in connected for p in sinks):
            bad.append("load %s: its supply port is connected to nothing" % el.Name)
    racks = []
    for a in f.by_type("IfcElementAssembly"):
        if a.ObjectType != "EquipmentRack":
            continue
        loaded = UE.get_psets(a, qtos_only=True).get("APK_RackQuantities", {}).get("LoadedGrossWeight")
        walked = kit_report.walk(a)[0] if kit_report else None
        racks.append({"name": a.Name, "walk": walked, "loaded": loaded})
        if kit_report and (walked is None) != (loaded is None) or (walked is not None and loaded is not None and abs(walked - loaded) > 1e-6):
            bad.append("rack %s: LoadedGrossWeight %s, kit_report walk %s" % (a.Name, loaded, walked))
    return bad, racks


def ids_fail_elements(f):
    """[{spec, class, name, part}] of every element failing an apk-av.ids requirement; part = the BIM part
    whose type it is (or is typed by), None for this editor's own entities."""
    from ifctester import ids
    spec = ids.open(str(TOOLS / "apk-av.ids"))
    spec.validate(f)
    out = []
    for sp in spec.specifications:
        for req in sp.requirements:
            for x in getattr(req, "failures", None) or []:
                el = x.get("element") if isinstance(x, dict) else getattr(x, "element", None)
                if el is None:
                    continue
                t = el if el.is_a("IfcTypeObject") else UE.get_type(el)
                part = UE.get_psets(t).get("APK_Part", {}).get("PartId") if t is not None else None
                icu = "ICU60947" in UE.get_psets(t if t is not None else el).get("Pset_ProtectiveDeviceTypeCircuitBreaker", {})
                out.append({"spec": sp.name, "class": el.is_a(), "name": getattr(el, "Name", None), "part": part,
                            "undeclared": sp.name == BREAKING and not icu})
    return out


def main(paths):
    oracle, kit_report = _tools()
    worst = 0
    for path in paths:
        f = ifcopenshell.open(path)
        st = statements(f)
        pp = oracle.pset_problems(f) if oracle else []
        ids_rows = [list(r) for r in oracle.ids_results(f)] if oracle else []
        ids_failures = ids_fail_elements(f) if oracle else []
        ck, racks = checks(f, kit_report)
        circuits = []
        for c in f.by_type("IfcDistributionCircuit"):
            circuits.append({"name": c.Name, "long": c.LongName,
                             "elements": sorted(x.is_a() for x in US.get_system_elements(c)),
                             "rollup": UE.get_psets(c).get("APK_PowerRollup", {})})
        # the board / breaker specs: this editor's own board and breakers must pass; an embedded BIM part type
        # (a PDU) that states no rating is the library's data gap (test_ifc_oracle DATA_GAPS), reported, not ours
        # a breaker that states NO breaking capacity is unknown until declared (ROAD-3598 answer 11): the IDS
        # breaker spec flags it, as intended, and it is reported (undeclared_breaking), not this file's error;
        # a capacity that IS stated and still fails the spec is
        own_fail = [x for x in ids_failures if x["spec"] in OWN_SPECS and not x["part"] and not x["undeclared"]]
        undeclared = sorted({x["name"] for x in ids_failures if x["undeclared"] and not x["part"]})
        print(json.dumps({"file": path, "schema": f.schema_identifier, "statements": len(st), "first": st[:5],
                          "pset_problems": pp, "ids": ids_rows, "ids_failures": ids_failures, "circuits": circuits, "racks": racks,
                          "checks": ck, "undeclared_breaking": undeclared, "oracle": bool(oracle)}))
        if st or pp or ck or own_fail:
            worst = 1
    return worst


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
