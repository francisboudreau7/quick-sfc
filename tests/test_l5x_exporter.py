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

from QuickSFC import parse_file, parse_string
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

        # Verify file content
        tree = ET.parse(filepath)
        root = tree.getroot()
        assert root.tag == "RSLogix5000Content"
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
    assert len(trans) == 6
    # Graph topology branches: ready(conv), done(conv), select_mode(div),
    # begin_load(div), both_loaded(conv), auto(div), manual(div)
    assert len(branches) == 7


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


if __name__ == "__main__":
    tests = [
        test_export_simple_sfc,
        test_export_with_custom_metadata,
        test_export_to_file,
        test_export_production_line,
        test_export_parallel_branches,
        test_export_selection_branches,
        test_step_description_contains_name,
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
