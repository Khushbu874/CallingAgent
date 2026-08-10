# 📞 Trinity AI Outbound Calling Agent & Real-Time Dashboard

A production-ready, enterprise-grade **AI Outbound Telephony System** built with **LiveKit Agents**, **Vobiz SIP Trunking**, **OpenAI**, and a real-time **Web Dashboard**.

The system enables an AI Voice Agent (*TrinityAI*) to make outbound PSTN/SIP phone calls, conduct natural Hinglish/English conversations, transfer calls to human agents, automatically hang up when requested by the caller, and stream live transcripts to a web dashboard.

---

## 🌟 Key Features

* 📞 **Outbound SIP Telephony**: Connects directly to phone numbers worldwide via Vobiz SIP Trunk and LiveKit Cloud.
* 🗣️ **Conversational Voice AI**: Powered by OpenAI GPT-4o-mini, Silero VAD, OpenAI STT (with Hindi/Hinglish support), and customizable TTS (OpenAI, Cartesia, ElevenLabs).
* 🔀 **Call Transfer (`transfer_call`)**: Dynamically transfers the caller to a human support agent or custom phone number upon interest.
* 🛑 **Automatic Call Disconnect (`end_call`)**: Recognizes when the caller wants to cut/end the call (e.g., *"call cut kar do"*, *"phone rakho"*, *"hang up"*, *"bye"*) and cleanly disconnects after a polite closing.
* 📊 **Real-Time Web Dashboard**: Built with modern CSS glassmorphism UI, featuring active call status, real-time live transcript streaming, and a full call history manager.
* 📄 **PDF Export & Web Share**: Download complete call transcripts as styled PDF documents (via `html2pdf.js`) or share directly using the native Web Share API.
* 💾 **Zero-Latency Data Store**: High-performance JSON file-based database for active live call streaming and completed call archives.

---

## 🛠️ Technology Stack & Versions

| Layer | Component / Technology | Package & Version | Role / Description |
| :--- | :--- | :--- | :--- |
| **Language & Runtime** | Python | `3.9+` | Core agent process, server API, and dispatch scripts |
| **Agent Framework** | LiveKit Agents | `livekit-agents == 1.5.8` | Real-time audio pipeline and worker runtime |
| **LiveKit SDK** | LiveKit API & Protocol | `livekit == 1.1.7`, `livekit-api == 1.1.0` | Room orchestration, SIP dispatch, participant management |
| **LLM (Brain)** | OpenAI GPT-4o-mini | `openai == 2.3.0` | Natural language understanding, dialogue, and function calling |
| **STT (Speech-to-Text)** | OpenAI Whisper STT | `livekit-plugins-openai == 1.5.8` | Real-time speech transcription (`language="hi"`) |
| **VAD** | Silero VAD | `livekit-plugins-silero == 1.5.8` | Voice Activity Detection for natural turn-taking |
| **TTS (Text-to-Speech)** | OpenAI / Cartesia / ElevenLabs | `livekit-plugins-cartesia`, `livekit-plugins-elevenlabs` | Voice synthesis (Default: OpenAI `tts-1` `alloy`) |
| **Noise Cancellation** | BVC Telephony | `livekit-plugins-noise-cancellation == 0.2.5` | Suppresses background noise during phone calls |
| **Telephony Gateway** | Vobiz SIP Trunking | SIP Gateway | Connects LiveKit rooms to PSTN phone networks |
| **Backend Web Server** | Flask & Flask-CORS | `Flask == 2.3.2`, `Flask-Cors == 3.0.10` | REST API for dashboard UI and call dispatch |
| **Frontend UI** | HTML5, Vanilla JS, CSS3 | Glassmorphism UI | Responsive dashboard, real-time transcript viewer, dialer |
| **Document Export** | html2pdf.js | `v0.10.1` (CDN) | Renders client-side PDF downloads of transcripts |
| **Database** | File-based JSON Store | Local filesystem (`recordings/`) | High-speed JSON storage for live & historical calls |

---

## 🏗️ System Architecture & Data Flow

```
   +-----------------------+              +-----------------------+
   |   Web Dashboard UI    |              |   Python Dispatch     |
   | (http://localhost:5000) |              |     (make_call.py)    |
   +-----------+-----------+              +-----------+-----------+
               |                                      |
               +-------------------+------------------+
                                   |
                                   v
                       +-----------------------+
                       |  Flask API Server     |
                       | (dashboard_server.py) |
                       +-----------+-----------+
                                   | (LiveKitAPI.agent_dispatch)
                                   v
                       +-----------------------+
                       |  LiveKit Cloud Server |
                       +-----------+-----------+
                                   |
                     (Worker Room Dispatch Assignment)
                                   v
                       +-----------------------+
                       |   Agent Worker        |
                       |      (agent.py)       |
                       +-----------+-----------+
                                   |
                  (api.sip.create_sip_participant)
                                   v
                       +-----------------------+
                       |  Vobiz SIP Trunk      |
                       +-----------+-----------+
                                   | (PSTN Call)
                                   v
                       +-----------------------+
                       |   Recipient Phone     |
                       +-----------------------+
```

### Process Flow:
1. **Call Initiation**: User enters a phone number in the Web Dashboard or runs `python make_call.py --to +91...`.
2. **Dispatch**: The backend invokes `LiveKitAPI.agent_dispatch` to assign the `outbound-caller` worker to a newly created room.
3. **SIP Connection**: `agent.py` joins the room and places an outbound SIP call using `CreateSIPParticipantRequest` via the configured Vobiz SIP Trunk ID.
4. **Conversation Loop**:
   - Recipient answers -> Agent hears audio via **Silero VAD** & **OpenAI STT**.
   - Transcript passes to **OpenAI GPT-4o-mini**, which determines the response and tool execution.
   - **TTS** converts response text into speech, streamed back into the call.
5. **Tool Execution**:
   - `transfer_call`: Executes SIP transfer to human support agent.
   - `end_call`: Plays goodbye response and closes room/call when caller asks to hang up.
6. **Live Transcript Streaming & Archiving**:
   - During active call: Updates `recordings/live_<phone>.json` on every turn.
   - When call ends: Converts live transcript into `recordings/call_<phone>_<timestamp>.json` and cleans up temporary live files.

---

## 📂 Project Structure

```
Calling Agent/
├── agent.py                 # Main AI Agent worker process (STT, LLM, TTS, SIP, Tool Calling)
├── dashboard_server.py      # Flask REST API server & static file host for Dashboard UI
├── make_call.py             # CLI utility script to trigger outbound calls
├── setup_trunk.py           # Script to list or configure LiveKit SIP Trunks
├── get_my_trunk.py          # Utility script to fetch trunk details
├── transfer_call.md         # Guide for configuring SIP call transfer
├── requirements.txt         # Complete list of Python dependencies
├── .env.example             # Template for required environment variables
├── .env                     # Local environment configuration file (API keys & secrets)
├── dashboard/               # Frontend Web Application
│   ├── index.html           # Main HTML structure with glassmorphism UI & modals
│   ├── styles.css           # Vanilla CSS styling with custom theme tokens & badges
│   └── app.js               # Frontend JS (real-time polling, transcript viewer, PDF/Share)
└── recordings/              # Database directory storing live & completed call JSON files
    ├── live_<phone>.json    # Real-time state for active calls
    └── call_<id>.json       # Historical call recordings and full transcripts
```

---

## 💾 Database Schema (JSON Document Store)

Call records are saved as structured JSON documents under the `recordings/` folder:

```json
{
    "id": "call_919302474642_20260810_223000",
    "phone_number": "+919302474642",
    "room_name": "call-919302474642-4821",
    "timestamp": "2026-08-10 22:30:00",
    "date": "2026-08-10 22:30:00",
    "status": "Completed",
    "total_messages": 4,
    "conversation": [
        {
            "role": "ai",
            "text": "Namaste! Main Trinity Solutions se TrinityAI bol rahi hoon. Kya meri baat Sir se ho rahi hai?",
            "timestamp": "22:30:02"
        },
        {
            "role": "human",
            "text": "Haan bolye kya kaam hai?",
            "timestamp": "22:30:08"
        },
        {
            "role": "ai",
            "text": "Actually hum Central India ki best software company hain. Kya aapko kisi custom software ya mobile app ki requirement hai?",
            "timestamp": "22:30:14"
        },
        {
            "role": "human",
            "text": "Nahi abhi koi zarurat nahi hai, call cut kardo.",
            "timestamp": "22:30:20"
        },
        {
            "role": "ai",
            "text": "Theek hai, thank you for your time! Have a great day, bye!",
            "timestamp": "22:30:22"
        }
    ]
}
```

---

## ⚙️ Environment Configuration (`.env`)

Create a `.env` file in the project root:

```env
# LiveKit Credentials
LIVEKIT_URL=wss://your-livekit-project.livekit.cloud
LIVEKIT_API_KEY=APIxxxxxxxxxxxx
LIVEKIT_API_SECRET=Secretxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# AI Models & Keys
OPENAI_API_KEY=sk-proj-xxxxxxxxxxxxxxxxxxxxxxxx

# Optional TTS Providers
TTS_PROVIDER=openai                       # Options: openai, cartesia, elevenlabs
OPENAI_TTS_MODEL=tts-1
OPENAI_TTS_VOICE=alloy

# Cartesia TTS (Optional)
# CARTESIA_TTS_MODEL=sonic-2
# CARTESIA_TTS_VOICE=f786b574-daa5-4673-aa0c-cbe3e8534c02

# ElevenLabs TTS (Optional)
# ELEVEN_API_KEY=el-xxxxxxxx
# ELEVEN_VOICE_ID=21m00Tcm4TlvDq8ikWAM

# Vobiz SIP Telephony Config
VOBIZ_SIP_DOMAIN=vobiz.sip.vobiz.ai
VOBIZ_USERNAME=your_vobiz_username
VOBIZ_PASSWORD=your_vobiz_password
SIP_OUTBOUND_NUMBER=+91xxxxxxxxxx
OUTBOUND_TRUNK_ID=ST_xxxxxxxxxxxxx       # LiveKit SIP Outbound Trunk ID

# Call Transfer Destination
DEFAULT_TRANSFER_NUMBER=+919302474642

# Web Server Port
PORT=5000
```

---

## 🚀 Step-by-Step Setup & Execution

### 1. Prerequisites
- **Python 3.9 or higher** installed.
- **uv** package manager installed (or standard `pip`).

### 2. Install Dependencies
```powershell
# Create virtual environment
uv venv

# Install requirements
uv pip install -r requirements.txt
```

### 3. Start the AI Agent Worker
Open Terminal 1:
```powershell
python agent.py start
```
*Wait until you see:* `INFO:livekit.agents:registered worker {"agent_name": "outbound-caller"}`

### 4. Start the Dashboard Web Server
Open Terminal 2:
```powershell
python dashboard_server.py
```
*Access the Web Dashboard at:* `http://localhost:5000`

---

## 📞 How to Initiate Outbound Calls

### Option A: Via Web Dashboard (Recommended)
1. Open `http://localhost:5000` in your web browser.
2. Select Country Code (e.g. `+91`) and enter 10-digit mobile number.
3. Click **Call Now**.
4. Monitor the live conversation transcript streaming in real time on the dashboard.

### Option B: Via Command Line
Open Terminal 3:
```powershell
python make_call.py --to +919988776655
```

---

## 📡 REST API Reference

| Endpoint | Method | Description |
| :--- | :--- | :--- |
| `GET /` | `GET` | Serves the Web Dashboard UI |
| `GET /api/config` | `GET` | Returns system status & outbound phone settings |
| `POST /api/call` | `POST` | Dispatches outbound call. Body: `{"phone_number": "...", "country_code": "+91"}` |
| `GET /api/calls` | `GET` | Retrieves all call logs (live active calls listed first) |
| `GET /api/calls/<call_id>` | `GET` | Fetches complete conversation transcript for specific call |
| `DELETE /api/calls/<call_id>`| `DELETE`| Permanently deletes a call transcript recording |

---

## 🤝 Key Capabilities

### 1. Call Transfer
When a user expresses interest in speaking with a manager or expert, TrinityAI executes `transfer_call()`, initiating a SIP referral to transfer the call without dropping the line.

### 2. Auto Disconnect (`end_call`)
If the user indicates they want to hang up (*"call cut kar do"*, *"phone rakho"*, *"bye"*, *"disconnect"*), TrinityAI invokes `end_call()`, delivers a polite closing phrase, and disconnects the call automatically after 2.5 seconds.

### 3. Transcript Exporting
From the Dashboard modal:
- Click **Download PDF** to export a clean, styled document.
- Click **Share Transcript** to share transcript files via Web Share API.
