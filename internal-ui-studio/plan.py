"""Bounded validation for untrusted candidate plans from an AI or JSON editor."""

import math
import re

MAX_NODES = 400
MAX_ISSUES = 100
MAX_CANVAS = 16384
MAX_DEPTH = 64

_KINDS = {"container", "sprite", "label", "button", "layout"}
_PARENTS = {"container", "layout", "button"}
_DIRECTIONS = {"horizontal": "horizontal", "vertical": "vertical",
               "row": "horizontal", "column": "vertical"}
_ALIGNMENTS = {
    "start", "center", "end", "stretch",
    "left", "right", "top", "bottom",
    "top-left", "top-center", "top-right",
    "center-left", "center-right",
    "bottom-left", "bottom-center", "bottom-right",
}
_SEVERITIES = {"info", "warning", "error"}
_NODE_REQUIRED = {"id", "parentId", "kind", "name", "x", "y", "width", "height"}
_NODE_OPTIONAL = {"assetId", "text", "fontAssetId", "align", "direction", "gap"}
_ID = re.compile(r"[A-Za-z0-9_-][A-Za-z0-9_.:-]{0,63}", re.ASCII)

PLAN_INSTRUCTIONS = """仅返回一个 JSON 对象，不要 Markdown、代码或外链。
顶层只包含 width、height、nodes、issues。画布宽高为 1–16384。nodes 最多 400 个，
每个节点有 id、parentId、kind、name、x、y、width、height。坐标是整个画布左上角起算的
绝对坐标，不是父节点坐标。矩形必须完整落在画布且宽高大于 0。id 为 1–64 位 ASCII
字母、数字、下划线或连字符开头，后续也可用点和冒号；id 唯一。恰好一个 container
根节点（parentId 为 null），其他节点均填已定义的父节点 id，不得有环。
kind 只用 container、layout、button、sprite、label。只有前 3 种可以作为父节点。
sprite 必填 assetId，button 可填 assetId，label 必填 text（可用空串表示动态文本）且可选
fontAssetId；仅可引用提供的资产 ID。缺失素材时用 container 占位，在 issues 写清楚缺了什么，
不要发明 ID 或用空 sprite。layout 必填 direction（horizontal 或 vertical），gap 可选且非负。
可选 align: start、center、end、stretch、left、right、top、bottom，或 top-left、
top-center、top-right、center-left、center-right、bottom-left、bottom-center、bottom-right。
issues 最多 100 项：每项含 message，可选 resolution（文本）和 severity（info、warning、error）。
不存在的可选字段直接省略，不要用 null。所有文本为纯文本。"""


def _fail(where, what):
    # Error paths are controlled by this module and array indexes, not model strings.
    raise ValueError(f"{where}：{what}")


def _obj(value, required, optional, where):
    if type(value) is not dict:
        _fail(where, "应为 JSON 对象")
    if not required <= value.keys():
        _fail(where, "缺少必填字段：" + "、".join(sorted(required - value.keys())))
    if not value.keys() <= required | optional:
        _fail(where, "含不支持的字段")


def _str(value, where, max_len, *, blank=False):
    if type(value) is not str or len(value) > max_len or (not blank and not value.strip()):
        _fail(where, f"应为{'可为空的' if blank else '非空'}文本，最多 {max_len} 字符")
    if any(((ord(ch) < 32 and ch not in "\t\n\r") or 127 <= ord(ch) <= 159
            or 0xD800 <= ord(ch) <= 0xDFFF) for ch in value):
        _fail(where, "含不支持的控制字符")
    return value


def _num(value, lower, upper, where, *, positive=False):
    # Range before isfinite keeps hostile arbitrarily large Python ints bounded
    # without converting them to float. Bool is deliberately not a JSON number.
    if (type(value) not in (int, float) or not lower <= value <= upper
            or not math.isfinite(value) or (positive and value <= 0)):
        _fail(where, f"应为{'大于 0 且' if positive else '不小于 '+str(lower)+' 且'}不大于 {upper} 的有限数字")
    return value


def _id(value, where):
    if type(value) is not str or not _ID.fullmatch(value):
        _fail(where, "应为安全的节点 ID（1–64 位字母、数字、下划线等）")
    return value


def _asset(value, asset_ids, where):
    if (type(value) is not str or not value or len(value) > 160
            or value not in asset_ids):
        _fail(where, "必须引用已提供的资产；没有素材时请使用容器占位并记录问题")
    return value


def _enum(value, allowed, where, detail):
    if type(value) is not str or value not in allowed:
        _fail(where, detail)
    return value


def validate_plan(value, asset_ids: set[str]) -> dict:
    """Return a canonical, fresh copy, or raise a displayable ValueError."""
    _obj(value, {"width", "height", "nodes", "issues"}, set(), "方案")
    width = _num(value["width"], 1, MAX_CANVAS, "画布宽度")
    height = _num(value["height"], 1, MAX_CANVAS, "画布高度")
    raw_nodes = value["nodes"]
    if type(raw_nodes) is not list or not 1 <= len(raw_nodes) <= MAX_NODES:
        _fail("节点列表", f"应包含 1–{MAX_NODES} 个节点")

    nodes, by_id, labels, roots = [], {}, {}, []
    for i, raw in enumerate(raw_nodes, 1):
        where = f"节点 {i}"
        _obj(raw, _NODE_REQUIRED, _NODE_OPTIONAL, where)
        ident = _id(raw["id"], where + " ID")
        if ident in by_id:
            _fail(where, "节点 ID 重复")
        kind = _enum(raw["kind"], _KINDS, where, "未知节点类型")
        parent = raw["parentId"]
        if parent is not None:
            parent = _id(parent, where + " 父节点 ID")
        else:
            roots.append(ident)
            if kind != "container":
                _fail(where, "根节点必须是容器")
        name = _str(raw["name"], where + " 名称", 100).strip()
        x = _num(raw["x"], 0, width, where + " X")
        y = _num(raw["y"], 0, height, where + " Y")
        w = _num(raw["width"], 0, width, where + " 宽度", positive=True)
        h = _num(raw["height"], 0, height, where + " 高度", positive=True)
        if x + w > width + 1e-9 or y + h > height + 1e-9:
            _fail(where, "矩形超出画布")
        n = dict(id=ident, parentId=parent, kind=kind, name=name, x=x, y=y, width=w, height=h)

        if kind == "sprite" and "assetId" not in raw:
            _fail(where, "Sprite 缺少资产；没有素材时请使用容器占位并记录问题")
        if "assetId" in raw:
            if kind not in ("sprite", "button"):
                _fail(where, "仅 Sprite 或按钮可引用图片资产")
            n["assetId"] = _asset(raw["assetId"], asset_ids, where + " 图片")
        if kind == "label":
            if "text" not in raw:
                _fail(where, "Label 必须提供 text 字段（动态文本可留空）")
            n["text"] = _str(raw["text"], where + " 文本", 4000, blank=True)
            if "fontAssetId" in raw:
                n["fontAssetId"] = _asset(raw["fontAssetId"], asset_ids, where + " 字体")
        elif "text" in raw or "fontAssetId" in raw:
            _fail(where, "仅 Label 可提供文本和字体")
        if "align" in raw:
            n["align"] = _enum(raw["align"], _ALIGNMENTS, where + " 对齐", "不支持的对齐方式")
        if kind == "layout":
            direction = _enum(raw.get("direction"), _DIRECTIONS, where + " 排列", "应为 horizontal 或 vertical")
            n["direction"] = _DIRECTIONS[direction]
            if "gap" in raw:
                n["gap"] = _num(raw["gap"], 0, MAX_CANVAS, where + " 间距")
        elif "direction" in raw or "gap" in raw:
            _fail(where, "仅布局节点可以设置排列方向和间距")
        nodes.append(n)
        by_id[ident], labels[ident] = n, where

    if len(roots) != 1:
        _fail("节点树", "必须恰好有一个根容器")
    root = roots[0]
    for n in nodes:
        parent = n["parentId"]
        if parent is not None:
            where = labels[n["id"]]
            if parent not in by_id:
                _fail(where, "父节点不存在")
            if by_id[parent]["kind"] not in _PARENTS:
                _fail(where, "父节点应为容器、布局或按钮")

    depths = {root: 0}
    for n in nodes:
        trail, visiting = [], set()
        current = n["id"]
        while current not in depths:
            if current in visiting:
                _fail(labels[n["id"]], "节点树含循环，无法连接到根容器")
            trail.append(current)
            visiting.add(current)
            current = by_id[current]["parentId"]
        depth = depths[current]
        for node_id in reversed(trail):
            depth += 1
            if depth > MAX_DEPTH:
                _fail(labels[node_id], f"层级深度不可超过 {MAX_DEPTH}")
            depths[node_id] = depth

    raw_issues = value["issues"]
    if type(raw_issues) is not list or len(raw_issues) > MAX_ISSUES:
        _fail("问题列表", f"应为最多 {MAX_ISSUES} 项的数组")
    issues = []
    for i, raw in enumerate(raw_issues, 1):
        where = f"问题 {i}"
        _obj(raw, {"message"}, {"resolution", "severity"}, where)
        item = {"message": _str(raw["message"], where, 600)}
        if "resolution" in raw:
            item["resolution"] = _str(raw["resolution"], where + " 处理说明", 600)
        if "severity" in raw:
            item["severity"] = _enum(raw["severity"], _SEVERITIES, where, "不支持的问题等级")
        issues.append(item)

    return dict(width=width, height=height, nodes=nodes, issues=issues)
