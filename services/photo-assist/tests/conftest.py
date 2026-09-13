import sys
from pathlib import Path

# Make the service modules (app, wall_fitting, ...) importable without installation.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
