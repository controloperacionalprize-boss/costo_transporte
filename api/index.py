import sys
import os

# Add backend dir to path so imports work
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'backend'))

from main import app
