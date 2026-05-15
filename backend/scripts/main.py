#!/usr/bin/env python3
"""
Main entry point for CCTV Face Recognition System
Standalone CLI tool for face recognition testing
"""

import os
import sys

# Add backend to path for imports
_backend_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _backend_root not in sys.path:
    sys.path.insert(0, _backend_root)

# Import and run main function
# Import from the same directory
from recognizer import main

if __name__ == "__main__":
    main()

