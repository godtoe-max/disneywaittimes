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
  activeTab: 'tab-recommendations',
  parkFilter: 'all',
  recParkFilter: 'all',
  recCategoryFilter: 'all',
  rideTypeFilter: 'rides', // 'rides' (159 real rides) or 'all' (197 total exhibits/shows)
  viewMode: 'cards', // 'cards' or 'table'
  searchQuery: '',
  openOnly: false,
  sortColumn: 'wait',
  sortAsc: false,
  chart: null,
  dayChart: null,
  pollSecondsRemaining: 300,
  isSyncing: false,
  rideCurvesCache: null,
  alerts: [],
  currentAlertRideId: null,
  userCoords: null,
  selectedRestParkId: 6,
};

// Patterns for walkthroughs, static exhibits, play areas, and continuous non-rides
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

// Park display metadata
const PARK_META = {
  6: {
    name: 'Magic Kingdom',
    resort: 'Walt Disney World',
    tag: 'Fantasyland, Tomorrowland & More',
    icon: '🏰',
    accentStart: '#3b82f6',
    accentEnd: '#fbbf24',
  },
  5: {
    name: 'EPCOT',
    resort: 'Walt Disney World',
    tag: 'World Discovery, Showcase & Nature',
    icon: '🌐',
    accentStart: '#8b5cf6',
    accentEnd: '#06b6d4',
  },
  7: {
    name: "Disney's Hollywood Studios",
    resort: 'Walt Disney World',
    tag: 'Star Wars, Toy Story & Sunset Blvd',
    icon: '🎬',
    accentStart: '#f97316',
    accentEnd: '#ec4899',
  },
  8: {
    name: "Disney's Animal Kingdom",
    resort: 'Walt Disney World',
    tag: 'Pandora, Africa & Asia',
    icon: '🌳',
    accentStart: '#059669',
    accentEnd: '#34d399',
  },
  16: {
    name: 'Disneyland Park',
    resort: 'Disneyland Resort',
    tag: "Main Street, Galaxy's Edge & Fantasyland",
    icon: '✨',
    accentStart: '#ec4899',
    accentEnd: '#c084fc',
  },
  17: {
    name: 'Disney California Adventure',
    resort: 'Disneyland Resort',
    tag: 'Cars Land, Avengers Campus & Pixar Pier',
    icon: '🎡',
    accentStart: '#0ea5e9',
    accentEnd: '#fb923c',
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
  initServiceWorker();
  loadAlertsFromStorage();
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

  // Desktop Tab switching
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetTab = btn.getAttribute('data-tab');
      switchTab(targetTab);
    });
  });

  // Mobile Bottom Navigation Tab switching
  document.querySelectorAll('.bottom-nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetTab = btn.getAttribute('data-tab');
      switchTab(targetTab);
    });
  });

  // Recommendations: Park Filter Chips
  document.querySelectorAll('#recParkChips .rec-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('#recParkChips .rec-chip').forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      state.recParkFilter = chip.getAttribute('data-park');
      renderRecommendations();
    });
  });

  // Recommendations: Category Strategy Chips
  document.querySelectorAll('#recCategoryChips .category-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('#recCategoryChips .category-chip').forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      state.recCategoryFilter = chip.getAttribute('data-category');
      renderRecommendations();
    });
  });

  // Attraction View Mode Toggle (Cards vs Table)
  const viewCardsBtn = document.getElementById('viewCardsBtn');
  const viewTableBtn = document.getElementById('viewTableBtn');
  if (viewCardsBtn && viewTableBtn) {
    viewCardsBtn.addEventListener('click', () => {
      state.viewMode = 'cards';
      viewCardsBtn.classList.add('active');
      viewTableBtn.classList.remove('active');
      document.getElementById('attractionsCardsGrid').classList.remove('hidden');
      document.getElementById('attractionsTableContainer').classList.add('hidden');
    });
    viewTableBtn.addEventListener('click', () => {
      state.viewMode = 'table';
      viewTableBtn.classList.add('active');
      viewCardsBtn.classList.remove('active');
      document.getElementById('attractionsCardsGrid').classList.add('hidden');
      document.getElementById('attractionsTableContainer').classList.remove('hidden');
    });
  }

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
      renderRecommendations();
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

  // Ride type filter (Rides Only vs All Exhibits)
  document.querySelectorAll('.ride-type-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.ride-type-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      state.rideTypeFilter = btn.getAttribute('data-ride-type');
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

  // Wait Time Alerts: Header button opens Settings Tab directly
  const alertsDrawerBtn = document.getElementById('alertsDrawerBtn');
  if (alertsDrawerBtn) {
    alertsDrawerBtn.addEventListener('click', () => {
      switchTab('tab-settings');
    });
  }

  const closeAlertModalBtn = document.getElementById('closeAlertModalBtn');
  if (closeAlertModalBtn) closeAlertModalBtn.addEventListener('click', closeSetAlertModal);

  const cancelAlertBtn = document.getElementById('cancelAlertBtn');
  if (cancelAlertBtn) cancelAlertBtn.addEventListener('click', closeSetAlertModal);

  const saveAlertBtn = document.getElementById('saveAlertBtn');
  if (saveAlertBtn) saveAlertBtn.addEventListener('click', saveCurrentAlert);

  const closeActiveAlertsBtn = document.getElementById('closeActiveAlertsBtn');
  if (closeActiveAlertsBtn) closeActiveAlertsBtn.addEventListener('click', closeActiveAlertsModal);

  const closeActiveAlertsFooterBtn = document.getElementById('closeActiveAlertsFooterBtn');
  if (closeActiveAlertsFooterBtn) closeActiveAlertsFooterBtn.addEventListener('click', closeActiveAlertsModal);

  const testNotificationBtn = document.getElementById('testNotificationBtn');
  if (testNotificationBtn) testNotificationBtn.addEventListener('click', testNotification);

  // Modal Threshold slider live display update
  const thresholdSlider = document.getElementById('thresholdSlider');
  const thresholdDisplay = document.getElementById('thresholdDisplay');
  if (thresholdSlider) {
    thresholdSlider.addEventListener('input', (e) => {
      const val = parseInt(e.target.value, 10);
      if (thresholdDisplay) thresholdDisplay.textContent = `${val} mins`;
      document.querySelectorAll('.preset-threshold-chip').forEach((chip) => {
        const cVal = parseInt(chip.getAttribute('data-threshold'), 10);
        chip.classList.toggle('active', cVal === val);
      });
    });
  }

  // Modal Preset threshold chips
  document.querySelectorAll('#alertModal .preset-threshold-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('#alertModal .preset-threshold-chip').forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      const val = parseInt(chip.getAttribute('data-threshold'), 10);
      if (thresholdSlider) thresholdSlider.value = val;
      if (thresholdDisplay) thresholdDisplay.textContent = `${val} mins`;
    });
  });

  // Settings Tab: Controls & Event Handlers
  initSettingsTabListeners();

  // Shaded Rest & Oasis Finder modal triggers
  const needRestBtn = document.getElementById('needRestBtn');
  if (needRestBtn) {
    needRestBtn.addEventListener('click', () => {
      openRestFinderModal(state.parkFilter !== 'all' ? parseInt(state.parkFilter, 10) : (state.selectedRestParkId || 6));
    });
  }

  const closeRestModalBtn = document.getElementById('closeRestModalBtn');
  if (closeRestModalBtn) closeRestModalBtn.addEventListener('click', closeRestFinderModal);

  const closeRestModalFooterBtn = document.getElementById('closeRestModalFooterBtn');
  if (closeRestModalFooterBtn) closeRestModalFooterBtn.addEventListener('click', closeRestFinderModal);

  const gpsLocationTriggerBtn = document.getElementById('gpsLocationTriggerBtn');
  if (gpsLocationTriggerBtn) {
    gpsLocationTriggerBtn.addEventListener('click', () => {
      acquireGpsLocation(true);
    });
  }

  document.querySelectorAll('#restParkChips .rec-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('#restParkChips .rec-chip').forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      const parkId = parseInt(chip.getAttribute('data-park'), 10);
      state.selectedRestParkId = parkId;
      renderRestSpots(parkId, state.userCoords);
    });
  });

  // Close modals on background overlay click
  document.querySelectorAll('.modal-overlay').forEach((overlay) => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.classList.add('hidden');
      }
    });
  });
}

function switchTab(tabId) {
  state.activeTab = tabId;

  // Desktop buttons
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.getAttribute('data-tab') === tabId);
  });

  // Mobile bottom nav buttons
  document.querySelectorAll('.bottom-nav-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.getAttribute('data-tab') === tabId);
  });

  // Panes
  document.querySelectorAll('.tab-pane').forEach((pane) => {
    pane.classList.toggle('active', pane.id === tabId);
  });

  if (tabId === 'tab-trends' && state.chart) {
    setTimeout(() => state.chart.resize(), 100);
  }
  if (tabId === 'tab-history' && state.dayChart) {
    setTimeout(() => state.dayChart.resize(), 100);
  }
  if (tabId === 'tab-recommendations') {
    renderRecommendations();
  }
  if (tabId === 'tab-settings') {
    renderSettingsTab();
  }
}

/* ==========================================================================
   Data Fetching
   ========================================================================== */
async function fetchAllData(isBackground = false) {
  try {
    let parks = null, rides = null, downtimes = null, hist = null;

    // First try relative /api/ endpoints (FastAPI or Netlify Functions)
    try {
      const [parksRes, ridesRes, downtimesRes, histRes] = await Promise.all([
        fetch('/api/parks'),
        fetch('/api/rides'),
        fetch('/api/downtimes'),
        fetch('/api/history/overview'),
      ]);

      if (parksRes.ok && ridesRes.ok) {
        parks = await parksRes.json();
        rides = await ridesRes.json();
        downtimes = await downtimesRes.json();
        hist = await histRes.json();
      }
    } catch (apiErr) {
      console.warn('Backend API endpoint unavailable, falling back to client-side data & direct API:', apiErr);
    }

    // Fallback: If API returned 404/error, load from static JSON and fetch Queue-Times directly
    if (!parks || parks.length === 0) {
      try {
        const histRes = await fetch('data/history_overview.json').catch(() => null);
        if (histRes && histRes.ok) {
          hist = await histRes.json();
        }
      } catch (e) {}

      const parkDefs = [
        { id: 6, name: 'Magic Kingdom', resort: 'Walt Disney World', timezone: 'America/New_York', baseline: 45.0 },
        { id: 5, name: 'EPCOT', resort: 'Walt Disney World', timezone: 'America/New_York', baseline: 40.0 },
        { id: 7, name: "Disney's Hollywood Studios", resort: 'Walt Disney World', timezone: 'America/New_York', baseline: 48.0 },
        { id: 8, name: "Disney's Animal Kingdom", resort: 'Walt Disney World', timezone: 'America/New_York', baseline: 40.0 },
        { id: 16, name: 'Disneyland Park', resort: 'Disneyland Resort', timezone: 'America/Los_Angeles', baseline: 45.0 },
        { id: 17, name: 'Disney California Adventure', resort: 'Disneyland Resort', timezone: 'America/Los_Angeles', baseline: 48.0 },
      ];

      parks = [];
      rides = [];
      downtimes = [];

      for (const p of parkDefs) {
        try {
          const qRes = await fetch(`https://queue-times.com/parks/${p.id}/queue_times.json`);
          if (!qRes.ok) continue;
          const qData = await qRes.json();
          let parkTotal = 0, parkOpen = 0, parkDown = 0, totalWait = 0, maxWait = 0, topRide = 'None';
          let parkTotalReal = 0, parkOpenReal = 0, totalWaitReal = 0;
          const allParkRides = [];

          (qData.lands || []).forEach((l) => {
            (l.rides || []).forEach((r) => allParkRides.push({ ...r, land_name: l.name }));
          });
          (qData.rides || []).forEach((r) => allParkRides.push({ ...r, land_name: 'General' }));

          allParkRides.forEach((r) => {
            parkTotal++;
            const isOpen = Boolean(r.is_open);
            const isRide = isQueueRide(r.name);
            const waitTime = isOpen ? (r.wait_time || 0) : 0;

            if (isRide) {
              parkTotalReal++;
              if (isOpen) {
                parkOpenReal++;
                totalWaitReal += waitTime;
              }
            }

            if (isOpen) {
              parkOpen++;
              totalWait += waitTime;
              if (waitTime > maxWait) {
                maxWait = waitTime;
                topRide = r.name;
              }
            } else {
              parkDown++;
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
            rides.push({
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
          });

          // Calculate average wait strictly across open real rides
          const avgWait = parkOpenReal > 0 ? Math.round((totalWaitReal / parkOpenReal) * 10) / 10 : 0;
          let crowdLevel = { level: 'normal', tier: 'NORMAL', badge_text: '🟡 Normal (Typical)' };
          if (avgWait < 25) crowdLevel = { level: 'empty', tier: 'EMPTY', badge_text: '🟢 Empty (Walk-on)' };
          else if (avgWait < 39) crowdLevel = { level: 'light', tier: 'LIGHT', badge_text: '🔵 Light (Below Normal)' };
          else if (avgWait >= 52) crowdLevel = { level: 'busy', tier: 'BUSY', badge_text: '🔴 Busy (Heavy Queues)' };

          parks.push({
            id: p.id,
            name: p.name,
            resort: p.resort,
            timezone: p.timezone,
            total_rides: parkTotalReal,
            open_rides: parkOpenReal,
            down_rides: parkDown,
            avg_wait_time: avgWait,
            max_wait_time: maxWait,
            top_ride_name: topRide,
            crowd_level: crowdLevel,
            last_updated: new Date().toISOString(),
          });
        } catch (err) {
          console.warn(`Direct fetch failed for park ${p.id}:`, err);
        }
      }
    }

    state.parks = parks || [];
    state.rides = rides || [];
    state.downtimes = downtimes || [];
    state.historyOverview = hist || {};

    renderResortBanner();
    renderParksGrid();
    renderAttractionsDropdown();
    renderQuickChips();
    renderAttractionsTable();
    renderDowntimes();
    renderHistoryArchive();
    renderHistoricalCalendar();
    loadAndCalculateRecommendations();
    loadLeastBusyDays(state.histSelectedParkId || 6);

    // Default select Seven Dwarfs Mine Train (109,294 historical records)
    if (!state.selectedRideId && state.rides.length > 0) {
      const mineTrain = state.rides.find((r) => r.id === 129);
      const defaultRide = mineTrain || state.rides[0];
      selectRideForChart(defaultRide.id);
    } else if (state.selectedRideId) {
      loadRideChartData(state.selectedRideId);
    }

    // Evaluate wait time threshold alerts against fresh live data
    evaluateAlerts();
  } catch (err) {
    console.error('Error fetching dashboard data:', err);
  }
}

/* ==========================================================================
   Smart Ride Recommendations ("Park Genie")
   ========================================================================== */
async function loadAndCalculateRecommendations() {
  if (!state.rideCurvesCache) {
    try {
      const res = await fetch('data/ride_curves.json');
      if (res.ok) {
        state.rideCurvesCache = await res.json();
      }
    } catch (e) {
      console.warn('Could not load ride curves cache:', e);
    }
  }

  renderRecommendations();
}

function formatHourDisplay(h) {
  const period = h < 12 ? 'AM' : 'PM';
  const displayH = h <= 12 ? h : h - 12;
  return `${displayH === 0 ? 12 : displayH} ${period}`;
}

function renderRecommendations() {
  const container = document.getElementById('recommendationsGrid');
  const summaryCountEl = document.getElementById('recSummaryCount');
  if (!container) return;

  const nowUtc = new Date();
  const currentHourUtc = nowUtc.getUTCHours();

  const isResortFiltered = state.selectedResort !== 'all';
  const targetParkIds = new Set(
    state.parks
      .filter((p) => !isResortFiltered || p.resort === state.selectedResort)
      .map((p) => p.id)
  );

  const filteredRides = state.rides.filter((r) => {
    if (r.is_ride === false || !isQueueRide(r.name)) return false; // Exclude non-rides / exhibits
    if (isResortFiltered && !targetParkIds.has(r.park_id)) return false;
    if (state.recParkFilter !== 'all' && String(r.park_id) !== state.recParkFilter) return false;
    return true;
  });

  const recommendations = [];

  filteredRides.forEach((ride) => {
    if (!ride.is_open) return; // Only recommend currently operating rides
    const wait = ride.wait_time;
    const parkOffset = (ride.park_id === 16 || ride.park_id === 17) ? -7 : -4;
    const localHour = (currentHourUtc + parkOffset + 24) % 24;

    let histAvg = null;
    let nextAvg = null;

    if (state.rideCurvesCache && state.rideCurvesCache[String(ride.id)]) {
      const histData = state.rideCurvesCache[String(ride.id)];
      const hourlyList = histData.hourly_averages || histData.curve || [];
      const match = hourlyList.find((h) => (h.hour === localHour || h.local_hour === localHour));
      if (match) histAvg = match.avg_wait_time || match.average_wait;

      const nextMatch = hourlyList.find((h) => (h.hour === (localHour + 2) % 24 || h.local_hour === (localHour + 2) % 24));
      if (nextMatch) nextAvg = nextMatch.avg_wait_time || nextMatch.average_wait;
    }

    const isFlagship = FLAGSHIP_KEYWORDS.some((kw) => ride.name.toLowerCase().includes(kw.toLowerCase()));

    // 1. Bargain Deals: Wait time is at least 10 mins lower than typical historical average
    if (histAvg !== null && histAvg >= 25 && (histAvg - wait) >= 10) {
      const diff = Math.round(histAvg - wait);
      recommendations.push({
        ride,
        type: 'bargain',
        badgeClass: 'pill-bargain',
        badgeText: `🔥 Save ~${diff}m vs. ${formatHourDisplay(localHour)} Avg!`,
        score: diff * 2.5 + (isFlagship ? 20 : 0),
        explanation: `Historical average right now is ${Math.round(histAvg)} mins. Standby line is moving significantly faster than normal!`,
        diffMins: diff,
        histAvg: Math.round(histAvg),
      });
    }

    // 2. Walk-On Gems: Quality attractions with <= 15m wait
    if (wait <= 15) {
      recommendations.push({
        ride,
        type: 'walkon',
        badgeClass: 'pill-walkon',
        badgeText: wait <= 5 ? '🚀 Instant Walk-On!' : '⚡ Fast Line (&le;15m)',
        score: 35 - wait + (isFlagship ? 25 : 0),
        explanation: `Almost zero queue time! Perfect opportunity to ride with near-instant dispatch.`,
        diffMins: 0,
        histAvg: histAvg ? Math.round(histAvg) : 20,
      });
    }

    // 3. Surge Warnings: Wait time is about to double in the next 1-2 hours
    if (nextAvg !== null && wait < 35 && (nextAvg - wait) >= 15) {
      const jump = Math.round(nextAvg - wait);
      recommendations.push({
        ride,
        type: 'surge',
        badgeClass: 'pill-surge',
        badgeText: `⏳ Ride Now Before Surge (+${jump}m)!`,
        score: jump * 1.8 + (isFlagship ? 15 : 0),
        explanation: `Historical curves show queues surge to ~${Math.round(nextAvg)} mins in the next 1–2 hours. Ride now to beat the rush!`,
        diffMins: jump,
        histAvg: Math.round(nextAvg),
      });
    }

    // 4. Headliner Sweet Spots: Major Flagship rides with below-normal wait
    if (isFlagship && wait < 45) {
      recommendations.push({
        ride,
        type: 'headliner',
        badgeClass: 'pill-headliner',
        badgeText: `👑 E-Ticket Sweet Spot`,
        score: 45 + (50 - wait),
        explanation: `Flagship headliner having a rare low standby window. High priority target for your park itinerary!`,
        diffMins: histAvg ? Math.round(histAvg - wait) : 10,
        histAvg: histAvg ? Math.round(histAvg) : 55,
      });
    }
  });

  // Filter by category
  let finalRecs = recommendations;
  if (state.recCategoryFilter !== 'all') {
    finalRecs = finalRecs.filter((r) => r.type === state.recCategoryFilter);
  }

  // Deduplicate by ride ID, picking highest score recommendation
  const deduped = new Map();
  finalRecs.forEach((r) => {
    if (!deduped.has(r.ride.id) || deduped.get(r.ride.id).score < r.score) {
      deduped.set(r.ride.id, r);
    }
  });

  const sortedRecs = Array.from(deduped.values()).sort((a, b) => b.score - a.score);

  if (summaryCountEl) {
    summaryCountEl.textContent = `${sortedRecs.length} Magical Opportunities Live`;
  }

  if (sortedRecs.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1; padding: 40px 20px; text-align: center;">
        <div class="empty-state-icon" style="font-size: 2.5rem; margin-bottom: 10px;">🏰</div>
        <h4 style="font-size: 1.1rem; color: var(--text-primary); margin-bottom: 6px;">All Queues Standard</h4>
        <p style="font-size: 0.85rem; color: var(--text-muted); max-width: 400px; margin: 0 auto;">No major bargains or surges right now. Browse the Attractions directory or choose another park filter above!</p>
      </div>
    `;
    return;
  }

  container.innerHTML = sortedRecs.map((rec) => `
    <div class="rec-card" data-ride-id="${rec.ride.id}">
      <div class="rec-card-top">
        <div class="rec-ride-info">
          <span class="rec-ride-title">${escapeHtml(rec.ride.name)}</span>
          <span class="rec-ride-park">🏰 ${escapeHtml(rec.ride.park_name)} • ${escapeHtml(rec.ride.land_name || 'General')}</span>
        </div>
        <div class="rec-wait-badge-box">
          <span class="rec-wait-num">${rec.ride.wait_time}</span>
          <span class="rec-wait-unit">mins</span>
        </div>
      </div>

      <div class="rec-pill-row">
        <span class="rec-strategy-pill ${rec.badgeClass}">${rec.badgeText}</span>
      </div>

      <p class="rec-explanation">${escapeHtml(rec.explanation)}</p>

      <div class="rec-actions-row">
        <span class="rec-delta-stat text-cyan">⚡ Standby: ${rec.ride.wait_time}m (vs ~${rec.histAvg}m)</span>
        <div style="display:flex; gap:8px; align-items:center;">
          <button class="btn-bell-mini" onclick="window.openSetAlertModal(${rec.ride.id})" title="Set wait time drop alert">🔔 Alert</button>
          <button class="rec-curve-btn" onclick="window.openRideInTrends(${rec.ride.id})">📈 View Curve</button>
        </div>
      </div>
    </div>
  `).join('');
}

window.openRideInTrends = function (rideId) {
  selectRideForChart(rideId);
  switchTab('tab-trends');
};

async function triggerManualSync() {
  if (state.isSyncing) return;
  state.isSyncing = true;

  const syncBtn = document.getElementById('syncNowBtn');
  const syncBtnText = document.getElementById('syncBtnText');
  syncBtn.classList.add('syncing');
  syncBtnText.textContent = 'Syncing...';

  try {
    await fetch('/api/sync', { method: 'POST' }).catch(() => null);
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

  const realRides = relevantRides.filter((r) => r.is_ride !== false && isQueueRide(r.name));
  const totalRides = realRides.length;
  const openRides = realRides.filter((r) => r.is_open).length;
  const downRides = relevantDowntimes.length;

  const openWaits = realRides.filter((r) => r.is_open).map((r) => r.wait_time);
  const avgWait = openWaits.length > 0
    ? Math.round(openWaits.reduce((a, b) => a + b, 0) / openWaits.length)
    : 0;

  document.getElementById('totalRidesVal').textContent = totalRides;
  document.getElementById('openRidesVal').textContent = openRides;
  document.getElementById('downRidesVal').textContent = downRides;
  document.getElementById('resortAvgWaitVal').textContent = `${avgWait} min`;
  document.getElementById('allRidesCount').textContent = totalRides;
  document.getElementById('downtimesCountBadge').textContent = downRides;

  const realCountBadge = document.getElementById('realRidesCountBadge');
  const allCountBadge = document.getElementById('allAttractionsCountBadge');
  if (realCountBadge) realCountBadge.textContent = realRides.length;
  if (allCountBadge) allCountBadge.textContent = relevantRides.length;

  // Calculate live crowd level on real rides
  let crowdClass = 'normal';
  let crowdText = '🟡 Normal (Typical)';
  if (avgWait < 25) {
    crowdClass = 'empty';
    crowdText = '🟢 Empty (Walk-on)';
  } else if (avgWait < 39) {
    crowdClass = 'light';
    crowdText = '🔵 Light (Below Normal)';
  } else if (avgWait < 52) {
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
    let data = null;
    try {
      const res = await fetch(`/api/rides/${rideId}/history`);
      if (res.ok) data = await res.json();
    } catch (e) {}

    if (!data) {
      try {
        const staticRes = await fetch('data/ride_curves.json');
        if (staticRes.ok) {
          const curvesMap = await staticRes.json();
          data = curvesMap[String(rideId)];
        }
      } catch (e) {}
    }

    if (data) {
      // If current_wait is missing from static curve, match with live state.rides
      if (data.current_wait === undefined) {
        const liveRide = state.rides.find(r => r.id === Number(rideId));
        data.current_wait = liveRide ? liveRide.wait_time : 0;
        data.is_open = liveRide ? liveRide.is_open : true;
      }
      updateChartStatsStrip(data);
      renderWaitCurveChart(data);
    }
  } catch (err) {
    console.error('Error loading ride chart data:', err);
  } finally {
    overlay.classList.add('hidden');
  }
}

function updateChartStatsStrip(data) {
  document.getElementById('statRideName').textContent = data.ride_name;
  document.getElementById('statRidePark').innerHTML = `
    ${escapeHtml(data.park_name)} • ${escapeHtml(data.land_name)}
    <button class="btn-bell-mini" onclick="window.openSetAlertModal(${data.ride_id || state.selectedRideId})" style="margin-left:8px;" title="Set wait time alert for this attraction">🔔 Set Alert</button>
  `;

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

  // Create bright sunny blue gradient for today's curve fill
  const skyGrad = ctx.createLinearGradient(0, 0, 0, 350);
  skyGrad.addColorStop(0, 'rgba(26, 115, 232, 0.22)');
  skyGrad.addColorStop(1, 'rgba(26, 115, 232, 0.00)');

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
          borderColor: '#1a73e8',
          backgroundColor: skyGrad,
          borderWidth: 3.5,
          pointBackgroundColor: '#1a73e8',
          pointBorderColor: '#ffffff',
          pointBorderWidth: 2,
          pointRadius: 5.5,
          pointHoverRadius: 8,
          fill: true,
          tension: 0.32,
          spanGaps: true,
        },
        {
          label: 'Historical Hourly Average',
          data: historicalPoints,
          borderColor: '#f59e0b',
          borderWidth: 2.5,
          borderDash: [6, 4],
          pointBackgroundColor: '#f59e0b',
          pointBorderColor: '#ffffff',
          pointBorderWidth: 1.5,
          pointRadius: 4.5,
          pointHoverRadius: 7,
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
          borderColor: '#e2e8f0',
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
            color: '#f1f5f9',
          },
          ticks: {
            color: '#64748b',
            font: {
              family: 'Plus Jakarta Sans',
              size: 11,
              weight: '600',
            },
          },
        },
        y: {
          min: 0,
          suggestedMax: 60,
          grid: {
            color: '#e2e8f0',
          },
          ticks: {
            color: '#64748b',
            font: {
              family: 'Plus Jakarta Sans',
              size: 11,
              weight: '600',
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
    // Ride Type filter: 'rides' (real moving rides only) vs 'all' (all exhibits/shows)
    if (state.rideTypeFilter === 'rides' && (r.is_ride === false || !isQueueRide(r.name))) {
      return false;
    }
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
      <td class="text-center" style="white-space:nowrap;">
        <button class="btn-bell-mini" onclick="window.openSetAlertModal(${r.id})" title="Set wait alert" style="margin-right:6px;">🔔</button>
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

  const countEl = document.getElementById('filteredCount');
  if (countEl) {
    const label = state.rideTypeFilter === 'rides' ? 'real moving rides' : 'attractions & exhibits';
    countEl.textContent = `Showing ${filtered.length} ${label}`;
  }

  renderAttractionsCards(filtered);
}

function renderAttractionsCards(filtered) {
  const container = document.getElementById('attractionsCardsGrid');
  if (!container) return;
  container.innerHTML = '';

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1; padding: 30px; text-align: center;">
        <div class="empty-state-icon">🔍</div>
        <p>No attractions match your filter criteria.</p>
      </div>
    `;
    return;
  }

  filtered.forEach((r) => {
    const card = document.createElement('div');
    card.className = 'attraction-mobile-card';
    card.setAttribute('data-ride-id', r.id);

    let waitHtml = '';
    if (!r.is_open) {
      waitHtml = '<span class="attraction-card-wait-val closed">Closed</span>';
    } else {
      waitHtml = `<span class="attraction-card-wait-val">${r.wait_time}<small style="font-size:0.65rem; color:var(--text-muted); text-transform:uppercase; margin-left:2px;">min</small></span>`;
    }

    card.innerHTML = `
      <div class="attraction-card-main">
        <span class="attraction-card-name">${escapeHtml(r.name)}</span>
        <div class="attraction-card-meta">
          <span>🏰 ${escapeHtml(r.park_name)}</span>
          <span>•</span>
          <span>${escapeHtml(r.land_name || 'General')}</span>
        </div>
      </div>
      <div class="attraction-card-right">
        ${waitHtml}
        <div style="display:flex; gap:6px; align-items:center;">
          ${
            r.is_open
              ? '<span class="status-badge open" style="font-size:0.7rem; padding:2px 8px;"><span class="status-dot open"></span> Open</span>'
              : '<span class="status-badge closed" style="font-size:0.7rem; padding:2px 8px;"><span class="status-dot closed"></span> Down</span>'
          }
          <button class="btn-bell-mini" onclick="event.stopPropagation(); window.openSetAlertModal(${r.id})" title="Set wait alert">🔔</button>
        </div>
      </div>
    `;

    card.addEventListener('click', () => {
      selectRideForChart(r.id);
      switchTab('tab-trends');
    });

    container.appendChild(card);
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
    let days = null;
    try {
      const res = await fetch(`/api/history/calendar?limit=40&holiday_only=${holidayOnly}`);
      if (res.ok) days = await res.json();
    } catch (e) {}

    if (!days) {
      try {
        const staticRes = await fetch('data/calendar.json');
        if (staticRes.ok) {
          days = await staticRes.json();
          if (holidayOnly) {
            days = days.filter(d => d.holiday && d.holiday !== 'None');
          }
          days = days.slice(0, 40);
        }
      } catch (e) {}
    }

    tbody.innerHTML = '';
    if (!days || days.length === 0) {
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
    let data = null;
    try {
      const res = await fetch(`/api/history/parks/${parkId}/least-busy-days`);
      if (res.ok) data = await res.json();
    } catch (e) {}

    if (!data) {
      try {
        const staticRes = await fetch(`data/least_busy_${parkId}.json`);
        if (staticRes.ok) data = await staticRes.json();
      } catch (e) {}
    }

    if (!data) {
      try {
        const staticAllRes = await fetch('data/least_busy_all.json');
        if (staticAllRes.ok) {
          const allMap = await staticAllRes.json();
          data = allMap[String(parkId)];
        }
      } catch (e) {}
    }

    if (!data) throw new Error('Failed to fetch least busy days');
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

/* ==========================================================================
   Wait Time Alerts & Notifications System (Rides & Park Crowd Levels)
   ========================================================================== */
const ALERTS_STORAGE_KEY = 'disney_wait_alerts';
let audioCtx = null;
let selectedSettingsCrowdTarget = 'empty';

function loadAlertsFromStorage() {
  try {
    const raw = localStorage.getItem(ALERTS_STORAGE_KEY);
    if (raw) {
      state.alerts = JSON.parse(raw);
    } else {
      state.alerts = [];
    }
  } catch (e) {
    console.warn('Failed to load alerts from storage:', e);
    state.alerts = [];
  }
  updateAlertsCountBadge();
}

function saveAlertsToStorage() {
  try {
    localStorage.setItem(ALERTS_STORAGE_KEY, JSON.stringify(state.alerts));
  } catch (e) {
    console.warn('Failed to save alerts to storage:', e);
  }
  updateAlertsCountBadge();
  renderSettingsActiveAlertsList();
}

function updateAlertsCountBadge() {
  const activeCount = (state.alerts || []).filter((a) => a.is_active !== false).length;
  
  const headerBadge = document.getElementById('activeAlertsCountBadge');
  if (headerBadge) headerBadge.textContent = activeCount;

  const settingsBadge = document.getElementById('settingsAlertsCountBadge');
  if (settingsBadge) settingsBadge.textContent = activeCount;

  const totalCountEl = document.getElementById('settingsTotalAlertsCount');
  if (totalCountEl) totalCountEl.textContent = `${activeCount} Active Watcher${activeCount === 1 ? '' : 's'}`;
}

function playChimeSound() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    if (!audioCtx || audioCtx.state === 'suspended') {
      audioCtx = new AudioContext();
    }
    
    // Pleasant 3-tone arpeggio (C5 -> E5 -> G5)
    const tones = [523.25, 659.25, 783.99];
    const now = audioCtx.currentTime;
    
    tones.forEach((freq, idx) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + idx * 0.12);
      
      gain.gain.setValueAtTime(0, now + idx * 0.12);
      gain.gain.linearRampToValueAtTime(0.18, now + idx * 0.12 + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.12 + 0.4);
      
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      
      osc.start(now + idx * 0.12);
      osc.stop(now + idx * 0.12 + 0.45);
    });
  } catch (e) {
    console.warn('Audio chime failed:', e);
  }
}

function showToast(title, desc, icon = '🔔', durationMs = 6000) {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = 'toast-item';
  toast.innerHTML = `
    <span class="toast-icon">${icon}</span>
    <div class="toast-content">
      <span class="toast-title">${escapeHtml(title)}</span>
      <span class="toast-desc">${escapeHtml(desc)}</span>
    </div>
    <button class="toast-close-btn" aria-label="Dismiss">&times;</button>
  `;

  toast.querySelector('.toast-close-btn').addEventListener('click', () => {
    toast.remove();
  });

  container.appendChild(toast);

  if (durationMs > 0) {
    setTimeout(() => {
      if (toast.parentNode) {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(50px)';
        toast.style.transition = 'all 0.3s ease';
        setTimeout(() => toast.remove(), 300);
      }
    }, durationMs);
  }
}

let swRegistration = null;

function initServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker
      .register('sw.js')
      .then((reg) => {
        swRegistration = reg;
        console.log('Disney Waits Service Worker registered with scope:', reg.scope);
      })
      .catch((err) => {
        console.warn('Service Worker registration failed:', err);
      });
  }
}

async function requestPushPermission() {
  if (!('Notification' in window)) {
    showToast('Notifications Unavailable', 'This browser does not support web push notifications.', '⚠️');
    return false;
  }

  if (Notification.permission === 'granted') {
    updatePushBannerStatus();
    return true;
  }

  try {
    const permission = await Notification.requestPermission();
    updatePushBannerStatus();
    if (permission === 'granted') {
      sendPushNotification(
        '🏰 Device Lock-Screen Alerts Active!',
        'You will now receive alerts directly on your device screen even when this app is in the background! ✨'
      );
      return true;
    }
  } catch (e) {
    console.warn('Error requesting notification permission:', e);
  }
  return false;
}

function sendPushNotification(title, body, data = {}) {
  // 1. Play magical audio chime
  playChimeSound();

  // 2. Hardware vibration (buzzes phone in pocket if supported)
  if ('vibrate' in navigator) {
    try {
      navigator.vibrate([300, 150, 300]);
    } catch (e) {}
  }

  // 3. In-App visual Toast
  showToast(title, body, '🔔');

  // 4. System-level OS / Lock Screen Device Notification via Service Worker
  if ('Notification' in window && Notification.permission === 'granted') {
    const notificationOptions = {
      body: body,
      icon: 'https://emojicdn.elk.sh/🏰',
      badge: 'https://emojicdn.elk.sh/🔔',
      vibrate: [300, 150, 300],
      tag: `disney-alert-${Date.now()}`,
      renotify: true,
      requireInteraction: true,
      data: { url: window.location.href, ...data },
    };

    if (swRegistration && swRegistration.showNotification) {
      swRegistration.showNotification(title, notificationOptions).catch((err) => {
        console.warn('swRegistration.showNotification failed, falling back:', err);
        tryDirectNotification(title, notificationOptions);
      });
    } else if (navigator.serviceWorker && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({
        type: 'SHOW_NOTIFICATION',
        title: title,
        options: notificationOptions,
      });
    } else {
      tryDirectNotification(title, notificationOptions);
    }
  }
}

function tryDirectNotification(title, options) {
  try {
    new Notification(title, options);
  } catch (e) {
    console.warn('Direct Notification constructor failed:', e);
  }
}

function updatePushBannerStatus() {
  const banner = document.getElementById('devicePushBanner');
  const icon = document.getElementById('pushBannerIcon');
  const title = document.getElementById('pushBannerTitle');
  const desc = document.getElementById('pushBannerDesc');
  const enableBtn = document.getElementById('enableDeviceAlertsBtn');
  const iosTip = document.getElementById('iosPwaTip');

  // Check iOS device
  const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  const isStandalone = window.navigator.standalone || window.matchMedia('(display-mode: standalone)').matches;

  if (iosTip) {
    if (isIos && !isStandalone) {
      iosTip.classList.remove('hidden');
    } else {
      iosTip.classList.add('hidden');
    }
  }

  if (!('Notification' in window)) {
    if (banner && title && desc) {
      banner.className = 'device-push-banner';
      if (icon) icon.textContent = 'ℹ️';
      title.textContent = 'Browser Notifications Not Supported';
      desc.textContent = isIos
        ? "On iOS, tap Safari's Share button -> 'Add to Home Screen' to enable full lock-screen notifications."
        : 'In-app chimes and alerts are active, but this browser does not support OS-level background push.';
      if (enableBtn) enableBtn.classList.add('hidden');
    }
    return;
  }

  if (Notification.permission === 'granted') {
    if (banner && title && desc) {
      banner.className = 'device-push-banner active';
      if (icon) icon.textContent = '✅';
      title.textContent = 'Device Lock-Screen Notifications Active!';
      desc.textContent = 'Your device will alert you with chimes, vibration, and lock-screen banners even when you are away from the app or your screen is locked.';
      if (enableBtn) enableBtn.classList.add('hidden');
    }
  } else if (Notification.permission === 'denied') {
    if (banner && title && desc) {
      banner.className = 'device-push-banner';
      if (icon) icon.textContent = '⚠️';
      title.textContent = 'Device Notifications Blocked in Browser Settings';
      desc.textContent = 'To receive lock-screen alerts when wait times drop, please click the lock/settings icon in your browser address bar and enable Notifications.';
      if (enableBtn) enableBtn.classList.add('hidden');
    }
  } else {
    if (banner && title && desc) {
      banner.className = 'device-push-banner';
      if (icon) icon.textContent = '🔔';
      title.textContent = 'Enable Device Lock-Screen Notifications';
      desc.textContent = 'Receive instant alerts with sound and vibration on your phone\'s lock screen even when your screen is off or you\'re using other apps.';
      if (enableBtn) enableBtn.classList.remove('hidden');
    }
  }
}

/* ==========================================================================
   Tab 5: Settings & Alert Center Initialization & Logic
   ========================================================================== */
function initSettingsTabListeners() {
  const parkSelect = document.getElementById('settingsParkSelect');
  const rideSelect = document.getElementById('settingsRideSelect');
  const slider = document.getElementById('settingsThresholdSlider');
  const display = document.getElementById('settingsThresholdDisplay');
  const saveRideBtn = document.getElementById('settingsSaveRideAlertBtn');

  const crowdParkSelect = document.getElementById('settingsCrowdParkSelect');
  const saveCrowdBtn = document.getElementById('settingsSaveCrowdAlertBtn');
  const testBtn = document.getElementById('settingsTestChimeBtn');
  const enablePushBtn = document.getElementById('settingsEnablePushBtn');
  const enableDeviceAlertsBtn = document.getElementById('enableDeviceAlertsBtn');
  const testDeviceAlertsBtn = document.getElementById('testDeviceAlertsBtn');

  if (parkSelect) {
    parkSelect.addEventListener('change', () => {
      populateSettingsRidesDropdown(parseInt(parkSelect.value, 10));
    });
  }

  if (rideSelect) {
    rideSelect.addEventListener('change', () => {
      updateSettingsSelectedRideInfo();
    });
  }

  if (slider) {
    slider.addEventListener('input', (e) => {
      const val = parseInt(e.target.value, 10);
      if (display) display.textContent = `${val} mins`;
      document.querySelectorAll('#settingsPresetChips .preset-threshold-chip').forEach((c) => {
        const cVal = parseInt(c.getAttribute('data-threshold'), 10);
        c.classList.toggle('active', cVal === val);
      });
    });
  }

  document.querySelectorAll('#settingsPresetChips .preset-threshold-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('#settingsPresetChips .preset-threshold-chip').forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      const val = parseInt(chip.getAttribute('data-threshold'), 10);
      if (slider) slider.value = val;
      if (display) display.textContent = `${val} mins`;
    });
  });

  if (saveRideBtn) {
    saveRideBtn.addEventListener('click', saveSettingsRideAlert);
  }

  // Crowd target chips
  document.querySelectorAll('#settingsCrowdTargetSelector .crowd-target-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('#settingsCrowdTargetSelector .crowd-target-chip').forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      selectedSettingsCrowdTarget = chip.getAttribute('data-level');
    });
  });

  if (crowdParkSelect) {
    crowdParkSelect.addEventListener('change', () => {
      updateSettingsSelectedParkCrowd();
    });
  }

  if (saveCrowdBtn) {
    saveCrowdBtn.addEventListener('click', saveSettingsCrowdAlert);
  }

  if (testBtn) {
    testBtn.addEventListener('click', testNotification);
  }

  if (testDeviceAlertsBtn) {
    testDeviceAlertsBtn.addEventListener('click', testNotification);
  }

  if (enablePushBtn) {
    enablePushBtn.addEventListener('click', async () => {
      const granted = await requestPushPermission();
      if (granted) {
        enablePushBtn.classList.add('hidden');
        showToast('Push Notifications Active', 'You will now receive alerts directly on your device screen! ✨', '✅');
      }
    });
  }

  if (enableDeviceAlertsBtn) {
    enableDeviceAlertsBtn.addEventListener('click', async () => {
      const granted = await requestPushPermission();
      if (granted) {
        showToast('Device Notifications Active', 'Lock-screen alerts and vibration are enabled! ✨', '✅');
      }
    });
  }
}

function renderSettingsTab() {
  const parkSelect = document.getElementById('settingsParkSelect');
  const parkId = parkSelect ? parseInt(parkSelect.value, 10) : 6;
  populateSettingsRidesDropdown(parkId);
  updateSettingsSelectedParkCrowd();
  renderSettingsActiveAlertsList();
  updatePushBannerStatus();

  // Push notification permission button visibility
  const enablePushBtn = document.getElementById('settingsEnablePushBtn');
  if (enablePushBtn) {
    if ('Notification' in window && Notification.permission !== 'granted') {
      enablePushBtn.classList.remove('hidden');
    } else {
      enablePushBtn.classList.add('hidden');
    }
  }
}

function populateSettingsRidesDropdown(parkId = 6) {
  const rideSelect = document.getElementById('settingsRideSelect');
  if (!rideSelect) return;
  rideSelect.innerHTML = '';

  const parkRides = state.rides.filter((r) => r.park_id === parkId && r.is_ride !== false && isQueueRide(r.name));

  if (parkRides.length === 0) {
    rideSelect.innerHTML = '<option value="" disabled selected>No attractions found in this park</option>';
    return;
  }

  parkRides.forEach((ride) => {
    const opt = document.createElement('option');
    opt.value = ride.id;
    opt.textContent = `${ride.name} (${ride.is_open ? `${ride.wait_time}m` : 'Closed'})`;
    rideSelect.appendChild(opt);
  });

  updateSettingsSelectedRideInfo();
}

function updateSettingsSelectedRideInfo() {
  const rideSelect = document.getElementById('settingsRideSelect');
  const waitValEl = document.getElementById('settingsSelectedRideWaitVal');
  if (!rideSelect || !waitValEl) return;

  const rideId = parseInt(rideSelect.value, 10);
  const ride = state.rides.find((r) => r.id === rideId);

  if (ride) {
    if (ride.is_open) {
      waitValEl.textContent = `${ride.wait_time} min standby`;
      waitValEl.className = 'text-gold font-bold';
    } else {
      waitValEl.textContent = 'Closed (Down)';
      waitValEl.className = 'text-danger font-bold';
    }
  } else {
    waitValEl.textContent = '-- min';
  }
}

function updateSettingsSelectedParkCrowd() {
  const crowdParkSelect = document.getElementById('settingsCrowdParkSelect');
  const crowdValEl = document.getElementById('settingsSelectedParkCrowdVal');
  if (!crowdParkSelect || !crowdValEl) return;

  const parkId = parseInt(crowdParkSelect.value, 10);
  const park = state.parks.find((p) => p.id === parkId);

  if (park && park.crowd_level) {
    crowdValEl.className = `crowd-badge ${park.crowd_level.level}`;
    crowdValEl.textContent = `${park.crowd_level.badge_text} (${park.avg_wait_time}m avg wait)`;
  } else {
    crowdValEl.textContent = '--';
  }
}

async function saveSettingsRideAlert() {
  const rideSelect = document.getElementById('settingsRideSelect');
  if (!rideSelect || !rideSelect.value) return;

  const rideId = parseInt(rideSelect.value, 10);
  const ride = state.rides.find((r) => r.id === rideId);
  if (!ride) return;

  const slider = document.getElementById('settingsThresholdSlider');
  const reopenCb = document.getElementById('settingsNotifyReopenCheckbox');
  const threshold = slider ? parseInt(slider.value, 10) : 30;
  const notifyReopen = reopenCb ? reopenCb.checked : true;

  if ('Notification' in window && Notification.permission === 'default') {
    await requestPushPermission();
  }

  const existingIdx = state.alerts.findIndex((a) => a.type === 'ride' && a.ride_id === ride.id);
  const newAlert = {
    id: existingIdx >= 0 ? state.alerts[existingIdx].id : `ride_alert_${Date.now()}`,
    type: 'ride',
    ride_id: ride.id,
    ride_name: ride.name,
    park_id: ride.park_id,
    park_name: ride.park_name,
    land_name: ride.land_name || 'General',
    threshold: threshold,
    notify_reopen: notifyReopen,
    is_active: true,
    last_notified_wait: null,
    was_down: !ride.is_open,
    created_at: new Date().toISOString(),
  };

  if (existingIdx >= 0) {
    state.alerts[existingIdx] = newAlert;
  } else {
    state.alerts.push(newAlert);
  }

  saveAlertsToStorage();

  showToast(
    `🔔 Wait Alert Set: ${ride.name}`,
    `You'll be alerted when wait drops to ≤ ${threshold}m${notifyReopen ? ' or reopens' : ''}!`,
    '✅'
  );
  playChimeSound();

  evaluateAlerts();
  renderSettingsActiveAlertsList();
  renderActiveAlerts();
}

async function saveSettingsCrowdAlert() {
  const crowdParkSelect = document.getElementById('settingsCrowdParkSelect');
  if (!crowdParkSelect) return;

  const parkId = parseInt(crowdParkSelect.value, 10);
  const park = state.parks.find((p) => p.id === parkId);
  if (!park) return;

  const targetLevel = selectedSettingsCrowdTarget || 'empty';
  const targetLabel = targetLevel === 'empty' ? 'Empty / Walk-on (<25m)' : (targetLevel === 'light' ? 'Light (<39m)' : 'Normal (<52m)');

  if ('Notification' in window && Notification.permission === 'default') {
    await requestPushPermission();
  }

  const existingIdx = state.alerts.findIndex((a) => a.type === 'park_crowd' && a.park_id === park.id);
  const newAlert = {
    id: existingIdx >= 0 ? state.alerts[existingIdx].id : `crowd_alert_${Date.now()}`,
    type: 'park_crowd',
    park_id: park.id,
    park_name: park.name,
    target_level: targetLevel,
    target_label: targetLabel,
    is_active: true,
    last_notified_level: null,
    created_at: new Date().toISOString(),
  };

  if (existingIdx >= 0) {
    state.alerts[existingIdx] = newAlert;
  } else {
    state.alerts.push(newAlert);
  }

  saveAlertsToStorage();

  showToast(
    `🏰 Crowd Alert Set: ${park.name}`,
    `You'll be alerted as soon as ${park.name} drops to ${targetLabel}!`,
    '✅'
  );
  playChimeSound();

  evaluateAlerts();
  renderSettingsActiveAlertsList();
  renderActiveAlerts();
}

function renderSettingsActiveAlertsList() {
  const container = document.getElementById('settingsActiveAlertsContainer');
  if (!container) return;

  if (!state.alerts || state.alerts.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="padding: 30px 20px; text-align: center; background:var(--bg-surface); border:1px dashed var(--border-subtle); border-radius:var(--radius-lg);">
        <div class="empty-state-icon" style="font-size: 2.2rem; margin-bottom: 8px;">🔔</div>
        <h4 style="font-size: 1.05rem; color: var(--text-primary); margin-bottom: 4px;">No Active Alerts Configured</h4>
        <p style="font-size: 0.85rem; color: var(--text-muted); max-width: 400px; margin: 0 auto;">
          Use the cards above to configure ride wait drops or park crowd level notifications.
        </p>
      </div>
    `;
    return;
  }

  container.innerHTML = state.alerts.map((alert) => {
    if (alert.type === 'park_crowd') {
      const park = state.parks.find((p) => p.id === alert.park_id);
      const currentCrowd = park ? (park.crowd_level ? park.crowd_level.badge_text : 'Normal') : '--';
      const currentAvg = park ? `${park.avg_wait_time}m avg` : '';

      return `
        <div class="active-alert-item" data-alert-id="${alert.id}">
          <div class="alert-item-info">
            <span class="alert-item-title">🏰 ${escapeHtml(alert.park_name)} (Park Crowd Alert)</span>
            <span class="alert-item-meta">Live Crowd: <strong class="text-cyan">${escapeHtml(currentCrowd)} (${currentAvg})</strong></span>
            <div style="display: flex; gap: 6px; align-items: center; margin-top: 4px;">
              <span class="alert-item-threshold-pill" style="background:var(--sun-light); color:#b45309;">🎯 Target: ${escapeHtml(alert.target_label || alert.target_level)}</span>
            </div>
          </div>
          <div class="alert-item-actions">
            <button class="alert-delete-btn" onclick="window.deleteAlert('${alert.id}')" title="Delete Alert">🗑️ Remove</button>
          </div>
        </div>
      `;
    } else {
      // Ride Wait Alert
      const liveRide = state.rides.find((r) => r.id === alert.ride_id);
      const liveWait = liveRide ? (liveRide.is_open ? `${liveRide.wait_time} min` : 'Closed') : '--';
      const isUnderThreshold = liveRide && liveRide.is_open && liveRide.wait_time <= alert.threshold;

      return `
        <div class="active-alert-item" data-alert-id="${alert.id}">
          <div class="alert-item-info">
            <span class="alert-item-title">🎢 ${escapeHtml(alert.ride_name)}</span>
            <span class="alert-item-meta">🏰 ${escapeHtml(alert.park_name)} • Live: <strong class="${isUnderThreshold ? 'text-success' : 'text-cyan'}">${liveWait}</strong></span>
            <div style="display: flex; gap: 6px; align-items: center; margin-top: 4px;">
              <span class="alert-item-threshold-pill">🎯 Goal: &le; ${alert.threshold} min</span>
              ${alert.notify_reopen ? '<span class="status-badge open" style="font-size:0.7rem; padding: 2px 6px;">✨ Reopen Alert</span>' : ''}
            </div>
          </div>
          <div class="alert-item-actions">
            <button class="alert-delete-btn" onclick="window.deleteAlert('${alert.id}')" title="Delete Alert">🗑️ Remove</button>
          </div>
        </div>
      `;
    }
  }).join('');
}

function evaluateAlerts() {
  if (!state.alerts || state.alerts.length === 0) return;

  let stateModified = false;
  const CROWD_RANK = { empty: 1, light: 2, normal: 3, busy: 4 };

  state.alerts.forEach((alert) => {
    if (alert.is_active === false) return;

    if (alert.type === 'park_crowd') {
      // Evaluate Park Crowd Alert
      const park = state.parks.find((p) => p.id === alert.park_id);
      if (!park || !park.crowd_level) return;

      const currentLevel = park.crowd_level.level || 'normal';
      const currentRank = CROWD_RANK[currentLevel] || 3;
      const targetRank = CROWD_RANK[alert.target_level] || 1;

      if (currentRank <= targetRank) {
        if (alert.last_notified_level !== currentLevel) {
          sendPushNotification(
            `🏰 Crowd Alert: ${park.name}!`,
            `Great news! ${park.name} has dropped to ${park.crowd_level.badge_text} with an average wait of only ${park.avg_wait_time} mins!`
          );
          alert.last_notified_level = currentLevel;
          alert.last_notified_at = new Date().toISOString();
          stateModified = true;
        }
      } else {
        // Reset notification so future drop will trigger again
        if (alert.last_notified_level !== null) {
          alert.last_notified_level = null;
          stateModified = true;
        }
      }
    } else {
      // Evaluate Ride Wait Drop Alert
      const ride = state.rides.find((r) => r.id === alert.ride_id);
      if (!ride) return;

      if (ride.is_open && ride.wait_time <= alert.threshold) {
        if (alert.last_notified_wait !== ride.wait_time) {
          sendPushNotification(
            `🔔 Wait Dropped: ${ride.name}!`,
            `Standby line is down to ${ride.wait_time} mins (Target: ≤ ${alert.threshold}m) at ${ride.park_name}! Head over now! 🚀`
          );
          alert.last_notified_wait = ride.wait_time;
          alert.last_notified_at = new Date().toISOString();
          stateModified = true;
        }
      } else if (ride.is_open && ride.wait_time > alert.threshold) {
        if (alert.last_notified_wait !== null) {
          alert.last_notified_wait = null;
          stateModified = true;
        }
      }

      // Reopening alert
      if (alert.notify_reopen && alert.was_down && ride.is_open) {
        sendPushNotification(
          `✨ Reopened: ${ride.name}!`,
          `${ride.name} is back up and running with a ${ride.wait_time} min wait at ${ride.park_name}!`
        );
        alert.was_down = false;
        stateModified = true;
      } else if (!ride.is_open) {
        alert.was_down = true;
      }
    }
  });

  if (stateModified) {
    saveAlertsToStorage();
  }
}

async function testNotification() {
  if ('Notification' in window && Notification.permission !== 'granted') {
    await requestPushPermission();
  }
  
  sendPushNotification(
    '🏰 Disney Wait Alert Test',
    'Magical chime, vibration, and device notifications are active! You will be alerted when wait times drop. ✨'
  );
}

// Quick modal helpers
function openSetAlertModal(rideId) {
  const ride = state.rides.find((r) => r.id === Number(rideId));
  if (!ride) return;

  state.currentAlertRideId = ride.id;

  const modal = document.getElementById('alertModal');
  const titleEl = document.getElementById('modalRideTitle');
  const metaEl = document.getElementById('modalRideMeta');
  const waitValEl = document.getElementById('modalCurrentWaitVal');
  const slider = document.getElementById('thresholdSlider');
  const display = document.getElementById('thresholdDisplay');
  const reopenCb = document.getElementById('notifyReopenCheckbox');
  const noticeBox = document.getElementById('permissionNoticeBox');

  if (titleEl) titleEl.textContent = ride.name;
  if (metaEl) metaEl.textContent = `🏰 ${ride.park_name} • ${ride.land_name || 'General'}`;
  
  if (waitValEl) {
    if (ride.is_open) {
      waitValEl.textContent = `${ride.wait_time} min`;
      waitValEl.className = 'modal-wait-val';
    } else {
      waitValEl.textContent = 'Closed (Down)';
      waitValEl.className = 'modal-wait-val text-danger';
    }
  }

  const existingAlert = state.alerts.find((a) => a.type === 'ride' && a.ride_id === ride.id);
  const defaultThreshold = existingAlert ? existingAlert.threshold : (ride.wait_time > 30 ? Math.min(60, Math.floor(ride.wait_time / 10) * 10 - 10) : 25);
  const finalThreshold = Math.max(5, defaultThreshold || 30);

  if (slider) slider.value = finalThreshold;
  if (display) display.textContent = `${finalThreshold} mins`;
  if (reopenCb) reopenCb.checked = existingAlert ? existingAlert.notify_reopen !== false : true;

  document.querySelectorAll('#alertModal .preset-threshold-chip').forEach((chip) => {
    const val = parseInt(chip.getAttribute('data-threshold'), 10);
    chip.classList.toggle('active', val === finalThreshold);
  });

  if ('Notification' in window && Notification.permission !== 'granted') {
    if (noticeBox) noticeBox.classList.remove('hidden');
  } else {
    if (noticeBox) noticeBox.classList.add('hidden');
  }

  if (modal) modal.classList.remove('hidden');
}

function closeSetAlertModal() {
  const modal = document.getElementById('alertModal');
  if (modal) modal.classList.add('hidden');
  state.currentAlertRideId = null;
}

async function saveCurrentAlert() {
  if (!state.currentAlertRideId) return;

  const ride = state.rides.find((r) => r.id === state.currentAlertRideId);
  if (!ride) return;

  const slider = document.getElementById('thresholdSlider');
  const reopenCb = document.getElementById('notifyReopenCheckbox');
  const threshold = slider ? parseInt(slider.value, 10) : 30;
  const notifyReopen = reopenCb ? reopenCb.checked : true;

  if ('Notification' in window && Notification.permission === 'default') {
    await requestPushPermission();
  }

  const existingIdx = state.alerts.findIndex((a) => a.type === 'ride' && a.ride_id === ride.id);
  const newAlert = {
    id: existingIdx >= 0 ? state.alerts[existingIdx].id : `ride_alert_${Date.now()}`,
    type: 'ride',
    ride_id: ride.id,
    ride_name: ride.name,
    park_id: ride.park_id,
    park_name: ride.park_name,
    land_name: ride.land_name || 'General',
    threshold: threshold,
    notify_reopen: notifyReopen,
    is_active: true,
    last_notified_wait: null,
    was_down: !ride.is_open,
    created_at: new Date().toISOString(),
  };

  if (existingIdx >= 0) {
    state.alerts[existingIdx] = newAlert;
  } else {
    state.alerts.push(newAlert);
  }

  saveAlertsToStorage();
  closeSetAlertModal();

  showToast(
    `🔔 Alert Set for ${ride.name}`,
    `You'll be notified when wait drops to ≤ ${threshold}m${notifyReopen ? ' or reopens' : ''}!`,
    '✅'
  );
  playChimeSound();

  evaluateAlerts();
  renderSettingsActiveAlertsList();
  renderActiveAlerts();
}

function openActiveAlertsModal() {
  switchTab('tab-settings');
}

function closeActiveAlertsModal() {
  const modal = document.getElementById('activeAlertsModal');
  if (modal) modal.classList.add('hidden');
}

/* ==========================================================================
   Shaded Rest & Oasis Finder (with Real-Time GPS Geolocation)
   ========================================================================== */

const REST_SPOTS_DB = [
  // Magic Kingdom (Park ID: 6)
  {
    id: 'mk_columbia_2f',
    park_id: 6,
    park_name: 'Magic Kingdom',
    land: 'Liberty Square',
    name: 'Columbia Harbour House (2nd Floor Dining Room)',
    lat: 28.4199,
    lng: -81.5831,
    ac: true,
    shaded: true,
    seating: 'Padded booths & quiet tables',
    outlets: true,
    restrooms: true,
    quiet_level: 'High',
    highlight: 'Ice-Cold A/C • Outlets • Castle / Liberty Sq Views',
    description: 'Head upstairs! Almost nobody goes to the second floor. Super icy A/C, huge windows overlooking Liberty Square & Fantasyland, and charging outlets along the walls.',
  },
  {
    id: 'mk_hall_of_presidents',
    park_id: 6,
    park_name: 'Magic Kingdom',
    land: 'Liberty Square',
    name: 'Hall of Presidents Grand Rotunda',
    lat: 28.4194,
    lng: -81.5828,
    ac: true,
    shaded: true,
    seating: 'Carpeted benches & plush seating',
    outlets: false,
    restrooms: true,
    quiet_level: 'Very High',
    highlight: 'Sub-Zero A/C • Carpet Seating • Continuous Entry',
    description: 'One of the best indoor chill spots in all of Magic Kingdom. Massive museum rotunda, carpeted floors, sub-zero air conditioning, and continuous show entry.',
  },
  {
    id: 'mk_storybook_circus_tent',
    park_id: 6,
    park_name: 'Magic Kingdom',
    land: 'Fantasyland',
    name: "Storybook Circus Tent Lounge (Pete's Silly Sideshow)",
    lat: 28.4208,
    lng: -81.5788,
    ac: true,
    shaded: true,
    seating: 'Air-conditioned benches & phone charging stations',
    outlets: true,
    restrooms: true,
    quiet_level: 'Medium',
    highlight: 'Dedicated Phone Charging • Cold A/C • Bathrooms',
    description: 'Tucked behind Big Top Souvenirs, this area has dedicated charging stations built into tree stump benches and powerful indoor A/C.',
  },
  {
    id: 'mk_tortuga_tavern',
    park_id: 6,
    park_name: 'Magic Kingdom',
    land: 'Adventureland',
    name: 'Tortuga Tavern Shaded Breezeway',
    lat: 28.4185,
    lng: -81.5843,
    ac: false,
    shaded: true,
    seating: 'Deep shaded Spanish colonial courtyard & fans',
    outlets: false,
    restrooms: true,
    quiet_level: 'High',
    highlight: 'Directly Opposite Pirates • Breezy Shade • Fans',
    description: 'Directly across from Pirates of the Caribbean. Shaded arches, cool breezes, water fountains nearby, and rarely crowded outside peak lunch hours.',
  },
  {
    id: 'mk_tomorrowland_terrace',
    park_id: 6,
    park_name: 'Magic Kingdom',
    land: 'Tomorrowland',
    name: 'Tomorrowland Terrace Covered Pavilion',
    lat: 28.4184,
    lng: -81.5800,
    ac: false,
    shaded: true,
    seating: 'Spacious covered patio seating with fans',
    outlets: false,
    restrooms: true,
    quiet_level: 'Medium',
    highlight: 'Huge Covered Area • Castle Water Views • Ceiling Fans',
    description: 'Massive covered pavilion between Main Street and Tomorrowland with breezy lake views of Cinderella Castle and large ceiling fans.',
  },
  {
    id: 'mk_sleepy_hollow',
    park_id: 6,
    park_name: 'Magic Kingdom',
    land: 'Liberty Square',
    name: 'Sleepy Hollow Shaded Brick Terrace',
    lat: 28.4188,
    lng: -81.5821,
    ac: false,
    shaded: true,
    seating: 'Shaded brick patio overlooking moat',
    outlets: false,
    restrooms: false,
    quiet_level: 'Medium',
    highlight: 'Castle Moat Views • Shaded Canopy • Quiet Water',
    description: 'Breezy brick terrace with stunning close-up views of Cinderella Castle and gentle water sounds from the moat.',
  },

  // EPCOT (Park ID: 5)
  {
    id: 'ep_seas_observation',
    park_id: 5,
    park_name: 'EPCOT',
    land: 'World Nature',
    name: 'The Seas with Nemo (2nd Floor Aquarium Observation)',
    lat: 28.3758,
    lng: -81.5519,
    ac: true,
    shaded: true,
    seating: 'Observation carpet & benches overlooking 5.7M gal tank',
    outlets: false,
    restrooms: true,
    quiet_level: 'Very High',
    highlight: 'Icy Cold A/C • Giant Aquarium • Dim & Relaxing',
    description: 'Dark, cool, and peaceful. Watch manatees, sea turtles, and sharks glide by in icy air conditioning.',
  },
  {
    id: 'ep_connections_lounge',
    park_id: 5,
    park_name: 'EPCOT',
    land: 'World Celebration',
    name: 'Connections Eatery & Cafe Seating Lounge',
    lat: 28.3742,
    lng: -81.5498,
    ac: true,
    shaded: true,
    seating: 'Modern cushioned booths & high-top tables',
    outlets: true,
    restrooms: true,
    quiet_level: 'Medium',
    highlight: 'USB & AC Outlets Every Booth • Strong A/C • Starbucks',
    description: 'Abundant AC, floor-to-ceiling windows, and almost every booth is equipped with USB and AC charging outlets.',
  },
  {
    id: 'ep_morocco_courtyard',
    park_id: 5,
    park_name: 'EPCOT',
    land: 'World Showcase',
    name: 'Morocco Pavilion Courtyard & Gallery',
    lat: 28.3693,
    lng: -81.5516,
    ac: true,
    shaded: true,
    seating: 'Shaded tiled mosaic benches & indoor gallery',
    outlets: false,
    restrooms: true,
    quiet_level: 'Very High',
    highlight: 'Quietest Spot in Showcase • Tile Benches • Mosaic Fountain',
    description: 'The back alleys of Morocco are the quietest spot in World Showcase. Features a cool indoor gallery with intricate Islamic architecture and running water.',
  },
  {
    id: 'ep_japan_garden',
    park_id: 5,
    park_name: 'EPCOT',
    land: 'World Showcase',
    name: 'Japan Pavilion Hillside Gardens & Katsura Patio',
    lat: 28.3688,
    lng: -81.5501,
    ac: false,
    shaded: true,
    seating: 'Shaded garden hillside benches under bamboo canopy',
    outlets: false,
    restrooms: true,
    quiet_level: 'High',
    highlight: 'Koi Ponds • Bamboo Shade • Waterfalls',
    description: 'Hidden zen garden with koi ponds, miniature waterfalls, and shaded wooden pavilions high above the main walkway.',
  },
  {
    id: 'ep_american_rotunda',
    park_id: 5,
    park_name: 'EPCOT',
    land: 'World Showcase',
    name: 'American Adventure Grand Rotunda',
    lat: 28.3683,
    lng: -81.5487,
    ac: true,
    shaded: true,
    seating: 'Air-conditioned wooden benches & grand colonnade',
    outlets: false,
    restrooms: true,
    quiet_level: 'High',
    highlight: 'Grand Rotunda • Voices of Liberty • Chilled Air',
    description: 'Massive colonial rotunda with echoing acoustics, Voices of Liberty performances, and museum exhibits.',
  },
  {
    id: 'ep_odyssey_pavilion',
    park_id: 5,
    park_name: 'EPCOT',
    land: 'World Discovery',
    name: 'Odyssey Pavilion Center Breezeway',
    lat: 28.3725,
    lng: -81.5480,
    ac: true,
    shaded: true,
    seating: 'Indoor high-top and low tables with lagoon views',
    outlets: true,
    restrooms: true,
    quiet_level: 'High',
    highlight: 'Waterfront Lagoon View • Low Crowds • Clean Restrooms',
    description: 'Bridge building connecting Test Track and Mexico. Ice cold air, low crowds between meals, and clean restrooms.',
  },

  // Disney's Hollywood Studios (Park ID: 7)
  {
    id: 'hs_walt_presents',
    park_id: 7,
    park_name: "Disney's Hollywood Studios",
    land: 'Animation Courtyard',
    name: 'Walt Disney Presents Gallery & Theater',
    lat: 28.3565,
    lng: -81.5593,
    ac: true,
    shaded: true,
    seating: 'Carpeted gallery walking space & 15-min theater seats',
    outlets: false,
    restrooms: true,
    quiet_level: 'Very High',
    highlight: '15-Min Continuous Theater • Carpeted Gallery • Chilled A/C',
    description: 'Walk through rare archival Disney models, historic costumes, and sit in the continuous theater show for 15 minutes of uninterrupted A/C.',
  },
  {
    id: 'hs_pizzerizzo_2f',
    park_id: 7,
    park_name: "Disney's Hollywood Studios",
    land: 'Grand Avenue',
    name: 'PizzeRizzo (2nd Floor Deluxe Wedding Room)',
    lat: 28.3560,
    lng: -81.5620,
    ac: true,
    shaded: true,
    seating: 'Plentiful booths, tables, and private banquet room',
    outlets: true,
    restrooms: true,
    quiet_level: 'Very High',
    highlight: 'Empty 2nd Floor • Blasting A/C • Retro Disco Room',
    description: 'Climb the stairs to the second floor "Deluxe Wedding Room"! Almost nobody is up there, the A/C is blasting, and there is disco music.',
  },
  {
    id: 'hs_launch_bay',
    park_id: 7,
    park_name: "Disney's Hollywood Studios",
    land: 'Animation Courtyard',
    name: 'Star Wars Launch Bay Relaxation Lounge',
    lat: 28.3568,
    lng: -81.5582,
    ac: true,
    shaded: true,
    seating: 'Carpeted benches & movie prop exhibits',
    outlets: false,
    restrooms: true,
    quiet_level: 'High',
    highlight: 'Dim Lighting • Sub-Zero Air • Movie Props',
    description: 'One of the most air-conditioned, low-light spaces in the park. Great for cooling down kids and catching your breath.',
  },
  {
    id: 'hs_baseline_pergola',
    park_id: 7,
    park_name: "Disney's Hollywood Studios",
    land: 'Grand Avenue',
    name: 'Baseline Tap House Shaded Pergola',
    lat: 28.3556,
    lng: -81.5615,
    ac: false,
    shaded: true,
    seating: 'Wooden picnic tables under shaded tree arbor & fans',
    outlets: false,
    restrooms: true,
    quiet_level: 'Medium',
    highlight: 'Misting Fans • Tree Arbor Shade • Near Galaxy’s Edge',
    description: 'Great outdoor vibe with misting fans, dense tree canopies, and cold drinks right outside Galaxy\'s Edge.',
  },
  {
    id: 'hs_backlot_express',
    park_id: 7,
    park_name: "Disney's Hollywood Studios",
    land: 'Echo Lake',
    name: 'Backlot Express Prop Shop Back Rooms',
    lat: 28.3572,
    lng: -81.5615,
    ac: true,
    shaded: true,
    seating: 'Air conditioned prop storage booths & hidden nooks',
    outlets: false,
    restrooms: true,
    quiet_level: 'High',
    highlight: 'Movie Prop Storage Theming • Deep A/C • Booth Seating',
    description: 'Navigate to the deep rear corners of Backlot Express for cool, dim rooms filled with authentic studio film props.',
  },

  // Disney's Animal Kingdom (Park ID: 8)
  {
    id: 'ak_nomad_lounge',
    park_id: 8,
    park_name: "Disney's Animal Kingdom",
    land: 'Discovery Island',
    name: 'Nomad Lounge Shaded Wrap-Around Veranda',
    lat: 28.3582,
    lng: -81.5915,
    ac: false,
    shaded: true,
    seating: 'Plush couches & deep comfy armchairs over river',
    outlets: true,
    restrooms: true,
    quiet_level: 'Very High',
    highlight: 'Plush Couches • River Breeze • Ceiling Fans • Outlets',
    description: 'The outdoor porch has plush couches, ceiling fans, gentle river breezes, and serene views of the Discovery River.',
  },
  {
    id: 'ak_satuli_sanctuary',
    park_id: 8,
    park_name: "Disney's Animal Kingdom",
    land: 'Pandora – The World of Avatar',
    name: "Satu'li Canteen Indoor Dining Sanctuary",
    lat: 28.3575,
    lng: -81.5935,
    ac: true,
    shaded: true,
    seating: 'Air-conditioned Pandora RDA mess hall with charging',
    outlets: true,
    restrooms: true,
    quiet_level: 'Medium',
    highlight: 'High-Ceiling A/C • Water Bottle Refill • Pandora Views',
    description: 'Spacious high ceilings, cold air conditioning, and drinking water bottle refill stations right outside.',
  },
  {
    id: 'ak_harambe_market',
    park_id: 8,
    park_name: "Disney's Animal Kingdom",
    land: 'Africa',
    name: 'Harambe Market Shaded Courtyard',
    lat: 28.3605,
    lng: -81.5925,
    ac: false,
    shaded: true,
    seating: 'Covered canopy seating with African percussion ambience',
    outlets: false,
    restrooms: true,
    quiet_level: 'Medium',
    highlight: 'Extensive Canopy Shade • Cold Beverages • Breezy',
    description: 'Extensive shade canopy with breezes and rustic seating tucked away from the main safari crowd.',
  },
  {
    id: 'ak_tree_of_life_grottoes',
    park_id: 8,
    park_name: "Disney's Animal Kingdom",
    land: 'Discovery Island',
    name: 'Tree of Life Root Grottoes & Flamingo Overlook',
    lat: 28.3592,
    lng: -81.5908,
    ac: false,
    shaded: true,
    seating: 'Stone benches shaded by massive jungle roots & trees',
    outlets: false,
    restrooms: false,
    quiet_level: 'Very High',
    highlight: 'Lush Forest Canopy • Waterfalls • Animal Viewing',
    description: 'Winding paths right around the base of the Tree of Life with stone grottoes, waterfalls, and peaceful bird sanctuaries.',
  },
  {
    id: 'ak_conservation_station',
    park_id: 8,
    park_name: "Disney's Animal Kingdom",
    land: "Rafiki's Planet Watch",
    name: 'Conservation Station (Rafiki’s Planet Watch)',
    lat: 28.3650,
    lng: -81.5910,
    ac: true,
    shaded: true,
    seating: 'Indoor veterinary pavilion with carpet and seating',
    outlets: false,
    restrooms: true,
    quiet_level: 'Very High',
    highlight: 'Train Ride Retreat • Huge AC Hall • Animation Classes',
    description: 'Accessible via a short relaxing train ride. The main building is air-conditioned, spacious, and features the Animation Experience.',
  },

  // Disneyland Park (Park ID: 16)
  {
    id: 'dl_mr_lincoln_lobby',
    park_id: 16,
    park_name: 'Disneyland Park',
    land: 'Main Street, U.S.A.',
    name: 'Great Moments with Mr. Lincoln Lobby & Gallery',
    lat: 33.8105,
    lng: -117.9189,
    ac: true,
    shaded: true,
    seating: 'Plush theater seats & cool carpeted gallery',
    outlets: false,
    restrooms: true,
    quiet_level: 'Very High',
    highlight: 'Historic Disneyland Models • Plush Theater • Sub-Zero A/C',
    description: 'Step right inside the Main Street Opera House. The gallery has museum models of the park, chilled air, and plush theater seating.',
  },
  {
    id: 'dl_docking_bay_7',
    park_id: 16,
    park_name: 'Disneyland Park',
    land: "Star Wars: Galaxy's Edge",
    name: 'Docking Bay 7 Food and Cargo (Indoor Hangars)',
    lat: 33.8145,
    lng: -117.9215,
    ac: true,
    shaded: true,
    seating: 'Indoor air conditioned shipping containers & shaded courtyard',
    outlets: true,
    restrooms: true,
    quiet_level: 'Medium',
    highlight: 'Air-Conditioned Pods • Water Bottle Refill • Charging',
    description: 'Atmospheric indoor dining hangar with heavy blast doors, cool temps, and filtered water refill taps.',
  },
  {
    id: 'dl_hungry_bear_deck',
    park_id: 16,
    park_name: 'Disneyland Park',
    land: 'Critter Country',
    name: 'Hungry Bear Barbecue Jamboree Lower Waterfront Deck',
    lat: 33.8130,
    lng: -117.9235,
    ac: false,
    shaded: true,
    seating: 'Two levels of covered wooden decks directly above river',
    outlets: false,
    restrooms: true,
    quiet_level: 'High',
    highlight: 'Over-the-Water Decks • Riverboat Views • Heavy Shade',
    description: 'The lower outdoor deck sits right over the water. Watch the Mark Twain Riverboat and canoe paddlers glide past in deep shade.',
  },
  {
    id: 'dl_tom_sawyer_gazebos',
    park_id: 16,
    park_name: 'Disneyland Park',
    land: 'Frontierland',
    name: "Pirate's Lair on Tom Sawyer Island (Fort Wilderness)",
    lat: 33.8125,
    lng: -117.9220,
    ac: false,
    shaded: true,
    seating: 'Shaded wooden rocking chairs overlooking Rivers of America',
    outlets: false,
    restrooms: true,
    quiet_level: 'Very High',
    highlight: 'Rocking Chairs • Island Breeze • Water Views',
    description: 'Take the raft across the river to enjoy breezy shaded porches with wooden rocking chairs and tranquil river views.',
  },
  {
    id: 'dl_space_mountain_breezeway',
    park_id: 16,
    park_name: 'Disneyland Park',
    land: 'Tomorrowland',
    name: 'Tomorrowland Space Mountain Lower Breezeway',
    lat: 33.8118,
    lng: -117.9168,
    ac: true,
    shaded: true,
    seating: 'Shaded benches under concrete pylons & indoor breezeways',
    outlets: false,
    restrooms: true,
    quiet_level: 'Medium',
    highlight: 'Concrete Shade Canopy • Cool Breezeways • Water Fountains',
    description: 'Covered passages behind Space Mountain and the Pizza Planet terrace offer cool shelter from the mid-day California sun.',
  },

  // Disney California Adventure (Park ID: 17)
  {
    id: 'dca_animation_building',
    park_id: 17,
    park_name: 'Disney California Adventure',
    land: 'Hollywood Land',
    name: 'Disney Animation Building Courtyard (Beast’s Library)',
    lat: 33.8078,
    lng: -117.9175,
    ac: true,
    shaded: true,
    seating: 'Carpeted central atrium with 360-deg animation & plush couches',
    outlets: true,
    restrooms: true,
    quiet_level: 'High',
    highlight: '🌟 #1 Best Chill Spot in DCA • 360° Screens • Ice-Cold A/C',
    description: 'Hands down the best relaxation spot in DCA. Sit or lie on the carpet, listen to Disney music, and enjoy high-powered ice cold A/C.',
  },
  {
    id: 'dca_redwood_creek_benches',
    park_id: 17,
    park_name: 'Disney California Adventure',
    land: 'Grizzly Peak',
    name: 'Redwood Creek Challenge Trail Shaded Forest Benches',
    lat: 33.8055,
    lng: -117.9198,
    ac: false,
    shaded: true,
    seating: 'Rustic carved redwood benches under towering pine trees',
    outlets: false,
    restrooms: true,
    quiet_level: 'Very High',
    highlight: '10° Cooler Forest Canopy • Babbling Brooks • Rustic Seating',
    description: 'Dense forest canopy keeps temperatures 5–10 degrees cooler than the rest of the park. Serene waterfalls and babbling brooks.',
  },
  {
    id: 'dca_flos_v8_patio',
    park_id: 17,
    park_name: 'Disney California Adventure',
    land: 'Cars Land',
    name: "Flo's V-8 Cafe Back Patio & Indoor Diner Booths",
    lat: 33.8050,
    lng: -117.9180,
    ac: true,
    shaded: true,
    seating: 'Covered diner booths overlooking the Cadillac Range',
    outlets: true,
    restrooms: true,
    quiet_level: 'Medium',
    highlight: 'Radiator Springs Racers Views • Shaded Diner • Neon Theming',
    description: 'The back outdoor covered patio or indoor neon diner booths have spectacular shade and front-row views of Radiator Springs Racers zooming past.',
  },
  {
    id: 'dca_sonoma_terrace',
    park_id: 17,
    park_name: 'Disney California Adventure',
    land: 'Performance Corridor',
    name: 'Sonoma Terrace & Golden Vine Winery Shaded Arbors',
    lat: 33.8062,
    lng: -117.9190,
    ac: false,
    shaded: true,
    seating: 'Grapevine-covered pergolas with cushioned seating',
    outlets: false,
    restrooms: true,
    quiet_level: 'High',
    highlight: 'Tuscan Grapevine Pergolas • Stone Fountains • Center Park',
    description: 'Romantic shaded terrace with stone fountains and lush Tuscan greenery right in the center of the park.',
  },
  {
    id: 'dca_lamplight_boardwalk',
    park_id: 17,
    park_name: 'Disney California Adventure',
    land: 'Pixar Pier',
    name: 'Lamplight Lounge Waterfront Boardwalk',
    lat: 33.8042,
    lng: -117.9210,
    ac: true,
    shaded: true,
    seating: 'Breezy covered waterfront seating & leather booths',
    outlets: false,
    restrooms: true,
    quiet_level: 'Medium',
    highlight: 'Waterfront Lagoon Breezes • Shaded Awnings • Pixar Art',
    description: 'Sit by the water under shaded awnings with cool bay breezes and Pixar animator sketchbook art.',
  },
];

/**
 * Calculates distance and walk time between two GPS coordinates using Haversine formula
 */
function calculateHaversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3; // Earth's radius in meters
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  const distanceMeters = R * c;
  const distanceFeet = distanceMeters * 3.28084;
  const distanceMiles = distanceMeters / 1609.34;
  // Estimated walking speed: 1.2 m/s (4.3 km/h or 2.7 mph) = 72 meters per minute
  const walkMinutes = Math.max(1, Math.round(distanceMeters / 72));

  return {
    meters: Math.round(distanceMeters),
    feet: Math.round(distanceFeet),
    miles: distanceMiles,
    walkMinutes: walkMinutes,
  };
}

/**
 * Opens Shaded Rest & Oasis Finder modal
 */
function openRestFinderModal(parkId = 6) {
  const modal = document.getElementById('restModal');
  if (!modal) return;

  state.selectedRestParkId = parkId;

  // Sync park chip selection
  document.querySelectorAll('#restParkChips .rec-chip').forEach((chip) => {
    const pId = parseInt(chip.getAttribute('data-park'), 10);
    chip.classList.toggle('active', pId === state.selectedRestParkId);
  });

  modal.classList.remove('hidden');

  // If we don't have GPS coords yet, automatically request once silently or render immediately
  if (!state.userCoords) {
    acquireGpsLocation(false);
  } else {
    renderRestSpots(state.selectedRestParkId, state.userCoords);
  }
}

/**
 * Closes Rest Finder modal
 */
function closeRestFinderModal() {
  const modal = document.getElementById('restModal');
  if (modal) modal.classList.add('hidden');
}

/**
 * Acquires user's GPS coordinates via browser Geolocation API
 */
function acquireGpsLocation(isManualClick = false) {
  const banner = document.getElementById('gpsStatusBanner');
  const bannerText = document.getElementById('gpsStatusText');

  if (!navigator.geolocation) {
    if (banner && bannerText && isManualClick) {
      banner.classList.remove('hidden');
      bannerText.textContent = '⚠️ GPS Geolocation is not supported by your browser.';
    }
    renderRestSpots(state.selectedRestParkId, null);
    return;
  }

  if (banner && bannerText) {
    banner.classList.remove('hidden');
    bannerText.innerHTML = '📍 <strong>Acquiring precise GPS location...</strong> Calculating nearest shaded rest spots.';
  }

  navigator.geolocation.getCurrentPosition(
    (position) => {
      state.userCoords = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        accuracy: position.coords.accuracy,
      };

      // Check if user is near one of the Disney parks
      let closestPark = null;
      let minParkDist = Infinity;
      const parkCenterCoords = {
        6: { lat: 28.4177, lng: -81.5812, name: 'Magic Kingdom' },
        5: { lat: 28.3747, lng: -81.5494, name: 'EPCOT' },
        7: { lat: 28.3575, lng: -81.5583, name: "Disney's Hollywood Studios" },
        8: { lat: 28.3597, lng: -81.5913, name: "Disney's Animal Kingdom" },
        16: { lat: 33.8121, lng: -117.9190, name: 'Disneyland Park' },
        17: { lat: 33.8061, lng: -117.9200, name: 'Disney California Adventure' },
      };

      Object.entries(parkCenterCoords).forEach(([pId, center]) => {
        const d = calculateHaversineDistance(state.userCoords.lat, state.userCoords.lng, center.lat, center.lng);
        if (d.meters < minParkDist) {
          minParkDist = d.meters;
          closestPark = parseInt(pId, 10);
        }
      });

      // If user is within 15km of a park, automatically focus that park
      if (closestPark && minParkDist < 15000) {
        state.selectedRestParkId = closestPark;
        document.querySelectorAll('#restParkChips .rec-chip').forEach((chip) => {
          const pId = parseInt(chip.getAttribute('data-park'), 10);
          chip.classList.toggle('active', pId === state.selectedRestParkId);
        });
      }

      if (banner && bannerText) {
        banner.classList.remove('hidden');
        banner.style.background = '#dcfce7';
        banner.style.borderColor = '#86efac';
        banner.style.color = '#15803d';
        bannerText.innerHTML = `📍 <strong>GPS Connected!</strong> Showing nearest rest spots sorted by real-time walking distance.`;
      }

      renderRestSpots(state.selectedRestParkId, state.userCoords);
    },
    (error) => {
      console.warn('Geolocation acquisition error:', error);
      if (banner && bannerText) {
        banner.classList.remove('hidden');
        banner.style.background = '#fffbeb';
        banner.style.borderColor = '#fde68a';
        banner.style.color = '#b45309';
        bannerText.innerHTML = `📍 <strong>GPS unavailable or permission denied.</strong> Showing all curated rest spots for this park.`;
      }
      renderRestSpots(state.selectedRestParkId, null);
    },
    {
      enableHighAccuracy: true,
      timeout: 8000,
      maximumAge: 30000,
    }
  );
}

/**
 * Renders the curated rest spots list
 */
function renderRestSpots(parkId = 6, userCoords = null) {
  const container = document.getElementById('restSpotsList');
  if (!container) return;

  const spots = REST_SPOTS_DB.filter((s) => s.park_id === parkId);

  if (spots.length === 0) {
    container.innerHTML = `
      <div style="text-align:center; padding:30px 20px; color:var(--text-muted);">
        <p>No rest spots found for this park.</p>
      </div>
    `;
    return;
  }

  // Calculate distances if GPS is active
  const enrichedSpots = spots.map((spot) => {
    let distanceInfo = null;
    if (userCoords && userCoords.lat && userCoords.lng) {
      distanceInfo = calculateHaversineDistance(userCoords.lat, userCoords.lng, spot.lat, spot.lng);
    }
    return { ...spot, distanceInfo };
  });

  // Sort by closest distance if GPS is available
  if (userCoords) {
    enrichedSpots.sort((a, b) => {
      const distA = a.distanceInfo ? a.distanceInfo.meters : 999999;
      const distB = b.distanceInfo ? b.distanceInfo.meters : 999999;
      return distA - distB;
    });
  }

  container.innerHTML = enrichedSpots
    .map((spot, index) => {
      const isClosest = userCoords && index === 0 && spot.distanceInfo && spot.distanceInfo.meters < 5000;
      const walkBadge = spot.distanceInfo
        ? `<div class="rest-walk-badge ${isClosest ? 'closest' : ''}">
            <span>🚶</span>
            <strong>${spot.distanceInfo.walkMinutes} min walk</strong>
            <small>(${spot.distanceInfo.meters > 1000 ? `${spot.distanceInfo.miles.toFixed(1)} mi` : `${spot.distanceInfo.feet} ft`})</small>
          </div>`
        : '';

      const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${spot.lat},${spot.lng}&travelmode=walking`;

      return `
        <div class="rest-card-item ${isClosest ? 'highlight-closest' : ''}" style="background:var(--bg-surface); border:1px solid ${isClosest ? 'var(--sun-gold)' : 'var(--border-subtle)'}; border-radius:var(--radius-md); padding:16px; box-shadow:var(--shadow-sm); display:flex; flex-direction:column; gap:10px;">
          <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px;">
            <div>
              ${isClosest ? '<div style="display:inline-flex; align-items:center; gap:4px; font-size:0.75rem; font-weight:700; color:#b45309; background:#fef3c7; padding:2px 8px; border-radius:999px; margin-bottom:6px;">🌟 NEAREST SHADED REST LOCATION</div>' : ''}
              <h4 style="font-size:1.05rem; font-weight:700; color:var(--text-primary); margin:0;">${escapeHtml(spot.name)}</h4>
              <div style="font-size:0.82rem; color:var(--text-muted); margin-top:2px;">
                🏰 ${escapeHtml(spot.park_name)} • 📍 ${escapeHtml(spot.land)}
              </div>
            </div>
            ${walkBadge}
          </div>

          <div style="display:flex; flex-wrap:wrap; gap:6px;">
            ${spot.ac ? '<span class="rest-tag" style="background:#e0f2fe; color:#0369a1; padding:3px 8px; border-radius:6px; font-size:0.75rem; font-weight:600;">❄️ Air Conditioned</span>' : '<span class="rest-tag" style="background:#fef3c7; color:#92400e; padding:3px 8px; border-radius:6px; font-size:0.75rem; font-weight:600;">🌴 Breezy Shade &amp; Fans</span>'}
            ${spot.outlets ? '<span class="rest-tag" style="background:#dcfce7; color:#15803d; padding:3px 8px; border-radius:6px; font-size:0.75rem; font-weight:600;">⚡ Outlets Available</span>' : ''}
            ${spot.restrooms ? '<span class="rest-tag" style="background:#f3e8ff; color:#7e22ce; padding:3px 8px; border-radius:6px; font-size:0.75rem; font-weight:600;">🚻 Restrooms Nearby</span>' : ''}
            <span class="rest-tag" style="background:#f1f5f9; color:#475569; padding:3px 8px; border-radius:6px; font-size:0.75rem; font-weight:600;">💺 ${escapeHtml(spot.seating)}</span>
            <span class="rest-tag" style="background:#f1f5f9; color:#475569; padding:3px 8px; border-radius:6px; font-size:0.75rem; font-weight:600;">🤫 Quiet: ${escapeHtml(spot.quiet_level)}</span>
          </div>

          <p style="font-size:0.86rem; color:var(--text-secondary); line-height:1.45; margin:0;">
            ${escapeHtml(spot.description)}
          </p>

          <div style="display:flex; justify-content:space-between; align-items:center; margin-top:4px; padding-top:8px; border-top:1px dashed var(--border-subtle);">
            <span style="font-size:0.78rem; font-weight:600; color:var(--text-gold);">
              💡 ${escapeHtml(spot.highlight)}
            </span>
            <a href="${mapsUrl}" target="_blank" rel="noopener noreferrer" class="btn btn-sm btn-secondary" style="font-size:0.78rem; text-decoration:none; padding:4px 10px;">
              📍 Open Walking Route ↗
            </a>
          </div>
        </div>
      `;
    })
    .join('');
}

// Global window helpers for inline onclick handlers
window.openSetAlertModal = function (rideId) {
  openSetAlertModal(rideId);
};

window.deleteAlert = function (alertId) {
  state.alerts = state.alerts.filter((a) => a.id !== alertId);
  saveAlertsToStorage();
};

window.openRestFinderModal = function (parkId) {
  openRestFinderModal(parkId);
};

window.acquireGpsLocation = function () {
  acquireGpsLocation(true);
};




