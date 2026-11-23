import math
import unittest

from plan import validate_plan


def node(ident, parent=None, kind="container", **patch):
    return dict(id=ident, parentId=parent, kind=kind, name="节点",
                x=0, y=0, width=100, height=100) | patch


def plan(*nodes, **patch):
    return dict(width=100, height=100, nodes=[*nodes], issues=[]) | patch


class PlanValidationTest(unittest.TestCase):
    def test_valid_hierarchy_is_copied_and_keeps_input_order(self):
        raw = plan(
            node("balance.label", "balance", "label", text="", fontAssetId="font", x=60, width=40),
            node("root"),
            node("balance", "root", "layout", direction="row", gap=0.5, align="center"),
            node("add-button", "balance", "button", assetId="plus", x=18, y=5, width=30, height=20),
            issues=[{"message": "底框未提供", "resolution": "用条目容器占位", "severity": "warning"}],
        )
        value = validate_plan(raw, {"font", "plus"})
        self.assertEqual([n["id"] for n in value["nodes"]], ["balance.label", "root", "balance", "add-button"])
        self.assertEqual(value["nodes"][2]["direction"], "horizontal")
        self.assertEqual(raw["nodes"][2]["direction"], "row")
        self.assertIsNot(value["issues"][0], raw["issues"][0])

    def test_missing_and_unknown_assets(self):
        for sprite in [node("sprite", "root", "sprite"), node("sprite", "root", "sprite", assetId="invented")]:
            with self.subTest(sprite=sprite), self.assertRaisesRegex(ValueError, "资产"):
                validate_plan(plan(node("root"), sprite), {"known"})
        self.assertEqual(validate_plan(plan(node("root"), node("missing", "root"),
                                           issues=[{"message": "缺图"}]), set())["nodes"][1]["kind"], "container")

    def test_geometry_rejects_boolean_nonfinite_past_edge(self):
        for overrides in [dict(width=True), dict(x=-1), dict(y=math.nan), dict(x=math.inf),
                          dict(height=0), dict(x=10, width=91), dict(y=99, height=1.5),
                          dict(width=10**1000)]:
            with self.subTest(overrides=overrides), self.assertRaises(ValueError):
                validate_plan(plan(node("root") | overrides), set())

    def test_tree_constraints(self):
        for children in [
            [node("root"), node("second-root")],
            [node("root"), node("root", "root")],
            [node("root"), node("a", "missing")],
            [node("root"), node("a", "b"), node("b", "a")],
            [node("root"), node("a", "a")],
            [node("root"), node("leaf", "root", "label", text=""), node("child", "leaf")],
            [node("root", None, "label", text="")],
        ]:
            with self.subTest(children=children), self.assertRaises(ValueError):
                validate_plan(plan(*children), set())

    def test_rejects_invalid_types_fields_and_values(self):
        for child in [node("a", "root", "layout"), node("a", "root", "label"),
                      node("a", "root", "label", text=1), node("a", "root", "label", text="\ud800"),
                      node("a", "root", kind=[]), node("a", "root", align={}),
                      node("a", "root", text="not allowed"),
                      node("a", "root", direction="horizontal"),
                      node("a", "root", unknown="<hostile>")]:
            with self.subTest(child=child), self.assertRaises(ValueError) as out:
                validate_plan(plan(node("root"), child), set())
            self.assertNotIn("<hostile>", str(out.exception))

    def test_bounded_graph_and_issues(self):
        deep = [node(f"a{i}", f"a{i-1}" if i else "root") for i in range(78)]
        with self.assertRaisesRegex(ValueError, "层级深度"):
            validate_plan(plan(node("root"), *deep), set())
        with self.assertRaisesRegex(ValueError, "节点列表"):
            validate_plan(plan(*[node(f"a{i}") for i in range(401)]), set())
        with self.assertRaisesRegex(ValueError, "问题列表"):
            validate_plan(plan(node("root"), issues=[{"message": "x"}] * 101), set())
        with self.assertRaisesRegex(ValueError, "问题等级"):
            validate_plan(plan(node("root"), issues=[{"message": "x", "severity": "alarm"}]), set())


unittest.main() if __name__ == "__main__" else None
