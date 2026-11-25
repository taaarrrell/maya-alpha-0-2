# E02 frontend release candidate

Serve the repository root and open /frontend/. The page starts in Simulated and loads the reviewed shared adapter and identity. Live is explicit and sends only the current message, approved identity instructions and optional Live chain reference to the existing Worker. Use disposable test content only. Real Live mode requires an approved deployment under the existing allowed Pages origin.

History and chain data are scoped to the release tab and survive reload. Simulated and Live transcript views are isolated. Reset clears both histories and the Live chain. PHINEAS and DREAM affect visuals only.

For verification, run the Playwright commands in tests/README.md. The suite injects synthetic transport and blocks any off-origin network traffic. The release entry point is also checked with an intercepted fetch.
