/**
 * Disney World Wait Times Tracker - Interactive Frontend Application
 */

// State
const state = {
  parks: [],
  rides: [],
  downtimes: [],
  selectedResort: 'all', // 'all', 'Walt Disney World', 'Disneyland Resort'
  selectedRideId: null,
  selectedHistRideId: 129, // Default: Seven Dwarfs Mine Train
  histSelectedParkId: 6,    // Default: Magic Kingdom
  histSelectedDate: '2021-04-04', // Default: Easter Sunday 2021
  historyOverview: null,
  activeTab: 'tab-trends',
  parkFilter: 'all',
  searchQuery: '',
  openOnly: false,
  sortColumn: 'wait',
  sortAsc: false,
  chart: null,
  dayChart: null,
  pollSecondsRemaining: 300,
  isSyncing: false,
};

// Park display metadata
const PARK_META = {
  6: {
    name: 'Magic Kingdom',
    resort: 'Walt Disney World',
    tag: 'Fantasyland, Tomorrowland & More',
    icon: '🏰',
    accentStart: '#0284c7',
    accentEnd: '#38bdf8',
  },
  5: {
    name: 'EPCOT',
    resort: 'Walt Disney World',
    tag: 'World Discovery, Showcase & Nature',
    icon: '🌐',
    accentStart: '#7c3aed',
    accentEnd: '#a855f7',
  },
  7: {
    name: "Disney's Hollywood Studios",
    resort: 'Walt Disney World',
    tag: 'Star Wars, Toy Story & Sunset Blvd',
    icon: '🎬',
    accentStart: '#ea580c',
    accentEnd: '#f97316',
  },
  8: {
    name: "Disney's Animal Kingdom",
    resort: 'Walt Disney World',
    tag: 'Pandora, Africa & Asia',
    icon: '🌳',
    accentStart: '#059669',
    accentEnd: '#10b981',
  },
  16: {
    name: 'Disneyland Park',
    resort: 'Disneyland Resort',
    tag: "Main Street, Galaxy's Edge & Fantasyland",
    icon: '✨',
    accentStart: '#db2777',
    accentEnd: '#f472b6',
  },
  17: {
    name: 'Disney California Adventure',
    resort: 'Disneyland Resort',
    tag: 'Cars Land, Avengers Campus & Pixar Pier',
    icon: '🎡',
    accentStart: '#0284c7',
    accentEnd: '#06b6d4',
  },
};

// Key Flagship rides to highlight
const FLAGSHIP_KEYWORDS = [
  'Mine Train',
  'Seven Dwarfs',
  'Space Mountain',
  'Radiator Springs',
  'Flight of Passage',
  'Rise of the Resistance',
  'Indiana Jones',
  'Matterhorn',
  'Guardians',
  'Pirates of the Caribbean',
  'Spaceship Earth',
  'Slinky Dog',
  'Soarin',
  'TRON',
  'Cosmic Rewind',
];

// Initialize application on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  initLiveClock();
  initEventListeners();
  initPollingTimer();
  fetchAllData();
});

/* ==========================================================================
   Clock & Timers
   ========================================================================== */
function initLiveClock() {
  const orlandoClockEl = document.getElementById('orlandoClock');
  const anaheimClockEl = document.getElementById('anaheimClock');

  function updateClock() {
    const now = new Date();
    // Orlando: US Eastern Time
    const orlandoFormatter = new Intl.DateTimeFormat([], {
      timeZone: 'America/New_York',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    });
    if (orlandoClockEl) {
      orlandoClockEl.textContent = `${orlandoFormatter.format(now)} Orlando`;
    }

    // Anaheim: US Pacific Time
    const anaheimFormatter = new Intl.DateTimeFormat([], {
      timeZone: 'America/Los_Angeles',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    });
    if (anaheimClockEl) {
      anaheimClockEl.textContent = `${anaheimFormatter.format(now)} Anaheim`;
    }
  }

  updateClock();
  setInterval(updateClock, 1000);
}

function initPollingTimer() {
  const countdownEl = document.getElementById('pollCountdown');

  setInterval(() => {
    state.pollSecondsRemaining -= 1;
    if (state.pollSecondsRemaining <= 0) {
      state.pollSecondsRemaining = 300;
      fetchAllData(true);
    }

    const mins = Math.floor(state.pollSecondsRemaining / 60);
    const secs = state.pollSecondsRemaining % 60;
    countdownEl.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
  }, 1000);
}

/* ==========================================================================
   Event Listeners
   ========================================================================== */
function initEventListeners() {
  // Sync now button
  const syncBtn = document.getElementById('syncNowBtn');
  syncBtn.addEventListener('click', triggerManualSync);

  // Tab switching
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetTab = btn.getAttribute('data-tab');
      switchTab(targetTab);
    });
  });

  // Attraction search
  const searchInput = document.getElementById('attractionSearch');
  const clearBtn = document.getElementById('clearSearchBtn');

  searchInput.addEventListener('input', (e) => {
    state.searchQuery = e.target.value.toLowerCase().trim();
    clearBtn.classList.toggle('hidden', state.searchQuery.length === 0);
    renderAttractionsTable();
  });

  clearBtn.addEventListener('click', () => {
    searchInput.value = '';
    state.searchQuery = '';
    clearBtn.classList.add('hidden');
    renderAttractionsTable();
  });

  // Resort Switcher
  document.querySelectorAll('.resort-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.resort-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      state.selectedResort = btn.getAttribute('data-resort');
      renderResortBanner();
      renderParksGrid();
      renderAttractionsTable();
      renderDowntimes();
    });
  });

  // Park filters in attractions table
  document.querySelectorAll('.filter-pill').forEach((pill) => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('.filter-pill').forEach((p) => p.classList.remove('active'));
      pill.classList.add('active');
      state.parkFilter = pill.getAttribute('data-park-filter');
      renderAttractionsTable();
    });
  });

  // Open only checkbox
  const openOnlyCb = document.getElementById('openOnlyCheckbox');
  openOnlyCb.addEventListener('change', (e) => {
    state.openOnly = e.target.checked;
    renderAttractionsTable();
  });

  // Ride select change in Trends
  const rideSelect = document.getElementById('rideSelect');
  rideSelect.addEventListener('change', (e) => {
    const rideId = parseInt(e.target.value, 10);
    if (rideId) {
      selectRideForChart(rideId);
    }
  });

  // Step 1: Park selection buttons in Tab 4
  document.querySelectorAll('#histParkButtons .step-park-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const parkId = parseInt(btn.getAttribute('data-park'), 10);
      document.querySelectorAll('#histParkButtons .step-park-btn').forEach((b) => b.classList.toggle('active', b === btn));
      state.histSelectedParkId = parkId;
      renderHistParkAttractions(parkId);
    });
  });

  // Step 2: Attraction selection in Tab 4
  const histAttractionPicker = document.getElementById('histAttractionPicker');
  if (histAttractionPicker) {
    histAttractionPicker.addEventListener('change', (e) => {
      const rideId = parseInt(e.target.value, 10);
      if (rideId) {
        state.histSelectedRideId = rideId;
        loadHistDayData();
      }
    });
  }

  // Step 3: Date picker and View button
  const histDayPicker = document.getElementById('histDayPicker');
  if (histDayPicker) {
    histDayPicker.addEventListener('change', (e) => {
      if (e.target.value) {
        state.histSelectedDate = e.target.value;
        loadHistDayData();
      }
    });
  }
  const loadDayBtn = document.getElementById('loadDayBtn');
  if (loadDayBtn) {
    loadDayBtn.addEventListener('click', () => {
      if (histDayPicker && histDayPicker.value) {
        state.histSelectedDate = histDayPicker.value;
        loadHistDayData();
      }
    });
  }

  // Wishlist evaluation button
  const evalWishlistBtn = document.getElementById('evaluateWishlistBtn');
  if (evalWishlistBtn) {
    evalWishlistBtn.addEventListener('click', () => {
      evaluateWishlist();
    });
  }

  // Preset Day Chips
  document.querySelectorAll('#dayPresetsContainer .preset-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('#dayPresetsContainer .preset-chip').forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      const date = chip.getAttribute('data-date');
      if (date) {
        state.histSelectedDate = date;
        if (histDayPicker) histDayPicker.value = date;
        loadHistDayData();
      }
    });
  });

  // Holiday only checkbox in Tab 4
  const holidayOnlyCb = document.getElementById('holidayOnlyCheckbox');
  if (holidayOnlyCb) {
    holidayOnlyCb.addEventListener('change', () => {
      renderHistoricalCalendar();
    });
  }

  // Least busy park selector buttons in Tab 4
  document.querySelectorAll('#leastBusyParkBar .least-busy-park-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#leastBusyParkBar .least-busy-park-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const parkId = parseInt(btn.getAttribute('data-park-id'), 10);
      if (parkId) {
        loadLeastBusyDays(parkId);
      }
    });
  });

  // Table header sorting
  document.querySelectorAll('#attractionsTable th[data-sort]').forEach((th) => {
    th.addEventListener('click', () => {
      const col = th.getAttribute('data-sort');
      if (state.sortColumn === col) {
        state.sortAsc = !state.sortAsc;
      } else {
        state.sortColumn = col;
        state.sortAsc = col === 'name' || col === 'park';
      }
      renderAttractionsTable();
    });
  });
}

function switchTab(tabId) {
  state.activeTab = tabId;
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.getAttribute('data-tab') === tabId);
  });
  document.querySelectorAll('.tab-pane').forEach((pane) => {
    pane.classList.toggle('active', pane.id === tabId);
  });

  if (tabId === 'tab-trends' && state.chart) {
    setTimeout(() => state.chart.resize(), 100);
  }
  if (tabId === 'tab-history' && state.dayChart) {
    setTimeout(() => state.dayChart.resize(), 100);
  }
}

/* ==========================================================================
   Data Fetching
   ========================================================================== */
async function fetchAllData(isBackground = false) {
  try {
    const [parksRes, ridesRes, downtimesRes, histRes] = await Promise.all([
      fetch('/api/parks'),
      fetch('/api/rides'),
      fetch('/api/downtimes'),
      fetch('/api/history/overview'),
    ]);

    state.parks = await parksRes.json();
    state.rides = await ridesRes.json();
    state.downtimes = await downtimesRes.json();
    state.historyOverview = await histRes.json();

    renderResortBanner();
    renderParksGrid();
    renderAttractionsDropdown();
    renderQuickChips();
    renderAttractionsTable();
    renderDowntimes();
    renderHistoryArchive();
    renderHistoricalCalendar();
    loadLeastBusyDays(state.histSelectedParkId || 6);

    // Default select Seven Dwarfs Mine Train (109,294 historical records)
    if (!state.selectedRideId && state.rides.length > 0) {
      const mineTrain = state.rides.find((r) => r.id === 129);
      const defaultRide = mineTrain || state.rides[0];
      selectRideForChart(defaultRide.id);
    } else if (state.selectedRideId) {
      loadRideChartData(state.selectedRideId);
    }
  } catch (err) {
    console.error('Error fetching dashboard data:', err);
  }
}

async function triggerManualSync() {
  if (state.isSyncing) return;
  state.isSyncing = true;

  const syncBtn = document.getElementById('syncNowBtn');
  const syncBtnText = document.getElementById('syncBtnText');
  syncBtn.classList.add('syncing');
  syncBtnText.textContent = 'Syncing...';

  try {
    const res = await fetch('/api/sync', { method: 'POST' });
    const result = await res.json();
    state.pollSecondsRemaining = 300;
    await fetchAllData();
  } catch (err) {
    console.error('Manual sync failed:', err);
  } finally {
    state.isSyncing = false;
    syncBtn.classList.remove('syncing');
    syncBtnText.textContent = 'Sync Live Data';
  }
}

/* ==========================================================================
   Rendering: Resort Banner & Park Cards
   ========================================================================== */
function renderResortBanner() {
  const isResortFiltered = state.selectedResort !== 'all';
  const targetParkIds = new Set(
    state.parks
      .filter((p) => !isResortFiltered || p.resort === state.selectedResort)
      .map((p) => p.id)
  );

  const relevantRides = state.rides.filter((r) => targetParkIds.has(r.park_id));
  const relevantDowntimes = state.downtimes.filter((dt) => targetParkIds.has(dt.park_id));

  const totalRides = relevantRides.length;
  const openRides = relevantRides.filter((r) => r.is_open).length;
  const downRides = relevantDowntimes.length;

  const openWaits = relevantRides.filter((r) => r.is_open).map((r) => r.wait_time);
  const avgWait = openWaits.length > 0
    ? Math.round(openWaits.reduce((a, b) => a + b, 0) / openWaits.length)
    : 0;

  document.getElementById('totalRidesVal').textContent = totalRides;
  document.getElementById('openRidesVal').textContent = openRides;
  document.getElementById('downRidesVal').textContent = downRides;
  document.getElementById('resortAvgWaitVal').textContent = `${avgWait} min`;
  document.getElementById('allRidesCount').textContent = totalRides;
  document.getElementById('downtimesCountBadge').textContent = downRides;

  // Calculate live crowd level
  let crowdClass = 'normal';
  let crowdText = '🟡 Normal (Typical)';
  if (avgWait < 18) {
    crowdClass = 'empty';
    crowdText = '🟢 Empty (Walk-on)';
  } else if (avgWait < 33) {
    crowdClass = 'light';
    crowdText = '🔵 Light (Below Normal)';
  } else if (avgWait < 47) {
    crowdClass = 'normal';
    crowdText = '🟡 Normal (Typical)';
  } else {
    crowdClass = 'busy';
    crowdText = '🔴 Busy (Heavy Queues)';
  }

  const crowdBadge = document.getElementById('resortCrowdBadge');
  if (crowdBadge) {
    crowdBadge.className = `crowd-badge ${crowdClass}`;
    crowdBadge.innerHTML = `<span class="status-dot"></span> ${crowdText}`;
  }
}

function renderParksGrid() {
  const container = document.getElementById('parksCardsContainer');
  container.innerHTML = '';

  const displayParks = state.selectedResort === 'all'
    ? state.parks
    : state.parks.filter((p) => p.resort === state.selectedResort);

  displayParks.forEach((park) => {
    const meta = PARK_META[park.id] || {
      name: park.name,
      tag: 'Theme Park',
      icon: '🎡',
      accentStart: '#0284c7',
      accentEnd: '#38bdf8',
    };

    const crowd = park.crowd_level || { level: 'normal', badge_text: '🟡 Normal (Typical)' };

    const card = document.createElement('div');
    card.className = 'park-card';
    card.style.setProperty('--accent-start', meta.accentStart);
    card.style.setProperty('--accent-end', meta.accentEnd);

    card.innerHTML = `
      <div class="park-card-header">
        <div class="park-name-wrap">
          <span class="park-sub-badge">${meta.tag}</span>
          <h3 class="park-title">${park.name}</h3>
        </div>
        <div class="park-icon-badge">${meta.icon}</div>
      </div>

      <div class="park-stat-row">
        <div class="avg-wait-box">
          <span class="avg-wait-number">${park.avg_wait_time}</span>
          <span class="avg-wait-unit">avg wait (mins)</span>
        </div>
        <div class="park-status-pills">
          <span class="pill-metric pill-open">${park.open_rides} / ${park.total_rides} Open</span>
          ${
            park.down_rides > 0
              ? `<span class="pill-metric pill-down">${park.down_rides} Down</span>`
              : `<span class="pill-metric pill-open">0 Down</span>`
          }
        </div>
      </div>

      <div class="park-card-crowd">
        <span class="muted-label" style="font-size:0.75rem; font-weight:600;">Crowd Volume:</span>
        <span class="crowd-badge ${crowd.level}">${crowd.badge_text}</span>
      </div>

      <div class="top-ride-highlight">
        <span class="top-ride-title" title="${escapeHtml(park.top_ride_name)}">
          ⚡ ${escapeHtml(park.top_ride_name)}
        </span>
        <span class="top-ride-wait">${park.max_wait_time}m</span>
      </div>
    `;

    // Clicking a park card filters the attraction list by this park
    card.addEventListener('click', () => {
      state.parkFilter = String(park.id);
      document.querySelectorAll('.filter-pill').forEach((pill) => {
        pill.classList.toggle('active', pill.getAttribute('data-park-filter') === String(park.id));
      });
      switchTab('tab-attractions');
      renderAttractionsTable();
    });

    container.appendChild(card);
  });
}

/* ==========================================================================
   Rendering: Tab 1 Time-Series Chart
   ========================================================================== */
function renderAttractionsDropdown() {
  const select = document.getElementById('rideSelect');
  const currentVal = state.selectedRideId;

  // Group rides by park
  const grouped = {};
  state.rides.forEach((r) => {
    if (!grouped[r.park_name]) grouped[r.park_name] = [];
    grouped[r.park_name].push(r);
  });

  select.innerHTML = '';
  Object.keys(grouped).forEach((parkName) => {
    const optgroup = document.createElement('optgroup');
    optgroup.label = parkName;

    grouped[parkName].forEach((ride) => {
      const opt = document.createElement('option');
      opt.value = ride.id;
      opt.textContent = `${ride.name} (${ride.is_open ? `${ride.wait_time}m` : 'Closed'})`;
      if (ride.id === currentVal) opt.selected = true;
      optgroup.appendChild(opt);
    });

    select.appendChild(optgroup);
  });
}

function renderQuickChips() {
  const container = document.getElementById('quickChipsContainer');
  // Keep the chips-label
  container.innerHTML = '<span class="chips-label">Popular Flagships:</span>';

  // Find popular flagship rides in current rides list
  const flagshipsFound = [];
  FLAGSHIP_KEYWORDS.forEach((kw) => {
    const match = state.rides.find((r) => r.name.toLowerCase().includes(kw.toLowerCase()));
    if (match && !flagshipsFound.some((f) => f.id === match.id)) {
      flagshipsFound.push(match);
    }
  });

  flagshipsFound.slice(0, 7).forEach((ride) => {
    const btn = document.createElement('button');
    btn.className = `chip-btn ${ride.id === state.selectedRideId ? 'active' : ''}`;
    btn.textContent = ride.name.split(':')[0].replace(' - Legend of the Forbidden Mountain', '').replace(' / Run', '');
    btn.addEventListener('click', () => {
      selectRideForChart(ride.id);
    });
    container.appendChild(btn);
  });
}

function selectRideForChart(rideId) {
  state.selectedRideId = rideId;
  const select = document.getElementById('rideSelect');
  if (select) select.value = rideId;

  document.querySelectorAll('.chip-btn').forEach((b) => {
    b.classList.remove('active');
  });

  loadRideChartData(rideId);
}

async function loadRideChartData(rideId) {
  const overlay = document.getElementById('chartLoadingOverlay');
  overlay.classList.remove('hidden');

  try {
    const res = await fetch(`/api/rides/${rideId}/history`);
    if (!res.ok) throw new Error('Failed to load ride history');
    const data = await res.json();

    updateChartStatsStrip(data);
    renderWaitCurveChart(data);
  } catch (err) {
    console.error('Error loading ride chart data:', err);
  } finally {
    overlay.classList.add('hidden');
  }
}

function updateChartStatsStrip(data) {
  document.getElementById('statRideName').textContent = data.ride_name;
  document.getElementById('statRidePark').textContent = `${data.park_name} • ${data.land_name}`;

  const currentWaitEl = document.getElementById('statCurrentWait');
  if (data.is_open) {
    currentWaitEl.textContent = `${data.current_wait} min`;
    currentWaitEl.className = 'strip-val stat-badge text-cyan';
  } else {
    currentWaitEl.textContent = 'Closed';
    currentWaitEl.className = 'strip-val stat-badge text-danger';
  }

  // Find historical average at current park local hour
  const nowUtc = new Date();
  const parkOffset = (data.park_id === 16 || data.park_id === 17) ? -7 : -4;
  const currentParkHour = (nowUtc.getUTCHours() + parkOffset + 24) % 24;
  const matchHour = data.hourly_averages.find((h) => h.hour === currentParkHour);

  const typicalWaitEl = document.getElementById('statTypicalWait');
  const comparisonDeltaEl = document.getElementById('statComparisonDelta');

  if (matchHour && matchHour.avg_wait_time !== null) {
    const sampleCount = data.total_historical_samples || 0;
    let sampleLabel = `(${sampleCount.toLocaleString()} samples)`;
    if (data.is_extrapolated_history) {
      sampleLabel = `(Ticket-Tier Model • ${sampleCount.toLocaleString()} baseline)`;
    } else if (sampleCount > 500) {
      sampleLabel = `(${sampleCount.toLocaleString()} historical samples)`;
    }
    typicalWaitEl.innerHTML = `${Math.round(matchHour.avg_wait_time)} min <small style="font-size:0.72rem; color:var(--cyan-400); display:block; font-weight:600;">${sampleLabel}</small>`;

    if (data.is_open) {
      const diff = data.current_wait - matchHour.avg_wait_time;
      if (diff <= -10) {
        comparisonDeltaEl.innerHTML = `<span class="text-success">▼ ${Math.abs(Math.round(diff))}m lower than usual! Fast line</span>`;
      } else if (diff >= 15) {
        comparisonDeltaEl.innerHTML = `<span class="text-danger">▲ ${Math.round(diff)}m higher than usual</span>`;
      } else {
        comparisonDeltaEl.innerHTML = `<span class="text-gold">≈ Typical for this hour</span>`;
      }
    } else {
      comparisonDeltaEl.innerHTML = `<span class="text-danger">Currently Downtime</span>`;
    }
  } else {
    typicalWaitEl.textContent = 'N/A';
    comparisonDeltaEl.textContent = data.is_open ? 'Normal range' : 'Closed';
  }
}

function renderWaitCurveChart(data) {
  const ctx = document.getElementById('waitCurveChart').getContext('2d');

  // Align data across standard operating hours (8:00 AM to 10:00 PM)
  const hours = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22];
  const labels = hours.map((h) => {
    const period = h < 12 ? 'AM' : 'PM';
    const displayH = h <= 12 ? h : h - 12;
    return `${displayH} ${period}`;
  });

  // 1. Historical hourly averages mapped to hours
  const histMap = {};
  data.hourly_averages.forEach((ha) => {
    histMap[ha.hour] = ha.avg_wait_time;
  });
  const historicalPoints = hours.map((h) => (histMap[h] !== undefined ? histMap[h] : null));

  // 2. Today's live curve mapped to hours (average wait for observations in that hour)
  const todayMap = {};
  data.today_curve.forEach((pt) => {
    if (pt.is_open && pt.wait_time !== null) {
      if (!todayMap[pt.local_hour]) todayMap[pt.local_hour] = [];
      todayMap[pt.local_hour].push(pt.wait_time);
    }
  });

  // Current park local hour (PDT for parks 16, 17; EDT for parks 5, 6, 7, 8)
  const nowUtc = new Date();
  const parkOffset = (data.park_id === 16 || data.park_id === 17) ? -7 : -4;
  const currentParkHour = (nowUtc.getUTCHours() + parkOffset + 24) % 24;

  const todayPoints = hours.map((h) => {
    if (h > currentParkHour) return null; // Don't plot future hours today
    if (todayMap[h] && todayMap[h].length > 0) {
      const avg = todayMap[h].reduce((a, b) => a + b, 0) / todayMap[h].length;
      return Math.round(avg);
    }
    // If it's current hour and we have live wait, use current wait
    if (h === currentParkHour && data.is_open) {
      return data.current_wait;
    }
    return null;
  });

  // Create cyan gradient for today's curve fill
  const cyanGrad = ctx.createLinearGradient(0, 0, 0, 350);
  cyanGrad.addColorStop(0, 'rgba(56, 189, 248, 0.35)');
  cyanGrad.addColorStop(1, 'rgba(56, 189, 248, 0.00)');

  // Destroy previous chart if exists
  if (state.chart) {
    state.chart.destroy();
  }

  state.chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [
        {
          label: "Today's Live Wait",
          data: todayPoints,
          borderColor: '#38BDF8',
          backgroundColor: cyanGrad,
          borderWidth: 3,
          pointBackgroundColor: '#38BDF8',
          pointBorderColor: '#FFFFFF',
          pointBorderWidth: 2,
          pointRadius: 5,
          pointHoverRadius: 7,
          fill: true,
          tension: 0.3,
          spanGaps: true,
        },
        {
          label: 'Historical Hourly Average',
          data: historicalPoints,
          borderColor: '#F59E0B',
          borderWidth: 2.2,
          borderDash: [6, 4],
          pointBackgroundColor: '#F59E0B',
          pointBorderColor: '#0E1626',
          pointRadius: 4,
          pointHoverRadius: 6,
          fill: false,
          tension: 0.35,
          spanGaps: true,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
        intersect: false,
      },
      plugins: {
        legend: {
          display: false, // Custom legend below chart
        },
        tooltip: {
          backgroundColor: 'rgba(15, 23, 42, 0.95)',
          titleColor: '#F8FAFC',
          bodyColor: '#94A3B8',
          borderColor: 'rgba(255, 255, 255, 0.1)',
          borderWidth: 1,
          padding: 12,
          boxPadding: 6,
          usePointStyle: true,
          callbacks: {
            label: function (context) {
              const val = context.parsed.y;
              if (val === null || val === undefined) return `${context.dataset.label}: No data`;
              return `${context.dataset.label}: ${Math.round(val)} mins`;
            },
            afterBody: function (items) {
              if (items.length >= 2) {
                const todayVal = items[0].parsed.y;
                const histVal = items[1].parsed.y;
                if (todayVal !== null && histVal !== null) {
                  const diff = Math.round(todayVal - histVal);
                  if (diff > 0) return `Difference: +${diff} mins vs baseline`;
                  if (diff < 0) return `Difference: ${diff} mins (shorter queue)`;
                  return `Difference: Exactly on baseline`;
                }
              }
              return '';
            },
          },
        },
      },
      scales: {
        x: {
          grid: {
            color: 'rgba(255, 255, 255, 0.05)',
          },
          ticks: {
            color: '#94A3B8',
            font: {
              family: 'Plus Jakarta Sans',
              size: 11,
            },
          },
        },
        y: {
          min: 0,
          suggestedMax: 60,
          grid: {
            color: 'rgba(255, 255, 255, 0.06)',
          },
          ticks: {
            color: '#94A3B8',
            font: {
              family: 'Plus Jakarta Sans',
              size: 11,
            },
            callback: function (val) {
              return `${val}m`;
            },
          },
        },
      },
    },
  });
}

/* ==========================================================================
   Rendering: Tab 2 Attractions Directory Table
   ========================================================================== */
function renderAttractionsTable() {
  const tbody = document.getElementById('attractionsTableBody');
  tbody.innerHTML = '';

  const isResortFiltered = state.selectedResort !== 'all';
  const targetParkIds = new Set(
    state.parks
      .filter((p) => !isResortFiltered || p.resort === state.selectedResort)
      .map((p) => p.id)
  );

  // Filter rides
  let filtered = state.rides.filter((r) => {
    // Resort filter (when all parks is selected)
    if (isResortFiltered && state.parkFilter === 'all' && !targetParkIds.has(r.park_id)) {
      return false;
    }
    // Park filter
    if (state.parkFilter !== 'all' && String(r.park_id) !== state.parkFilter) {
      return false;
    }
    // Open only filter
    if (state.openOnly && !r.is_open) {
      return false;
    }
    // Search filter
    if (state.searchQuery) {
      const matchName = r.name.toLowerCase().includes(state.searchQuery);
      const matchLand = r.land_name.toLowerCase().includes(state.searchQuery);
      if (!matchName && !matchLand) return false;
    }
    return true;
  });

  // Sort rides
  filtered.sort((a, b) => {
    let comp = 0;
    if (state.sortColumn === 'wait') {
      // Treat closed as -1 so they sort to the bottom on descending
      const waitA = a.is_open ? a.wait_time : -1;
      const waitB = b.is_open ? b.wait_time : -1;
      comp = waitA - waitB;
    } else if (state.sortColumn === 'name') {
      comp = a.name.localeCompare(b.name);
    } else if (state.sortColumn === 'park') {
      comp = a.park_name.localeCompare(b.park_name);
    } else if (state.sortColumn === 'land') {
      comp = a.land_name.localeCompare(b.land_name);
    } else if (state.sortColumn === 'status') {
      comp = Number(a.is_open) - Number(b.is_open);
    }
    return state.sortAsc ? comp : -comp;
  });

  if (filtered.length === 0) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td colspan="6" class="empty-state">
        <div class="empty-state-icon">🔍</div>
        <p>No attractions match your filter criteria.</p>
      </td>
    `;
    tbody.appendChild(tr);
    return;
  }

  filtered.forEach((r) => {
    const tr = document.createElement('tr');

    let waitBadgeHtml = '';
    if (!r.is_open) {
      waitBadgeHtml = '<span class="status-badge closed"><span class="status-dot closed"></span> Closed</span>';
    } else if (r.wait_time <= 20) {
      waitBadgeHtml = `<span class="wait-badge wait-low">${r.wait_time} <small>min</small></span>`;
    } else if (r.wait_time <= 45) {
      waitBadgeHtml = `<span class="wait-badge wait-med">${r.wait_time} <small>min</small></span>`;
    } else {
      waitBadgeHtml = `<span class="wait-badge wait-high">${r.wait_time} <small>min</small></span>`;
    }

    tr.innerHTML = `
      <td class="ride-name-cell">${escapeHtml(r.name)}</td>
      <td>${escapeHtml(r.park_name)}</td>
      <td><span class="muted-label">${escapeHtml(r.land_name)}</span></td>
      <td>
        ${
          r.is_open
            ? '<span class="status-badge open"><span class="status-dot open"></span> Operating</span>'
            : '<span class="status-badge closed"><span class="status-dot closed"></span> Down</span>'
        }
      </td>
      <td class="text-right">${waitBadgeHtml}</td>
      <td class="text-center">
        <button class="action-btn-mini" data-ride-id="${r.id}">View Curve</button>
      </td>
    `;

    // Hook View Curve button
    tr.querySelector('.action-btn-mini').addEventListener('click', () => {
      selectRideForChart(r.id);
      switchTab('tab-trends');
      window.scrollTo({ top: 380, behavior: 'smooth' });
    });

    tbody.appendChild(tr);
  });
}

/* ==========================================================================
   Rendering: Tab 3 Downtimes
   ========================================================================== */
function renderDowntimes() {
  const grid = document.getElementById('downtimesGrid');
  const summaryText = document.getElementById('downtimeSummaryText');
  grid.innerHTML = '';

  const isResortFiltered = state.selectedResort !== 'all';
  const targetParkIds = new Set(
    state.parks
      .filter((p) => !isResortFiltered || p.resort === state.selectedResort)
      .map((p) => p.id)
  );

  const displayDowntimes = state.downtimes.filter((dt) => targetParkIds.has(dt.park_id));
  const count = displayDowntimes.length;
  summaryText.textContent = `${count} Attraction${count === 1 ? '' : 's'} Down`;

  if (count === 0) {
    grid.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">✨</div>
        <h3>All Attractions Operating!</h3>
        <p>No active downtimes reported across the ${isResortFiltered ? state.selectedResort : 'resort'} right now.</p>
      </div>
    `;
    return;
  }

  displayDowntimes.forEach((dt) => {
    const card = document.createElement('div');
    card.className = 'downtime-card';

    card.innerHTML = `
      <div class="downtime-top">
        <div>
          <span class="downtime-park-tag">${escapeHtml(dt.park_name)} • ${escapeHtml(dt.land_name)}</span>
          <h4 class="downtime-title">${escapeHtml(dt.ride_name)}</h4>
        </div>
        <span class="downtime-duration-badge">~${dt.downtime_minutes}m down</span>
      </div>
      <div class="downtime-meta">
        <span>Reported status: Closed</span>
        <button class="action-btn-mini" data-ride-id="${dt.ride_id}">View History</button>
      </div>
    `;

    card.querySelector('.action-btn-mini').addEventListener('click', () => {
      selectRideForChart(dt.ride_id);
      switchTab('tab-trends');
    });

    grid.appendChild(card);
  });
}

// Utility: escape HTML
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/* ==========================================================================
   Tab 4: 3-Step Historical Park -> Ride -> Day Explorer
   ========================================================================== */
function renderHistoryArchive() {
  if (!state.historyOverview) return;
  const overview = state.historyOverview;

  // Header badges
  const totalObsEl = document.getElementById('histTotalRecords');
  const actualObsEl = document.getElementById('histActualRecords');
  const daysEl = document.getElementById('histDaysRecords');
  const badgeBadge = document.getElementById('historicalRecordsCountBadge');

  if (totalObsEl) totalObsEl.textContent = (overview.total_observations || 0).toLocaleString();
  if (actualObsEl) actualObsEl.textContent = (overview.actual_timer_observations || 0).toLocaleString();
  if (daysEl) daysEl.textContent = (overview.calendar_days || 0).toLocaleString();
  if (badgeBadge) {
    const kCount = Math.round((overview.total_observations || 0) / 1000);
    badgeBadge.textContent = `${kCount}k+`;
  }

  // Populate Step 1 & Step 2
  renderHistParkAttractions(state.histSelectedParkId);
}

function renderHistParkAttractions(parkId) {
  const picker = document.getElementById('histAttractionPicker');
  const noticeEl = document.getElementById('attractionArchiveNotice');
  const dateHintEl = document.getElementById('dateRangeHint');
  if (!picker) return;

  picker.innerHTML = '';

  // Filter rides in this park
  const parkRides = state.rides.filter((r) => r.park_id === parkId);

  // Separate rides that have historical archives vs others
  const archivedAttractions = (state.historyOverview?.attractions || []).filter((a) => a.park_id === parkId);
  const archivedRideIds = new Set(archivedAttractions.map((a) => a.ride_id));

  // Optgroup 1: Archived Attractions with 40k-109k data points
  if (archivedAttractions.length > 0) {
    const ogArchived = document.createElement('optgroup');
    ogArchived.label = '⭐ 5-Year Historical Open Data Archive (2021–2026)';

    archivedAttractions.forEach((att) => {
      const opt = document.createElement('option');
      opt.value = att.ride_id;
      opt.setAttribute('data-archived', 'true');
      opt.textContent = `⭐ ${att.ride_name} (${att.total_observations.toLocaleString()} records)`;
      if (att.ride_id === state.histSelectedRideId) opt.selected = true;
      ogArchived.appendChild(opt);
    });
    picker.appendChild(ogArchived);
  }

  // Optgroup 2: Other Attractions in this park (Live Polled Only)
  const otherRides = parkRides.filter((r) => !archivedRideIds.has(r.id));
  if (otherRides.length > 0) {
    const ogOther = document.createElement('optgroup');
    ogOther.label = '📡 Live Polling Tracking Only (Active Sep 2026)';
    otherRides.forEach((ride) => {
      const opt = document.createElement('option');
      opt.value = ride.id;
      opt.setAttribute('data-archived', 'false');
      opt.textContent = `📡 ${ride.name} (Live Polled)`;
      if (ride.id === state.histSelectedRideId) opt.selected = true;
      ogOther.appendChild(opt);
    });
    picker.appendChild(ogOther);
  }

  // If current selected ride is not in this park, select the first archived ride
  const options = Array.from(picker.options);
  const currentInList = options.some((o) => parseInt(o.value, 10) === state.histSelectedRideId);
  if (!currentInList && options.length > 0) {
    state.histSelectedRideId = parseInt(options[0].value, 10);
    picker.value = state.histSelectedRideId;
  } else {
    picker.value = state.histSelectedRideId;
  }

  updateAttractionHints();
  renderWishlistGrid(parkId);
  loadHistDayData();
}

function updateAttractionHints() {
  const noticeEl = document.getElementById('attractionArchiveNotice');
  const dateHintEl = document.getElementById('dateRangeHint');
  const rideId = state.histSelectedRideId;

  const isArchived = (state.historyOverview?.attractions || []).some((a) => a.ride_id === rideId);
  const archivedAtt = (state.historyOverview?.attractions || []).find((a) => a.ride_id === rideId);

  if (noticeEl) {
    if (isArchived && archivedAtt) {
      noticeEl.innerHTML = `<span class="text-cyan">⭐ <strong>10-Year Research Archive:</strong> ${archivedAtt.total_observations.toLocaleString()} records from 2015 to 2021</span>`;
    } else {
      noticeEl.innerHTML = `<span class="text-gold">📡 <strong>Live Polling Only:</strong> No 2015–2021 TouringPlans CSV exists. Live data is recorded while server runs.</span>`;
    }
  }

  if (dateHintEl) {
    if (isArchived) {
      dateHintEl.textContent = '📅 Archive range: 2015-01-01 to 2021-12-31';
    } else {
      dateHintEl.textContent = '📅 Live data available: 2026-09-02 (Today)';
    }
  }
}

async function loadHistDayData() {
  const overlay = document.getElementById('dayChartOverlay');
  const emptyAlertEl = document.getElementById('dayEmptyAlert');
  if (overlay) overlay.classList.remove('hidden');

  updateAttractionHints();

  const rideId = state.histSelectedRideId;
  const dateStr = state.histSelectedDate;
  const currentRide = state.rides.find((r) => r.id === rideId) || { name: 'Attraction', park_name: 'Disney World' };
  const isArchived = (state.historyOverview?.attractions || []).some((a) => a.ride_id === rideId);

  try {
    const res = await fetch(`/api/history/rides/${rideId}/day?date=${encodeURIComponent(dateStr)}`);
    if (!res.ok) throw new Error('No historical data found for this date');
    const data = await res.json();

    if (!data.timeline || data.timeline.length === 0) {
      throw new Error('Timeline is empty');
    }

    // Hide empty alert
    if (emptyAlertEl) emptyAlertEl.classList.add('hidden');

    // 1. Context Banner
    document.getElementById('dayParkBadge').textContent = data.park_name;
    document.getElementById('dayRideTitle').textContent = data.ride_name;

    // Source & Tier Badges
    const sourceEl = document.getElementById('daySourceBadge');
    const tierEl = document.getElementById('dayTierBadge');
    if (sourceEl) {
      if (data.is_extrapolated) {
        sourceEl.className = 'badge badge-source extrapolated';
        sourceEl.textContent = `🔮 Modeled (${data.tier}-Ticket: ${Math.round((data.tier_ratio || 0.6) * 100)}% of ${data.anchor_ride_name || 'Anchor'})`;
      } else {
        sourceEl.className = 'badge badge-source';
        sourceEl.textContent = '⭐ 100% Ground-Truth Research Data';
      }
    }
    if (tierEl) {
      tierEl.textContent = `${data.tier}-Ticket (${data.tier_label || 'Attraction'})`;
    }

    // Date display
    const dParts = dateStr.split('-');
    const dateObj = new Date(parseInt(dParts[0]), parseInt(dParts[1]) - 1, parseInt(dParts[2]));
    const dateFormatted = dateObj.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    document.getElementById('dayDateDisplay').textContent = dateFormatted;
    document.getElementById('chartDayDateLabel').textContent = dateFormatted;

    // Actionable Strategy Card
    const strat = data.strategy || {};
    const sBestTime = document.getElementById('stratBestTime');
    const sBestWait = document.getElementById('stratBestWait');
    const sPeakWindow = document.getElementById('stratPeakWindow');
    const sPeakSavings = document.getElementById('stratPeakSavings');
    const sRealVsPosted = document.getElementById('stratRealVsPosted');
    const sLLAdvice = document.getElementById('stratLLAdvice');
    const sLLType = document.getElementById('stratLLType');

    if (sBestTime) sBestTime.textContent = strat.best_time_window || 'Morning Rope Drop';
    if (sBestWait) sBestWait.textContent = `Expected wait: ~${strat.best_time_expected_wait || '15 min'}`;
    if (sPeakWindow) sPeakWindow.textContent = strat.peak_window || 'Midday rush';
    if (sPeakSavings) sPeakSavings.textContent = `Saves ~${strat.time_savings_mins || 25}m if avoided`;
    if (sRealVsPosted) sRealVsPosted.textContent = strat.real_vs_posted || 'Actual wait is ~28% shorter than posted';
    if (sLLAdvice) sLLAdvice.textContent = strat.lightning_lane_recommendation || 'Multi Pass Eligible';
    if (sLLType) sLLType.textContent = strat.ll_type === 'single_pass' ? '⚡ Lightning Lane Single Pass' : '🎟️ Lightning Lane Multi Pass Eligible';

    // Metadata badges & pills
    const meta = data.metadata || {};
    const seasonEl = document.getElementById('daySeasonBadge');
    const holidayEl = document.getElementById('dayHolidayBadge');

    seasonEl.textContent = meta.season || 'STANDARD SEASON';
    if (meta.holiday && meta.holiday !== '0') {
      holidayEl.textContent = meta.holiday === '1' ? 'Holiday / Peak Event' : meta.holiday;
      holidayEl.style.display = 'inline-block';
    } else {
      holidayEl.style.display = 'none';
    }

    // Operating hours for this park
    let parkHours = 'Regular Hours';
    if (data.park_id === 6 && meta.mk_open) parkHours = `${meta.mk_open} – ${meta.mk_close}`;
    else if (data.park_id === 5 && meta.ep_open) parkHours = `${meta.ep_open} – ${meta.ep_close}`;
    else if (data.park_id === 7 && meta.hs_open) parkHours = `${meta.hs_open} – ${meta.hs_close}`;
    else if (data.park_id === 8 && meta.ak_open) parkHours = `${meta.ak_open} – ${meta.ak_close}`;
    document.getElementById('dayHoursVal').textContent = parkHours;

    // Weather & School
    if (meta.weather_high) {
      document.getElementById('dayWeatherVal').textContent = `${Math.round(meta.weather_high)}° / ${Math.round(meta.weather_low || 0)}°F`;
    } else {
      document.getElementById('dayWeatherVal').textContent = 'N/A';
    }

    if (meta.school_in_session_pct !== undefined && meta.school_in_session_pct !== null) {
      const pct = Math.round(meta.school_in_session_pct);
      document.getElementById('daySchoolVal').textContent = `${pct}% ${pct < 20 ? '(Holiday Break)' : ''}`;
    } else {
      document.getElementById('daySchoolVal').textContent = 'N/A';
    }

    // 2. Day KPIs
    const stats = data.day_stats || {};
    document.getElementById('dayAvgPostedVal').textContent = `${stats.avg_posted_wait || 0} min`;
    document.getElementById('dayAvgActualVal').textContent = stats.avg_actual_wait ? `${stats.avg_actual_wait} min` : 'N/A';
    document.getElementById('dayActualCountVal').textContent = `${stats.actual_timer_count || 0} timer observations`;

    document.getElementById('dayPeakWaitVal').textContent = `${stats.peak_wait || 0} min`;
    document.getElementById('dayPeakTimeVal').textContent = stats.peak_time ? `at ${stats.peak_time}` : '';

    document.getElementById('dayMinWaitVal').textContent = `${stats.min_wait || 0} min`;
    document.getElementById('dayMinTimeVal').textContent = stats.min_time ? `at ${stats.min_time}` : '';

    document.getElementById('dayPaddingVal').textContent = stats.disney_inflation_percent ? `+${stats.disney_inflation_percent}%` : '--';
    document.getElementById('dayTotalObsVal').textContent = `${stats.total_observations || 0}`;

    // 3. Render Chart
    renderDayCurveChart(data);

    // 4. Render Day Observations Table
    renderDayObsTable(data.timeline || [], data.all_time_hourly_baseline || {});

    // 5. Update Day-of-Week list for this attraction
    loadAttractionDowStats(rideId, data.ride_name);

    // 6. Update Multi-Ride Wishlist Planner Grid
    renderWishlistGrid(data.park_id);

  } catch (err) {
    console.warn(`No data found for ride ${rideId} on ${dateStr}:`, err);

    // Show prominent empty state card explaining why data is absent
    if (emptyAlertEl) {
      emptyAlertEl.classList.remove('hidden');

      // Pick a suggested archived attraction in the same park (or Seven Dwarfs)
      const parkArchived = (state.historyOverview?.attractions || []).filter((a) => a.park_id === state.histSelectedParkId);
      const suggestedRide = parkArchived.length > 0 ? parkArchived[0] : { ride_id: 129, ride_name: 'Seven Dwarfs Mine Train' };

      const dParts = dateStr.split('-');
      const dateFormatted = `${dateStr}`;

      emptyAlertEl.innerHTML = `
        <div class="empty-data-header">
          <span class="empty-data-icon">👻</span>
          <div>
            <h4 class="empty-data-title">No Historical Records Found for ${escapeHtml(currentRide.name)} on ${escapeHtml(dateFormatted)}</h4>
            <span class="text-muted" style="font-size:0.8rem;">Why is this date blank?</span>
          </div>
        </div>
        <div class="empty-data-desc">
          <p>
            <strong>1. TouringPlans Open Data Scope:</strong> The TouringPlans 10-year research dataset (2015–2021) only made public CSV files for <strong>14 crowd-calendar attractions</strong> (such as <em>Seven Dwarfs Mine Train</em>, <em>Pirates of the Caribbean</em>, and <em>Flight of Passage</em>). TouringPlans did not publish an open research CSV for <strong>${escapeHtml(currentRide.name)}</strong>.
          </p>
          <p>
            <strong>2. Recent Dates (Past Few Months):</strong> The Queue-Times API only serves <em>live snapshots</em> (it does not archive past months). Our server started live tracking today.
          </p>
        </div>
        <div class="empty-data-actions">
          <button class="btn btn-sm btn-primary" onclick="window.viewRideToday(${rideId})">📅 View ${escapeHtml(currentRide.name)} Today (Live Data)</button>
          <button class="btn btn-sm btn-outline" onclick="window.switchHistoricalRide(${suggestedRide.ride_id}, '2019-04-21')">⭐ View ${escapeHtml(suggestedRide.ride_name)} on Easter Sunday</button>
          <button class="btn btn-sm btn-outline" onclick="window.switchHistoricalRide(${suggestedRide.ride_id}, '2019-12-25')">🎄 View ${escapeHtml(suggestedRide.ride_name)} on Christmas</button>
        </div>
      `;
    }

    // Reset Day KPIs to blank
    document.getElementById('dayRideTitle').textContent = currentRide.name;
    document.getElementById('dayDateDisplay').textContent = dateStr;
    document.getElementById('dayAvgPostedVal').textContent = 'No Data';
    document.getElementById('dayAvgActualVal').textContent = 'No Data';
    document.getElementById('dayActualCountVal').textContent = '0 observations';
    document.getElementById('dayPeakWaitVal').textContent = '--';
    document.getElementById('dayPeakTimeVal').textContent = '';
    document.getElementById('dayMinWaitVal').textContent = '--';
    document.getElementById('dayMinTimeVal').textContent = '';
    document.getElementById('dayPaddingVal').textContent = '--';
    document.getElementById('dayTotalObsVal').textContent = '0';

    if (state.dayChart) {
      state.dayChart.destroy();
      state.dayChart = null;
    }

    document.getElementById('dayObsTableBody').innerHTML = `
      <tr><td colspan="5" class="empty-state">No records available for ${escapeHtml(currentRide.name)} on ${escapeHtml(dateStr)}. Choose today's date or select an attraction marked with ⭐ for 2015–2021 data.</td></tr>
    `;
  } finally {
    if (overlay) overlay.classList.add('hidden');
  }
}

// Global action helpers for empty alert buttons
window.viewRideToday = function(rideId) {
  state.histSelectedRideId = rideId;
  state.histSelectedDate = '2026-09-02';
  const picker = document.getElementById('histDayPicker');
  if (picker) picker.value = '2026-09-02';
  loadHistDayData();
};

window.switchHistoricalRide = function(rideId, targetDate) {
  state.histSelectedRideId = rideId;
  state.histSelectedDate = targetDate;
  const picker = document.getElementById('histAttractionPicker');
  if (picker) picker.value = rideId;
  const datePicker = document.getElementById('histDayPicker');
  if (datePicker) datePicker.value = targetDate;
  loadHistDayData();
};

function renderDayCurveChart(data) {
  const canvas = document.getElementById('dayWaitCurveChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  const timeline = data.timeline || [];
  const labels = timeline.map((p) => p.local_time);
  const postedData = timeline.map((p) => (p.is_open ? p.posted_wait : null));
  const actualData = timeline.map((p) => p.actual_wait);

  // Hourly baseline overlay aligned with local timestamps
  const baselineMap = data.all_time_hourly_baseline || {};
  const baselineData = timeline.map((p) => {
    const dt = p.local_datetime;
    if (!dt || !dt.includes(' ')) return null;
    const hour = parseInt(dt.split(' ')[1].split(':')[0], 10);
    return baselineMap[hour] || null;
  });

  if (state.dayChart) {
    state.dayChart.destroy();
  }

  const isExtrap = Boolean(data.is_extrapolated);
  const lineLabel = isExtrap
    ? `🔮 Modeled Wait Curve (${data.tier}-Ticket: ${Math.round((data.tier_ratio || 0.6) * 100)}% of Anchor)`
    : 'Official Posted Wait';
  const lineColor = isExtrap ? '#C084FC' : '#38BDF8';
  const bgColor = isExtrap ? 'rgba(192, 132, 252, 0.12)' : 'rgba(56, 189, 248, 0.12)';
  const borderDash = isExtrap ? [6, 4] : [];

  state.dayChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [
        {
          label: lineLabel,
          data: postedData,
          borderColor: lineColor,
          backgroundColor: bgColor,
          borderWidth: 2.5,
          borderDash: borderDash,
          pointBackgroundColor: lineColor,
          pointRadius: isExtrap ? 2.5 : 3.5,
          tension: 0.3,
          fill: false,
        },
        {
          label: 'Real Actual Wait (Timer)',
          data: actualData,
          borderColor: '#10B981',
          backgroundColor: '#10B981',
          borderWidth: 0,
          pointBackgroundColor: '#10B981',
          pointBorderColor: '#FFF',
          pointBorderWidth: 1.5,
          pointRadius: 6,
          pointHoverRadius: 8,
          showLine: false,
        },
        {
          label: 'All-Time Average Baseline',
          data: baselineData,
          borderColor: '#F59E0B',
          borderWidth: 2,
          borderDash: [5, 5],
          pointRadius: 0,
          fill: false,
          tension: 0.3,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
        intersect: false,
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(15, 23, 42, 0.95)',
          titleColor: '#F8FAFC',
          bodyColor: '#94A3B8',
          borderColor: 'rgba(255, 255, 255, 0.1)',
          borderWidth: 1,
          padding: 12,
          callbacks: {
            label: (ctx) => {
              if (ctx.parsed.y === null) return null;
              return `${ctx.dataset.label}: ${Math.round(ctx.parsed.y)} min`;
            },
          },
        },
      },
      scales: {
        x: {
          grid: { color: 'rgba(255, 255, 255, 0.05)' },
          ticks: {
            color: '#94A3B8',
            font: { size: 10 },
            maxRotation: 45,
            autoSkip: true,
            maxTicksLimit: 14,
          },
        },
        y: {
          min: 0,
          grid: { color: 'rgba(255, 255, 255, 0.05)' },
          ticks: {
            color: '#94A3B8',
            font: { size: 10 },
            callback: (val) => `${val}m`,
          },
        },
      },
    },
  });
}

function renderDayObsTable(timeline, baselineMap) {
  const tbody = document.getElementById('dayObsTableBody');
  const countEl = document.getElementById('dayObsTableCount');
  if (!tbody) return;

  tbody.innerHTML = '';
  if (countEl) countEl.textContent = timeline.length;

  if (timeline.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No observations recorded on this date.</td></tr>';
    return;
  }

  timeline.forEach((point) => {
    const tr = document.createElement('tr');

    const dt = point.local_datetime;
    const hour = dt && dt.includes(' ') ? parseInt(dt.split(' ')[1].split(':')[0], 10) : null;
    const baseWait = hour !== null ? baselineMap[hour] : null;

    let compBadge = '--';
    if (point.is_open && baseWait) {
      const diff = Math.round(point.posted_wait - baseWait);
      if (diff <= -10) {
        compBadge = `<span class="text-success">▼ ${Math.abs(diff)}m faster than usual</span>`;
      } else if (diff >= 15) {
        compBadge = `<span class="text-danger">▲ +${diff}m busier than usual</span>`;
      } else {
        compBadge = `<span class="text-gold">≈ Typical (${Math.round(baseWait)}m)</span>`;
      }
    }

    const actualStr = point.actual_wait !== null
      ? `<strong class="text-success">${point.actual_wait} min (Rider Timer)</strong>`
      : '<span class="text-muted">--</span>';

    const statusBadge = point.is_open
      ? '<span class="badge badge-success" style="font-size:0.75rem;">Operating</span>'
      : '<span class="stat-badge text-danger" style="font-size:0.75rem;">Closed / Down</span>';

    tr.innerHTML = `
      <td><strong>${escapeHtml(point.local_time)}</strong></td>
      <td><span class="text-cyan" style="font-weight:700;">${point.is_open ? `${point.posted_wait} min` : 'Closed'}</span></td>
      <td>${actualStr}</td>
      <td>${statusBadge}</td>
      <td>${compBadge}</td>
    `;

    tbody.appendChild(tr);
  });
}

async function loadAttractionDowStats(rideId, rideName) {
  const dowNameEl = document.getElementById('dowRideName');
  if (dowNameEl) dowNameEl.textContent = rideName;

  try {
    const res = await fetch(`/api/history/attractions/${rideId}`);
    if (!res.ok) return;
    const data = await res.json();
    renderDayOfWeekList(data.day_of_week_breakdown || []);
  } catch (err) {
    console.error('Error fetching dow stats:', err);
  }
}

function renderDayOfWeekList(dowList) {
  const container = document.getElementById('ddDowList');
  if (!container) return;
  container.innerHTML = '';

  const maxWait = Math.max(...dowList.map((d) => d.avg_wait || 0), 60);

  dowList.forEach((d) => {
    const isSunday = d.day_name === 'Sunday';
    const pct = Math.min(100, Math.round(((d.avg_wait || 0) / maxWait) * 100));

    const item = document.createElement('div');
    item.className = `dow-item ${isSunday ? 'sunday' : ''}`;
    item.innerHTML = `
      <span class="dow-name">${escapeHtml(d.day_name)} ${isSunday ? '✝️' : ''}</span>
      <div class="dow-bar-wrap">
        <div class="dow-bar-fill" style="width: ${pct}%;"></div>
      </div>
      <span class="dow-wait-val">${d.avg_wait ? `${Math.round(d.avg_wait)}m` : '--'}</span>
    `;

    container.appendChild(item);
  });
}

async function renderHistoricalCalendar() {
  const tbody = document.getElementById('calendarTableBody');
  const holidayOnly = document.getElementById('holidayOnlyCheckbox')?.checked ?? true;
  if (!tbody) return;

  try {
    const res = await fetch(`/api/history/calendar?limit=40&holiday_only=${holidayOnly}`);
    if (!res.ok) throw new Error('Failed to fetch calendar');
    const days = await res.json();

    tbody.innerHTML = '';
    if (days.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No calendar records found.</td></tr>';
      return;
    }

    days.forEach((d) => {
      const tr = document.createElement('tr');
      const tempStr = d.weather_high ? `${Math.round(d.weather_high)}° / ${Math.round(d.weather_low || 0)}°F` : '--';

      tr.innerHTML = `
        <td><strong>${escapeHtml(d.date)}</strong></td>
        <td><span class="text-gold" style="font-weight:600;">${escapeHtml(d.holiday || 'Standard Day')}</span></td>
        <td><span class="badge badge-success" style="font-size:0.75rem;">${escapeHtml(d.season || 'Regular')}</span></td>
        <td>${tempStr}</td>
        <td>${escapeHtml(d.mk_open || '--')} – ${escapeHtml(d.mk_close || '--')}</td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error('Error fetching calendar table:', err);
  }
}

/* =========================================================================
   Wishlist Planner & Lightning Lane Evaluator
   ========================================================================= */

function renderWishlistGrid(parkId) {
  const grid = document.getElementById('wishlistRidesGrid');
  if (!grid) return;
  grid.innerHTML = '';

  const parkRides = state.rides.filter((r) => r.park_id === parkId);
  if (!state.selectedWishlistRides) state.selectedWishlistRides = new Set();

  // If no rides selected in this park yet, auto-select the top 4
  const currentInPark = Array.from(state.selectedWishlistRides).filter((id) => parkRides.some((r) => r.id === id));
  if (currentInPark.length === 0 && parkRides.length > 0) {
    parkRides.slice(0, 4).forEach((r) => state.selectedWishlistRides.add(r.id));
  }

  parkRides.forEach((ride) => {
    const isChecked = state.selectedWishlistRides.has(ride.id);
    const item = document.createElement('div');
    item.className = `wishlist-ride-item ${isChecked ? 'selected' : ''}`;
    item.setAttribute('data-ride-id', ride.id);

    item.innerHTML = `
      <input type="checkbox" class="wishlist-ride-cb" ${isChecked ? 'checked' : ''}>
      <span class="wishlist-ride-name">${escapeHtml(ride.name)}</span>
    `;

    item.addEventListener('click', (e) => {
      if (e.target.type !== 'checkbox') {
        const cb = item.querySelector('.wishlist-ride-cb');
        cb.checked = !cb.checked;
      }
      const cb = item.querySelector('.wishlist-ride-cb');
      if (cb.checked) {
        state.selectedWishlistRides.add(ride.id);
        item.classList.add('selected');
      } else {
        state.selectedWishlistRides.delete(ride.id);
        item.classList.remove('selected');
      }
    });

    grid.appendChild(item);
  });
}

async function evaluateWishlist() {
  const rideIds = Array.from(state.selectedWishlistRides || []);
  if (rideIds.length === 0) {
    alert('Please check at least 1 attraction for your wishlist!');
    return;
  }

  const resultsCard = document.getElementById('wishlistResultsCard');
  const familySizeEl = document.getElementById('wishlistFamilySize');
  const familySize = familySizeEl ? parseInt(familySizeEl.value, 10) : 5;
  const parkId = state.histSelectedParkId;
  const dateStr = state.histSelectedDate;

  if (resultsCard) {
    resultsCard.classList.remove('hidden');
    resultsCard.innerHTML = `
      <div style="text-align:center; padding: 24px;">
        <div class="spinner"></div>
        <p style="margin-top:10px; color:var(--text-muted);">Evaluating your wishlist and running Lightning Lane ROI math...</p>
      </div>
    `;
  }

  try {
    const res = await fetch('/api/planner/wishlist-evaluation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        park_id: parkId,
        date: dateStr,
        ride_ids: rideIds,
        family_size: familySize,
      }),
    });
    if (!res.ok) throw new Error('Evaluation failed');
    const data = await res.json();
    renderWishlistResults(data);
  } catch (err) {
    if (resultsCard) {
      resultsCard.innerHTML = `<div class="empty-state">Failed to evaluate wishlist: ${escapeHtml(err.message)}</div>`;
    }
  }
}

function renderWishlistResults(data) {
  const resultsCard = document.getElementById('wishlistResultsCard');
  if (!resultsCard) return;

  const v = data.verdict || {};
  const statusClass = v.status || 'recommended';

  let badgeColor = 'var(--danger-400)';
  if (statusClass === 'skip') badgeColor = 'var(--emerald-400)';
  if (statusClass === 'optional_split') badgeColor = 'var(--cyan-400)';

  let ridesRowsHtml = (data.rides || []).map((r) => `
    <tr>
      <td><strong>${escapeHtml(r.ride_name)}</strong></td>
      <td><span class="badge badge-tier">${escapeHtml(r.tier)}-Ticket</span></td>
      <td><span class="text-gold" style="font-weight:700;">~${r.midday_wait_mins} min</span></td>
      <td><span class="text-danger" style="font-weight:700;">${r.peak_wait_mins} min</span></td>
      <td>${r.ll_type === 'single_pass' ? '<span class="text-gold">⚡ Single Pass</span>' : '<span class="text-cyan">🎟️ Multi Pass</span>'}</td>
    </tr>
  `).join('');

  resultsCard.innerHTML = `
    <!-- Verdict Banner -->
    <div class="verdict-banner ${statusClass}">
      <div class="verdict-badge" style="color: ${badgeColor};">${escapeHtml(v.badge || 'VERDICT')}</div>
      <h4 class="verdict-title">${escapeHtml(v.title || 'Lightning Lane Evaluation')}</h4>
      <p class="verdict-summary">${escapeHtml(v.summary || '')}</p>
    </div>

    <!-- Summary KPIs -->
    <div class="wishlist-kpis">
      <div class="kpi-card">
        <span class="kpi-label">Cumulative Standby Line Time</span>
        <span class="kpi-value text-danger">${data.total_standby_hours} Hours</span>
        <span class="kpi-sub">${data.total_standby_minutes} mins on concrete</span>
      </div>
      <div class="kpi-card">
        <span class="kpi-label">Time Saved with Lightning Lane</span>
        <span class="kpi-value text-success">${data.hours_saved_with_ll} Hours</span>
        <span class="kpi-sub">Reclaimed family time</span>
      </div>
      <div class="kpi-card">
        <span class="kpi-label">Estimated Family Cost</span>
        <span class="kpi-value text-gold">$${data.estimated_family_cost}</span>
        <span class="kpi-sub">For ${data.family_size} guests ($27/ea)</span>
      </div>
      <div class="kpi-card">
        <span class="kpi-label">Cost per Hour Saved</span>
        <span class="kpi-value text-cyan">$${data.cost_per_hour_saved}/hr</span>
        <span class="kpi-sub">ROI value metric</span>
      </div>
    </div>

    <!-- Breakdown Table -->
    <div class="table-responsive" style="margin-top:16px;">
      <table class="attractions-table">
        <thead>
          <tr>
            <th>Attraction</th>
            <th>Tier</th>
            <th>Midday Standby</th>
            <th>Peak Wait</th>
            <th>Lightning Lane Category</th>
          </tr>
        </thead>
        <tbody>
          ${ridesRowsHtml}
        </tbody>
      </table>
    </div>
  `;
}

/* ==========================================================================
   Least Busy Days of the Year Showcase
   ========================================================================== */
async function loadLeastBusyDays(parkId = 6) {
  const container = document.getElementById('leastBusyContainer');
  if (!container) return;

  container.innerHTML = `<div class="park-card-skeleton" style="height: 220px; border-radius: 16px;"></div>`;

  try {
    const res = await fetch(`/api/history/parks/${parkId}/least-busy-days`);
    if (!res.ok) throw new Error('Failed to fetch least busy days');
    const data = await res.json();
    renderLeastBusyDays(data);
  } catch (err) {
    console.error('Error loading least busy days:', err);
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">⚠️</div>
        <p>Could not load least busy days analysis for this park.</p>
      </div>
    `;
  }
}

function renderLeastBusyDays(data) {
  const container = document.getElementById('leastBusyContainer');
  if (!container || !data) return;

  const topLeast = data.top_least_busy_days || [];
  const sweetSpots = data.seasonal_sweet_spots || [];
  const dowRankings = data.day_of_week_rankings || [];
  const attractionComps = data.attraction_comparisons || [];

  const lowestAvgWait = topLeast.length > 0 ? `${topLeast[0].avg_wait} min` : '20 min';

  // Build top 10 least busy days table
  const leastDaysRowsHtml = topLeast.map((d, idx) => `
    <tr>
      <td><strong>#${idx + 1}</strong></td>
      <td><strong>${escapeHtml(d.formatted_date)}</strong></td>
      <td><span class="text-gold" style="font-weight:700;">${d.avg_wait} min</span></td>
      <td><span class="text-danger">${d.peak_wait} min</span></td>
      <td><span class="crowd-badge ${d.crowd_level.level}">${d.crowd_level.badge_text}</span></td>
      <td><span class="muted-label">${escapeHtml(d.holiday)}</span></td>
      <td>${d.weather_high}°F</td>
    </tr>
  `).join('');

  // Build DOW rankings list
  const dowRowsHtml = dowRankings.map((dow, idx) => `
    <div style="display:flex; justify-content:space-between; align-items:center; padding:10px 14px; background:rgba(0,0,0,0.25); border-radius:8px; margin-bottom:6px; border:1px solid var(--border-subtle);">
      <div style="display:flex; align-items:center; gap:8px;">
        <span style="font-weight:700; color:${idx === 0 ? '#10b981' : (idx === dowRankings.length - 1 ? '#ef4444' : 'var(--text-secondary)')};">#${idx + 1}</span>
        <strong>${dow.day_name}</strong>
      </div>
      <div style="display:flex; align-items:center; gap:12px;">
        <span class="crowd-badge ${dow.crowd_level.level}">${dow.crowd_level.badge_text}</span>
        <span style="font-weight:700; color:var(--gold-400); min-width:60px; text-align:right;">${dow.avg_wait} min</span>
      </div>
    </div>
  `).join('');

  // Build sweet spot cards
  const sweetSpotsHtml = sweetSpots.map((ss) => `
    <div class="sweet-spot-card">
      <div class="sweet-spot-header">
        <h5 class="sweet-spot-title">${escapeHtml(ss.title)}</h5>
        <span class="crowd-badge" style="background:${ss.crowd_color}25; color:${ss.crowd_color}; border:1px solid ${ss.crowd_color}50;">
          ${escapeHtml(ss.crowd_badge)}
        </span>
      </div>
      <div class="sweet-spot-window">📅 ${escapeHtml(ss.window)} • Avg: ${escapeHtml(ss.avg_wait_range)}</div>
      <p class="sweet-spot-highlight">${escapeHtml(ss.highlight)}</p>
    </div>
  `).join('');

  // Build attraction savings table
  const attCompRowsHtml = attractionComps.map((ac) => `
    <tr>
      <td><strong>${escapeHtml(ac.ride_name)}</strong></td>
      <td><span class="text-success" style="font-weight:700;">${ac.least_busy_wait} min</span></td>
      <td><span class="text-danger" style="font-weight:700;">${ac.peak_day_wait} min</span></td>
      <td><span class="badge badge-success">Save ~${ac.minutes_saved_standby} min</span></td>
    </tr>
  `).join('');

  container.innerHTML = `
    <!-- Top KPIs -->
    <div class="least-busy-kpi-row">
      <div class="least-busy-kpi-card">
        <span class="least-busy-kpi-label">Lowest Historical Avg</span>
        <span class="least-busy-kpi-val text-success">${lowestAvgWait}</span>
        <span class="least-busy-kpi-sub">Across all attractions on best day</span>
      </div>
      <div class="least-busy-kpi-card">
        <span class="least-busy-kpi-label">Best Day to Visit</span>
        <span class="least-busy-kpi-val text-cyan">${escapeHtml(data.best_day_of_week)}</span>
        <span class="least-busy-kpi-sub">Lowest weekly average queues</span>
      </div>
      <div class="least-busy-kpi-card">
        <span class="least-busy-kpi-label">Busiest Day to Avoid</span>
        <span class="least-busy-kpi-val text-danger">${escapeHtml(data.busiest_day_of_week)}</span>
        <span class="least-busy-kpi-sub">Highest weekend crowd density</span>
      </div>
      <div class="least-busy-kpi-card">
        <span class="least-busy-kpi-label">Historical Calendar Base</span>
        <span class="least-busy-kpi-val text-gold">${data.total_dates_analyzed} Days</span>
        <span class="least-busy-kpi-sub">${escapeHtml(data.park_name)} (${escapeHtml(data.resort)})</span>
      </div>
    </div>

    <!-- Seasonal Sweet Spots -->
    <div style="margin-top:10px;">
      <div class="box-title-row" style="margin-bottom:12px;">
        <h4 style="font-size:1.05rem; font-weight:700; color:var(--text-primary);">🎯 Top 4 Annual Travel Sweet Spots for ${escapeHtml(data.park_name)}</h4>
        <span class="chart-tag text-cyan">Optimal Booking Windows</span>
      </div>
      <div class="sweet-spots-grid">
        ${sweetSpotsHtml}
      </div>
    </div>

    <!-- Tables Row: Top 10 Days + DOW Rankings -->
    <div class="least-busy-tables-row" style="margin-top:14px;">
      <!-- Top 10 Least Busy Days Table -->
      <div class="deepdive-chart-box" style="padding:20px;">
        <div class="box-title-row">
          <h4>⭐ Top 10 Least Busy Days of the Year</h4>
          <span class="chart-tag text-gold">Lowest Queue Records</span>
        </div>
        <p class="box-desc" style="margin-bottom:12px;">Ranked historical dates with the shortest standby lines across ${escapeHtml(data.park_name)}.</p>
        <div class="table-responsive" style="max-height:360px; overflow-y:auto;">
          <table class="attractions-table" style="font-size:0.82rem;">
            <thead>
              <tr>
                <th>Rank</th>
                <th>Date</th>
                <th>Avg Wait</th>
                <th>Peak Wait</th>
                <th>Crowd Level</th>
                <th>Context</th>
                <th>Weather</th>
              </tr>
            </thead>
            <tbody>
              ${leastDaysRowsHtml}
            </tbody>
          </table>
        </div>
      </div>

      <!-- Day of Week Rankings -->
      <div class="deepdive-dow-box" style="padding:20px;">
        <div class="box-title-row">
          <h4>Day of Week Crowd Ranking</h4>
          <span class="chart-tag text-cyan">Weekly Profile</span>
        </div>
        <p class="box-desc" style="margin-bottom:12px;">Ranked from least busy (#1) to heaviest queues (#7).</p>
        <div style="display:flex; flex-direction:column; gap:4px; max-height:360px; overflow-y:auto;">
          ${dowRowsHtml}
        </div>
      </div>
    </div>

    <!-- Attraction Savings Callout Table -->
    <div class="deepdive-chart-box" style="padding:20px; margin-top:4px;">
      <div class="box-title-row">
        <h4>⚡ Standby Time Saved on Least Busy vs. Peak Holiday Days</h4>
        <span class="chart-tag text-success">Queue Reclaimed</span>
      </div>
      <div class="table-responsive">
        <table class="attractions-table" style="font-size:0.84rem;">
          <thead>
            <tr>
              <th>Attraction</th>
              <th>Least Busy Day Standby</th>
              <th>Peak Holiday Standby</th>
              <th>Time Saved per Ride</th>
            </tr>
          </thead>
          <tbody>
            ${attCompRowsHtml}
          </tbody>
        </table>
      </div>
    </div>
  `;
}


