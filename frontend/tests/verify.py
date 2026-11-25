"""Browser integration checks against the corrected adapter over loopback only."""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

from playwright.sync_api import expect, sync_playwright


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


def verify(browser, origin, profile):
    context = browser.new_context(**profile, reduced_motion="reduce")
    context.add_init_script(
        """window.MAYA_E01_TESTING = true;
           if (!sessionStorage.getItem('maya-alpha-0-2-chain-v0.1')) {
             sessionStorage.setItem('maya-alpha-0-2-chain-v0.1', 'other-alpha02-chain');
             sessionStorage.setItem('maya-alpha-chain-v0.1', 'old-chain');
             sessionStorage.setItem('maya-alpha-conversation-v0.1', 'old-history');
           }"""
    )
    page = context.new_page()
    errors = []
    external = []
    page.on("pageerror", lambda error: errors.append(str(error)))

    def local_only(route):
        if route.request.url.startswith(origin + "/"):
            route.continue_()
        else:
            external.append(route.request.url)
            route.abort()

    page.route("**/*", local_only)
    fixture = Path(__file__).resolve().parents[1] / "synthetic-bootstrap.js"
    page.route(origin + "/frontend/live-bootstrap.js",
               lambda route: route.fulfill(path=fixture, content_type="text/javascript"))
    assert page.goto(origin + "/frontend/").ok
    mode = page.locator("#connection")
    field = page.locator("#message")
    quota = page.locator("#quota")
    status = page.locator("#pending")
    send = page.get_by_role("button", name="Send")
    reset = page.get_by_role("button", name="Reset")
    messages = page.locator(".message")
    feedback = page.locator("#feedback")
    canvas = page.locator("canvas")
    form = page.locator("#embodiment")
    image = page.locator("#form-image")

    def submit(text):
        field.fill(text)
        field.press("Enter")

    def clock(value):
        page.evaluate("value => MayaE01Synthetic.setTime(value)", value)

    def enqueue(**response):
        page.evaluate("result => MayaE01Synthetic.enqueue(result)", response)

    def reply(text, count, delay=0):
        enqueue(status=200, body={"text": text, "remaining": count, "interaction_id": "e01-" + str(count)}, delay=delay)

    def settle():
        expect(send).to_be_enabled()

    def calls():
        return page.evaluate("() => MayaE01Synthetic.calls.map(call => call.body)")

    def keys():
        return page.evaluate("() => Object.fromEntries(Object.entries(sessionStorage))")

    expect(mode).to_have_value("simulated")
    expect(quota).to_be_hidden()
    assert not calls()
    page.get_by_text("Identity", exact=True).click()
    identity = page.evaluate("() => window.MAYA_IDENTITY_CONFIG")
    assert page.locator(".identity-content h3").inner_text() == identity["display_name"]
    assert page.locator(".identity-content p").all_text_contents() == [
        identity["full_name"], identity["purpose"], identity["personality"]
    ]
    assert page.locator(".identity-content li").all_text_contents() == [
        *identity["traits"], *identity["principles"], *identity["boundaries"]
    ]
    expect(page.get_by_role("textbox", name="Your message")).to_be_visible()
    expect(page.get_by_role("log", name="Conversation history")).to_be_visible()
    assert status.get_attribute("role") == "status"
    assert feedback.get_attribute("role") == "alert"
    assert page.locator(".composer a").count() == 0
    protocol_button = page.get_by_role("button", name="M.A.Y.A.", exact=True)
    protocol_button.focus()
    page.keyboard.press("Tab")
    expect(page.get_by_role("button", name="PHINEAS", exact=True)).to_be_focused()
    page.keyboard.press("Enter")
    expect(page.get_by_role("button", name="PHINEAS", exact=True)).to_have_attribute("aria-pressed", "true")
    assert image.get_attribute("alt") == ""
    assert canvas.get_attribute("aria-hidden") == "true"
    print("PASS exact identity wording, accessible names and status roles, keyboard focus and visual-only decorative assets")
    page.emulate_media(reduced_motion="no-preference")
    frame = canvas.evaluate("c => c.toDataURL()")
    page.wait_for_function("frame => document.querySelector('canvas').toDataURL() !== frame", arg=frame)
    page.emulate_media(reduced_motion="reduce")
    frames = set()
    for protocol in ("M.A.Y.A.", "PHINEAS", "DREAM"):
        page.get_by_role("button", name=protocol, exact=True).tap()
        expect(page.locator("#mode-title")).to_have_text(protocol)
        frame = canvas.evaluate("c => c.toDataURL()")
        page.evaluate("() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))")
        assert frame == canvas.evaluate("c => c.toDataURL()")
        frames.add(frame)
    assert len(frames) == 3 and not calls()
    print("PASS nanoswarm animation, three static formations with Reduce Motion, touch protocol controls")

    for name in ("signal", "prism"):
        form.select_option(name)
        expect(image).to_have_attribute("src", f"forms/{name}-neutral.png")
        page.wait_for_function("() => document.querySelector('#form-image').naturalWidth > 0")
    assert image.evaluate("e => getComputedStyle(e).animationName") == "none"
    clock("2026-11-25T23:59:30Z")
    submit("who are you")
    expect(image).to_have_attribute("src", "forms/prism-pending.png")
    mode.select_option("live")
    settle()
    expect(image).to_have_attribute("src", "forms/prism-reply.png")
    expect(messages).to_have_count(0)
    mode.select_option("simulated")
    expect(messages.last).to_have_attribute("data-mode", "simulated")
    assert identity["full_name"] in messages.last.inner_text()
    mode.select_option("live")
    expect(quota).to_have_text("Remaining: unknown")
    assert not calls()
    form.select_option("swarm")
    expect(canvas).to_be_visible()
    print("PASS PNG forms and expressions, identity injection, adapter simulation and in-flight mode tagging")

    reply("<b>First</b>", 19, delay=280)
    submit("first transport")
    mode.select_option("simulated")
    settle()
    expect(messages).to_have_count(2)
    expect(messages.last).to_have_attribute("data-mode", "simulated")
    mode.select_option("live")
    expect(messages.last).to_have_attribute("data-mode", "live")
    assert "<b>First</b>" in messages.last.inner_text()
    assert messages.locator("b").count() == 0
    instruction = calls()[0]["system_instruction"]
    for field_name in ("display_name", "full_name", "purpose", "personality", "traits", "principles", "boundaries"):
        values = identity[field_name]
        assert all(value in instruction for value in (values if isinstance(values, list) else [values]))
    assert "previous_interaction_id" not in calls()[0]
    mode.select_option("live")
    expect(quota).to_have_text("Remaining: 19")
    clock("2026-11-26T00:00:00Z")
    expect(quota).to_have_text("Remaining: unknown", timeout=3000)

    clock("2026-11-26T23:59:59Z")
    reply("Crosses midnight", 17, delay=500)
    submit("cross boundary")
    expect(status).to_have_text("Waiting for a reply…")
    clock("2026-11-27T00:00:00Z")
    settle()
    assert calls()[-1]["previous_interaction_id"] == "e01-19"
    assert "Crosses midnight" in messages.last.inner_text()
    expect(quota).to_have_text("Remaining: unknown")
    reply("Current UTC day", 18)
    submit("same day")
    settle()
    expect(quota).to_have_text("Remaining: 18")
    for invalid in (-1, 21, 1.5, "18", None):
        reply("Unusable count", invalid)
        submit("invalid count")
        settle()
        expect(quota).to_have_text("Remaining: unknown")
        assert "Unusable count" in messages.last.inner_text()
    reply("Recovered count", 18)
    submit("valid count")
    settle()
    expect(quota).to_have_text("Remaining: 18")
    print("PASS periodic UTC expiration, cross-midnight suppression and same-day quota recovery")

    for failure, message in [
        ({"status": 502, "body": {"error": "upstream_overloaded"}}, "Gemini is overloaded right now. Wait a little and try again."),
        ({"network": True}, "Could not reach the proxy. Check your connection and try again."),
        ({"status": 200, "hang": True}, "The reply took too long. Try again."),
    ]:
        before = len(calls())
        persisted = keys()
        count = messages.count()
        enqueue(**failure)
        submit("failed draft")
        settle()
        expect(feedback).to_have_text(message)
        expect(quota).to_have_text("Remaining: unknown")
        expect(messages).to_have_count(count)
        expect(field).to_have_value("failed draft")
        assert keys() == persisted and len(calls()) == before + 1
    print("PASS worker error, network error, hung response-body timeout, no writes or retries on failure")

    snapshot = messages.count()
    page.reload()
    expect(mode).to_have_value("simulated")
    expect(quota).to_be_hidden()
    expect(messages).to_have_count(2)
    assert messages.last.get_attribute("data-mode") == "simulated"
    mode.select_option("live")
    expect(messages).to_have_count(snapshot)
    assert messages.first.get_attribute("data-mode") == "live"
    expect(quota).to_have_text("Remaining: unknown")
    reply("Late reply", 16, delay=650)
    submit("discard on reset")
    expect(status).to_have_text("Waiting for a reply…")
    assert calls()[0]["previous_interaction_id"] == "e01-18"
    assert page.evaluate("() => MayaE01Synthetic.startSend('duplicate')") == "busy"
    reset.tap()
    settle()
    expect(messages).to_have_count(0)
    expect(feedback).to_have_text("")
    assert page.evaluate("() => MayaE01Synthetic.calls[0].signal.aborted")
    reply("After reset", 15, delay=750)
    submit("new generation")
    settle()
    expect(messages).to_have_count(2)
    assert "After reset" in messages.last.inner_text()
    assert "previous_interaction_id" not in calls()[-1]
    reset.tap()
    assert keys() == {
        "maya-alpha-0-2-chain-v0.1": "other-alpha02-chain",
        "maya-alpha-chain-v0.1": "old-chain",
        "maya-alpha-conversation-v0.1": "old-history",
    }
    print("PASS persisted mode-isolated history, isolated keys, busy, reset, and late-response isolation")

    for width, height in [(320, 568), (390, 844), (430, 932), (844, 390), (1280, 900)]:
        page.set_viewport_size({"width": width, "height": height})
        assert page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")
        assert page.locator("button, select").evaluate_all("items => items.every(e => e.getBoundingClientRect().height >= 44)")
    assert not errors and not external, (errors, external)
    print("PASS five viewport sizes, 44px controls, zero JavaScript errors and off-origin requests")
    context.close()


def verify_release_bootstrap(browser, origin, profile):
    context = browser.new_context(**profile, reduced_motion="reduce")
    context.add_init_script("""
      window.releaseCalls = [];
      window.fetch = (url, options) => {
        releaseCalls.push({url, method: options.method, credentials: options.credentials,
                           redirect: options.redirect, body: JSON.parse(options.body)});
        return Promise.resolve(new Response(JSON.stringify({
          text: 'Intercepted release reply', interaction_id: 'e02-test', remaining: 19
        }), {status: 200, headers: {'Content-Type': 'application/json'}}));
      };
    """)
    page = context.new_page()
    off_origin = []
    def restrict(route):
        if route.request.url.startswith(origin + "/"):
            route.continue_()
        else:
            off_origin.append(route.request.url)
            route.abort()
    page.route("**/*", restrict)
    assert page.goto(origin + "/frontend/").ok
    worker = "https://maya-alpha-m3-proxy.macman2028.workers.dev"
    policy = page.locator('meta[http-equiv="Content-Security-Policy"]').get_attribute("content")
    assert [entry.split() for entry in policy.split(";") if entry.strip().startswith("connect-src")] == [
        ["connect-src", worker]
    ]
    mode = page.get_by_role("combobox", name="Connection mode")
    expect(mode).to_have_value("simulated")
    expect(mode).to_have_attribute("aria-describedby", "live-disclosure")
    expect(page.locator("#live-disclosure")).to_contain_text("Gemini through a Cloudflare Worker")
    expect(page.locator("#live-disclosure")).to_contain_text("private memories")
    field = page.get_by_role("textbox", name="Your message")
    field.fill("synthetic local turn")
    field.press("Enter")
    expect(page.locator(".message")).to_have_count(2)
    assert page.evaluate("() => releaseCalls.length") == 0
    mode.select_option("live")
    expect(page.locator(".signal")).to_have_text("LIVE")
    expect(page.locator(".message")).to_have_count(0)
    assert page.evaluate("() => releaseCalls.length") == 0
    field.fill("synthetic release check")
    field.press("Enter")
    expect(page.locator(".message").last).to_contain_text("Intercepted release reply")
    expect(page.locator("#quota")).to_have_text("Remaining: 19")
    [request] = page.evaluate("() => releaseCalls")
    assert (request["url"], request["method"], request["credentials"], request["redirect"]) == (
        worker + "/chat", "POST", "omit", "error",
    )
    assert request["body"]["messages"] == [{"role": "user", "text": "synthetic release check"}]
    assert "previous_interaction_id" not in request["body"]
    trait = page.evaluate("() => window.MAYA_IDENTITY_CONFIG.traits[4]")
    assert trait in request["body"]["system_instruction"]
    assert not off_origin
    print("PASS release entry point, explicit Live, disclosure, one Worker destination, isolated payload")
    context.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--engine", choices=["chromium", "webkit"], default="chromium")
    parser.add_argument("--chromium", help="Path to a locally installed Chromium")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    with ThreadingHTTPServer(("127.0.0.1", 0), partial(QuietHandler, directory=root)) as server:
        Thread(target=server.serve_forever, daemon=True).start()
        try:
            with sync_playwright() as playwright:
                browser = getattr(playwright, args.engine).launch(executable_path=args.chromium)
                profile = dict(playwright.devices["iPhone 13"])
                profile.pop("default_browser_type")
                print(args.engine, browser.version)
                verify(browser, f"http://127.0.0.1:{server.server_port}", profile)
                verify_release_bootstrap(browser, f"http://127.0.0.1:{server.server_port}", profile)
                browser.close()
        finally:
            server.shutdown()


if __name__ == "__main__":
    main()
