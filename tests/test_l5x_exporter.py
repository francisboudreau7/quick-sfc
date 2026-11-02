"""Tests for L5X exporter."""

import sys
import os
import xml.etree.ElementTree as ET
import tempfile

# Add workspace to path for imports (same as run_tests.py)
TEST_DIR = os.path.dirname(os.path.abspath(__file__))
QUICKSFC_DIR = os.path.dirname(TEST_DIR)
WORKSPACE_DIR = os.path.dirname(QUICKSFC_DIR)
sys.path.insert(0, WORKSPACE_DIR)

from QuickSFC import parse_file, parse_string, ParseError
from QuickSFC.L5X_exporter import L5XExporter, L5XExportError


def test_export_simple_sfc():
    """Test exporting a simple SFC creates valid XML."""
    content = """SI@init(action:=1;)
T@done(cond)
S@final()
T@loop() -> @init
END
"""
    sfc = parse_string(content)
    exporter = L5XExporter(sfc)

    xml_str = exporter.to_string()

    # Parse to verify validity
    root = ET.fromstring(xml_str)
    assert root.tag == "RSLogix5000Content"

    # Check structure
    steps = root.findall('.//Step')
    trans = root.findall('.//Transition')
    links = root.findall('.//DirectedLink')

    assert len(steps) == 2  # init, final
    assert len(trans) == 2  # done, loop
    assert len(links) > 0


def test_export_with_custom_metadata():
    """Test setting custom program/controller names."""
    content = """SI@init()
T@done()
S@end()
T@loop() -> @init
END
"""
    sfc = parse_string(content)
    exporter = (
        L5XExporter(sfc)
        .set_program_name("TestProgram")
        .set_controller_name("TestPLC")
        .set_software_revision("33.00")
    )

    xml_str = exporter.to_string()
    root = ET.fromstring(xml_str)

    assert root.get("TargetName") == "TestProgram"
    assert root.get("SoftwareRevision") == "33.00"

    controller = root.find('.//Controller')
    assert controller.get("Name") == "TestPLC"


def test_export_to_file():
    """Test exporting to a file."""
    content = """SI@init()
T@done()
S@end()
T@loop() -> @init
END
"""
    sfc = parse_string(content)

    with tempfile.NamedTemporaryFile(suffix=".L5X", delete=False) as f:
        filepath = f.name

    try:
        exporter = L5XExporter(sfc)
        result = exporter.export(filepath)

        assert result == filepath
        assert os.path.exists(filepath)

        # Studio 5000 writes UTF-8 with a BOM and CRLF line endings
        with open(filepath, "rb") as f:
            raw = f.read()
        assert raw.startswith(b"\xef\xbb\xbf")
        assert b"\n" not in raw.replace(b"\r\n", b"")
        assert raw.endswith(b"</RSLogix5000Content>\r\n")

        # Verify file content
        tree = ET.parse(filepath)
        root = tree.getroot()
        assert root.tag == "RSLogix5000Content"
        program = root.find('.//Program')
        assert program.get("MainRoutineName") == "SFC"
        assert root.find(f'.//Routine[@Name="SFC"]') is not None
    finally:
        if os.path.exists(filepath):
            os.unlink(filepath)


def test_export_production_line():
    """Test exporting the production_line.qsfc file."""
    test_dir = os.path.dirname(os.path.abspath(__file__))
    qsfc_file = os.path.join(test_dir, "production_line.qsfc")

    sfc = parse_file(qsfc_file)
    exporter = L5XExporter(sfc)

    xml_str = exporter.to_string()
    root = ET.fromstring(xml_str)

    # Verify expected elements
    steps = root.findall('.//Step')
    trans = root.findall('.//Transition')
    branches = root.findall('.//Branch')

    assert len(steps) == 8
    assert len(trans) == 8
    # Graph topology branches: ready(conv), done(conv), select_mode(div),
    # begin_load(div), both_loaded(conv)
    assert len(branches) == 5


def test_export_parallel_branches():
    """Test exporting SFC with parallel (AND) branches."""
    test_dir = os.path.dirname(os.path.abspath(__file__))
    qsfc_file = os.path.join(test_dir, "simple_parallel.qsfc")

    sfc = parse_file(qsfc_file)
    exporter = L5XExporter(sfc)

    xml_str = exporter.to_string()
    root = ET.fromstring(xml_str)

    # Check branch types
    branches = root.findall('.//Branch')
    simultaneous_branches = [b for b in branches if b.get("BranchType") == "Simultaneous"]

    assert len(simultaneous_branches) > 0
    # Studio 5000 only accepts Priority on Selection diverges
    assert all(b.get("Priority") is None for b in simultaneous_branches)


def test_export_selection_branches():
    """Test exporting SFC with selection (OR) branches."""
    test_dir = os.path.dirname(os.path.abspath(__file__))
    qsfc_file = os.path.join(test_dir, "simple_selection.qsfc")

    sfc = parse_file(qsfc_file)
    exporter = L5XExporter(sfc)

    xml_str = exporter.to_string()
    root = ET.fromstring(xml_str)

    # Check branch types
    branches = root.findall('.//Branch')
    selection_branches = [b for b in branches if b.get("BranchType") == "Selection"]

    assert len(selection_branches) > 0


def test_step_description_contains_name():
    """Test that step tag descriptions contain original @names."""
    content = """SI@my_init_step(action:=1;)
T@transition1()
S@my_second_step()
T@loop() -> @my_init_step
END
"""
    sfc = parse_string(content)
    exporter = L5XExporter(sfc)

    xml_str = exporter.to_string()
    root = ET.fromstring(xml_str)

    # Find step tags and check descriptions (descriptions live on Tag elements)
    step_tags = [t for t in root.findall('.//Tags/Tag') if t.get('DataType') == 'SFC_STEP']
    descriptions = [t.findtext('Description', '').strip() for t in step_tags]

    assert "@my_init_step" in descriptions
    assert "@my_second_step" in descriptions


def test_attached_comments_go_to_tag_description():
    """Attached comments are exported under @name; standalone comment lines are not."""
    test_dir = os.path.dirname(os.path.abspath(__file__))
    sfc = parse_file(os.path.join(test_dir, "production_line.qsfc"))
    root = ET.fromstring(L5XExporter(sfc).to_string())
    descriptions = [(t.findtext('Description') or '').strip()
                    for t in root.findall('.//Tags/Tag')]

    assert "@init\nreinitialise" in descriptions
    assert "@start\nwait for user input" in descriptions
    assert "@run_auto\nprogram_1" in descriptions
    assert "@ready" in descriptions
    assert not any("Load both sides" in d for d in descriptions)


def test_action_contains_code():
    """Test that actions contain the structured text code."""
    content = """SI@init(motor_on:=1; valve:=0;)
T@done()
S@end()
T@loop() -> @init
END
"""
    sfc = parse_string(content)
    exporter = L5XExporter(sfc)

    xml_str = exporter.to_string()
    root = ET.fromstring(xml_str)

    # Find action body
    action_line = root.find('.//Step/Action/Body/STContent/Line')
    assert action_line is not None
    assert "motor_on:=1" in action_line.text


def test_tags_are_created():
    """Test that tags are created for steps, actions, and transitions."""
    content = """SI@init(code:=1;)
T@done()
S@end()
T@loop() -> @init
END
"""
    sfc = parse_string(content)
    exporter = L5XExporter(sfc)

    xml_str = exporter.to_string()
    root = ET.fromstring(xml_str)

    # Find program-level tags
    tags = root.findall('.//Program/Tags/Tag')
    tag_names = [t.get("Name") for t in tags]

    # Check for step, action, and transition tags
    assert "Step_000" in tag_names
    assert "Step_001" in tag_names
    assert "Action_000" in tag_names  # Only init has action
    assert "Tran_000" in tag_names
    assert "Tran_001" in tag_names


def test_directed_links_created():
    """Test that DirectedLinks are created for flow."""
    content = """SI@init()
T@go()
S@work()
T@done() -> @init
END
"""
    sfc = parse_string(content)
    exporter = L5XExporter(sfc)

    xml_str = exporter.to_string()
    root = ET.fromstring(xml_str)

    links = root.findall('.//DirectedLink')

    # Should have links connecting steps and transitions
    assert len(links) >= 4  # init->go, go->work, work->done, done->init


def test_cdata_content_is_not_escaped():
    """Special characters inside CDATA must reach Studio 5000 unescaped."""
    content = """SI@init(x := a < b AND c > 1 & d; s := "q";)
T@go(level > 5 AND a < b)
S@s()
T@back() -> @init
END
"""
    xml_str = L5XExporter(parse_string(content)).to_string()
    assert "&lt;" not in xml_str and "&gt;" not in xml_str and "&amp;" not in xml_str
    root = ET.fromstring(xml_str)
    lines = [(l.text or "").strip() for l in root.iter('Line')]
    assert 'x := a < b AND c > 1 & d; s := "q";' in lines
    assert "level > 5 AND a < b" in lines


def test_jump_is_not_chained_to_next_step():
    """A transition with -> @target must not also link to the following step."""
    content = """SI@init()
T@a() -> @init
S@other()
T@b() -> @init
END
"""
    sfc = parse_string(content)
    assert [s.name for s in sfc.get_transition_by_name("a").outgoing_steps] == ["init"]


def test_redundant_jump_to_next_step_links_once():
    content = """SI@init()
T@go() -> @s
S@s()
T@back() -> @init
END
"""
    sfc = parse_string(content)
    assert [s.name for s in sfc.get_transition_by_name("go").outgoing_steps] == ["s"]
    root = ET.fromstring(L5XExporter(sfc).to_string())
    assert root.findall('.//Branch') == []


def test_sequential_branches_layout_every_element():
    """Elements after a second branch of the same type must get real positions."""
    content = """SI@a()
T@t0()
S@b()
/\\
T@x1(c1)
S@x()
T@x2()
|
T@y1(c2)
S@y()
T@y2()
\\/ S@c()
T@t1()
S@d()
/\\
T@p1()
S@p()
T@p2()
|
T@q1()
S@q()
T@q2()
\\/ S@e()
T@back() -> @a
END
"""
    root = ET.fromstring(L5XExporter(parse_string(content)).to_string())
    positions = [(e.get("X"), e.get("Y")) for e in root.iter()
                 if e.tag in ("Step", "Transition")]
    assert len(positions) == len(set(positions))


def test_or_leg_ending_with_step_is_rejected():
    """An OR leg that converges must end with a transition."""
    content = """SI@a()
T@t()
S@b()
/\\
T@x()
S@x1()
|
T@y()
S@y1()
T@y2()
\\/ S@c()
T@back() -> @a
END
"""
    try:
        parse_string(content)
    except ParseError as e:
        assert "must end with a transition" in str(e)
        assert "@x1" in str(e)
    else:
        raise AssertionError("Expected ParseError")


def test_inline_step_after_transition():
    """'T@x() -> S@y()' is the same as writing S@y() on the next line."""
    inline = """SI@init()
T@go() -> S@work()
T@pick() //\\\\
    S@a()
    T@a_done() -> S@a2()
    |
    S@b()
\\\\// T@joined()
S@choose()
/\\
    T@left() -> S@l()
    T@l_done()
    |
    T@right() -> S@r()
    T@r_done()
\\/ S@done()
T@back() -> @init
END
"""
    multiline = (inline.replace(" -> S@", "\nS@").replace(" //\\\\", "\n//\\\\")
                 .replace("\\\\// ", "\\\\//\n"))
    graphs = []
    for src in (inline, multiline):
        sfc = parse_string(src)
        graphs.append(sorted(
            (t.name, tuple(s.name for s in t.incoming_steps), tuple(s.name for s in t.outgoing_steps))
            for t in sfc.transitions))
    assert graphs[0] == graphs[1]
    assert ("go", ("init",), ("work",)) in graphs[0]
    assert ("a_done", ("a",), ("a2",)) in graphs[0]
    assert ("left", ("choose",), ("l",)) in graphs[0]


def test_spec_examples_parse():
    """Every complete chart in QUICK_SFC_RULES.md must parse and export."""
    test_dir = os.path.dirname(os.path.abspath(__file__))
    with open(os.path.join(os.path.dirname(test_dir), "QUICK_SFC_RULES.md"), encoding="utf-8") as f:
        spec = f.read()
    assert spec.count("```") % 2 == 0, "unbalanced code fences"
    blocks = spec.split("```")[1::2]
    charts = [b for b in blocks
              if any(l.startswith("SI@") for l in b.splitlines())
              and any(l.strip() == "END" for l in b.splitlines())]
    assert len(charts) == 4
    for chart in charts:
        L5XExporter(parse_string(chart)).to_string()


def _tag_names(xml_str):
    return [t.get("Name") for t in ET.fromstring(xml_str).findall('.//Program/Tags/Tag')]


def test_missing_tags_not_declared_by_default():
    test_dir = os.path.dirname(os.path.abspath(__file__))
    sfc = parse_file(os.path.join(test_dir, "production_line.qsfc"))
    names = _tag_names(L5XExporter(sfc).to_string())
    assert "start_btn" not in names


def test_declare_missing_tags_option():
    test_dir = os.path.dirname(os.path.abspath(__file__))
    sfc = parse_file(os.path.join(test_dir, "production_line.qsfc"))
    xml_str = L5XExporter(sfc).set_declare_missing_tags().to_string()
    root = ET.fromstring(xml_str)
    generated = {"Step", "Tran", "Action"}
    extra = [t for t in root.findall('.//Program/Tags/Tag')
             if t.get("Name").split("_")[0] not in generated]
    assert [t.get("Name") for t in extra] == [
        "auto_mode", "load_sensor_A", "load_sensor_B", "manual_mode",
        "reset_all", "safety_ok", "start_btn",
    ]
    assert all(t.get("DataType") == "BOOL" for t in extra)


def test_declare_missing_tags_skips_what_it_cannot_type():
    """Keywords, members, calls, literals, strings and existing tags are not declared."""
    content = """SI@init(L[:=]1; Count := ABS(delta) + 16#FF; msg := 'not_a_tag'; (* skipped *))
T@go(Step_000.DN and NOT(d1) OR a[2] AND t1 > T#5s and l)
S@s()
T@back() -> @init
END
"""
    xml_str = L5XExporter(parse_string(content)).set_declare_missing_tags().to_string()
    names = _tag_names(xml_str)
    extra = [n for n in names if n.split("_")[0] not in {"Step", "Tran", "Action"}]
    # "l" and "L" are the same tag: Logix tag names are case-insensitive
    assert extra == ["Count", "d1", "delta", "l", "msg", "t1"]


def test_empty_condition_uses_transition_tag():
    """An empty condition would fail Verify; it becomes the transition's own BOOL tag."""
    content = """SI@init()
T@go()
S@s()
T@back(ready) -> @init
END
"""
    root = ET.fromstring(L5XExporter(parse_string(content)).to_string())
    conditions = {t.get("Operand"): t.find('.//Line').text.strip()
                  for t in root.iter('Transition')}
    assert conditions == {"Tran_000": "Tran_000", "Tran_001": "ready"}


def test_directed_links_never_share_endpoints():
    """Every DirectedLink FromID and ToID must be unique in the sample files."""
    test_dir = os.path.dirname(os.path.abspath(__file__))
    for name in ("simple_selection.qsfc", "simple_parallel.qsfc", "production_line.qsfc"):
        sfc = parse_file(os.path.join(test_dir, name))
        root = ET.fromstring(L5XExporter(sfc).to_string())
        links = root.findall('.//DirectedLink')
        from_ids = [l.get("FromID") for l in links]
        to_ids = [l.get("ToID") for l in links]
        assert len(from_ids) == len(set(from_ids)), name
        assert len(to_ids) == len(set(to_ids)), name


if __name__ == "__main__":
    tests = [
        test_cdata_content_is_not_escaped,
        test_jump_is_not_chained_to_next_step,
        test_redundant_jump_to_next_step_links_once,
        test_sequential_branches_layout_every_element,
        test_or_leg_ending_with_step_is_rejected,
        test_inline_step_after_transition,
        test_spec_examples_parse,
        test_missing_tags_not_declared_by_default,
        test_declare_missing_tags_option,
        test_declare_missing_tags_skips_what_it_cannot_type,
        test_empty_condition_uses_transition_tag,
        test_directed_links_never_share_endpoints,
        test_export_simple_sfc,
        test_export_with_custom_metadata,
        test_export_to_file,
        test_export_production_line,
        test_export_parallel_branches,
        test_export_selection_branches,
        test_step_description_contains_name,
        test_attached_comments_go_to_tag_description,
        test_action_contains_code,
        test_tags_are_created,
        test_directed_links_created,
    ]

    print("L5X Exporter Tests")
    print("-" * 50)

    passed = 0
    failed = 0

    for test in tests:
        try:
            test()
            print(f"  PASS: {test.__name__}")
            passed += 1
        except Exception as e:
            print(f"  FAIL: {test.__name__}: {e}")
            failed += 1

    print("-" * 50)
    print(f"Results: {passed} passed, {failed} failed")
