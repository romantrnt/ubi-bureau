"""Compatibility entry point for the native watcher acceptance scenario."""
import runpy
from pathlib import Path
runpy.run_path(str(Path(__file__).with_name("native-acceptance.py")), run_name="__main__")
