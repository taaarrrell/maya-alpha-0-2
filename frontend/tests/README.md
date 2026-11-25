# Frontend browser checks

With Python Playwright and its browser engines installed, run `python frontend/tests/verify.py --engine chromium` and `python frontend/tests/verify.py --engine webkit` from the repository root. The runner uses loopback and synthetic transport and rejects off-origin requests.
