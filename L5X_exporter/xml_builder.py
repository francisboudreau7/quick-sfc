"""XML generation for L5X format using xml.etree.ElementTree."""

import re
import xml.etree.ElementTree as ET
from xml.dom import minidom
from datetime import datetime
from typing import List, Tuple

# Sentinel tag used to mark text that must be emitted as CDATA sections.
# ElementTree does not support CDATA natively, so we store CDATA content
# inside placeholder elements during tree construction and convert them
# to real <![CDATA[...]]> sections when serializing to a string.
CDATA_TAG = "__CDATA__"

from .constants import (
    DEFAULT_SOFTWARE_REVISION, DEFAULT_SCHEMA_REVISION,
    DEFAULT_CONTROLLER_NAME, DEFAULT_PROGRAM_NAME,
    SHEET_SIZE, SHEET_ORIENTATION,
    STEP_NAME_PREFIX, TRANSITION_NAME_PREFIX, ACTION_NAME_PREFIX, STOP_NAME_PREFIX,
    L5X_BRANCH_TYPE_SELECTION, L5X_BRANCH_TYPE_SIMULTANEOUS,
    L5X_BRANCH_FLOW_DIVERGE, L5X_BRANCH_FLOW_CONVERGE,
    DEFAULT_ACTION_QUALIFIER
)


class L5XBuilder:
    """Builds L5X XML structure from SFC data."""

    def __init__(self, sfc, id_manager, layout_calculator):
        """Initialize XML builder.

        Args:
            sfc: Parsed SFC object
            id_manager: IDManager with allocated IDs
            layout_calculator: LayoutCalculator with positions
        """
        self.sfc = sfc
        self.id_manager = id_manager
        self.layout = layout_calculator

        # Configurable metadata
        self.program_name = DEFAULT_PROGRAM_NAME
        self.controller_name = DEFAULT_CONTROLLER_NAME
        self.software_revision = DEFAULT_SOFTWARE_REVISION

        # Collected directed links
        self._directed_links: List[Tuple[int, int]] = []

    def set_program_name(self, name: str):
        """Set program name for export."""
        self.program_name = name

    def set_controller_name(self, name: str):
        """Set controller name for export."""
        self.controller_name = name

    def set_software_revision(self, revision: str):
        """Set software revision for export."""
        self.software_revision = revision

    def build(self) -> ET.Element:
        """Build complete L5X XML tree.

        Returns:
            Root Element of L5X document
        """
        self._directed_links = []

        # Create root element
        root = self._create_root()

        # Create Controller context
        controller = self._create_controller(root)

        # Create Programs context
        programs = ET.SubElement(controller, "Programs", Use="Context")

        # Create Program
        program = self._create_program(programs)

        # Create Tags section
        self._create_tags(program)

        # Create Routines section with SFC
        self._create_routines(program)

        return root

    def _create_root(self) -> ET.Element:
        """Create RSLogix5000Content root element."""
        export_date = datetime.now().strftime("%a %b %d %H:%M:%S %Y")

        root = ET.Element("RSLogix5000Content")
        root.set("SchemaRevision", DEFAULT_SCHEMA_REVISION)
        root.set("SoftwareRevision", self.software_revision)
        root.set("TargetName", self.program_name)
        root.set("TargetType", "Program")
        root.set("ContainsContext", "true")
        root.set("Owner", "QuickSFC")
        root.set("ExportDate", export_date)
        root.set("ExportOptions", "References NoRawData L5KData DecoratedData Context Dependencies ForceProtectedEncoding AllProjDocTrans")

        return root

    def _create_controller(self, root: ET.Element) -> ET.Element:
        """Create Controller element."""
        controller = ET.SubElement(root, "Controller", Use="Context", Name=self.controller_name)

        # Empty DataTypes context
        ET.SubElement(controller, "DataTypes", Use="Context")

        # Empty Modules context
        ET.SubElement(controller, "Modules", Use="Context")

        # Empty Tags context (controller-level)
        ET.SubElement(controller, "Tags", Use="Context")

        return controller

    def _create_program(self, programs: ET.Element) -> ET.Element:
        """Create Program element."""
        program = ET.SubElement(
            programs, "Program",
            Use="Target",
            Name=self.program_name,
            TestEdits="false",
            Disabled="false",
            UseAsFolder="false"
        )
        return program

    def _create_tags(self, program: ET.Element):
        """Create Tags section with SFC_STEP, SFC_ACTION, and BOOL tags."""
        tags = ET.SubElement(program, "Tags")

        # Create Step tags
        for step in self.sfc.steps:
            operand = self.id_manager.get_step_operand(step)
            if operand:
                description = f"@{step.name}" if step.name else None
                self._create_step_tag(tags, operand, step.preset, description)

        # Create Action tags for steps with actions
        for step in self.sfc.steps:
            # Only create action tag if step has real action content
            if step.action and step.action != "None" and step.action.strip():
                operand = self.id_manager.get_action_operand(step)
                if operand:
                    description = f"@{step.name}" if step.name else None
                    self._create_action_tag(tags, operand, description)

        # Create Transition tags (BOOL)
        for trans in self.sfc.transitions:
            operand = self.id_manager.get_transition_operand(trans)
            if operand:
                description = f"@{trans.name}" if trans.name else None
                self._create_transition_tag(tags, operand, description)

    def _create_step_tag(self, tags: ET.Element, name: str, preset: int = 0,
                         description: str = None):
        """Create SFC_STEP tag."""
        tag = ET.SubElement(
            tags, "Tag",
            Name=name,
            TagType="Base",
            DataType="SFC_STEP",
            Constant="false",
            ExternalAccess="Read/Write"
        )

        if description:
            desc = ET.SubElement(tag, "Description")
            self._set_cdata_text(desc, description)

        # L5K data format
        l5k_data = ET.SubElement(tag, "Data", Format="L5K")
        self._set_cdata_text(l5k_data, f"[136314881,{preset},0,0,0,0,0]")

        # Decorated data format
        decorated = ET.SubElement(tag, "Data", Format="Decorated")
        struct = ET.SubElement(decorated, "Structure", DataType="SFC_STEP")

        self._add_data_member(struct, "Status", "DINT", "Hex", "16#0820_0001")
        self._add_data_member(struct, "X", "BOOL", value="0")
        self._add_data_member(struct, "FS", "BOOL", value="0")
        self._add_data_member(struct, "SA", "BOOL", value="0")
        self._add_data_member(struct, "LS", "BOOL", value="0")
        self._add_data_member(struct, "DN", "BOOL", value="0")
        self._add_data_member(struct, "OV", "BOOL", value="0")
        self._add_data_member(struct, "AlarmEn", "BOOL", value="0")
        self._add_data_member(struct, "AlarmLow", "BOOL", value="0")
        self._add_data_member(struct, "AlarmHigh", "BOOL", value="0")
        self._add_data_member(struct, "Reset", "BOOL", value="0")
        self._add_data_member(struct, "PauseTimer", "BOOL", value="1")
        self._add_data_member(struct, "PRE", "DINT", "Decimal", str(preset))
        self._add_data_member(struct, "T", "DINT", "Decimal", "0")
        self._add_data_member(struct, "TMax", "DINT", "Decimal", "0")
        self._add_data_member(struct, "Count", "DINT", "Decimal", "0")
        self._add_data_member(struct, "LimitLow", "DINT", "Decimal", "0")
        self._add_data_member(struct, "LimitHigh", "DINT", "Decimal", "0")

    def _create_action_tag(self, tags: ET.Element, name: str,
                           description: str = None):
        """Create SFC_ACTION tag."""
        tag = ET.SubElement(
            tags, "Tag",
            Name=name,
            TagType="Base",
            DataType="SFC_ACTION",
            Constant="false",
            ExternalAccess="Read/Write"
        )

        if description:
            desc = ET.SubElement(tag, "Description")
            self._set_cdata_text(desc, description)

        # L5K data format
        l5k_data = ET.SubElement(tag, "Data", Format="L5K")
        self._set_cdata_text(l5k_data, "[2097152,0,0,0]")

        # Decorated data format
        decorated = ET.SubElement(tag, "Data", Format="Decorated")
        struct = ET.SubElement(decorated, "Structure", DataType="SFC_ACTION")

        self._add_data_member(struct, "Status", "DINT", "Hex", "16#0020_0000")
        self._add_data_member(struct, "A", "BOOL", value="0")
        self._add_data_member(struct, "Q", "BOOL", value="0")
        self._add_data_member(struct, "PauseTimer", "BOOL", value="1")
        self._add_data_member(struct, "PRE", "DINT", "Decimal", "0")
        self._add_data_member(struct, "T", "DINT", "Decimal", "0")
        self._add_data_member(struct, "Count", "DINT", "Decimal", "0")

    def _create_transition_tag(self, tags: ET.Element, name: str,
                               description: str = None):
        """Create BOOL tag for transition."""
        tag = ET.SubElement(
            tags, "Tag",
            Name=name,
            TagType="Base",
            DataType="BOOL",
            Radix="Decimal",
            Constant="false",
            ExternalAccess="Read/Write"
        )

        if description:
            desc = ET.SubElement(tag, "Description")
            self._set_cdata_text(desc, description)

        # L5K data format
        l5k_data = ET.SubElement(tag, "Data", Format="L5K")
        self._set_cdata_text(l5k_data, "0")

        # Decorated data format
        decorated = ET.SubElement(tag, "Data", Format="Decorated")
        ET.SubElement(decorated, "DataValue", DataType="BOOL", Radix="Decimal", Value="0")

    def _add_data_member(self, parent: ET.Element, name: str, data_type: str,
                         radix: str = None, value: str = "0"):
        """Add DataValueMember to structure."""
        attrs = {"Name": name, "DataType": data_type}
        if radix:
            attrs["Radix"] = radix
        attrs["Value"] = value
        ET.SubElement(parent, "DataValueMember", **attrs)

    @staticmethod
    def _set_cdata_text(parent: ET.Element, text: str):
        """Set text content that will be emitted as a CDATA section.

        Instead of setting parent.text directly (which ElementTree would
        XML-escape), this creates a sentinel child element whose content
        is later converted to a real <![CDATA[...]]> section by
        _convert_cdata_elements().
        """
        cdata_elem = ET.SubElement(parent, CDATA_TAG)
        cdata_elem.text = text

    def _create_routines(self, program: ET.Element):
        """Create Routines section with SFC content."""
        routines = ET.SubElement(program, "Routines")

        routine = ET.SubElement(routines, "Routine", Name="SFC", Type="SFC")

        sfc_content = ET.SubElement(
            routine, "SFCContent",
            SheetSize=SHEET_SIZE,
            SheetOrientation=SHEET_ORIENTATION,
            StepName=STEP_NAME_PREFIX,
            TransitionName=TRANSITION_NAME_PREFIX,
            ActionName=ACTION_NAME_PREFIX,
            StopName=STOP_NAME_PREFIX
        )

        # Build SFC elements
        self._build_steps(sfc_content)
        self._build_transitions(sfc_content)
        self._build_branches_and_links(sfc_content)
        self._build_directed_links(sfc_content)

    def _build_steps(self, sfc_content: ET.Element):
        """Build Step elements in SFCContent."""
        for step in self.sfc.steps:
            step_id = self.id_manager.get_step_id(step)
            operand = self.id_manager.get_step_operand(step)
            x, y = self.layout.get_step_position(step)

            step_elem = ET.SubElement(
                sfc_content, "Step",
                ID=str(step_id),
                X=str(x),
                Y=str(y),
                Operand=operand,
                HideDesc="false",
                DescX=str(x + 40),
                DescY=str(y - 20),
                DescWidth="0",
                InitialStep=str(step.is_initial).lower(),
                PresetUsesExpr="false",
                LimitHighUsesExpr="false",
                LimitLowUsesExpr="false",
                ShowActions="true"
            )

            # Add action if present (check for None and empty string)
            if step.action and step.action != "None" and step.action.strip():
                action_id = self.id_manager.get_action_id(step)
                action_operand = self.id_manager.get_action_operand(step)

                action_elem = ET.SubElement(
                    step_elem, "Action",
                    ID=str(action_id),
                    Operand=action_operand,
                    Qualifier=DEFAULT_ACTION_QUALIFIER,
                    IsBoolean="false",
                    PresetUsesExpr="false"
                )

                body = ET.SubElement(action_elem, "Body")
                st_content = ET.SubElement(body, "STContent")
                line = ET.SubElement(st_content, "Line", Number="0")
                self._set_cdata_text(line, step.action)

    def _build_transitions(self, sfc_content: ET.Element):
        """Build Transition elements in SFCContent."""
        for trans in self.sfc.transitions:
            trans_id = self.id_manager.get_transition_id(trans)
            operand = self.id_manager.get_transition_operand(trans)
            x, y = self.layout.get_transition_position(trans)

            trans_elem = ET.SubElement(
                sfc_content, "Transition",
                ID=str(trans_id),
                X=str(x),
                Y=str(y),
                Operand=operand,
                HideDesc="false",
                DescX=str(x + 60),
                DescY=str(y - 20),
                DescWidth="0"
            )

            # Add condition
            condition_elem = ET.SubElement(trans_elem, "Condition")
            st_content = ET.SubElement(condition_elem, "STContent")
            line = ET.SubElement(st_content, "Line", Number="0")
            self._set_cdata_text(line, trans.condition)

    def _build_branches_and_links(self, sfc_content: ET.Element):
        """Build L5X Branch and DirectedLink elements from graph topology.

        L5X branches are determined by connectivity, not QSFC syntax:
        - An element with multiple incoming connections gets a Converge branch.
        - An element with multiple outgoing connections gets a Diverge branch.
        Every DirectedLink is strictly 1-to-1; branches mediate fan-in/fan-out.
        """
        # Build QSFC branch lookups for type detection
        trans_to_qsfc_branch = {}
        step_to_qsfc_branch = {}
        for branch in self.sfc.branches:
            if branch.branch_type == "DIVERGE":
                for leg in branch.legs:
                    for trans in leg.transitions:
                        trans_to_qsfc_branch[trans] = branch
                    for step in leg.steps:
                        step_to_qsfc_branch[step] = branch

        # ---- Step-level Converge (step has multiple incoming transitions) ----
        # Maps step -> (branch_id, type, {trans: leg_id})
        step_converge = {}
        for step in self.sfc.steps:
            incoming = step.incoming_transitions
            if len(incoming) <= 1:
                continue
            branch_type = self._determine_converge_type_trans(
                incoming, trans_to_qsfc_branch)
            branch_id = self.id_manager.next_id()
            sorted_inc = sorted(
                incoming, key=lambda t: self.id_manager.get_transition_id(t))
            leg_map = {t: self.id_manager.next_id() for t in sorted_inc}
            step_converge[step] = (branch_id, branch_type, leg_map)
            # Y position
            step_y = self.layout.get_step_position(step)[1]
            max_y = max(self.layout.get_transition_position(t)[1]
                        for t in incoming)
            self._emit_branch(sfc_content, branch_id, (max_y + step_y) // 2,
                              branch_type, L5X_BRANCH_FLOW_CONVERGE,
                              [leg_map[t] for t in sorted_inc])

        # ---- Step-level Diverge (step has multiple outgoing transitions) ----
        # Maps step -> (branch_id, type, {trans: leg_id})
        step_diverge = {}
        for step in self.sfc.steps:
            outgoing = step.outgoing_transitions
            if len(outgoing) <= 1:
                continue
            branch_type = self._determine_diverge_type_for(step, is_step=True)
            branch_id = self.id_manager.next_id()
            sorted_out = sorted(
                outgoing, key=lambda t: self.id_manager.get_transition_id(t))
            leg_map = {t: self.id_manager.next_id() for t in sorted_out}
            step_diverge[step] = (branch_id, branch_type, leg_map)
            step_y = self.layout.get_step_position(step)[1]
            min_y = min(self.layout.get_transition_position(t)[1]
                        for t in outgoing)
            self._emit_branch(sfc_content, branch_id, (step_y + min_y) // 2,
                              branch_type, L5X_BRANCH_FLOW_DIVERGE,
                              [leg_map[t] for t in sorted_out])

        # ---- Transition-level Converge (trans has multiple incoming steps) ----
        # Maps trans -> (branch_id, type, {step: leg_id})
        trans_converge = {}
        for trans in self.sfc.transitions:
            incoming = trans.incoming_steps
            if len(incoming) <= 1:
                continue
            branch_type = self._determine_converge_type_step(
                incoming, step_to_qsfc_branch)
            branch_id = self.id_manager.next_id()
            sorted_inc = sorted(
                incoming, key=lambda s: self.id_manager.get_step_id(s))
            leg_map = {s: self.id_manager.next_id() for s in sorted_inc}
            trans_converge[trans] = (branch_id, branch_type, leg_map)
            trans_y = self.layout.get_transition_position(trans)[1]
            max_y = max(self.layout.get_step_position(s)[1]
                        for s in incoming)
            self._emit_branch(sfc_content, branch_id, (max_y + trans_y) // 2,
                              branch_type, L5X_BRANCH_FLOW_CONVERGE,
                              [leg_map[s] for s in sorted_inc])

        # ---- Transition-level Diverge (trans has multiple outgoing steps) ----
        # Maps trans -> (branch_id, type, {step: leg_id})
        trans_diverge = {}
        for trans in self.sfc.transitions:
            outgoing = trans.outgoing_steps
            if len(outgoing) <= 1:
                continue
            branch_type = self._determine_diverge_type_for(trans, is_step=False)
            branch_id = self.id_manager.next_id()
            sorted_out = sorted(
                outgoing, key=lambda s: self.id_manager.get_step_id(s))
            leg_map = {s: self.id_manager.next_id() for s in sorted_out}
            trans_diverge[trans] = (branch_id, branch_type, leg_map)
            trans_y = self.layout.get_transition_position(trans)[1]
            min_y = min(self.layout.get_step_position(s)[1]
                        for s in outgoing)
            self._emit_branch(sfc_content, branch_id, (trans_y + min_y) // 2,
                              branch_type, L5X_BRANCH_FLOW_DIVERGE,
                              [leg_map[s] for s in sorted_out])

        # ---- Directed links ----

        # Step -> Transition connections
        for step in self.sfc.steps:
            step_id = self.id_manager.get_step_id(step)
            for trans in step.outgoing_transitions:
                trans_id = self.id_manager.get_transition_id(trans)
                has_div = step in step_diverge
                has_conv = trans in trans_converge
                if has_div and has_conv:
                    d_leg = step_diverge[step][2][trans]
                    c_leg = trans_converge[trans][2][step]
                    self._directed_links.append((d_leg, c_leg))
                elif has_div:
                    d_leg = step_diverge[step][2][trans]
                    self._directed_links.append((d_leg, trans_id))
                elif has_conv:
                    c_leg = trans_converge[trans][2][step]
                    self._directed_links.append((step_id, c_leg))
                else:
                    self._directed_links.append((step_id, trans_id))

        # Transition -> Step connections
        for trans in self.sfc.transitions:
            trans_id = self.id_manager.get_transition_id(trans)
            for step in trans.outgoing_steps:
                step_id = self.id_manager.get_step_id(step)
                has_div = trans in trans_diverge
                has_conv = step in step_converge
                if has_div and has_conv:
                    d_leg = trans_diverge[trans][2][step]
                    c_leg = step_converge[step][2][trans]
                    self._directed_links.append((d_leg, c_leg))
                elif has_div:
                    d_leg = trans_diverge[trans][2][step]
                    self._directed_links.append((d_leg, step_id))
                elif has_conv:
                    c_leg = step_converge[step][2][trans]
                    self._directed_links.append((trans_id, c_leg))
                else:
                    self._directed_links.append((trans_id, step_id))

        # Source -> Diverge branch links
        for step, (bid, _, _) in step_diverge.items():
            self._directed_links.append(
                (self.id_manager.get_step_id(step), bid))
        for trans, (bid, _, _) in trans_diverge.items():
            self._directed_links.append(
                (self.id_manager.get_transition_id(trans), bid))

        # Converge branch -> Target links
        for step, (bid, _, _) in step_converge.items():
            self._directed_links.append(
                (bid, self.id_manager.get_step_id(step)))
        for trans, (bid, _, _) in trans_converge.items():
            self._directed_links.append(
                (bid, self.id_manager.get_transition_id(trans)))

    def _emit_branch(self, parent, branch_id, y, branch_type, flow, leg_ids):
        """Emit a Branch XML element with Leg children."""
        attrs = {
            "ID": str(branch_id),
            "Y": str(y),
            "BranchType": branch_type,
            "BranchFlow": flow,
        }
        if flow == L5X_BRANCH_FLOW_DIVERGE:
            attrs["Priority"] = "Default"
        elem = ET.SubElement(parent, "Branch", **attrs)
        for lid in leg_ids:
            ET.SubElement(elem, "Leg", ID=str(lid))

    def _determine_converge_type_trans(self, transitions, trans_to_qsfc_branch):
        """Determine Selection vs Simultaneous for a step-converge branch."""
        source_branches = {}
        all_in_branch = True
        for trans in transitions:
            b = trans_to_qsfc_branch.get(trans)
            if b is not None:
                source_branches[id(b)] = b
            else:
                all_in_branch = False
        if all_in_branch and len(source_branches) == 1:
            branch = next(iter(source_branches.values()))
            if branch.flow_type == "AND":
                return L5X_BRANCH_TYPE_SIMULTANEOUS
        return L5X_BRANCH_TYPE_SELECTION

    def _determine_converge_type_step(self, steps, step_to_qsfc_branch):
        """Determine Selection vs Simultaneous for a transition-converge branch."""
        source_branches = {}
        all_in_branch = True
        for step in steps:
            b = step_to_qsfc_branch.get(step)
            if b is not None:
                source_branches[id(b)] = b
            else:
                all_in_branch = False
        if all_in_branch and len(source_branches) == 1:
            branch = next(iter(source_branches.values()))
            if branch.flow_type == "AND":
                return L5X_BRANCH_TYPE_SIMULTANEOUS
        return L5X_BRANCH_TYPE_SELECTION

    def _determine_diverge_type_for(self, element, is_step=True):
        """Determine Selection vs Simultaneous for a diverge branch."""
        for branch in self.sfc.branches:
            if branch.branch_type == "DIVERGE" and branch.root is element:
                if branch.flow_type == "AND":
                    return L5X_BRANCH_TYPE_SIMULTANEOUS
                return L5X_BRANCH_TYPE_SELECTION
        return L5X_BRANCH_TYPE_SELECTION

    def _build_directed_links(self, sfc_content: ET.Element):
        """Build DirectedLink elements."""
        for from_id, to_id in self._directed_links:
            ET.SubElement(
                sfc_content, "DirectedLink",
                FromID=str(from_id),
                ToID=str(to_id),
                Show="true"
            )

    def to_string(self, root: ET.Element) -> str:
        """Convert XML tree to formatted string.

        Args:
            root: Root element of XML tree

        Returns:
            Formatted XML string with declaration
        """
        # Convert to string
        rough_string = ET.tostring(root, encoding="unicode")

        # Parse with minidom for pretty printing
        parsed = minidom.parseString(rough_string)
        pretty = parsed.toprettyxml(indent="  ", encoding=None)

        # Fix the XML declaration
        lines = pretty.split("\n")
        lines[0] = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'

        # Remove empty lines that minidom adds
        result_lines = []
        for line in lines:
            if line.strip():
                result_lines.append(line)

        result = "\n".join(result_lines)

        # Convert sentinel CDATA elements to real CDATA sections
        result = self._convert_cdata_elements(result)

        return result

    @staticmethod
    def _convert_cdata_elements(xml_string: str) -> str:
        """Replace CDATA sentinel elements with actual CDATA sections.

        During tree construction, text that needs CDATA wrapping is stored
        inside <__CDATA__>text</__CDATA__> placeholder elements.  This
        method converts those placeholders to proper <![CDATA[text]]>
        sections in the serialized XML string.
        """
        pattern = r"""
            # Match elements with separate opening and closing tags.
            <{tag}\s*>    # Opening tag.
            (?P<text>.*?) # Element content.
            </{tag}\s*>   # Closing tag.

            |

            # Also match empty, self-closing tags.
            <{tag}\s*/>
        """.format(tag=re.escape(CDATA_TAG))

        def _to_cdata_section(match):
            text = match.group('text')
            if text is not None:
                return '<![CDATA[{0}]]>'.format(text)
            # Self-closing tag means empty content.
            return '<![CDATA[]]>'

        return re.sub(pattern, _to_cdata_section, xml_string,
                      flags=re.VERBOSE | re.DOTALL)
