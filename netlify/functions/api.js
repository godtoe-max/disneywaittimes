/**
 * Netlify Serverless Function: Disney Wait Times Live API & Historical Intelligence
 * 
 * Provides live queue aggregation from Queue-Times for 6 Disney parks (WDW + DL)
 * and serves pre-computed 5-year historical curves, crowd gauges, and ROI planning.
 */

const fs = require('fs');
const path = require('path');

// Load static historical dataset
let DATA = {};
try {
  const dataDir = path.join(__dirname, '..', '..', 'frontend', 'data');
  if (fs.existsSync(dataDir)) {
    DATA.historyOverview = JSON.parse(fs.readFileSync(path.join(dataDir, 'history_overview.json'), 'utf8'));
    DATA.leastBusy = JSON.parse(fs.readFileSync(path.join(dataDir, 'least_busy_all.json'), 'utf8'));
    DATA.calendar = JSON.parse(fs.readFileSync(path.join(dataDir, 'calendar.json'), 'utf8'));
    DATA.rideTiers = JSON.parse(fs.readFileSync(path.join(dataDir, 'ride_tiers.json'), 'utf8'));
    DATA.rideCurves = JSON.parse(fs.readFileSync(path.join(dataDir, 'ride_curves.json'), 'utf8'));
    DATA.rideDeepdives = JSON.parse(fs.readFileSync(path.join(dataDir, 'ride_deepdives.json'), 'utf8'));
    DATA.parks = JSON.parse(fs.readFileSync(path.join(dataDir, 'parks.json'), 'utf8'));
    DATA.catalog = JSON.parse(fs.readFileSync(path.join(dataDir, 'rides_catalog.json'), 'utf8'));
  }
} catch (e) {
  console.error('Error loading static historical data files:', e);
}

const NON_QUEUE_PATTERNS = [
  'splash \'n\' soak', 'treehouse', 'shootin\'', 'shootin exposition', 'arcade',
  'sorcerer\'s workshop', 'bakery tour', 'single rider', 'main street cinema',
  'the disney gallery', 'how-to-play yard', 'duck pond', 'a magical life',
  'sleeping beauty castle walkthrough', 'redwood creek challenge', 'tom sawyer island',
  'discovery island trails', 'gorilla falls exploration trail', 'maharajah jungle trek',
  'swiss family treehouse', 'animation academy', 'games of pixar pier',
  'walt disney\'s enchanted tiki room', 'the hall of presidents', 'carousel of progress',
  'country bear musical jamboree', 'turtle talk'
];

function isQueueRide(name) {
  if (!name) return false;
  const nl = name.toLowerCase();
  return !NON_QUEUE_PATTERNS.some(p => nl.includes(p));
}

const PARK_DEFS = [
  { id: 6, name: "Magic Kingdom", resort: "Walt Disney World", timezone: "America/New_York", baseline: 45.0 },
  { id: 5, name: "EPCOT", resort: "Walt Disney World", timezone: "America/New_York", baseline: 40.0 },
  { id: 7, name: "Disney's Hollywood Studios", resort: "Walt Disney World", timezone: "America/New_York", baseline: 48.0 },
  { id: 8, name: "Disney's Animal Kingdom", resort: "Walt Disney World", timezone: "America/New_York", baseline: 40.0 },
  { id: 16, name: "Disneyland Park", resort: "Disneyland Resort", timezone: "America/Los_Angeles", baseline: 45.0 },
  { id: 17, name: "Disney California Adventure", resort: "Disneyland Resort", timezone: "America/Los_Angeles", baseline: 48.0 },
];

function calculateCrowdLevel(avgWait, parkId) {
  let baseline = 44.0;
  const p = PARK_DEFS.find(x => x.id === parkId);
  if (p) baseline = p.baseline;

  const ratio = baseline > 0 ? (avgWait / baseline) : 1.0;

  if (avgWait < 25 || ratio < 0.60) {
    return {
      level: "empty",
      tier: "EMPTY",
      label: "Empty / Walk-on",
      badge_text: "🟢 Empty (Walk-on)",
      score: 1,
      color: "#10b981",
      bg_color: "rgba(16, 185, 129, 0.15)",
      icon: "🟢",
      description: "Near-zero lines across major rides! Exceptional walk-on conditions.",
      pct_of_normal: Math.round(ratio * 1000) / 10,
    };
  } else if (avgWait < 39 || ratio < 0.85) {
    return {
      level: "light",
      tier: "LIGHT",
      label: "Light Crowds",
      badge_text: "🔵 Light (Below Normal)",
      score: 2,
      color: "#06b6d4",
      bg_color: "rgba(6, 182, 212, 0.15)",
      icon: "🔵",
      description: "Significantly shorter lines on moving rides. Great day for standby riding without long waits.",
      pct_of_normal: Math.round(ratio * 1000) / 10,
    };
  } else if (avgWait < 52 || ratio <= 1.18) {
    return {
      level: "normal",
      tier: "NORMAL",
      label: "Normal / Moderate",
      badge_text: "🟡 Normal (Typical)",
      score: 3,
      color: "#f59e0b",
      bg_color: "rgba(245, 158, 11, 0.15)",
      icon: "🟡",
      description: "Standard crowd volume. Headliners have typical lines (45-75m), secondary rides are manageable.",
      pct_of_normal: Math.round(ratio * 1000) / 10,
    };
  } else {
    return {
      level: "busy",
      tier: "BUSY",
      label: "Busy / Heavy",
      badge_text: "🔴 Busy (Heavy Queues)",
      score: 4,
      color: "#ef4444",
      bg_color: "rgba(239, 68, 68, 0.15)",
      icon: "🔴",
      description: "Heavy wait times across major attractions. Lightning Lane or rope drop strategy strongly advised.",
      pct_of_normal: Math.round(ratio * 1000) / 10,
    };
  }
}

// In-memory cache for Queue-Times API calls (15 seconds TTL)
let cache = { timestamp: 0, parks: null, rides: null, downtimes: null };

async function fetchLiveQueueTimes() {
  const now = Date.now();
  if (cache.parks && (now - cache.timestamp < 15000)) {
    return cache;
  }

  const parkSummaries = [];
  const allRides = [];
  const downtimes = [];

  for (const p of PARK_DEFS) {
    try {
      const url = `https://queue-times.com/parks/${p.id}/queue_times.json`;
      const res = await fetch(url, { headers: { 'User-Agent': 'DisneyWaitTimesTracker/1.0' } });
      if (!res.ok) continue;
      const data = await res.json();

      let parkTotalRides = 0;
      let parkOpenRides = 0;
      let parkDownRides = 0;
      let totalRealRideWait = 0;
      let openRealRides = 0;
      let maxWait = 0;
      let topRideName = "None";

      // Process lands and standalone rides
      const lands = data.lands || [];
      const standalone = data.rides || [];
      const allParkRides = [];

      for (const land of lands) {
        for (const ride of (land.rides || [])) {
          allParkRides.push({ ...ride, land_name: land.name });
        }
      }
      for (const ride of standalone) {
        allParkRides.push({ ...ride, land_name: 'General' });
      }

      for (const r of allParkRides) {
        parkTotalRides++;
        const isOpen = Boolean(r.is_open);
        const waitTime = isOpen ? (r.wait_time || 0) : 0;
        const isRide = isQueueRide(r.name);

        if (isOpen) {
          parkOpenRides++;
          if (isRide) {
            openRealRides++;
            totalRealRideWait += waitTime;
          }
          if (waitTime > maxWait) {
            maxWait = waitTime;
            topRideName = r.name;
          }
        } else {
          parkDownRides++;
          downtimes.push({
            ride_id: r.id,
            ride_name: r.name,
            park_id: p.id,
            park_name: p.name,
            land_name: r.land_name,
            down_since: r.updated_at || new Date().toISOString(),
            downtime_minutes: 10,
          });
        }

        allRides.push({
          id: r.id,
          name: r.name,
          park_id: p.id,
          park_name: p.name,
          land_name: r.land_name,
          wait_time: waitTime,
          is_open: isOpen,
          is_ride: isRide,
          last_updated: r.updated_at || new Date().toISOString(),
        });
      }

      const avgWait = openRealRides > 0 ? Math.round((totalRealRideWait / openRealRides) * 10) / 10 : 0;
      const crowd = calculateCrowdLevel(avgWait, p.id);

      parkSummaries.push({
        id: p.id,
        name: p.name,
        resort: p.resort,
        timezone: p.timezone,
        total_rides: parkTotalRides,
        open_rides: parkOpenRides,
        down_rides: parkDownRides,
        open_real_rides: openRealRides,
        avg_wait_time: avgWait,
        max_wait_time: maxWait,
        top_ride_name: topRideName,
        crowd_level: crowd,
        last_updated: new Date().toISOString(),
      });
    } catch (err) {
      console.error(`Error polling Queue-Times for park ${p.id}:`, err);
    }
  }

  cache = {
    timestamp: now,
    parks: parkSummaries,
    rides: allRides,
    downtimes: downtimes,
  };
  return cache;
}

exports.handler = async (event) => {
  const pathPart = event.path.replace(/^\/\.netlify\/functions\/api/, '').replace(/^\/api/, '');
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    // 1. Health check
    if (pathPart === '' || pathPart === '/' || pathPart === '/health') {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ status: 'ok', server: 'Netlify Serverless Disney Wait Times' }),
      };
    }

    // 2. Parks summary
    if (pathPart === '/parks') {
      const live = await fetchLiveQueueTimes();
      return { statusCode: 200, headers, body: JSON.stringify(live.parks || []) };
    }

    // 3. Rides list
    if (pathPart === '/rides') {
      const live = await fetchLiveQueueTimes();
      let list = live.rides || [];
      const params = event.queryStringParameters || {};
      if (params.park_id) {
        const pid = parseInt(params.park_id, 10);
        list = list.filter(r => r.park_id === pid);
      }
      if (params.open_only === 'true') {
        list = list.filter(r => r.is_open);
      }
      if (params.search) {
        const q = params.search.toLowerCase();
        list = list.filter(r => r.name.toLowerCase().includes(q));
      }
      return { statusCode: 200, headers, body: JSON.stringify(list) };
    }

    // 4. Downtimes
    if (pathPart === '/downtimes') {
      const live = await fetchLiveQueueTimes();
      return { statusCode: 200, headers, body: JSON.stringify(live.downtimes || []) };
    }

    // 5. Historical overview
    if (pathPart === '/history/overview') {
      return { statusCode: 200, headers, body: JSON.stringify(DATA.historyOverview || {}) };
    }

    // 6. Ride curves / history
    const rideCurvesMatch = pathPart.match(/^\/rides\/(\d+)\/history/);
    if (rideCurvesMatch) {
      const rideId = rideCurvesMatch[1];
      const curve = (DATA.rideCurves && DATA.rideCurves[rideId]) || {
        ride_id: parseInt(rideId, 10),
        hourly_breakdown: [],
        day_of_week_breakdown: [],
        total_observations: 0,
        avg_posted_wait: 0
      };
      return { statusCode: 200, headers, body: JSON.stringify(curve) };
    }

    // 7. Least busy days
    const leastBusyMatch = pathPart.match(/^\/history\/parks\/(\d+)\/least-busy-days/);
    if (leastBusyMatch) {
      const parkId = leastBusyMatch[1];
      const data = (DATA.leastBusy && DATA.leastBusy[parkId]) || { rankings: [], sweet_spots: [] };
      return { statusCode: 200, headers, body: JSON.stringify(data) };
    }

    // 8. Calendar
    if (pathPart === '/history/calendar') {
      return { statusCode: 200, headers, body: JSON.stringify(DATA.calendar || []) };
    }

    // 9. Manual sync
    if (pathPart === '/sync' && event.httpMethod === 'POST') {
      cache.timestamp = 0; // Invalidate cache
      const live = await fetchLiveQueueTimes();
      return { statusCode: 200, headers, body: JSON.stringify({ status: 'ok', synced_parks: live.parks.length }) };
    }

    // 10. Wishlist evaluation
    if (pathPart === '/wishlist/evaluate' && event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const rideIds = body.ride_ids || [];
      const passPrice = body.pass_price || 30.0;
      
      const live = await fetchLiveQueueTimes();
      const ridesMap = {};
      (live.rides || []).forEach(r => { ridesMap[r.id] = r; });

      let totalStandby = 0;
      let totalLightning = 0;
      const details = [];

      rideIds.forEach(id => {
        const r = ridesMap[id];
        const wait = r ? r.wait_time : 30;
        const llWait = Math.max(5, Math.round(wait * 0.2));
        const saved = wait - llWait;
        totalStandby += wait;
        totalLightning += llWait;
        details.push({
          ride_id: id,
          ride_name: r ? r.name : `Ride #${id}`,
          standby_wait: wait,
          lightning_lane_wait: llWait,
          minutes_saved: saved,
        });
      });

      const totalSaved = totalStandby - totalLightning;
      const hoursSaved = totalSaved / 60.0;
      const costPerHourSaved = hoursSaved > 0 ? (passPrice / hoursSaved) : 0;

      let verdict = 'NEUTRAL';
      let verdictDesc = 'Moderate time savings. Worth considering if park is getting busier.';
      if (hoursSaved >= 2.5) {
        verdict = 'STRONG_BUY';
        verdictDesc = 'Exceptional time savings! Lightning Lane will save you massive queue time.';
      } else if (hoursSaved < 1.0) {
        verdict = 'SKIP';
        verdictDesc = 'Low standby lines today. Standby riding is fast enough without purchasing.';
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          verdict,
          verdict_description: verdictDesc,
          total_standby_minutes: totalStandby,
          total_lightning_lane_minutes: totalLightning,
          total_minutes_saved: totalSaved,
          total_hours_saved: Math.round(hoursSaved * 10) / 10,
          pass_cost: passPrice,
          cost_per_hour_saved: Math.round(costPerHourSaved * 100) / 100,
          ride_evaluations: details,
        }),
      };
    }

    return {
      statusCode: 404,
      headers,
      body: JSON.stringify({ error: `Path ${pathPart} not found` }),
    };
  } catch (err) {
    console.error('Serverless function error:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
