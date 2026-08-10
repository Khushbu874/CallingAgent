import os
import json
import random
import asyncio
from datetime import datetime
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from dotenv import load_dotenv
from livekit import api
import anyascii


def ensure_roman_script(text: str) -> str:
    """Converts ANY non-Latin script to Roman English using anyascii."""
    if not text:
        return ""
    has_non_latin = any(ord(c) > 0x024F and not c.isascii() for c in text)
    if has_non_latin:
        return anyascii.anyascii(text)
    return text


def sanitize_call(data: dict) -> dict:
    """Apply ensure_roman_script to every conversation message text in a call record."""
    if "conversation" in data:
        for msg in data["conversation"]:
            if "text" in msg:
                msg["text"] = ensure_roman_script(msg["text"])
    return data

# Load environment variables
load_dotenv(".env")

app = Flask(__name__, static_folder="dashboard", static_url_path="")
CORS(app)

RECORDINGS_DIR = "recordings"
if not os.path.exists(RECORDINGS_DIR):
    os.makedirs(RECORDINGS_DIR)

# --- Routes for Frontend ---

@app.route("/")
def index():
    return send_from_directory("dashboard", "index.html")

@app.route("/<path:filename>")
def serve_static(filename):
    return send_from_directory("dashboard", filename)

# --- API Endpoints ---

@app.route("/api/config", methods=["GET"])
def get_config():
    """Returns basic configuration status."""
    return jsonify({
        "status": "ready",
        "default_transfer_number": os.getenv("DEFAULT_TRANSFER_NUMBER", ""),
        "outbound_number": os.getenv("VOBIZ_OUTBOUND_NUMBER", "")
    })

@app.route("/api/call", methods=["POST"])
def initiate_call():
    """Dispatch an outbound AI call via LiveKit Cloud."""
    data = request.json or {}
    country_code = data.get("country_code", "+91").strip()
    raw_number = data.get("phone_number", "").strip()

    if not raw_number:
        return jsonify({"success": False, "error": "Phone number is required."}), 400

    # Clean phone number
    clean_num = "".join(filter(str.isdigit, raw_number))
    if not clean_num:
        return jsonify({"success": False, "error": "Invalid phone number format."}), 400

    # Ensure phone number starts with + and country code
    if raw_number.startswith("+"):
        phone_number = raw_number
    else:
        # Strip leading zeros if present
        clean_num = clean_num.lstrip("0")
        if len(clean_num) != 10:
            return jsonify({"success": False, "error": "Phone number must be exactly 10 digits."}), 400
        phone_number = f"{country_code}{clean_num}"

    url = os.getenv("LIVEKIT_URL")
    api_key = os.getenv("LIVEKIT_API_KEY")
    api_secret = os.getenv("LIVEKIT_API_SECRET")

    if not (url and api_key and api_secret):
        return jsonify({"success": False, "error": "LiveKit credentials missing in server .env"}), 500

    room_name = f"call-{phone_number.replace('+', '')}-{random.randint(1000, 9999)}"

    async def _dispatch():
        lk_api = api.LiveKitAPI(url=url, api_key=api_key, api_secret=api_secret)
        try:
            dispatch_request = api.CreateAgentDispatchRequest(
                agent_name="outbound-caller",
                room=room_name,
                metadata=json.dumps({"phone_number": phone_number})
            )
            dispatch = await lk_api.agent_dispatch.create_dispatch(dispatch_request)
            return dispatch.id
        finally:
            await lk_api.aclose()

    try:
        dispatch_id = asyncio.run(_dispatch())
        return jsonify({
            "success": True,
            "message": f"Outbound call dispatched successfully to {phone_number}!",
            "dispatch_id": dispatch_id,
            "room_name": room_name,
            "phone_number": phone_number,
            "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        })
    except Exception as e:
        return jsonify({"success": False, "error": f"Failed to dispatch call: {str(e)}"}), 500

@app.route("/api/calls", methods=["GET"])
def get_calls():
    """Retrieve list of all recorded calls with transcript summaries."""
    calls = []
    if os.path.exists(RECORDINGS_DIR):
        for fname in os.listdir(RECORDINGS_DIR):
            if fname.endswith(".json"):
                fpath = os.path.join(RECORDINGS_DIR, fname)
                try:
                    with open(fpath, "r", encoding="utf-8") as f:
                        data = json.load(f)
                        data = sanitize_call(data)
                        data["id"] = data.get("id", fname.replace(".json", ""))
                        data["filename"] = fname
                        data["total_messages"] = len(data.get("conversation", []))
                        calls.append(data)
                except Exception as e:
                    print(f"Error reading {fname}: {e}")

    # Sort calls by status (live first), then timestamp/filename descending
    def call_sort_key(x):
        is_live = 1 if x.get("id", "").startswith("live_") or x.get("status") == "In Progress (Live)" else 0
        return (is_live, x.get("timestamp", ""))

    calls.sort(key=call_sort_key, reverse=True)
    return jsonify({"success": True, "calls": calls})

@app.route("/api/calls/<call_id>", methods=["GET"])
def get_call_detail(call_id):
    """Retrieve full details and chat transcript for a single call."""
    fname = f"{call_id}.json" if not call_id.endswith(".json") else call_id
    fpath = os.path.join(RECORDINGS_DIR, fname)
    
    if not os.path.exists(fpath):
        return jsonify({"success": False, "error": "Call transcript recording not found."}), 404

    try:
        with open(fpath, "r", encoding="utf-8") as f:
            data = json.load(f)
            data = sanitize_call(data)
            data["id"] = call_id
            return jsonify({"success": True, "call": data})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route("/api/calls/<call_id>", methods=["DELETE"])
def delete_call(call_id):
    """Delete a call recording file."""
    fname = f"{call_id}.json" if not call_id.endswith(".json") else call_id
    fpath = os.path.join(RECORDINGS_DIR, fname)
    
    if os.path.exists(fpath):
        os.remove(fpath)
        return jsonify({"success": True, "message": "Recording deleted."})
    return jsonify({"success": False, "error": "File not found."}), 404

if __name__ == "__main__":
    port = int(os.getenv("PORT", 5000))
    print(f"\nTrinity Calling Dashboard Server running at http://localhost:{port}\n")
    app.run(host="0.0.0.0", port=port, debug=True)
