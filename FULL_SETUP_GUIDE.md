# 🚀 Trinity Outbound Voice Agent - Full Setup Guide

Follow this guide to set up the system from scratch and start making outbound AI phone calls.

---

## 📋 1. Prerequisites
Ensure your computer has the following installed and configured:
- **Python 3.9+**: [Download here](https://www.python.org/downloads/)
- **LiveKit Cloud Account**: Obtain API Keys from [cloud.livekit.io](https://cloud.livekit.io).
- **Vobiz Account**: Required for SIP Trunk credentials.
- **OpenAI API Key**: Used for the AI LLM (Brain).
- **ElevenLabs API Key**: Used for natural sounding Text-to-Speech.

---

## 🛠️ 2. Installation Steps

### Step 1: Create a Virtual Environment
Open your terminal and run the following command to create an isolated environment:
```powershell
python -m venv .venv
```

### Step 2: Activate the Environment (Windows)
```powershell
.\.venv\Scripts\activate
```

### Step 3: Install Required Dependencies
```powershell
pip install -r requirements.txt
```

---

## ⚙️ 3. Configuration (.env Setup)
Create a file named `.env` in the project root directory and fill in the following values:

```env
# LIVEKIT CREDENTIALS
LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=your_key
LIVEKIT_API_SECRET=your_secret

# AI MODEL KEYS
OPENAI_API_KEY=sk-proj-...
ELEVEN_API_KEY=your_eleven_key
TTS_PROVIDER=elevenlabs

# VOBIZ CONFIGURATION (SIP)
VOBIZ_SIP_DOMAIN=xxx.sip.vobiz.ai
VOBIZ_USERNAME=your_username
VOBIZ_PASSWORD=your_password
VOBIZ_OUTBOUND_NUMBER=+91...
DEFAULT_TRANSFER_NUMBER=+91...

# TRUNK ID (Obtained after creating a SIP Trunk in LiveKit)
OUTBOUND_TRUNK_ID=ST_...
```

---

## 📞 4. Running the System

To run the system, you will need **two terminal windows**.

### Step 1: Start the Agent Worker (Terminal 1)
This is the background process that handles the AI logic and voice. Keep this terminal running.
```powershell
python agent.py dev
```
*(Wait until you see the "worker started" message in the logs.)*

### Step 2: Trigger an Outbound Call (Terminal 2)
Open a new terminal, activate the environment, and run the bridge script:
```powershell
.\.venv\Scripts\activate
python make_call.py --to +91XXXXXXXXXX
```
*(Replace `+91XXXXXXXXXX` with the actual destination phone number.)*

---

## 📂 5. Project File Overview
- **`agent.py`**: The main entry point for the AI worker.
- **`make_call.py`**: A utility script to dispatch a call request.
- **`setup_trunk.py`**: Script to update SIP Trunk credentials in LiveKit.
- **`.env`**: Stores all secrets and configuration settings.
- **`recordings/`**: Directory where call transcripts and metadata are saved automatically.

---

## ⚠️ 6. Troubleshooting
- **"Trunk ID not found"**: Ensure `OUTBOUND_TRUNK_ID` is correctly set in your `.env` file.
- **"Connection Timeout"**: Verify your internet connection and the `LIVEKIT_URL`.
- **"Authentication Failed"**: Double-check your Vobiz SIP credentials in the `.env` file.
- **No Audio/Voice**: Ensure your ElevenLabs or OpenAI API keys have valid credits/quota.

---

**Happy Calling!** 🚀
*Developed for the Trinity Voice Assistant Project.*
