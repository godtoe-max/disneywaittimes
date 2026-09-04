"""
Cloud Web Push Dispatcher (VAPID)
Polls Queue-Times API and sends true lock-screen push notifications to Apple APNs and Google FCM endpoints.
100% Free - Uses standard Web Push protocol (RFC 8291 / 8292).
"""

import os
import json
import logging
import asyncio
import httpx
from typing import Dict, Any, List
from pywebpush import webpush, WebPushException

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] [cloud-push] %(message)s")
logger = logging.getLogger("cloud-push")

VAPID_PUBLIC_KEY = os.environ.get(
    "VAPID_PUBLIC_KEY",
    "BEx8URoFAQgYpSFA5dLFzRPe8jSspI7Dxd1Q-2mJgMtWl1COYwixDdcQDvm-vxPOEyqr65spANBvT_S--DQc6RY"
)
VAPID_PRIVATE_KEY = os.environ.get(
    "VAPID_PRIVATE_KEY",
    "uULVajWg8ZrPA1MFw8noOWbp1sdSKPGBozA_pFyTurU"
)
VAPID_CLAIMS = {"sub": "mailto:alerts@disneymagicwaits.com"}

TARGET_PARKS = [
    {"id": 6, "name": "Magic Kingdom"},
    {"id": 5, "name": "EPCOT"},
    {"id": 7, "name": "Disney's Hollywood Studios"},
    {"id": 8, "name": "Disney's Animal Kingdom"},
    {"id": 16, "name": "Disneyland Park"},
    {"id": 17, "name": "Disney California Adventure"},
]

SUBSCRIPTIONS_FILE = os.path.join(os.path.dirname(__file__), "..", "frontend", "data", "push_subscriptions.json")

def load_subscriptions() -> List[Dict[str, Any]]:
    if not os.path.exists(SUBSCRIPTIONS_FILE):
        return []
    try:
        with open(SUBSCRIPTIONS_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        logger.warning(f"Failed to read subscriptions file: {e}")
        return []

def save_subscriptions(subs: List[Dict[str, Any]]):
    os.makedirs(os.path.dirname(SUBSCRIPTIONS_FILE), exist_ok=True)
    with open(SUBSCRIPTIONS_FILE, "w", encoding="utf-8") as f:
        json.dump(subs, f, indent=2)

async def fetch_live_park_rides() -> Dict[int, Dict[str, Any]]:
    """Fetch all rides across 6 Disney parks in parallel."""
    async with httpx.AsyncClient(timeout=15.0) as client:
        tasks = [
            client.get(
                f"https://queue-times.com/parks/{p['id']}/queue_times.json",
                headers={"User-Agent": "DisneyMagicWaits/1.0"}
            )
            for p in TARGET_PARKS
        ]
        responses = await asyncio.gather(*tasks, return_exceptions=True)

    rides_by_id = {}
    for p, resp in zip(TARGET_PARKS, responses):
        if isinstance(resp, Exception) or resp.status_code != 200:
            continue
        try:
            data = resp.json()
            all_rides = []
            for land in data.get("lands", []):
                for r in land.get("rides", []):
                    all_rides.append({**r, "land_name": land.get("name", "")})
            for r in data.get("rides", []):
                all_rides.append({**r, "land_name": "General"})

            for r in all_rides:
                rides_by_id[r["id"]] = {
                    "id": r["id"],
                    "name": r["name"],
                    "park_id": p["id"],
                    "park_name": p["name"],
                    "is_open": bool(r.get("is_open")),
                    "wait_time": r.get("wait_time") or 0,
                }
        except Exception as e:
            logger.warning(f"Error parsing rides for park {p['id']}: {e}")

    return rides_by_id

def send_single_push(subscription_info: Dict[str, Any], payload: Dict[str, Any]) -> bool:
    """Send an encrypted Web Push payload to Apple (APNs) / Google (FCM)."""
    try:
        webpush(
            subscription_info=subscription_info,
            data=json.dumps(payload),
            vapid_private_key=VAPID_PRIVATE_KEY,
            vapid_claims=VAPID_CLAIMS,
            timeout=10,
        )
        logger.info(f"Successfully sent lock-screen push: {payload.get('title')}")
        return True
    except WebPushException as ex:
        logger.warning(f"WebPush failed: {ex}")
        if ex.response and ex.response.status_code in (404, 410):
            # Subscription has expired or user revoked permission
            logger.info("Subscription expired or revoked.")
            return False
    except Exception as e:
        logger.error(f"Unexpected push error: {e}")
    return True

async def evaluate_and_dispatch_pushes():
    """Evaluate all active subscriptions against live queue times and send pushes."""
    subs = load_subscriptions()
    if not subs:
        logger.info("No active cloud push subscriptions registered.")
        return 0

    rides_map = await fetch_live_park_rides()
    if not rides_map:
        logger.warning("Could not fetch live queue times.")
        return 0

    valid_subs = []
    sent_count = 0

    for sub in subs:
        sub_info = sub.get("subscription")
        alerts = sub.get("alerts", [])
        if not sub_info or not alerts:
            continue

        keep_sub = True
        sub_modified = False

        for alert in alerts:
            ride_id = alert.get("ride_id")
            threshold = alert.get("threshold", 30)
            ride = rides_map.get(ride_id)

            if not ride:
                # Try finding by name
                alert_name = alert.get("ride_name", "").lower().strip()
                for r in rides_map.values():
                    if r["name"].lower().strip() == alert_name:
                        ride = r
                        break

            if not ride or not ride["is_open"]:
                continue

            wait = ride["wait_time"]
            if wait <= threshold:
                # Check last notification time to avoid duplicate spamming within 5 mins
                last_sent = alert.get("last_sent_wait")
                if last_sent != wait:
                    payload = {
                        "title": f"🔔 Goal Reached: {ride['name']} ({wait}m)!",
                        "body": f"Standby line at {ride['park_name']} is down to {wait} min (Goal: ≤ {threshold}m)! Head over now! 🚀",
                        "icon": "https://emojicdn.elk.sh/🏰?size=192",
                        "badge": "https://emojicdn.elk.sh/🔔?size=96",
                        "tag": f"goal-{ride['id']}",
                        "data": {
                            "rideId": ride["id"],
                            "parkId": ride["park_id"],
                            "url": "https://godtoe-max.github.io/disneywaittimes/",
                        },
                    }
                    success = send_single_push(sub_info, payload)
                    if success:
                        alert["last_sent_wait"] = wait
                        sub_modified = True
                        sent_count += 1
                    else:
                        # Expired subscription
                        keep_sub = False
                        break

        if keep_sub:
            valid_subs.append(sub)

    # Save cleaned / updated subscriptions
    save_subscriptions(valid_subs)
    logger.info(f"Cloud push cycle complete. Sent {sent_count} lock-screen notifications.")
    return sent_count

if __name__ == "__main__":
    asyncio.run(evaluate_and_dispatch_pushes())
