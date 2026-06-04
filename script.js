// --- Service Worker & PWA ---
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js')
          .then(reg => {
            console.log('Service Worker geladen', reg);
            reg.update();
          })
          .catch(err => console.log('Service Worker Fehler', err));
      });
    }

    let deferredPrompt;
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredPrompt = e;
      const installBtn = document.getElementById('install-app-btn');
      if(installBtn) installBtn.classList.remove('hidden');
    });

    function installPWA() {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      deferredPrompt.userChoice.then((choiceResult) => {
        deferredPrompt = null;
        const installBtn = document.getElementById('install-app-btn');
        if (installBtn) installBtn.classList.add('hidden');
      });
    }

    // --- State & Variables ---
    const STORAGE_KEY = 'nutrisnap_data_v8'; 
    
    let appData = {
      apiKey: '',
      goalKcal: 2000,
      goalWater: 8,
      macroSplit: { c: 40, p: 30, f: 30 },
      meals: [],
      favorites: [],
      water: {},
      weights: {},
      dailyGoals: {}, 
      lastActiveDate: null,
      streak: 0
    };

    let currentDate = new Date();
    let tempMethod = 'Manuell';
    let editingMealId = null; 
    let calcFinalResult = 0; 
    let currentPhotoType = 'meal'; 
    let chartMode = 'kcal'; 
    
    let baseNutrients = { cal: 0, pro: 0, carbs: 0, fat: 0 };

    let recognition;
    let isRecording = false;
    let touchstartX = 0;
    let touchstartY = 0;

   // --- Initialization & Sicherheits-Checks ---
    async function requestPersistentStorage() {
      if (navigator.storage && navigator.storage.persist) {
        const isPersisted = await navigator.storage.persisted();
        console.log(`Speicher bereits dauerhaft? ${isPersisted ? 'Ja' : 'Nein'}`);
        
        if (!isPersisted) {
          const persisted = await navigator.storage.persist();
          console.log(`Dauerhafter Speicher genehmigt? ${persisted ? 'Ja' : 'Nein'}`);
        }
      }
    }

    function init() {
      requestPersistentStorage();

      try {
        const savedData = localStorage.getItem(STORAGE_KEY) || localStorage.getItem('nutrisnap_data_v7');
        if(savedData) {
            const parsed = JSON.parse(savedData);
            appData = { ...appData, ...parsed };
        }
      } catch(e) { console.error("Datenfehler beim Laden", e); }
      
      if (!appData.macroSplit || typeof appData.macroSplit !== 'object') appData.macroSplit = { c: 40, p: 30, f: 30 };
      if (!Array.isArray(appData.meals)) appData.meals = [];
      if (!Array.isArray(appData.favorites)) appData.favorites = [];
      if (!appData.water || typeof appData.water !== 'object') appData.water = {};
      if (!appData.weights || typeof appData.weights !== 'object') appData.weights = {};
      if (!appData.dailyGoals || typeof appData.dailyGoals !== 'object') appData.dailyGoals = {};
      if (!appData.goalKcal || isNaN(appData.goalKcal)) appData.goalKcal = 2000;
      if (!appData.goalWater || isNaN(appData.goalWater)) appData.goalWater = 8;
      
      lucide.createIcons();
      updateStreak();
      updateDateUI();
      renderMeals();
      updateDashboard();
      populateSettingsForm();
      initSpeechRecognition();
      setupSwipeGestures();
    }

    // --- Helper für Tagesziel ---
    function getGoalForDate(dateStr) {
      if (appData.dailyGoals && appData.dailyGoals[dateStr]) {
        return Number(appData.dailyGoals[dateStr]);
      }
      return Number(appData.goalKcal) || 2000;
    }

    // --- Streaks ---
    function updateStreak() {
      const today = new Date().toDateString();
      if (appData.lastActiveDate !== today) {
         const yesterday = new Date();
         yesterday.setDate(yesterday.getDate() - 1);
         if (appData.lastActiveDate === yesterday.toDateString()) {
           appData.streak = (appData.streak || 0) + 1;
         } else {
           appData.streak = 1;
         }
         appData.lastActiveDate = today;
         saveData();
      }
      document.getElementById('streak-counter').innerText = appData.streak || 1;
    }

    function haptic() { 
      try { if (navigator.vibrate) navigator.vibrate(10); } catch(e){} 
    }

    function forceCloseAllModals() {
      document.querySelectorAll('.fixed.inset-0').forEach(el => el.classList.add('hidden'));
      document.body.classList.remove('modal-open');
    }

    function saveData() {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(appData));
      renderMeals();
      updateDashboard();
    }

    function openModal(id) { 
      document.getElementById(id).classList.remove('hidden'); 
      document.body.classList.add('modal-open'); 
    }
    
    function closeModal(id) { 
      document.getElementById(id).classList.add('hidden'); 
      document.body.classList.remove('modal-open'); 
    }

    // --- Swipe Gestures ---
    function setupSwipeGestures() {
      document.addEventListener('touchstart', e => {
        touchstartX = e.changedTouches[0].screenX;
        touchstartY = e.changedTouches[0].screenY;
      }, {passive: true});

      document.addEventListener('touchend', e => {
        if(document.body.classList.contains('modal-open')) return;
        let touchendX = e.changedTouches[0].screenX;
        let touchendY = e.changedTouches[0].screenY;
        let MathX = touchstartX - touchendX;
        let MathY = Math.abs(touchstartY - touchendY);
        
        if (MathY < 50) {
          if (MathX > 70) changeDate(1);
          else if (MathX < -70) changeDate(-1);
        }
      }, {passive: true});
    }

    // --- Tab Navigation ---
    function switchTab(tabId) {
      haptic();
      const navColors = { 'dashboard': 'text-emerald-500', 'diary': 'text-blue-500', 'add': 'text-purple-500', 'settings': 'text-orange-500' };

      ['dashboard', 'diary', 'add', 'settings'].forEach(id => {
        document.getElementById('view-' + id).classList.add('hidden');
        const navEl = document.getElementById('nav-' + id);
        navEl.classList.remove('text-emerald-500', 'text-blue-500', 'text-purple-500', 'text-orange-500');
        navEl.classList.add('text-gray-400');
      });

      document.getElementById('view-' + tabId).classList.remove('hidden');
      const activeNav = document.getElementById('nav-' + tabId);
      activeNav.classList.remove('text-gray-400');
      activeNav.classList.add(navColors[tabId]);

      const dateNav = document.getElementById('date-nav-container');
      if (tabId === 'settings' || tabId === 'add') dateNav.classList.add('hidden');
      else dateNav.classList.remove('hidden');

      if (tabId === 'settings') populateSettingsForm();
      if (tabId === 'dashboard') updateDashboard();
    }

    // --- Date Navigation ---
    function getActiveDateStr() {
      const offset = currentDate.getTimezoneOffset() * 60000;
      return new Date(currentDate.getTime() - offset).toISOString().split('T')[0];
    }

    function changeDate(days) {
      haptic();
      currentDate.setDate(currentDate.getDate() + days);
      updateDateUI();
      renderMeals();
      updateDashboard();

      const content = document.getElementById('main-content');
      content.classList.remove('swipe-flash');
      void content.offsetWidth;
      content.classList.add('swipe-flash');
    }

    function updateDateUI() {
      const today = new Date();
      const isToday = today.toDateString() === currentDate.toDateString();
      const text = isToday ? "Heute" : currentDate.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: 'short' });
      
      document.getElementById('current-date-display').innerText = text;
      document.getElementById('weight-date-label').innerText = text;
      
      const nextBtn = document.getElementById('btn-next-day');
      nextBtn.style.opacity = isToday ? "0.3" : "1";
      nextBtn.style.pointerEvents = isToday ? "none" : "auto";
    }

    // --- UI Rendering ---
    function renderMeals() {
  const container = document.getElementById('meals-container');
  const emptyState = document.getElementById('empty-state');
  const activeStr = getActiveDateStr();
  
  const todaysMeals = appData.meals.filter(m => m && m.timestamp && String(m.timestamp).startsWith(activeStr));
  let totalKcalForDay = 0;

  if (todaysMeals.length === 0) {
    container.innerHTML = '';
    if (emptyState) emptyState.style.display = 'block';
    document.getElementById('diary-kcal-total').innerText = '0 kcal';
    return;
  }

  if (emptyState) emptyState.style.display = 'none';
  container.innerHTML = '';

  todaysMeals.forEach(meal => {
    totalKcalForDay += (Number(meal.calories) || 0);
    let timeStr = '--:--';
    if(meal.timestamp) {
       const timeMatch = String(meal.timestamp).match(/T(\d{2}:\d{2})/);
       if(timeMatch) timeStr = timeMatch[1];
    }

    let iconHtml, bgClass, textClass;
    if(meal.method === 'KI-Text') { 
      iconHtml = '<i data-lucide="sparkles" class="w-5 h-5"></i>'; bgClass = 'bg-blue-100'; textClass = 'text-blue-600';
    } else if(meal.method === 'KI-Foto' || meal.method === 'KI-Scanner') { 
      iconHtml = meal.method === 'KI-Scanner' ? '<i data-lucide="scan-line" class="w-5 h-5"></i>' : '<i data-lucide="camera" class="w-5 h-5"></i>'; 
      bgClass = 'bg-emerald-100'; textClass = 'text-emerald-600';
    } else if(meal.method === 'Favorit') { 
      iconHtml = '<i data-lucide="star" class="w-5 h-5"></i>'; bgClass = 'bg-amber-100'; textClass = 'text-amber-600';
    } else {
      iconHtml = '<i data-lucide="pen-line" class="w-5 h-5"></i>'; bgClass = 'bg-purple-100'; textClass = 'text-purple-600';
    }

    const el = document.createElement('div');
    el.className = 'bg-white p-4 rounded-3xl shadow-sm border border-gray-100 flex flex-col gap-4 fade-in hover:shadow-md transition-shadow';
    
    const amountDisplay = meal.amount && meal.amount !== 100 ? ` &bull; ${meal.amount}g` : '';

    el.innerHTML = `
      <div class="flex justify-between items-start">
        <div class="flex items-center gap-4">
          <div class="w-12 h-12 rounded-2xl ${bgClass} ${textClass} flex items-center justify-center shrink-0">
            ${iconHtml}
          </div>
          <div>
            <div class="font-black text-gray-800 text-lg leading-tight">${meal.name || 'Mahlzeit'}</div>
            <div class="text-xs font-bold text-gray-400 flex items-center gap-1 mt-1">
              <i data-lucide="clock" class="w-3.5 h-3.5"></i> ${timeStr} Uhr <span class="text-gray-500 ml-1">${amountDisplay}</span>
            </div>
          </div>
        </div>
        <div class="text-right">
          <div class="font-black text-emerald-500 text-xl">${meal.calories || 0}</div>
          <div class="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Kcal</div>
        </div>
      </div>
      
      <div class="flex justify-between items-center bg-gray-50 p-3 rounded-2xl border border-gray-100">
         <div class="flex gap-5 text-sm font-medium text-gray-500">
           <div><span class="font-bold text-gray-800">C:</span> ${meal.carbs || 0}g</div>
           <div><span class="font-bold text-gray-800">P:</span> ${meal.protein || 0}g</div>
           <div><span class="font-bold text-gray-800">F:</span> ${meal.fat || 0}g</div>
         </div>
         <div class="flex gap-1">
           <button onclick="haptic(); editMeal(${meal.id});" class="text-gray-400 hover:text-blue-500 p-2 transition-colors bg-white rounded-xl shadow-sm border border-gray-200 active:scale-95">
             <i data-lucide="pencil" class="w-4 h-4"></i>
           </button>
           <button onclick="haptic(); deleteMeal(${meal.id});" class="text-gray-400 hover:text-red-500 p-2 transition-colors bg-white rounded-xl shadow-sm border border-gray-200 active:scale-95">
             <i data-lucide="trash-2" class="w-4 h-4"></i>
           </button>
         </div>
      </div>
    `;
    container.appendChild(el);
  });
  
  document.getElementById('diary-kcal-total').innerText = `${Math.round(totalKcalForDay)} kcal`;
  try { lucide.createIcons(); } catch(e){}
}

    function updateDashboard() {
      const activeStr = getActiveDateStr();
      const todaysMeals = appData.meals.filter(m => m && m.timestamp && String(m.timestamp).startsWith(activeStr));
      const currentGoalKcal = getGoalForDate(activeStr);
      
      const t = todaysMeals.reduce((acc, meal) => {
        acc.cal += (Number(meal.calories) || 0); 
        acc.pro += (Number(meal.protein) || 0); 
        acc.carbs += (Number(meal.carbs) || 0); 
        acc.fat += (Number(meal.fat) || 0); 
        return acc;
      }, { cal: 0, pro: 0, carbs: 0, fat: 0 });

      document.getElementById('total-calories').innerText = Math.round(t.cal);
      document.getElementById('goal-calories-display').innerText = currentGoalKcal;
      
      let remaining = currentGoalKcal - Math.round(t.cal);
      const remEl = document.getElementById('remaining-calories');
      remEl.innerText = remaining;
      remEl.className = remaining >= 0 ? "text-3xl font-black text-emerald-500 transition-colors" : "text-3xl font-black text-red-500 transition-colors";

      document.getElementById('total-carbs').innerText = Math.round(t.carbs) + 'g';
      document.getElementById('total-protein').innerText = Math.round(t.pro) + 'g';
      document.getElementById('total-fat').innerText = Math.round(t.fat) + 'g';

      const calPercent = Math.min(100, (t.cal / currentGoalKcal) * 100);
      document.getElementById('cal-progress').style.width = `${calPercent}%`;
      document.getElementById('cal-progress').className = `h-full progress-bar ${calPercent >= 100 ? 'bg-red-500' : 'bg-emerald-500'}`;

      const split = appData.macroSplit || {};
      const cPercentage = split.c !== undefined ? Number(split.c) : 40;
      const pPercentage = split.p !== undefined ? Number(split.p) : 30;
      const fPercentage = split.f !== undefined ? Number(split.f) : 30;

      const carbsGoal = Math.round((currentGoalKcal * (cPercentage / 100)) / 4);
      const proGoal = Math.round((currentGoalKcal * (pPercentage / 100)) / 4);
      const fatGoal = Math.round((currentGoalKcal * (fPercentage / 100)) / 9);

      document.getElementById('goal-carbs-text').innerText = `Ziel: ${carbsGoal}g`;
      document.getElementById('goal-pro-text').innerText = `Ziel: ${proGoal}g`;
      document.getElementById('goal-fat-text').innerText = `Ziel: ${fatGoal}g`;

      document.getElementById('carbs-progress').style.width = `${Math.min(100, (t.carbs / (carbsGoal || 1)) * 100)}%`;
      document.getElementById('protein-progress').style.width = `${Math.min(100, (t.pro / (proGoal || 1)) * 100)}%`;
      document.getElementById('fat-progress').style.width = `${Math.min(100, (t.fat / (fatGoal || 1)) * 100)}%`;

      const totalMacroKcal = (t.carbs * 4) + (t.pro * 4) + (t.fat * 9) || 1;
      const cPct = ((t.carbs * 4) / totalMacroKcal) * 100;
      const pPct = ((t.pro * 4) / totalMacroKcal) * 100;

      const donut = document.getElementById('macro-donut');
      if (t.cal === 0) {
        donut.style.background = '#f3f4f6';
      } else {
        donut.style.setProperty('--carbs-end', `${cPct}%`);
        donut.style.setProperty('--pro-end', `${cPct + pPct}%`);
        donut.style.setProperty('--fat-end', `100%`);
        donut.style.background = `conic-gradient(#60a5fa 0% var(--carbs-end), #f87171 var(--carbs-end) var(--pro-end), #facc15 var(--pro-end) var(--fat-end))`;
      }

      // Water & Weight Displays
      const waterCount = Number(appData.water[activeStr]) || 0;
      const goalWater = Number(appData.goalWater) || 8;
      document.getElementById('water-count-display').innerText = waterCount;
      document.getElementById('water-goal-display').innerText = goalWater;
      
      let glassesHtml = '';
      const maxDisplay = Math.max(5, goalWater);
      for(let i=0; i < maxDisplay; i++) {
        if(i < 5) {
          const isFull = i < waterCount;
          glassesHtml += `<div class="w-6 h-8 rounded-b flex items-end justify-center overflow-hidden border ${isFull ? 'border-blue-400' : 'border-blue-200'}"><div class="w-full ${isFull ? 'bg-blue-400 h-full' : 'bg-transparent h-0'} transition-all duration-300"></div></div>`;
        }
      }
      if(waterCount > 5) glassesHtml += `<div class="text-xs font-bold text-blue-500 ml-1">+${waterCount - 5}</div>`;
      document.getElementById('water-glasses-container').innerHTML = glassesHtml;

      const todayWeight = appData.weights[activeStr];
      document.getElementById('weight-display').innerText = todayWeight ? Number(todayWeight).toFixed(1) : '--';

      let totalW = 0;
      let countW = 0;
      const today = new Date();
      for(let i=0; i<7; i++) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        const offset = d.getTimezoneOffset() * 60000;
        const dateStr = new Date(d.getTime() - offset).toISOString().split('T')[0];
        const w = appData.weights[dateStr];
        if(w) {
          totalW += Number(w);
          countW++;
        }
      }
      const avgW = countW > 0 ? (totalW / countW).toFixed(1) : null;
      document.getElementById('weight-avg-display').innerText = avgW ? `Ø dieser Woche: ${avgW} kg` : 'Ø dieser Woche: -- kg';

      renderWeeklyChart();
    }

    function setChartMode(mode) {
      haptic();
      chartMode = mode;
      const btnKcal = document.getElementById('btn-chart-kcal');
      const btnWeight = document.getElementById('btn-chart-weight');
      const title = document.getElementById('chart-title');
      const icon = document.getElementById('chart-icon');

      if(mode === 'kcal') {
        btnKcal.className = "px-2.5 py-1 rounded-lg text-[10px] font-black bg-white text-gray-800 shadow-sm transition-all";
        btnWeight.className = "px-2.5 py-1 rounded-lg text-[10px] font-bold text-gray-500 transition-all";
        title.innerText = "Deine letzten 7 Tage (Kcal)";
        icon.className = "w-4 h-4 text-emerald-500";
        icon.setAttribute('data-lucide', 'bar-chart-2');
      } else {
        btnKcal.className = "px-2.5 py-1 rounded-lg text-[10px] font-bold text-gray-500 transition-all";
        btnWeight.className = "px-2.5 py-1 rounded-lg text-[10px] font-black bg-white text-gray-800 shadow-sm transition-all";
        title.innerText = "Deine letzten 7 Tage (Gewicht)";
        icon.className = "w-4 h-4 text-purple-500";
        icon.setAttribute('data-lucide', 'scale');
      }
      try { lucide.createIcons(); } catch(e){}
      renderWeeklyChart();
    }

    function renderWeeklyChart() {
      const container = document.getElementById('weekly-chart-container');
      if(!container) return;
      container.innerHTML = '';
      const today = new Date();
      const daysArr = ['So','Mo','Di','Mi','Do','Fr','Sa'];

      if (chartMode === 'kcal') {
        for(let i=6; i>=0; i--) {
          const d = new Date(today);
          d.setDate(d.getDate() - i);
          const offset = d.getTimezoneOffset() * 60000;
          const dateStr = new Date(d.getTime() - offset).toISOString().split('T')[0];

          const mealsForDay = appData.meals.filter(m => m && m.timestamp && String(m.timestamp).startsWith(dateStr));
          const cals = mealsForDay.reduce((sum, m) => sum + (Number(m.calories) || 0), 0);
          const dayGoal = getGoalForDate(dateStr); 

          const dayName = daysArr[d.getDay()];
          const isToday = i === 0;
          const heightPct = dayGoal > 0 ? Math.min(100, (cals / dayGoal) * 100) : 0;
          const colorClass = heightPct >= 100 ? 'bg-red-400' : (isToday ? 'bg-emerald-500' : 'bg-emerald-300');

          container.innerHTML += `
            <div class="flex flex-col items-center gap-1 w-full flex-1">
              <span class="text-[8px] font-bold text-gray-400 h-3">${cals > 0 ? Math.round(cals) : ''}</span>
              <div class="w-full bg-gray-50 rounded-t flex items-end h-16 overflow-hidden">
                <div class="w-full ${colorClass} rounded-t transition-all duration-500" style="height: ${heightPct}%"></div>
              </div>
              <span class="text-[10px] font-bold ${isToday ? 'text-gray-800' : 'text-gray-400'}">${dayName}</span>
            </div>
          `;
        }
      } else {
        const daysData = [];
        let minW = Infinity;
        let maxW = -Infinity;

        for(let i=6; i>=0; i--) {
          const d = new Date(today);
          d.setDate(d.getDate() - i);
          const offset = d.getTimezoneOffset() * 60000;
          const dateStr = new Date(d.getTime() - offset).toISOString().split('T')[0];
          const weight = appData.weights[dateStr] ? Number(appData.weights[dateStr]) : null;

          daysData.push({
            dayName: daysArr[d.getDay()],
            isToday: i === 0,
            weight: weight
          });

          if (weight !== null) {
            if (weight < minW) minW = weight;
            if (weight > maxW) maxW = weight;
          }
        }

        const hasAnyWeights = minW !== Infinity;

        daysData.forEach(day => {
          let heightPct = 0;
          if (day.weight !== null && hasAnyWeights) {
            if (maxW === minW) {
              heightPct = 60;
            } else {
              heightPct = 20 + ((day.weight - minW) / (maxW - minW)) * 80;
            }
          }

          const colorClass = day.isToday ? 'bg-purple-600' : 'bg-purple-400';

          container.innerHTML += `
            <div class="flex flex-col items-center gap-1 w-full flex-1">
              <span class="text-[8px] font-black text-purple-700 h-3">${day.weight !== null ? day.weight.toFixed(1) : ''}</span>
              <div class="w-full bg-purple-50/50 rounded-t flex items-end h-16 overflow-hidden border-b border-purple-100">
                ${day.weight !== null ? `
                  <div class="w-full ${colorClass} rounded-t transition-all duration-500" style="height: ${heightPct}%"></div>
                ` : `
                  <div class="w-full h-1 bg-gray-200 rounded-t"></div>
                `}
              </div>
              <span class="text-[10px] font-bold ${day.isToday ? 'text-gray-800' : 'text-gray-400'}">${day.dayName}</span>
            </div>
          `;
        });
      }
    }

    function deleteMeal(id) { appData.meals = appData.meals.filter(m => m.id !== id); saveData(); }
    
    function deleteFavorite(id) {
  haptic();
  appData.favorites = appData.favorites.filter(fav => fav.id !== id);
  saveData();
  openFavorites(); 
  showNotification('success', 'Favorit gelöscht!');
}
    function editMeal(id) {
  const meal = appData.meals.find(m => m.id === id);
  if(!meal) return;
  editingMealId = id;
  tempMethod = meal.method; 
  fillResultModal(meal.name, meal.calories, meal.protein, meal.carbs, meal.fat, meal.amount || 100);
  document.getElementById('modal-title').innerText = "Mahlzeit bearbeiten";
  document.getElementById('save-fav-container').classList.add('hidden'); 
  openModal('result-modal');
}

    function updateWater(change) {
      haptic();
      if (!appData.water) appData.water = {};
      const dateStr = getActiveDateStr();
      appData.water[dateStr] = Math.max(0, (Number(appData.water[dateStr]) || 0) + change);
      saveData();
    }

    function openWeightModal() {
      haptic();
      const currentWeight = appData.weights[getActiveDateStr()];
      document.getElementById('weight-input').value = currentWeight || '';
      renderWeightHistoryList();
      openModal('weight-modal');
    }

    function renderWeightHistoryList() {
      const listContainer = document.getElementById('weight-history-list');
      if(!listContainer) return;
      listContainer.innerHTML = '';
      const today = new Date();
      let count = 0;

      for(let i=0; i<7; i++) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        const offset = d.getTimezoneOffset() * 60000;
        const dateStr = new Date(d.getTime() - offset).toISOString().split('T')[0];
        const weight = appData.weights[dateStr];

        if(weight) {
          count++;
          const isToday = i === 0;
          const dateLabel = isToday ? "Heute" : d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
          
          const el = document.createElement('div');
          el.className = "flex justify-between items-center bg-gray-50 p-2.5 rounded-xl border border-gray-100 text-sm";
          el.innerHTML = `
            <span class="font-bold text-gray-600">${dateLabel}</span>
            <div class="flex items-center gap-3">
              <span class="font-black text-purple-700">${Number(weight).toFixed(1)} kg</span>
              <button onclick="haptic(); deleteWeightHistory('${dateStr}');" class="text-gray-300 hover:text-red-500 p-1 transition-colors">
                <i data-lucide="trash-2" class="w-4 h-4"></i>
              </button>
            </div>
          `;
          listContainer.appendChild(el);
        }
      }

      if(count === 0) {
        listContainer.innerHTML = '<p class="text-xs text-gray-400 text-center py-2">Noch kein Gewicht für diese Woche eingetragen.</p>';
      }
      try { lucide.createIcons(); } catch(e){}
    }

    function deleteWeightHistory(dateStr) {
      delete appData.weights[dateStr];
      saveData();
      renderWeightHistoryList();
      showNotification('success', 'Gewichtseintrag gelöscht!');
    }

    function closeWeightModal() { forceCloseAllModals(); }

    function saveWeight() {
      const val = parseFloat(document.getElementById('weight-input').value);
      if(isNaN(val) || val <= 0) { showNotification('error', 'Ungültiges Gewicht!'); return; }
      
      if (!appData.weights) appData.weights = {};
      const activeStr = getActiveDateStr();
      appData.weights[activeStr] = val;
      
      saveData();
      closeWeightModal();
      showNotification('success', 'Gewicht gespeichert!');
    }

    function openCalcModal() {
      haptic();
      const todayWeight = appData.weights[getActiveDateStr()];
      if (todayWeight && !document.getElementById('calc-weight').value) document.getElementById('calc-weight').value = todayWeight;
      calculateTDEE(); openModal('calc-modal');
    }
    
    function closeCalcModal() { forceCloseAllModals(); }

    function calculateTDEE() {
      const gender = document.querySelector('input[name="calc-gender"]:checked').value;
      const age = parseFloat(document.getElementById('calc-age').value) || 0;
      const height = parseFloat(document.getElementById('calc-height').value) || 0;
      const weight = parseFloat(document.getElementById('calc-weight').value) || 0;
      const activity = parseFloat(document.getElementById('calc-activity').value);
      const goalModifier = parseFloat(document.getElementById('calc-goal').value);

      if (age > 0 && height > 0 && weight > 0) {
        let bmr = (10 * weight) + (6.25 * height) - (5 * age);
        bmr += (gender === 'male') ? 5 : -161;
        let tdee = bmr * activity;
        calcFinalResult = Math.round(tdee + goalModifier);
        if (gender === 'female' && calcFinalResult < 1200) calcFinalResult = 1200;
        if (gender === 'male' && calcFinalResult < 1500) calcFinalResult = 1500;
        document.getElementById('calc-result').innerText = calcFinalResult;
      } else {
        document.getElementById('calc-result').innerText = "--"; calcFinalResult = 0;
      }
    }

    function applyCalcResult() {
      if (calcFinalResult > 0) {
        document.getElementById('goal-kcal-input').value = calcFinalResult;
        appData.goalKcal = calcFinalResult;
        
        const activeStr = getActiveDateStr();
        if(!appData.dailyGoals) appData.dailyGoals = {};
        appData.dailyGoals[activeStr] = calcFinalResult;

        saveData(); closeCalcModal(); showNotification('success', 'Tagesziel wurde aktualisiert!');
      } else { showNotification('error', 'Bitte fülle Alter, Größe & Gewicht aus.'); }
    }

    function populateSettingsForm() {
      document.getElementById('api-key-input').value = appData.apiKey || '';
      const activeStr = getActiveDateStr();
      document.getElementById('goal-kcal-input').value = getGoalForDate(activeStr);
      document.getElementById('goal-water-input').value = appData.goalWater;
      document.getElementById('macro-c').value = appData.macroSplit.c;
      document.getElementById('macro-p').value = appData.macroSplit.p;
      document.getElementById('macro-f').value = appData.macroSplit.f;
    }

    function saveSettings() {
      const mc = Number(document.getElementById('macro-c').value) || 0;
      const mp = Number(document.getElementById('macro-p').value) || 0;
      const mf = Number(document.getElementById('macro-f').value) || 0;
      
      if(mc + mp + mf !== 100) {
        document.getElementById('macro-sum-warning').classList.replace('text-gray-400', 'text-red-500');
        showNotification('error', 'Makros müssen 100% ergeben!');
        return;
      }
      document.getElementById('macro-sum-warning').classList.replace('text-red-500', 'text-gray-400');

      appData.apiKey = document.getElementById('api-key-input').value.trim();
      appData.goalKcal = Number(document.getElementById('goal-kcal-input').value) || 2000;
      appData.goalWater = Number(document.getElementById('goal-water-input').value) || 8;
      appData.macroSplit = { c: mc, p: mp, f: mf };
      
      const activeStr = getActiveDateStr();
      if(!appData.dailyGoals) appData.dailyGoals = {};
      appData.dailyGoals[activeStr] = appData.goalKcal;

      saveData(); showNotification('success', 'Einstellungen gesichert');
    }

    function exportData() {
      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(appData));
      const downloadAnchorNode = document.createElement('a');
      downloadAnchorNode.setAttribute("href", dataStr);
      downloadAnchorNode.setAttribute("download", "nutrisnap_backup.json");
      document.body.appendChild(downloadAnchorNode);
      downloadAnchorNode.click(); downloadAnchorNode.remove();
      showNotification('success', 'Backup heruntergeladen!');
    }

    function importData(event) {
      const file = event.target.files[0]; if (!file) return;
      const reader = new FileReader();
      reader.onload = function(e) {
        try {
          const imported = JSON.parse(e.target.result);
          if (imported.meals) {
            appData = { ...appData, ...imported };
            if (!Array.isArray(appData.meals)) appData.meals = [];
            saveData(); populateSettingsForm(); showNotification('success', 'Daten importiert!');
          } else throw new Error();
        } catch(err) { showNotification('error', 'Fehler beim Import.'); }
      };
      reader.readAsText(file); event.target.value = '';
    }

    function requireApiKey() {
      if (!appData.apiKey) {
        showNotification('error', 'Bitte hinterlege den API-Schlüssel im Profil.');
        setTimeout(() => switchTab('settings'), 600); return false;
      } return true;
    }

    function openManualInput() { 
      haptic();
      tempMethod = 'Manuell'; editingMealId = null;
      document.getElementById('modal-title').innerText = "Manuell Eintragen";
      document.getElementById('save-fav-container').classList.remove('hidden');
      fillResultModal('', 0, 0, 0, 0); 
      openModal('result-modal'); 
    }
    
   function openFavorites() {
  haptic();
  const container = document.getElementById('fav-container');
  container.innerHTML = '';
  
  if (!appData.favorites || appData.favorites.length === 0) {
    container.innerHTML = '<div class="text-center text-gray-400 py-10"><i data-lucide="star-off" class="w-8 h-8 mx-auto mb-2 opacity-50"></i><p>Keine Favoriten gespeichert</p></div>';
  } else {
    appData.favorites.forEach(fav => {
      const itemEl = document.createElement('div');
      itemEl.className = 'w-full bg-white p-3 rounded-2xl flex justify-between items-center border border-gray-100 shadow-sm transition-all';
      
      itemEl.innerHTML = `
        <div class="flex-1 cursor-pointer active:scale-[0.98]" id="load-fav-${fav.id}">
          <div class="font-bold text-gray-800">${fav.name || 'Ohne Name'}</div>
          <div class="text-xs font-bold text-orange-600 mt-1">${fav.calories || 0} kcal</div>
        </div>
        <div class="flex items-center gap-1 ml-2">
          <button onclick="deleteFavorite(${fav.id})" class="w-10 h-10 flex items-center justify-center rounded-xl bg-gray-50 text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors active:scale-95">
            <i data-lucide="trash-2" class="w-5 h-5 pointer-events-none"></i>
          </button>
          <button id="add-fav-${fav.id}" class="w-10 h-10 bg-orange-100 rounded-xl flex items-center justify-center text-orange-600 hover:bg-orange-200 transition-colors active:scale-95">
            <i data-lucide="plus" class="w-5 h-5 pointer-events-none"></i>
          </button>
        </div>
      `;
      
      const loadAction = () => { 
        haptic(); tempMethod = 'Favorit'; editingMealId = null;
        document.getElementById('modal-title').innerText = "Aus Favoriten";
        document.getElementById('save-fav-container').classList.remove('hidden');
        fillResultModal(fav.name || 'Mahlzeit', fav.calories, fav.protein, fav.carbs, fav.fat, fav.amount || 100); 
        closeFavorites(); openModal('result-modal'); 
      };
      
      itemEl.querySelector(`#load-fav-${fav.id}`).onclick = loadAction;
      itemEl.querySelector(`#add-fav-${fav.id}`).onclick = loadAction;
      
      container.appendChild(itemEl);
    });
  }
  lucide.createIcons(); openModal('fav-modal');
}
    
    function closeFavorites() { forceCloseAllModals(); }

    function initSpeechRecognition() {
      if ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window) {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        recognition = new SpeechRecognition();
        recognition.lang = 'de-DE';
        recognition.interimResults = false;
        recognition.maxAlternatives = 1;

        recognition.onstart = function() {
          isRecording = true;
          const micBtn = document.getElementById('mic-btn');
          micBtn.classList.replace('bg-white', 'bg-red-500');
          micBtn.classList.replace('text-gray-500', 'text-white');
          micBtn.classList.add('animate-pulse');
          document.getElementById('ai-text-input').placeholder = 'Höre zu... Sprich jetzt!';
        };

        recognition.onresult = function(event) {
          const transcript = event.results[0][0].transcript;
          const input = document.getElementById('ai-text-input');
          input.value = input.value ? input.value + ' ' + transcript : transcript;
        };

        recognition.onerror = function(event) { if(event.error !== 'no-speech') stopRecordingUI(); };
        recognition.onend = function() { stopRecordingUI(); };
      } else { document.getElementById('mic-btn').style.display = 'none'; }
    }

    function toggleSpeechRecognition() {
      if (!recognition) { showNotification('error', 'Browser unterstützt keine Spracherkennung.'); return; }
      isRecording ? recognition.stop() : recognition.start();
    }

    function stopRecordingUI() {
      isRecording = false;
      const micBtn = document.getElementById('mic-btn');
      if(micBtn) {
        micBtn.classList.replace('bg-red-500', 'bg-white');
        micBtn.classList.replace('text-white', 'text-gray-500');
        micBtn.classList.remove('animate-pulse');
      }
      const inp = document.getElementById('ai-text-input');
      if(inp) inp.placeholder = 'Deine Mahlzeit...';
    }

    function startAiText() { 
      haptic();
      if (!requireApiKey()) return; 
      document.getElementById('ai-text-input').value = ''; 
      openModal('ai-text-modal'); 
    }
    
    function closeAiText() { 
      if(isRecording && recognition) recognition.stop(); 
      forceCloseAllModals(); 
    }
    
    function startAiPhoto(type) { 
      haptic();
      if (!requireApiKey()) return; 
      currentPhotoType = type; 
      document.getElementById('camera-input').click(); 
    }

     async function processAiText() {
      const input = document.getElementById('ai-text-input').value.trim();
      if (!input) return;
      if (isRecording && recognition) recognition.stop();

      const btn = document.getElementById('btn-process-text');
      btn.innerHTML = `<i data-lucide="loader-2" class="w-5 h-5 animate-spin"></i> Analysiere...`; 
      try { lucide.createIcons(); } catch(e){}

      try {
        // NEU: Simpler Prompt, da die Haupt-Regeln jetzt sicher im Hintergrund (callGroqAPI) liegen
        const res = await callGroqAPI("Analysiere diese Mahlzeit: " + input, null);
        
        tempMethod = 'KI-Text'; editingMealId = null;
        document.getElementById('modal-title').innerText = "KI Erkennung";
        document.getElementById('save-fav-container').classList.remove('hidden');
        
        fillResultModal(res.foodName, res.calories, res.protein, res.carbs, res.fat, res.amount || 100);
        
        forceCloseAllModals(); openModal('result-modal');
      } catch (e) { showNotification('error', e.message); } 
      finally { btn.innerHTML = `Analysieren`; }
    }

async function processAiPhoto(e) {
      const file = e.target.files[0]; if (!file) return; e.target.value = '';
      const isLabel = currentPhotoType === 'label';
      showNotification('info', isLabel ? 'Lese Tabelle...' : 'Analysiere Foto...');
      
      try {
        const b64 = await convertFileToBase64(file);
        
        let prompt = "Analysiere das Essen auf diesem Bild. Berechne das Gesamtgewicht und die Gesamtkalorien für ALLES, was du auf dem Teller/Bild siehst.";
        
        if (isLabel) {
            prompt = "WICHTIG: Du bist ein strenges OCR-Programm. Lies EXAKT die Zahlen aus der Spalte 'pro 100g'. Achte extrem penibel auf Kommastellen bei kleinen Werten (z.B. 1,2g). Erfinde nichts, rate nichts! Suche 'Brennwert (kcal)' für calories, 'Eiweiß' für protein, 'Kohlenhydrate' für carbs und 'Fett' für fat. Setze 'amount' zwingend auf 100. foodName ist 'Gescannter Artikel'.";
        }

        const res = await callGroqAPI(prompt, b64);
        tempMethod = isLabel ? 'KI-Scanner' : 'KI-Foto'; 
        editingMealId = null;
        document.getElementById('modal-title').innerText = isLabel ? "Tabellen-Scan" : "KI Foto-Scan";
        document.getElementById('save-fav-container').classList.remove('hidden');
        
        fillResultModal(res.foodName, res.calories, res.protein, res.carbs, res.fat, res.amount || 100);
        openModal('result-modal');
      } catch (err) { showNotification('error', 'Fehler: ' + err.message); }
    }

    function convertFileToBase64(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader(); reader.readAsDataURL(file);
        reader.onload = () => {
          let encoded = reader.result.toString().replace(/^data:(.*,)?/, '');
          if ((encoded.length % 4) > 0) encoded += '='.repeat(4 - (encoded.length % 4));
          resolve(encoded);
        };
        reader.onerror = error => reject(error);
      });
    }

   async function callGroqAPI(prompt, base64Image) {
      const endpoint = `https://api.groq.com/openai/v1/chat/completions`;
      
      const sysInst = `Du bist ein hochpräziser Ernährungs-Experte. 
Regeln:
1. Du bist eine virtuelle Waage. Schätze das GESAMTGEWICHT der Portion realistisch ein. (Beispiel: Ein normaler Apfel wiegt ca. 180g-200g und hat etwa 95 kcal. Ein Teller Nudeln wiegt ca. 350g-400g).
2. Berechne die GESAMTKALORIEN und Makros für EXAKT DIESE geschätzte Gesamtportion.
3. Die Mathematik muss zwingend stimmen: (carbs * 4) + (protein * 4) + (fat * 9) = calories.
4. Antworte IMMER im puren JSON-Format. KEIN Markdown (kein \`\`\`json). 
5. Die Keys MÜSSEN exakt so heißen: foodName (String), amount (Number), calories (Number), protein (Number), carbs (Number), fat (Number).`;
      
      const model = base64Image ? "meta-llama/llama-4-scout-17b-16e-instruct" : "llama-3.3-70b-versatile";
      
      let messages = [
        { role: "system", content: sysInst }
      ];

      if (base64Image) {
        messages.push({
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64Image}` } }
          ]
        });
      } else {
        messages.push({
          role: "user",
          content: prompt
        });
      }

      const response = await fetch(endpoint, {
        method: 'POST', 
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${appData.apiKey}` 
        },
        body: JSON.stringify({ 
          model: model,
          messages: messages, 
          temperature: 0.1 
        })
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error?.message || 'API Fehler');
      }

      const data = await response.json();
      let text = data.choices[0].message.content.replace(/```json/gi, '').replace(/```/g, '').trim();
      return JSON.parse(text);
    }

   // --- NEUER ROBUSTER LIVE RECHNER ---
    function scaleNutrients() {
      const yourWeight = Number(document.getElementById('res-your-weight').value) || 0;
      if (yourWeight <= 0) return;
      
      const factor = yourWeight / 100;
      
      // Saubere mathematische Rundung, damit HTML-Zahlenfelder nicht verrückt spielen
      document.getElementById('res-cal').value = Math.round(baseNutrients.cal * factor);
      document.getElementById('res-pro').value = Math.round(baseNutrients.pro * factor * 10) / 10;
      document.getElementById('res-carbs').value = Math.round(baseNutrients.carbs * factor * 10) / 10;
      document.getElementById('res-fat').value = Math.round(baseNutrients.fat * factor * 10) / 10;
    }

    function updateBaseFromInputs() {
      const yourWeight = Number(document.getElementById('res-your-weight').value) || 100;
      const factorTo100 = yourWeight > 0 ? (100 / yourWeight) : 1;

      baseNutrients.cal = (Number(document.getElementById('res-cal').value) || 0) * factorTo100;
      baseNutrients.pro = (Number(document.getElementById('res-pro').value) || 0) * factorTo100;
      baseNutrients.carbs = (Number(document.getElementById('res-carbs').value) || 0) * factorTo100;
      baseNutrients.fat = (Number(document.getElementById('res-fat').value) || 0) * factorTo100;
    }
   
    function fillResultModal(n, c, p, cb, f, amount = 100) {
      document.getElementById('res-name').value = n || ''; 

      // Rechnet die KI-Gesamtwerte im Hintergrund auf 100g um, damit die Skalierung beim Tippen immer stimmt
      const factorTo100 = amount > 0 ? (100 / amount) : 1;

      baseNutrients.cal = (Number(c) || 0) * factorTo100;
      baseNutrients.pro = (Number(p) || 0) * factorTo100;
      baseNutrients.carbs = (Number(cb) || 0) * factorTo100;
      baseNutrients.fat = (Number(f) || 0) * factorTo100;

      document.getElementById('res-ref-weight').value = 100;
      
      // Trägt das von der KI geschätzte Gesamtgewicht ein (du musst nichts tippen!)
      document.getElementById('res-your-weight').value = amount;

      // Trägt die fertig berechneten Gesamtkalorien ein
      document.getElementById('res-cal').value = Math.round(Number(c) || 0);
      document.getElementById('res-pro').value = Math.round((Number(p) || 0) * 10) / 10;
      document.getElementById('res-carbs').value = Math.round((Number(cb) || 0) * 10) / 10;
      document.getElementById('res-fat').value = Math.round((Number(f) || 0) * 10) / 10;
      
      document.getElementById('res-save-fav').checked = false;

      // Zeigt den Rechner ab sofort IMMER an, damit du volle Kontrolle hast
      const liveRechner = document.getElementById('live-rechner');
      if (liveRechner) {
         liveRechner.classList.remove('hidden');
      }
    }

    function closeResultModal() {
      forceCloseAllModals();
      editingMealId = null; 
    }

    function saveFinalResult() {
      try {
        const n = document.getElementById('res-name').value.trim() || 'Mahlzeit';
        let c = Number(document.getElementById('res-cal').value) || 0;
        const p = Number(document.getElementById('res-pro').value) || 0;
        const cb = Number(document.getElementById('res-carbs').value) || 0;
        const f = Number(document.getElementById('res-fat').value) || 0;
        const amount = Number(document.getElementById('res-your-weight').value) || 100;
        const fav = document.getElementById('res-save-fav').checked;

        // BUGFIX DASHBOARD-SCHUTZ: Zwingt Kalorien zur Korrektheit, falls die KI sich stark verrechnet hat
        const trueKcal = Math.round((cb * 4) + (p * 4) + (f * 9));
        // Erlaubt minimale Abweichungen durch Ballaststoffe (die anders verrechnet werden), korrigiert aber grobe K.I. Halluzinationen
        if (Math.abs(c - trueKcal) > 30 && trueKcal > 0) {
            c = trueKcal; 
        }

        if (!Array.isArray(appData.meals)) appData.meals = [];

        if (editingMealId) {
          const index = appData.meals.findIndex(m => m.id === editingMealId);
          if (index !== -1) {
            appData.meals[index] = { ...appData.meals[index], name: n, calories: c, protein: p, carbs: cb, fat: f, amount: amount };
          }
        } else {
          const datePrefix = getActiveDateStr();
          const timeNow = new Date().toTimeString().split(' ')[0];
          const ts = `${datePrefix}T${timeNow}.000Z`;
          
          appData.meals.unshift({ id: Date.now(), name: n, calories: c, protein: p, carbs: cb, fat: f, timestamp: ts, method: tempMethod, amount: amount });
        }

        if (!editingMealId && fav) {
          if (!Array.isArray(appData.favorites)) appData.favorites = [];
          const isAlreadyFav = appData.favorites.some(x => {
            if(!x.name) return false;
            return String(x.name).toLowerCase() === String(n).toLowerCase();
          });
          if(!isAlreadyFav) {
             appData.favorites.push({ id: Date.now()+1, name: n, calories: c, protein: p, carbs: cb, fat: f, amount: amount });
          }
        }

        saveData(); 
        switchTab('diary');
        showNotification('success', `Eintrag gespeichert!`);

      } catch(err) {
        console.error("Kritischer Fehler beim Speichern:", err);
        showNotification('error', 'Fehler: ' + err.message);
      } finally {
        forceCloseAllModals();
        editingMealId = null;
      }
    }

    function showNotification(type, msg) {
      haptic();
      const cont = document.getElementById('toast-container'); const t = document.createElement('div');
      let bg = type === 'success' ? 'bg-emerald-600' : (type === 'error' ? 'bg-red-500' : 'bg-blue-600');
      let ic = type === 'success' ? 'check-circle' : (type === 'error' ? 'alert-triangle' : 'info');
      
      t.className = `${bg} text-white px-5 py-4 rounded-2xl shadow-xl flex items-center gap-3 text-sm font-bold toast-enter`;
      t.innerHTML = `<i data-lucide="${ic}" class="w-5 h-5"></i> <span>${msg}</span>`;
      cont.appendChild(t); 
      
      try { lucide.createIcons(); } catch(e){}
      
      setTimeout(() => { t.classList.replace('toast-enter', 'toast-exit'); setTimeout(() => t.remove(), 300); }, 3000);
    }

    init();
    // --- Barcode Scanner Logic ---
let html5QrCode = null;

function openScanner() {
  haptic();
  openModal('scanner-modal');

  if (!html5QrCode) {
    html5QrCode = new Html5Qrcode("reader");
  }

  html5QrCode.start(
    { facingMode: "environment" },
    { fps: 10, qrbox: { width: 250, height: 150 } },
    (decodedText) => {
      haptic();
      closeScanner(); 
      fetchFoodData(decodedText); 
    },
    (errorMessage) => { 
    }
  ).then(() => {
    const loadingEl = document.getElementById('scanner-loading');
    if(loadingEl) loadingEl.style.display = 'none';
  }).catch((err) => {
    console.error("Kamerafehler", err);
    alert("Bitte erlaube den Kamera-Zugriff in deinem Browser.");
  });
}

function closeScanner() {
  haptic();
  closeModal('scanner-modal');
  
  const loadingEl = document.getElementById('scanner-loading');
  if(loadingEl) loadingEl.style.display = 'flex';
  
  if (html5QrCode && html5QrCode.isScanning) {
    html5QrCode.stop();
  }
}

async function fetchFoodData(barcode) {
  console.log("Suche im Internet nach Barcode: " + barcode);
  
  try {
    const response = await fetch(`https://world.openfoodfacts.org/api/v0/product/${barcode}.json`);
    const data = await response.json();

    if (data.status === 1) {
      const product = data.product;
      const name = product.product_name || "Unbekanntes Produkt";
      
      // BUGFIX BARCODE: Falls die DB keine kcal hat, sondern nur kJ (Energie in Joule), umrechnen!
      let kcal = product.nutriments['energy-kcal_100g'];
      if (kcal === undefined) {
        kcal = product.nutriments['energy_100g'] ? (product.nutriments['energy_100g'] / 4.184) : 0;
      }
      kcal = Math.round(kcal);
      
      tempMethod = 'KI-Scanner'; 
      editingMealId = null;
      document.getElementById('modal-title').innerText = "Barcode-Scan";
      document.getElementById('save-fav-container').classList.remove('hidden');
      
      fillResultModal(
        name, 
        kcal, 
        product.nutriments['proteins_100g'] || 0, 
        product.nutriments['carbohydrates_100g'] || 0, 
        product.nutriments['fat_100g'] || 0,
        100
      );
      
      openModal('result-modal');
      
    } else {
      alert("Schade, dieses Produkt ist noch nicht in der Datenbank.");
    }
  } catch (error) {
    console.error("Datenbank-Fehler:", error);
    alert("Konnte keine Verbindung zum Internet herstellen.");
  }
}
