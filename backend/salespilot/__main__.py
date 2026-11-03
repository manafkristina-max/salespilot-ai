"""python -m salespilot  → serve API + built UI on http://127.0.0.1:8000"""

import uvicorn

from .api import create_app
from .config import get_settings

if __name__ == "__main__":
    s = get_settings()
    if s.host not in ("127.0.0.1", "localhost", "::1"):
        print("WARNING: SalesPilot has no authentication; bind to 127.0.0.1 unless you know what you are doing.")
    uvicorn.run(create_app(s), host=s.host, port=s.port)
