"""Main L5X exporter with builder pattern API."""

from .validators import L5XValidator, L5XExportError
from .id_manager import IDManager
from .layout import LayoutCalculator
from .xml_builder import L5XBuilder
from .constants import (
    DEFAULT_PROGRAM_NAME, DEFAULT_CONTROLLER_NAME, DEFAULT_SOFTWARE_REVISION
)


class L5XExporter:
    """Exports SFC to Rockwell Automation L5X format.

    Uses builder pattern for configuration:

        L5XExporter(sfc)
            .set_program_name("MyProgram")
            .set_controller_name("MainPLC")
            .set_software_revision("32.01")
            .export("output.L5X")
    """

    def __init__(self, sfc):
        """Initialize exporter with parsed SFC.

        Args:
            sfc: Parsed SFC object from QuickSFC parser
        """
        self.sfc = sfc
        self._program_name = DEFAULT_PROGRAM_NAME
        self._controller_name = DEFAULT_CONTROLLER_NAME
        self._software_revision = DEFAULT_SOFTWARE_REVISION

        # Internal components
        self._id_manager = None
        self._layout = None
        self._xml_builder = None

    def set_program_name(self, name: str) -> "L5XExporter":
        """Set the L5X program name.

        Args:
            name: Program name (e.g., "MainProgram")

        Returns:
            Self for chaining
        """
        self._program_name = name
        return self

    def set_controller_name(self, name: str) -> "L5XExporter":
        """Set the L5X controller name.

        Args:
            name: Controller name (e.g., "MainPLC")

        Returns:
            Self for chaining
        """
        self._controller_name = name
        return self

    def set_software_revision(self, revision: str) -> "L5XExporter":
        """Set the L5X software revision.

        Args:
            revision: Software revision (e.g., "32.01")

        Returns:
            Self for chaining
        """
        self._software_revision = revision
        return self

    def validate(self) -> "L5XExporter":
        """Run pre-export validation.

        Returns:
            Self for chaining

        Raises:
            L5XExportError: If validation fails
        """
        validator = L5XValidator(self.sfc)
        validator.validate()
        return self

    def export(self, filepath: str) -> str:
        """Export SFC to L5X file.

        Args:
            filepath: Output file path

        Returns:
            Path to exported file

        Raises:
            L5XExportError: If export fails
        """
        # Step 1: Validate
        self.validate()

        # Step 2: Allocate IDs
        self._allocate_ids()

        # Step 3: Calculate layout
        self._calculate_layout()

        # Step 4: Build XML
        xml_string = self._build_xml()

        # Step 5: Write to file
        with open(filepath, "w", encoding="utf-8") as f:
            f.write(xml_string)

        return filepath

    def to_string(self) -> str:
        """Export SFC to L5X XML string.

        Returns:
            L5X XML string

        Raises:
            L5XExportError: If export fails
        """
        # Step 1: Validate
        self.validate()

        # Step 2: Allocate IDs
        self._allocate_ids()

        # Step 3: Calculate layout
        self._calculate_layout()

        # Step 4: Build XML
        return self._build_xml()

    def _allocate_ids(self):
        """Allocate IDs for all SFC elements."""
        self._id_manager = IDManager()

        # Allocate step and action IDs (in order)
        for step in self.sfc.steps:
            self._id_manager.allocate_step_id(step)
            # Only allocate action ID if step has real action content
            if step.action and step.action != "None" and step.action.strip():
                self._id_manager.allocate_action_id(step)

        # Allocate transition IDs
        for trans in self.sfc.transitions:
            self._id_manager.allocate_transition_id(trans)

        # L5X branch and leg IDs are allocated later by the XML builder
        # based on graph topology (fan-in/fan-out analysis), not the
        # QSFC branch syntax.

    def _calculate_layout(self):
        """Calculate positions for all elements."""
        self._layout = LayoutCalculator(self.sfc, self._id_manager)
        self._layout.calculate()

    def _build_xml(self) -> str:
        """Build L5X XML string."""
        self._xml_builder = L5XBuilder(
            self.sfc, self._id_manager, self._layout
        )
        self._xml_builder.set_program_name(self._program_name)
        self._xml_builder.set_controller_name(self._controller_name)
        self._xml_builder.set_software_revision(self._software_revision)

        root = self._xml_builder.build()
        return self._xml_builder.to_string(root)
