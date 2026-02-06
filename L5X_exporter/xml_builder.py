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
        self._build_branches(sfc_content)
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

            # Register directed links from step to outgoing transitions
            for trans in step.outgoing_transitions:
                trans_id = self.id_manager.get_transition_id(trans)
                if trans_id is not None:
                    self._directed_links.append((step_id, trans_id))

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

            # Register directed links from transition to outgoing steps
            for step in trans.outgoing_steps:
                step_id = self.id_manager.get_step_id(step)
                if step_id is not None:
                    self._directed_links.append((trans_id, step_id))

    def _build_branches(self, sfc_content: ET.Element):
        """Build Branch elements in SFCContent."""
        for branch in self.sfc.branches:
            branch_id = self.id_manager.get_branch_id(branch)
            y = self.layout.get_branch_y(branch)

            # Map flow type to L5X branch type
            if branch.flow_type == "OR":
                branch_type = L5X_BRANCH_TYPE_SELECTION
            else:  # AND
                branch_type = L5X_BRANCH_TYPE_SIMULTANEOUS

            # Map branch type to L5X branch flow
            if branch.branch_type == "DIVERGE":
                branch_flow = L5X_BRANCH_FLOW_DIVERGE
            else:
                branch_flow = L5X_BRANCH_FLOW_CONVERGE

            branch_elem = ET.SubElement(
                sfc_content, "Branch",
                ID=str(branch_id),
                Y=str(y),
                BranchType=branch_type,
                BranchFlow=branch_flow
            )

            if branch.branch_type == "DIVERGE":
                branch_elem.set("Priority", "Default")

            # Add legs
            for leg in branch.legs:
                leg_id = self.id_manager.get_leg_id(leg)
                ET.SubElement(branch_elem, "Leg", ID=str(leg_id))

            # Create directed links for branches
            if branch.branch_type == "DIVERGE" and branch.root:
                # Link from root element to diverge branch
                root_id = None
                if hasattr(branch.root, 'is_initial'):  # Step
                    root_id = self.id_manager.get_step_id(branch.root)
                elif hasattr(branch.root, 'condition'):  # Transition
                    root_id = self.id_manager.get_transition_id(branch.root)

                if root_id is not None:
                    self._directed_links.append((root_id, branch_id))

                # Link from legs to first elements in each leg
                for leg in branch.legs:
                    leg_id = self.id_manager.get_leg_id(leg)
                    elements = leg.elements_sorted_by_line_number()
                    if elements:
                        first_elem = elements[0]
                        first_id = None
                        if hasattr(first_elem, 'is_initial'):  # Step
                            first_id = self.id_manager.get_step_id(first_elem)
                        elif hasattr(first_elem, 'condition'):  # Transition
                            first_id = self.id_manager.get_transition_id(first_elem)

                        if first_id is not None:
                            self._directed_links.append((leg_id, first_id))

            elif branch.branch_type == "CONVERGE":
                # Link from legs to converge branch
                for leg in branch.legs:
                    leg_id = self.id_manager.get_leg_id(leg)
                    elements = leg.elements_sorted_by_line_number()
                    if elements:
                        last_elem = elements[-1]
                        last_id = None
                        if hasattr(last_elem, 'is_initial'):  # Step
                            last_id = self.id_manager.get_step_id(last_elem)
                        elif hasattr(last_elem, 'condition'):  # Transition
                            last_id = self.id_manager.get_transition_id(last_elem)

                        if last_id is not None:
                            self._directed_links.append((last_id, leg_id))

                # Link from converge branch to root element
                if branch.root:
                    root_id = None
                    if hasattr(branch.root, 'is_initial'):  # Step
                        root_id = self.id_manager.get_step_id(branch.root)
                    elif hasattr(branch.root, 'condition'):  # Transition
                        root_id = self.id_manager.get_transition_id(branch.root)

                    if root_id is not None:
                        self._directed_links.append((branch_id, root_id))

    def _build_directed_links(self, sfc_content: ET.Element):
        """Build DirectedLink elements."""
        # Remove duplicates while preserving order
        seen = set()
        unique_links = []
        for link in self._directed_links:
            if link not in seen:
                seen.add(link)
                unique_links.append(link)

        for from_id, to_id in unique_links:
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
