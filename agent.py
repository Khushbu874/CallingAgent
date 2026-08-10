import logging
import os
import json
import asyncio
import anyascii
from datetime import datetime
from dotenv import load_dotenv

from livekit import agents, api
from livekit.agents import AgentSession, Agent, RoomInputOptions
from livekit.plugins import (
    openai,
    cartesia,
    deepgram,
    noise_cancellation,
    silero,
    elevenlabs,
)
from livekit.agents import llm
from livekit.agents.llm.chat_context import Instructions
from typing import Annotated, Optional
import livekit.agents.llm.chat_context as cc
from pydantic_core import core_schema

def ensure_roman_script(text: str) -> str:
    """Converts ANY non-Latin script (Arabic, Urdu, Devanagari, CJK, Japanese, Korean, Thai, etc.) to Roman English."""
    if not text:
        return ""
    # Detect any character outside printable ASCII + common Latin extended range
    has_non_latin = any(
        ord(c) > 0x024F and not c.isascii()
        for c in text
    )
    if has_non_latin:
        return anyascii.anyascii(text)
    return text

# Fix livekit-agents 1.5.8 Pydantic serialization bug for ChatMessage/Instructions
@classmethod
def _patched_instructions_pydantic_schema(cls, source_type, handler):
    def validate_python(v):
        if isinstance(v, cc.Instructions):
            return v
        if isinstance(v, dict) and v.get('type') == 'instructions':
            return cls(v['audio'], text=v.get('text'))
        return cls(v)
        
    def serialize(v):
        if hasattr(v, '_audio_variant'):
            d = {'type': 'instructions', 'audio': v.audio}
            if v._text_variant is not None:
                d['text'] = v._text_variant
            return d
        return str(v)
        
    return core_schema.json_or_python_schema(
        python_schema=core_schema.no_info_plain_validator_function(validate_python),
        json_schema=core_schema.no_info_plain_validator_function(validate_python),
        serialization=core_schema.plain_serializer_function_ser_schema(serialize, info_arg=False),
    )

cc.Instructions.__get_pydantic_core_schema__ = _patched_instructions_pydantic_schema
cc.ChatMessage.model_rebuild(force=True)

# Load environment variables
load_dotenv(".env")

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("outbound-agent")


# TRUNK ID - This needs to be set after you crate your trunk
# You can find this by running 'python setup_trunk.py --list' or checking LiveKit Dashboard
OUTBOUND_TRUNK_ID = os.getenv("OUTBOUND_TRUNK_ID")
SIP_OUTBOUND_NUMBER = os.getenv("SIP_OUTBOUND_NUMBER", "")
SIP_DOMAIN = os.getenv("VOBIZ_SIP_DOMAIN") 


def _build_tts():
    """Configure the Text-to-Speech provider based on env vars."""
    provider = os.getenv("TTS_PROVIDER", "openai").lower()
    
    if provider == "cartesia":
        logger.info("Using Cartesia TTS")
        model = os.getenv("CARTESIA_TTS_MODEL", "sonic-2")
        voice = os.getenv("CARTESIA_TTS_VOICE", "f786b574-daa5-4673-aa0c-cbe3e8534c02")
        return cartesia.TTS(model=model, voice=voice)
    
    if provider == "elevenlabs":
        logger.info("Using ElevenLabs TTS")
        api_key = os.getenv("ELEVEN_API_KEY")
        voice_id = os.getenv("ELEVEN_VOICE_ID", "21m00Tcm4TlvDq8ikWAM")
        try:
            # Try with multilingual model for best language support
            return elevenlabs.TTS(api_key=api_key, voice_id=voice_id, model_id="eleven_multilingual_v2")
        except TypeError:
            # Fallback if the installed plugin version has different arguments
            return elevenlabs.TTS(api_key=api_key, voice_id=voice_id)
    
    # Default to OpenAI
    logger.info("Using OpenAI TTS")
    model = os.getenv("OPENAI_TTS_MODEL", "tts-1")
    voice = os.getenv("OPENAI_TTS_VOICE", "alloy")
    return openai.TTS(model=model, voice=voice)

class TransferFunctions(llm.ToolContext):
    def __init__(self, ctx: agents.JobContext, phone_number: str = None):
        super().__init__(tools=[])
        self.ctx = ctx
        self.phone_number = phone_number

    @llm.function_tool(description="Transfer the call to a human support agent or another phone number.")
    async def transfer_call(self, destination: Annotated[str, "The destination phone number to transfer the call to."] = os.getenv("TRANSFER_DESTINATION_NUMBER", "")):
        """
        Transfer the call.
        """
        default_num = os.getenv("DEFAULT_TRANSFER_NUMBER", "+919302474642")
        clean_digits = "".join(filter(str.isdigit, str(destination)))
        
        # If destination is empty or not a valid phone number (e.g., 'human support agent'), use default transfer number
        if not destination or len(clean_digits) < 5:
            destination = default_num

        if "@" not in destination:
            # If no domain is provided, append the SIP domain
            clean_dest = destination.replace("tel:", "").replace("sip:", "")
            if SIP_DOMAIN:
                destination = f"sip:{clean_dest}@{SIP_DOMAIN}"
            else:
                destination = f"tel:{clean_dest}"
        elif not destination.startswith("sip:"):
            destination = f"sip:{destination}"
        
        logger.info(f"Transferring call to {destination}")
        
        # Determine the participant identity
        # For outbound calls initiated by this agent, the participant identity is typically "sip_<phone_number>"
        # For inbound, we might need to find the remote participant.
        participant_identity = None
        
        # If we stored the phone number from metadata, we can construct the identity
        if self.phone_number:
            participant_identity = f"sip_{self.phone_number}"
        else:
            # Try to find a participant that is NOT the agent
            for p in self.ctx.room.remote_participants.values():
                participant_identity = p.identity
                break
        
        if not participant_identity:
            logger.error("Could not determine participant identity for transfer")
            return "Failed to transfer: could not identify the caller."

        try:
            logger.info(f"Transferring participant {participant_identity} to {destination}")
            await self.ctx.api.sip.transfer_sip_participant(
                api.TransferSIPParticipantRequest(
                    room_name=self.ctx.room.name,
                    participant_identity=participant_identity,
                    transfer_to=destination,
                    play_dialtone=False
                )
            )
            return "Transfer initiated successfully."
        except Exception as e:
            logger.error(f"Transfer failed: {e}")
            return f"Error executing transfer: {e}"

    @llm.function_tool(
        description="Disconnect/hang up the phone call when the user asks to end/cut/disconnect the call or says goodbye."
    )
    async def end_call(self):
        """
        Disconnect and end the current call.
        """
        logger.info("end_call tool triggered by AI. Scheduling call disconnection...")
        async def _disconnect():
            await asyncio.sleep(2.5) # Allow final TTS goodbye audio to play to caller
            logger.info("Disconnecting room context and terminating PSTN call now...")
            
            # Identify SIP participant to explicitly hang up PSTN line
            participant_identity = None
            if self.phone_number:
                participant_identity = f"sip_{self.phone_number}"
            
            if not participant_identity and hasattr(self.ctx.room, "remote_participants"):
                for p in self.ctx.room.remote_participants.values():
                    if p.identity:
                        participant_identity = p.identity
                        break
            
            if participant_identity:
                try:
                    logger.info(f"Removing SIP participant {participant_identity} to hang up phone call...")
                    await self.ctx.api.room.remove_participant(
                        api.RoomParticipantIdentity(
                            room=self.ctx.room.name,
                            identity=participant_identity
                        )
                    )
                except Exception as e:
                    logger.warning(f"Failed to remove SIP participant: {e}")

            try:
                logger.info(f"Deleting LiveKit room {self.ctx.room.name}...")
                await self.ctx.api.room.delete_room(
                    api.DeleteRoomRequest(room=self.ctx.room.name)
                )
            except Exception as e:
                logger.warning(f"Failed to delete room: {e}")

            self.ctx.shutdown()

        asyncio.create_task(_disconnect())
        return "Call disconnection scheduled. Say a polite goodbye to the user now."


class OutboundAssistant(Agent):

    """
    An AI agent tailored for outbound calls.
    Attempts to be helpful and concise.
    """
    def __init__(self) -> None:
        super().__init__(
            instructions=Instructions(
                audio=(
                    "You are 'TrinityAI', a professional and friendly female voice assistant representing 'Trinity Solutions', Raipur (Chhattisgarh). "
                    "Your goal is to help businesses with IT and Software solutions. "
                    "\n\nCOMPANY KNOWLEDGE:\n"
                    "- SERVICES: Custom Software Development, ERP Solutions, Web & Mobile App Development, Bulk SMS, Bulk WhatsApp API, and Digital Marketing.\n"
                    "- ERP PRODUCTS: TMS (Transport Management), IMS (Institute Management), SMS (School Management), Inventory, and Hospital/Clinic Management Software.\n"
                    "- TAGLINE: 'Central India's best software company'.\n"
                    "- LOCATION: Head office is in Raipur (Maheshwari Tower, Kailashpuri).\n"
                    "\nCRITICAL STYLE RULES:\n"
                    "1. FEMALE PERSONA: Always speak as a female. In Hindi/Hinglish, use feminine verb endings (e.g., 'bol rahi hoon', 'kar sakti hoon').\n"
                    "2. NATURAL CONVERSATION: Speak like a real human. Use fillers like 'Hmm...', 'Theek hai', 'Actually...', 'I see'.\n"
                    "3. HINGLISH: Respond in CONVERSATIONAL HINGLISH. Use English words mixed with Hindi. Avoid formal/shuddh Hindi.\n"
                    "4. SCRIPT: Always write response in ROMAN SCRIPT (English letters). NEVER use Devanagari/Hindi script.\n"
                    "5. LANGUAGE MIRRORING: If user speaks English, respond in English. If they speak Hinglish, respond in Hinglish.\n"
                    "6. NEXT STEPS: If a user is interested in a demo or service, explain briefly and offer to transfer the call to a human expert using 'transfer_call'.\n"
                    "7. CALL DISCONNECTION / CALL CUT: If the caller wants to end or cut the call (e.g., says 'call cut kar do', 'phone rakho', 'hang up', 'bye', 'disconnect', 'not interested', 'baad me baat karenge'), you MUST immediately call the 'end_call' tool and say a polite goodbye phrase in Hinglish (e.g., 'Theek hai, thank you for your time! Have a great day, bye!')."
                )
            ),
        )


async def entrypoint(ctx: agents.JobContext):
    """
    Main entrypoint for the agent.
    
    For outbound calls:
    1. Checks for 'phone_number' in the job metadata.
    2. Connects to the room.
    3. Initiates the SIP call to the phone number.
    4. Waits for answer before speaking.
    """
    logger.info(f"Connecting to room: {ctx.room.name}")
    
    # parse the phone number from the metadata sent by the dispatch script
    phone_number = None
    try:
        if ctx.job.metadata:
            data = json.loads(ctx.job.metadata)
            phone_number = data.get("phone_number")
    except Exception:
        logger.warning("No valid JSON metadata found. This might be an inbound call.")

    # Initialize function context
    fnc_ctx = TransferFunctions(ctx, phone_number)

    # Initialize the Agent Session with plugins

    session = AgentSession(
        stt=openai.STT(language="hi"),
        vad=silero.VAD.load(),
        llm=openai.LLM(model="gpt-4o-mini"),
        tts=_build_tts(),
        tools=fnc_ctx.flatten(),
    )

    # --- Conversation Logging ---
    conversation_history = []
    
    def update_live_file():
        """Helper to write real-time live conversation state while call is active."""
        if not os.path.exists("recordings"):
            os.makedirs("recordings")
        safe_phone = str(phone_number).replace("+", "") if phone_number else "inbound"
        live_filename = f"recordings/live_{safe_phone}.json"
        try:
            with open(live_filename, "w", encoding="utf-8") as f:
                json.dump({
                    "id": f"live_{safe_phone}",
                    "phone_number": phone_number or "Unknown",
                    "room_name": ctx.room.name,
                    "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                    "date": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                    "status": "In Progress (Live)",
                    "total_messages": len(conversation_history),
                    "conversation": conversation_history
                }, f, indent=4, ensure_ascii=False)
        except Exception as err:
            logger.warning(f"Failed to update live transcript file: {err}")
    
    @session.on("conversation_item_added")
    def on_conversation_item_added(ev: agents.ConversationItemAddedEvent):
        item = ev.item
        if hasattr(item, "role") and item.role in ("user", "assistant"):
            role_label = "human" if item.role == "user" else "ai"
            text = ensure_roman_script(item.text_content or "")
            if text:
                if not conversation_history or conversation_history[-1]["text"] != text:
                    conversation_history.append({
                        "role": role_label,
                        "text": text,
                        "timestamp": datetime.now().strftime("%H:%M:%S")
                    })
                    logger.info(f"Live Transcript ({role_label.upper()}): {text}")
                    update_live_file()

    @session.on("user_transcript_finished")
    def on_user_transcript(event: agents.stt.SpeechEvent):
        if event.alternatives:
            text = ensure_roman_script(event.alternatives[0].text)
            if text:
                if not conversation_history or conversation_history[-1]["text"] != text:
                    conversation_history.append({
                        "role": "human",
                        "text": text,
                        "timestamp": datetime.now().strftime("%H:%M:%S")
                    })
                    logger.info(f"Transcript (Human): {text}")
                    update_live_file()

    @session.on("agent_transcript_finished")
    def on_agent_transcript(text: str):
        text = ensure_roman_script(text)
        if text:
            if not conversation_history or conversation_history[-1]["text"] != text:
                conversation_history.append({
                    "role": "ai",
                    "text": text,
                    "timestamp": datetime.now().strftime("%H:%M:%S")
                })
                logger.info(f"Transcript (AI): {text}")
                update_live_file()

    async def save_conversation():
        if not os.path.exists("recordings"):
            os.makedirs("recordings")
            
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        formatted_date = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        safe_phone = str(phone_number).replace("+", "") if phone_number else "inbound"
        call_id = f"call_{safe_phone}_{timestamp}"
        filename = f"recordings/{call_id}.json"
        live_filename = f"recordings/live_{safe_phone}.json"
        
        chat_list = []
        if hasattr(session, "history") and session.history and session.history.items:
            for item in session.history.items:
                if hasattr(item, "role") and item.role in ("user", "assistant"):
                    role_label = "human" if item.role == "user" else "ai"
                    text = ensure_roman_script(item.text_content or "")
                    if text:
                        item_time = (
                            datetime.fromtimestamp(item.created_at).strftime("%H:%M:%S")
                            if hasattr(item, "created_at") and item.created_at
                            else datetime.now().strftime("%H:%M:%S")
                        )
                        chat_list.append({
                            "role": role_label,
                            "text": text,
                            "timestamp": item_time
                        })

        if not chat_list and conversation_history:
            chat_list = conversation_history

        # Remove temporary live file if present
        if os.path.exists(live_filename):
            try:
                os.remove(live_filename)
            except Exception:
                pass

        if not chat_list:
            logger.info("No transcript entries recorded to save.")
            return

        with open(filename, "w", encoding="utf-8") as f:
            json.dump({
                "id": call_id,
                "phone_number": phone_number or "Unknown",
                "room_name": ctx.room.name,
                "timestamp": formatted_date,
                "date": formatted_date,
                "status": "Completed",
                "total_messages": len(chat_list),
                "conversation": chat_list
            }, f, indent=4, ensure_ascii=False)
        logger.info(f"Conversation saved to {filename}")

    # --- End Conversation Logging ---

    # Start the session
    await session.start(
        room=ctx.room,
        agent=OutboundAssistant(),
        room_input_options=RoomInputOptions(
            noise_cancellation=noise_cancellation.BVCTelephony(),
            close_on_disconnect=True, # Close room when agent disconnects
        ),
    )

    if phone_number:
        logger.info(f"Initiating outbound SIP call to {phone_number}...")
        update_live_file()
        try:
            # Create a SIP participant to dial out
            # This effectively "calls" the phone number and brings them into this room
            await ctx.api.sip.create_sip_participant(
                api.CreateSIPParticipantRequest(
                    room_name=ctx.room.name,
                    sip_trunk_id=OUTBOUND_TRUNK_ID,
                    sip_call_to=phone_number,
                    participant_identity=f"sip_{phone_number}", # Unique ID for the SIP user
                    wait_until_answered=True, # Important: Wait for pickup before continuing
                )
            )
            logger.info("Call answered! Agent is now listening.")
            
            # Speak initial intro greeting when call is answered
            await session.generate_reply()
            
            
        except Exception as e:
            logger.error(f"Failed to place outbound call: {e}")
            # Ensure we clean up if the call fails
            ctx.shutdown()
    else:
        # Fallback for inbound calls (if this agent is used for that)
        logger.info("No phone number in metadata. Treating as inbound/web call.")
        await session.generate_reply()

    # Register shutdown callback so conversation is saved when the call ends/disconnects
    ctx.add_shutdown_callback(save_conversation)


if __name__ == "__main__":
    # The agent name "outbound-caller" is used by the dispatch script to find this worker
    agents.cli.run_app(
        agents.WorkerOptions(
            entrypoint_fnc=entrypoint,
            agent_name="outbound-caller", 
        )
    )
