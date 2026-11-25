"""L5X Exporter - Export QuickSFC to Rockwell Automation L5X format.

Public API:
    L5XExporter - Main exporter class with builder pattern
    L5XExportError - Exception raised on export errors

Example usage:
    from L5X_exporter import L5XExporter, L5XExportError

    sfc = parse("program.qsfc")

    try:
        L5XExporter(sfc)
            .set_program_name("MyProgram")
            .set_controller_name("MainPLC")
            .set_software_revision("32.01")
            .export("output.L5X")
    except L5XExportError as e:
        print(f"Export failed: {e}")
"""

from .exporter import L5XExporter
from .validators import L5XExportError

__all__ = ["L5XExporter", "L5XExportError"]
