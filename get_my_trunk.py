import asyncio
import os
from dotenv import load_dotenv
from livekit import api

load_dotenv(".env")

async def main():
    lkapi = api.LiveKitAPI()
    
    try:
        print("Checking for existing trunks...")
        resp = await lkapi.sip.list_sip_outbound_trunk(api.ListSIPOutboundTrunkRequest())
        
        if resp.items:
            print(f"\n✅ SUCCESS! Found existing trunk:")
            print(f"TRUNK_ID: {resp.items[0].sip_trunk_id}")
            return

        print("No trunk found. Creating new one using SIPOutboundTrunkInfo...")
        
        # In your version, the class is called SIPOutboundTrunkInfo
        trunk_info = api.SIPOutboundTrunkInfo(
            address=os.getenv("VOBIZ_SIP_DOMAIN"),
            numbers=[os.getenv("VOBIZ_OUTBOUND_NUMBER")],
            auth_username=os.getenv("VOBIZ_USERNAME"),
            auth_password=os.getenv("VOBIZ_PASSWORD"),
            name="Vobiz Outbound"
        )

        request = api.CreateSIPOutboundTrunkRequest(trunk=trunk_info)
        new_trunk = await lkapi.sip.create_sip_outbound_trunk(request)
        
        print(f"\n✅ SUCCESS! New Trunk Created.")
        print(f"TRUNK_ID: {new_trunk.sip_trunk_id}")
        
    except Exception as e:
        print(f"\n❌ Error: {e}")
    finally:
        await lkapi.aclose()

if __name__ == "__main__":
    asyncio.run(main()) 