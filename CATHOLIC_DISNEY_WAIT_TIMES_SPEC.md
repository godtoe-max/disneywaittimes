# Catholic Disney: Wait Time Analytics & Itinerary Integration Specification

> **Document Purpose:** This specification outlines how to integrate theme park queue analytics, ticket-tier extrapolation, and historical crowd intelligence into the Catholic Disney web application (`c:\Users\sgaro\Documents\Catholic Disney`). It is designed for the Catholic Disney website developer/agent to review and implement directly.

---

## 1. Executive Summary

Disney park planning is notoriously stressful for families, especially large Catholic families balancing Sunday Mass obligations, holy day crowds, and travel budgets. 

By integrating **historical crowd baselines** and **ticket-tier mathematical extrapolation**, the Catholic Disney website can provide parents with an honest, data-driven planning engine that answers:
1. *"We are going to 8:00 AM Sunday Mass—what will lines look like when we arrive at 10:30 AM, and what should we ride first?"*
2. *"My kids love Haunted Mansion, Peter Pan, and Buzz Lightyear—what will our actual wait times be on our travel date?"*
3. *"Is Lightning Lane worth $150–$250 for our family on this specific day, or should we save our money?"*
4. *"If we must wait in a 40-minute line, how does that sync with praying the Rosary as a family?"*

---

## 2. Core Architecture & Data Foundation

The system is built on two primary data streams:
1. **10-Year TouringPlans Research Open Dataset (2015–2021)**:
   - **891,000+ observations** across flagship E-ticket attractions.
   - **77,700+ actual in-park timer records (`SACTMIN`)**, proving that Disney posted wait times are typically inflated by 20% to 40%.
   - **2,079 days of daily metadata** (`daily_metadata`), cataloging historical crowd levels (1–10), holiday flags, park operating hours, weather, and school session percentages.
2. **Queue-Times API (Live Poller)**:
   - Polls all 4 Disney World parks every 5 minutes for active operating status and live wait times.

---

## 3. The Mathematical Extrapolation Engine

### A. The "Rising Tide" Anchor Principle
On any given day, crowd pressure elevates or lowers all attractions in a park in lockstep. Because we possess ground-truth historical curves for E-ticket headliners (e.g., *Seven Dwarfs Mine Train* in Magic Kingdom, *Avatar Flight of Passage* in Animal Kingdom, *Slinky Dog Dash* in Hollywood Studios), those rides act as the **Anchor Curve ($W_{anchor}$)** for the entire park.

### B. The Classic "A through E Ticket" Tier Ratio Matrix
Attractions are classified by their historical theoretical hourly capacity (People Per Hour / PPH) and guest demand:

| Ticket Tier | Classification & Experience | Ratio to Anchor E-Ticket ($R_{tier}$) | Typical Midday Wait (Crowd Level 8) | Example Attractions |
| :--- | :--- | :--- | :--- | :--- |
| **E-Ticket** | Mega-Thrills / Headliners | **1.00** (Anchor) | **90 – 115 min** | *Seven Dwarfs Mine Train, TRON, Space Mountain, Big Thunder* |
| **E-Capacity Anomaly** | Family ride with low PPH capacity | **0.80 – 0.85** | **75 – 90 min** | *Peter Pan's Flight* (~800 riders/hr bottle-neck) |
| **D-Ticket** | Major Park Classics / Omnimovers | **0.55 – 0.70** | **45 – 65 min** | *The Haunted Mansion, Pirates of the Caribbean, Jungle Cruise* |
| **C-Ticket** | Popular Mid-Tier / Dark Rides | **0.30 – 0.45** | **25 – 40 min** | *Buzz Lightyear, Winnie the Pooh, Under the Sea, "it's a small world"* |
| **B-Ticket** | Spinners & Secondary Rides | **0.15 – 0.25** | **15 – 25 min** | *Dumbo, Mad Tea Party, Magic Carpets of Aladdin, Barnstormer* |
| **A-Ticket** | High-Capacity Transit & Walk-ons | **0.05 – 0.10** | **5 – 10 min** (Walk-on) | *PeopleMover, Carousel of Progress, Tiki Room, Hall of Presidents* |

### C. The Wait Time Projection Formula
For any attraction on a given calendar date at hour $t$:

$$\text{Estimated Wait}(t) = W_{\text{anchor}}(t) \times R_{\text{tier}} \times C_{\text{crowd}}$$

Where:
- $W_{\text{anchor}}(t)$ is the hourly wait of the park's anchor E-ticket.
- $R_{\text{tier}}$ is the attraction's tier ratio.
- $C_{\text{crowd}}$ is a crowd-level normalization multiplier from `daily_metadata` ($0.5$ for Level 2 up to $1.2$ for Level 10).

### D. The "Actual vs. Posted" Reality Check (Deflation Formula)
Disney deliberately inflates posted wait boards to manage foot traffic and set low expectations. In-park timers show:

$$\text{Actual Wait} \approx \text{Posted Wait} \times 0.72$$

*(e.g., A 55-minute posted wait for Haunted Mansion is typically a ~38-minute real wait).*

---

## 4. Key Catholic Family Features

### Feature 1: The "Sunday Mass Trade-Off" Calculator
- **User Input**: Select Sunday Mass time and location (e.g., 8:00 AM Mass at *Basilica of the National Shrine of Mary, Queen of the Universe* or 10:00 AM Mass at *Corpus Christi* in Celebration).
- **Automatic Buffer Calculation**:
  - Mass duration: ~55–65 mins.
  - Transit, parking at Transportation & Ticket Center (TTC), security, and Monorail/Ferry: ~40–50 mins.
  - Example output: 8:00 AM Mass $\rightarrow$ **10:15 AM Park Arrival**.
- **Actionable Routing Recommendation**:
  - The tool recognizes that at 10:15 AM, E-tickets are already in their peak surge (~95 min), but D and C-tickets are still ramping up.
  - *Advice*: "Head directly to Adventureland/Liberty Square first (*Pirates* ~35 min, *Haunted Mansion* ~40 min) while crowds congest Fantasyland. Save Seven Dwarfs for the 8:45 PM fireworks lull."

### Feature 2: Multi-Ride Wishlist & Cumulative Standby Hours
- Families pick 3 to 5 "must-do" rides for their day.
- The tool sums the standby wait:
  ```
  Family Wishlist on Easter Sunday:
  • Seven Dwarfs Mine Train:  95 min
  • Peter Pan's Flight:        75 min
  • Haunted Mansion:           55 min
  • Buzz Lightyear:            35 min
  -----------------------------------------
  Total Time in Standby Lines: 260 min (4.3 Hours!)
  ```

### Feature 3: The "Lightning Lane Stewardship & ROI" Verdict
Per-person pricing ($20–$35+/ticket) punishes large families ($150–$250+ per day for a family of 6). The tool provides an objective financial stewardship assessment:

1. **High Crowd Days (Level 8–10: Easter, Spring Break, Christmas, Thanksgiving)**:
   - **Verdict**: 🚨 **Lightning Lane Recommended**.
   - *"Your 4 selected rides will consume 4.3 hours in line. Lightning Lane saves ~3.5 hours, keeping young children rested and peaceful."*
2. **Moderate/Low Days (Level 1–5: September, January, Mid-February, Ordinary Time Tuesdays)**:
   - **Verdict**: 💡 **Save Your Money (Skip Lightning Lane)**.
   - *"Your 4 selected rides only total ~80 minutes combined. By rope-dropping the first ride and doing the second during fireworks, you save $200+ for dinner or souvenirs."*
3. **Split-Strategy Advice**:
   - *"Buy the $13 Single Pass for Seven Dwarfs Mine Train, but skip the $28 Multi Pass bundle—Haunted Mansion, Pirates, and Buzz can be ridden with under 25-min waits after 5:00 PM."*

### Feature 4: Integration with Queue Rosary & Prayer Nooks
- **Queue Rosary Sync** (`queue-rosary.js`):
  - When a wait is unavoidable (e.g. 40 minutes at Flight of Passage), the app suggests:
    - *"40-minute wait detected: Exactly enough time to pray the Sorrowful Mysteries as a family using the Queue Rosary!"*
- **Quiet Prayer Nooks** (`prayer-nooks.js`):
  - When park crowds peak between 1:00 PM and 3:30 PM, suggest stepping away to a nearby quiet rest spot:
    - Magic Kingdom: *Liberty Square riverfront benches* or *Tom Sawyer Island rocking chairs*.
    - EPCOT: *Stave Church in Norway Pavilion* (quiet air-conditioned reflection) or *Morocco Pavilion courtyards*.

---

## 5. Technical Implementation in Catholic Disney (Vanilla JS)

To keep Catholic Disney lightweight, fast, and free of ongoing API token costs, use **Rule-Based Dynamic Natural Language Generation (NLG)** rather than calling an external LLM on every page load:

### A. Ride Tier Dictionary (`js/data/ride-tiers.js`)
```javascript
export const RIDE_TIERS = {
  // Magic Kingdom
  129: { name: "Seven Dwarfs Mine Train", parkId: 6, tier: "E", ratio: 1.00, pph: 1500 },
  138: { name: "Space Mountain", parkId: 6, tier: "E", ratio: 0.90, pph: 1600 },
  130: { name: "Big Thunder Mountain", parkId: 6, tier: "E", ratio: 0.85, pph: 1800 },
  136: { name: "Peter Pan's Flight", parkId: 6, tier: "E-ANOMALY", ratio: 0.85, pph: 800 },
  140: { name: "Haunted Mansion", parkId: 6, tier: "D", ratio: 0.60, pph: 2600 },
  137: { name: "Pirates of the Caribbean", parkId: 6, tier: "D", ratio: 0.55, pph: 3000 },
  134: { name: "Jungle Cruise", parkId: 6, tier: "D", ratio: 0.65, pph: 1800 },
  131: { name: "Buzz Lightyear's Space Ranger Spin", parkId: 6, tier: "C", ratio: 0.40, pph: 2000 },
  142: { name: "The Many Adventures of Winnie the Pooh", parkId: 6, tier: "C", ratio: 0.35, pph: 1400 },
  133: { name: "'it's a small world'", parkId: 6, tier: "C", ratio: 0.30, pph: 3000 },
  132: { name: "Dumbo the Flying Elephant", parkId: 6, tier: "B", ratio: 0.22, pph: 1000 },
  135: { name: "Mad Tea Party", parkId: 6, tier: "B", ratio: 0.18, pph: 1200 },
  1190: { name: "Tomorrowland Transit Authority PeopleMover", parkId: 6, tier: "A", ratio: 0.10, pph: 4000 },
  457: { name: "Walt Disney's Carousel of Progress", parkId: 6, tier: "A", ratio: 0.05, pph: 3600 },
  356: { name: "The Hall of Presidents", parkId: 6, tier: "A", ratio: 0.05, pph: 3000 },
};
```

### B. Natural Language Rules Engine (`js/components/wait-time-insights.js`)
```javascript
export function generateItineraryCoaching(itinerary) {
  const { arrivalHour, totalWaitMinutes, rides, isHoliday, massParish } = itinerary;
  const insights = [];

  // 1. Mass Arrival Timing Insight
  if (arrivalHour >= 10.5 && arrivalHour <= 13.5) {
    insights.push({
      type: "pacing",
      icon: "⏰",
      title: "Midday Mass Arrival Strategy",
      text: `Arriving around ${formatTime(arrivalHour)} after Mass puts you right in the midday rush. Start your day in Adventureland or Tomorrowland transit attractions rather than Fantasyland coasters to avoid long queues.`
    });
  }

  // 2. Lightning Lane ROI Insight
  if (totalWaitMinutes >= 180 && isHoliday) {
    insights.push({
      type: "budget",
      icon: "🚨",
      title: "Lightning Lane Recommended",
      text: `Your selected attractions total ~${Math.round(totalWaitMinutes / 60)} hours in standby lines today. On peak holiday days, investing in Lightning Lane Multi Pass will reclaim over 3 hours of family time.`
    });
  } else if (totalWaitMinutes < 90) {
    insights.push({
      type: "budget",
      icon: "💡",
      title: "Stewardship Tip: Skip Lightning Lane",
      text: `Your selected rides only average ~${totalWaitMinutes} minutes of combined wait today. Save your family's budget ($150–$250) and utilize rope drop and fireworks-time queues instead.`
    });
  }

  // 3. Queue Rosary Prompt
  const longestRide = rides.reduce((max, r) => r.estimatedWait > max.estimatedWait ? r : max, rides[0]);
  if (longestRide && longestRide.estimatedWait >= 35) {
    insights.push({
      type: "spiritual",
      icon: "📿",
      title: "Queue Rosary Opportunity",
      text: `Your longest wait will be ~${longestRide.estimatedWait} minutes at ${longestRide.name}. That's the ideal window to pray the Rosary together as a family using our interactive Queue Rosary.`
    });
  }

  return insights;
}
```

---

## 6. Summary for Website Developer Agent

1. **Where Data Lives**: The SQLite database (`disney_wait_times.db`) and analytical endpoints live in `c:\Users\sgaro\Documents\Wait Times Updater`.
2. **What to Import**: Copy `ride-tiers.js` and `wait-time-insights.js` into `Catholic Disney/js/data/` and `Catholic Disney/js/components/`.
3. **Where to Hook In**:
   - In `Catholic Disney/js/components/itinerary-planner.js`: Add the "Estimated Line Time" metric and the "Lightning Lane ROI" verdict card.
   - In `Catholic Disney/js/components/queue-rosary.js`: Add a quick-launch banner from long queue alerts.
