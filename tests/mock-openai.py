"""Tiny OpenAI-compatible mock, only for verifying the Summarize button end to end.

POST /v1/chat/completions -> canned summary. CORS open so the page on
127.0.0.1:8765 can call it. Never used by the app itself.
"""
import json
from http.server import BaseHTTPRequestHandler, HTTPServer

SUMMARY = (
    "KEY POINTS\n"
    "- Subfloor under the tub is soft about two feet out and has to be replaced before tile.\n"
    "- Customer wants confirmation from the owner.\n"
    "\n"
    "PRICES & DATES\n"
    "- 2800 dollars, materials included.\n"
    "- Start Monday the 23rd.\n"
    "\n"
    "ACTION ITEMS\n"
    "- Confirm with the owner by Friday.\n"
    "- Order subfloor panels.\n"
)


class Handler(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b"{}"
        try:
            body = json.loads(raw)
        except Exception:
            body = {}
        with open("mock-request.json", "w", encoding="utf-8") as fh:
            json.dump(
                {
                    "path": self.path,
                    "authorization": self.headers.get("Authorization"),
                    "body": body,
                },
                fh,
                indent=2,
            )
        if not body.get("messages"):
            self.send_response(400)
            self._cors()
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"error":{"message":"no messages"}}')
            return
        payload = json.dumps(
            {
                "id": "mock-1",
                "object": "chat.completion",
                "model": body.get("model", "mock"),
                "choices": [
                    {"index": 0, "message": {"role": "assistant", "content": SUMMARY}, "finish_reason": "stop"}
                ],
            }
        ).encode("utf-8")
        self.send_response(200)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    HTTPServer(("127.0.0.1", 8799), Handler).serve_forever()
