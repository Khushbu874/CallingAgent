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

try:
    from supabase import create_client
    SUPABASE_AVAILABLE = True
except ImportError:
    SUPABASE_AVAILABLE = False


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

# --- Supabase Client ---
_supabase = None
if SUPABASE_AVAILABLE:
    _sb_url = os.getenv("SUPABASE_URL", "")
    _sb_key = os.getenv("SUPABASE_SECRET_KEY", "") or os.getenv("SUPABASE_PUBLISHABLE_KEY", "")
    if _sb_url and _sb_key:
        try:
            _supabase = create_client(_sb_url, _sb_key)
            print("[Supabase] Connected successfully.")
        except Exception as e:
            print(f"[Supabase] Connection failed: {e}")

# --- Routes for Frontend ---

@app.route("/")
def index():
    return send_from_directory("dashboard", "index.html")

@app.route("/favicon.ico")
def favicon():
    return "", 204

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
    """Retrieve list of all recorded calls. Reads from Supabase first, falls back to local JSON."""
    calls = []

    # --- Try Supabase first ---
    if _supabase:
        try:
            result = _supabase.table("call_logs") \
                .select("id, phone_number, room_name, status, total_messages, created_at, conversation") \
                .order("created_at", desc=True) \
                .execute()
            for row in result.data:
                call = sanitize_call({
                    "id": str(row["id"]),
                    "phone_number": row.get("phone_number", "Unknown"),
                    "room_name": row.get("room_name", ""),
                    "status": row.get("status", "Completed"),
                    "total_messages": row.get("total_messages", 0),
                    "timestamp": str(row.get("created_at", "")),
                    "date": str(row.get("created_at", "")),
                    "conversation": row.get("conversation", []),
                })
                calls.append(call)
            return jsonify({"success": True, "calls": calls, "source": "supabase"})
        except Exception as e:
            print(f"[Supabase] Failed to fetch calls: {e} — falling back to local JSON")

    # --- Fallback: Local JSON files ---
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

    def call_sort_key(x):
        is_live = 1 if x.get("id", "").startswith("live_") or x.get("status") == "In Progress (Live)" else 0
        return (is_live, x.get("timestamp", ""))

    calls.sort(key=call_sort_key, reverse=True)
    return jsonify({"success": True, "calls": calls, "source": "local"})

@app.route("/api/calls/<call_id>", methods=["GET"])
def get_call_detail(call_id):
    """Retrieve full details for a single call. Reads from Supabase first, falls back to local JSON."""

    # --- Try Supabase first ---
    if _supabase:
        try:
            result = _supabase.table("call_logs") \
                .select("*") \
                .eq("id", call_id) \
                .single() \
                .execute()
            if result.data:
                row = result.data
                call = sanitize_call({
                    "id": str(row["id"]),
                    "phone_number": row.get("phone_number", "Unknown"),
                    "room_name": row.get("room_name", ""),
                    "status": row.get("status", "Completed"),
                    "total_messages": row.get("total_messages", 0),
                    "timestamp": str(row.get("created_at", "")),
                    "date": str(row.get("created_at", "")),
                    "conversation": row.get("conversation", []),
                })
                return jsonify({"success": True, "call": call})
        except Exception as e:
            print(f"[Supabase] Failed to fetch call {call_id}: {e} — falling back to local JSON")

    # --- Fallback: Local JSON ---
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
    """Delete a call recording record from Supabase and/or local disk."""
    deleted = False

    if _supabase:
        try:
            _supabase.table("call_logs").delete().eq("id", call_id).execute()
            deleted = True
        except Exception as e:
            print(f"[Supabase] Failed to delete call {call_id}: {e}")

    fname = f"{call_id}.json" if not call_id.endswith(".json") else call_id
    fpath = os.path.join(RECORDINGS_DIR, fname)
    if os.path.exists(fpath):
        try:
            os.remove(fpath)
            deleted = True
        except Exception as e:
            print(f"Failed to delete local file {fpath}: {e}")

    if deleted:
        return jsonify({"success": True, "message": "Recording deleted."})
    return jsonify({"success": False, "error": "Recording not found."}), 404

if __name__ == "__main__":
    port = int(os.getenv("PORT", 5000))
    print(f"\nTrinity Calling Dashboard Server running at http://localhost:{port}\n")
    app.run(host="0.0.0.0", port=port, debug=True)
