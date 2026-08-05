// ============================================================
// 予約システム v2（月一括取得対応）
// GASにまるごと貼り替えて新バージョンでデプロイ
// ============================================================

var CALENDAR_ID  = 'poritan.the.dk@gmail.com';
var NOTIFY_EMAIL = 'putter.matsumoto@gmail.com';
var SHEET_ID     = '1Me9JRGM8VKahuYrSSHskJ75z2OCcQSUg42zOojOTmf8';

var DAY_SLOTS = {
  weekday: [{h:9,m:0},{h:10,m:0},{h:11,m:0},{h:12,m:30},{h:14,m:0},{h:15,m:0},{h:16,m:0},{h:18,m:0},{h:19,m:0}],
  sat:     [{h:9,m:0},{h:10,m:0},{h:11,m:0},{h:14,m:0},{h:15,m:0},{h:16,m:0}],
  sun:     [{h:9,m:0},{h:10,m:0},{h:11,m:0},{h:13,m:0},{h:14,m:0},{h:15,m:0}]
};

// レンタルジムの時間枠（木曜は終日休み）
var RENTAL_DAY_SLOTS = {
  1: [{h:20,m:0},{h:21,m:0},{h:22,m:0}],   // 月
  2: [{h:20,m:0},{h:21,m:0},{h:22,m:0}],   // 火
  3: [{h:20,m:0},{h:21,m:0},{h:22,m:0}],   // 水
  4: [{h:10,m:0},{h:11,m:0},{h:12,m:0},{h:13,m:0},{h:14,m:0},{h:15,m:0},{h:16,m:0},{h:17,m:0},{h:18,m:0},{h:19,m:0},{h:20,m:0},{h:21,m:0},{h:22,m:0}], // 木
  5: [{h:21,m:0},{h:22,m:0}],               // 金
  6: [{h:18,m:0},{h:19,m:0},{h:20,m:0},{h:21,m:0}], // 土
  0: [{h:18,m:0},{h:19,m:0},{h:20,m:0},{h:21,m:0}]  // 日
};

function pad(n){ return String(n).padStart(2,'0'); }
function timeStr(h,m){ return pad(h)+':'+pad(m); }
function getSlotsForDay(dow){ return dow===0?DAY_SLOTS.sun:dow===6?DAY_SLOTS.sat:DAY_SLOTS.weekday; }

function doGet(e) {
  const action = e && e.parameter && e.parameter.action;

  if (action === 'admin_summary') return adminSummary();
  if (action === 'admin_monthly') return adminMonthly(e.parameter.month);
  if (action === 'admin_homework') return adminHomework();
  if (action === 'admin_add_homework') return adminAddHomework(e.parameter.name, e.parameter.task);
  if (action === 'admin_delete_homework') return adminDeleteHomework(e.parameter.name, e.parameter.task);
  if (action === 'admin_holidays') return getHolidayDates();
  if (action === 'admin_add_holiday') return addHoliday(e.parameter.date);
  if (action === 'admin_delete_holiday') return deleteHoliday(e.parameter.date);
  if (action === 'check_shift') return checkShift(e.parameter.name);
  if (action === 'available_slots') return availableSlots(e.parameter.date);
  if (action === 'month_slots') return monthSlots(e.parameter.month);
  if (action === 'user_schedule') return userSchedule(e.parameter.name, e.parameter.month);
  if (action === 'saveSteps') {
    saveSteps(e.parameter.userId, e.parameter.displayName, e.parameter.steps, e.parameter.date);
    return json({ ok: true });
  }
  if (action === 'getWeeklyRanking') return json(getWeeklyRanking());
  if (action === 'checkYesterdayTraining') return json(checkYesterdayTraining(e.parameter.name));
  if (action === 'checkTomorrowTraining') return json(checkTomorrowTraining(e.parameter.name));
  if (action === 'getSorenessHistory') return json(getSorenessHistory());
  if (action === 'getIdeas') return json(getIdeas(e.parameter.name));
  if (action === 'getRandomTasks') return json(getRandomTasksList());
  if (action === 'sendNoteTheme') { sendNoteTheme(); return json({ ok: true }); }
  if (action === 'admin_client_history') return adminClientHistory(e.parameter.name);
  if (action === 'admin_textbook_watch') return adminTextbookWatch();
  if (action === 'admin_reason_read') return adminReasonRead();
  if (action === 'admin_weekly_activity') return adminWeeklyActivity();
  if (action === 'rental_slots') return rentalSlots(e.parameter.date);

  const userName = e && e.parameter && e.parameter.name;
  if (userName) return getHomeworkForUser(userName);

  return ContentService.createTextOutput('ok');
}

function doPost(e) {
  const data = JSON.parse(e.postData.contents);
  if (data.action === 'book') return bookAppointment(data);
  if (data.action === 'book_all') return bookAll(data);
  if (data.action === 'feedback') return saveFeedback(data);
  if (data.action === 'saveSoreness') { saveSoreness(data.name, data.date, data.parts); return json({ ok: true }); }
  if (data.action === 'saveIdea') { saveIdea(data.name, data.text); return json({ ok: true }); }
  if (data.action === 'addRandomTask') { addRandomTask(data.task); return json({ ok: true }); }
  if (data.action === 'deleteRandomTask') { deleteRandomTask(data.index); return json({ ok: true }); }
  if (data.action === 'saveTextbookWatch') { saveTextbookWatch(data.name, data.videoId, data.watched); return json({ ok: true }); }
  if (data.action === 'saveReasonRead') { saveReasonRead(data.name, data.slug, data.read); return json({ ok: true }); }
  if (data.action === 'book_rental') return bookRental(data);
  // 日々の記録保存
  if (data.name && data.date) return saveRecord(data);
  return json({ ok: false });
}

function saveRecord(data) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName('記録');
  if (!sheet) return json({ ok: false, error: '記録シートがありません' });

  // 同じ名前・日付の既存行を探して上書き
  const rows = sheet.getDataRange().getValues();
  const dateStr = data.date;
  const name = data.name;
  for (let i = 1; i < rows.length; i++) {
    const rowDate = rows[i][0] ? Utilities.formatDate(new Date(rows[i][0]), 'Asia/Tokyo', 'yyyy-MM-dd') : '';
    if (rowDate === dateStr && rows[i][1] === name) {
      sheet.getRange(i + 1, 1, 1, 13).setValues([[
        dateStr, name, data.weight || '', data.goalWeight || '', data.temperature || '',
        data.foods || '', data.p || 0, data.f || 0, data.c || 0, data.kcal || 0,
        data.cardio || 0, data.checkedTasks || '', data.uncheckedTasks || ''
      ]]);
      return json({ ok: true, updated: true });
    }
  }

  // 新規行を追加
  sheet.appendRow([
    dateStr, name, data.weight || '', data.goalWeight || '', data.temperature || '',
    data.foods || '', data.p || 0, data.f || 0, data.c || 0, data.kcal || 0,
    data.cardio || 0, data.checkedTasks || '', data.uncheckedTasks || ''
  ]);
  return json({ ok: true, created: true });
}

function saveFeedback(data) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName('意見箱') || ss.insertSheet('意見箱');
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['日付', '名前', 'やってみたいトレーニング', 'わからなかったこと', '今後の目標']);
  }
  sheet.appendRow([data.date, data.name, data.training || '', data.question || '', data.goal || '']);
  return json({ ok: true });
}

function checkShift(name) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName('宿題');
  if (!sheet || !name) return json({ isShift: false, isShiftSpecial: false });
  const data = sheet.getDataRange().getValues();
  for (const row of data) {
    if (row[0] === name) {
      const val = row[1] ? String(row[1]) : '';
      const isShiftSpecial = val === 'シフト制特別';
      const isShift = val.includes('シフト制');
      const isRental = val === 'レンタルジム';
      return json({ isShift: !!isShift, isShiftSpecial: !!isShiftSpecial, isRental: !!isRental });
    }
  }
  return json({ isShift: false, isShiftSpecial: false });
}

function availableSlots(dateStr) {
  if (!dateStr) return json({ slots: [] });
  const date = new Date(dateStr + 'T00:00:00');
  const dow = date.getDay();

  if (dow === 4) return json({ closed: true });

  const holidays = getHolidayList();
  if (holidays.includes(dateStr)) return json({ holiday: true });

  const daySlots = getSlotsForDay(dow);

  const cal = CalendarApp.getCalendarById(CALENDAR_ID);
  const start = new Date(dateStr + 'T00:00:00');
  const end = new Date(dateStr + 'T23:59:59');
  const events = cal.getEvents(start, end);
  const takenKeys = {};
  events.forEach(ev => {
    const s = ev.getStartTime();
    takenKeys[s.getHours() + '_' + s.getMinutes()] = true;
  });

  const slots = daySlots.map(s => {
    // 12:30は11:00と14:00が両方埋まっているときだけ表示
    if (s.h === 12 && s.m === 30) {
      if (!takenKeys['11_0'] || !takenKeys['14_0']) return null;
    }
    return { time: timeStr(s.h, s.m), available: !takenKeys[s.h + '_' + s.m] };
  }).filter(s => s !== null);

  return json({ slots });
}

function monthSlots(month) {
  if (!month) return json({});
  const holidays = getHolidayList();
  const start = new Date(month + '-01T00:00:00');
  const daysInMonth = new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate();

  const cal = CalendarApp.getCalendarById(CALENDAR_ID);
  const end = new Date(month + '-' + String(daysInMonth).padStart(2,'0') + 'T23:59:59');
  const events = cal.getEvents(start, end);

  const booked = {};
  events.forEach(ev => {
    const d = Utilities.formatDate(ev.getStartTime(), 'Asia/Tokyo', 'yyyy-MM-dd');
    const h = ev.getStartTime().getHours();
    const m = ev.getStartTime().getMinutes();
    if (!booked[d]) booked[d] = [];
    booked[d].push(h + '_' + m);
  });

  const result = {};
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = month + '-' + String(d).padStart(2,'0');
    const dow = new Date(dateStr + 'T00:00:00').getDay();
    if (dow === 4) { result[dateStr] = { closed: true }; continue; }
    if (holidays.includes(dateStr)) { result[dateStr] = { holiday: true }; continue; }
    const daySlots = getSlotsForDay(dow);
    const taken = booked[dateStr] || [];
    const slots = daySlots.map(s => {
      if (s.h === 12 && s.m === 30) {
        if (!taken.includes('11_0') || !taken.includes('14_0')) return null;
      }
      return { time: timeStr(s.h, s.m), available: !taken.includes(s.h + '_' + s.m) };
    }).filter(s => s !== null);
    result[dateStr] = { slots };
  }
  return json(result);
}

function bookAll(data) {
  const { name, items } = data; // items: [{date, time}, ...]
  if (!name || !items || items.length === 0) return json({ ok: false });

  const cal = CalendarApp.getCalendarById(CALENDAR_ID);
  const failed = [];
  const booked = [];

  items.forEach(item => {
    const parts = item.time.split(':');
    const h = parseInt(parts[0]), m = parseInt(parts[1]);
    const start = new Date(item.date + 'T' + pad(h) + ':' + pad(m) + ':00');
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    if (cal.getEvents(start, end).length > 0) {
      failed.push(item);
    } else {
      cal.createEvent(name, start, end);
      booked.push({ date: item.date, time: item.time, start });
    }
  });

  // まとめて1通メール
  if (booked.length > 0) {
    try {
      const lines = booked.map(b => {
        const dateLabel = Utilities.formatDate(b.start, 'Asia/Tokyo', 'yyyy年M月d日');
        const endH = Math.floor((b.start.getHours() * 60 + b.start.getMinutes() + 60) / 60);
        const endM = (b.start.getHours() * 60 + b.start.getMinutes() + 60) % 60;
        return dateLabel + ' ' + b.time + '〜' + timeStr(endH, endM);
      }).join('\n');
      MailApp.sendEmail(
        NOTIFY_EMAIL,
        '【PUTTERS】新規予約が入りました（' + booked.length + '件）',
        '【新規予約】\n\nお名前：' + name + '\n\n' + lines + '\n\n予約システムより自動送信'
      );
    } catch(e) {}
  }

  return json({ ok: true, booked: booked.length, failed });
}

function bookAppointment(data) {
  const { name, date, time } = data;
  if (!name || !date || !time) return json({ ok: false });

  const parts = time.split(':');
  const h = parseInt(parts[0]), m = parseInt(parts[1]);
  const start = new Date(date + 'T' + pad(h) + ':' + pad(m) + ':00');
  const end = new Date(start.getTime() + 60 * 60 * 1000);

  const cal = CalendarApp.getCalendarById(CALENDAR_ID);

  if (cal.getEvents(start, end).length > 0) return json({ ok: false, error: 'already booked' });

  cal.createEvent(name, start, end);

  try {
    const dateLabel = Utilities.formatDate(start, 'Asia/Tokyo', 'yyyy年M月d日');
    const endH = Math.floor((h * 60 + m + 60) / 60);
    const endM = (h * 60 + m + 60) % 60;
    MailApp.sendEmail(
      NOTIFY_EMAIL,
      '【PUTTERS】新規予約が入りました',
      '【新規予約】\n\nお名前：' + name + '\n\n' + dateLabel + ' ' + time + '〜' + timeStr(endH, endM) + '\n\n予約システムより自動送信'
    );
  } catch(e) {}

  return json({ ok: true });
}

function userSchedule(name, month) {
  if (!name || !month) return json([]);
  const cal = CalendarApp.getCalendarById(CALENDAR_ID);
  const start = new Date(month + '-01T00:00:00');
  const end = new Date(new Date(start).setMonth(start.getMonth() + 1));
  const events = cal.getEvents(start, end);
  const result = events
    .filter(ev => ev.getTitle() === name || ev.getTitle() === 'レンタルジム - ' + name)
    .map(ev => ({
      date: Utilities.formatDate(ev.getStartTime(), 'Asia/Tokyo', 'yyyy-MM-dd'),
      time: Utilities.formatDate(ev.getStartTime(), 'Asia/Tokyo', 'HH:mm'),
      type: ev.getTitle() === name ? 'gym' : 'rental'
    }));
  return json(result);
}

function getHolidayList() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName('休み') || ss.insertSheet('休み');
  const data = sheet.getDataRange().getValues();
  return data.flat().filter(v => v).map(v => {
    try { return Utilities.formatDate(new Date(v), 'Asia/Tokyo', 'yyyy-MM-dd'); } catch(e) { return String(v); }
  });
}

function getHolidayDates() {
  return json(getHolidayList());
}

function addHoliday(dateStr) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName('休み') || ss.insertSheet('休み');
  const existing = getHolidayList();
  if (existing.includes(dateStr)) return json({ ok: false, error: 'already exists' });
  sheet.appendRow([dateStr]);
  return json({ ok: true });
}

function deleteHoliday(dateStr) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName('休み') || ss.insertSheet('休み');
  const data = sheet.getDataRange().getValues();
  for (let i = 0; i < data.length; i++) {
    let str = '';
    try { str = Utilities.formatDate(new Date(data[i][0]), 'Asia/Tokyo', 'yyyy-MM-dd'); } catch(e) { str = String(data[i][0]); }
    if (str === dateStr) { sheet.deleteRow(i + 1); return json({ ok: true }); }
  }
  return json({ ok: false });
}

function adminSummary() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName('記録') || ss.getSheets()[0];
  const data = sheet.getDataRange().getValues();
  const latest = {};
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const date = row[0]; const name = row[1];
    if (!name) continue;
    if (!latest[name] || new Date(date) > new Date(latest[name].date)) {
      latest[name] = { date: Utilities.formatDate(new Date(date), 'Asia/Tokyo', 'yyyy-MM-dd'), name, weight: row[2]||'-', foods: row[5]||'-', p: row[6]||0, f: row[7]||0, c: row[8]||0, kcal: row[9]||0, cardio: row[10]||0 };
    }
  }
  return json(Object.values(latest).sort((a,b) => b.date.localeCompare(a.date)));
}

function adminMonthly(month) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName('記録') || ss.getSheets()[0];
  const data = sheet.getDataRange().getValues();
  const grouped = {};
  for (let i = 1; i < data.length; i++) {
    const row = data[i]; const date = row[0]; if (!date) continue;
    const dateStr = Utilities.formatDate(new Date(date), 'Asia/Tokyo', 'yyyy-MM-dd');
    if (!dateStr.startsWith(month)) continue;
    const name = row[1]; if (!name) continue;
    if (!grouped[name]) grouped[name] = [];
    grouped[name].push({ date: dateStr, weight: parseFloat(row[2])||null, p: parseFloat(row[6])||0, f: parseFloat(row[7])||0, c: parseFloat(row[8])||0, kcal: parseFloat(row[9])||0, cardio: parseFloat(row[10])||0 });
  }
  const result = Object.entries(grouped).map(([name, records]) => {
    records.sort((a,b) => a.date.localeCompare(b.date));
    const weights = records.map(r => r.weight).filter(w => w !== null);
    const avgWeight = weights.length > 0 ? (weights.reduce((s,v)=>s+v,0)/weights.length).toFixed(1) : '-';
    const weightChange = weights.length >= 2 ? (weights[weights.length-1]-weights[0]).toFixed(1) : '-';
    const avg = key => (records.reduce((s,r)=>s+r[key],0)/records.length).toFixed(1);
    return { name, days: records.length, avgWeight, weightChange, avgP: avg('p'), avgF: avg('f'), avgC: avg('c'), avgKcal: Math.round(records.reduce((s,r)=>s+r.kcal,0)/records.length), totalCardio: records.reduce((s,r)=>s+r.cardio,0) };
  }).sort((a,b) => b.days-a.days);
  return json(result);
}

function adminHomework() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName('宿題');
  if (!sheet) return json([]);
  const data = sheet.getDataRange().getValues();
  return json(data.map(row => ({ name: row[0], tasks: row.slice(2).filter(t => t !== '') })).filter(r => r.name));
}

function adminAddHomework(name, task) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName('宿題');
  if (!sheet || !name || !task) return json({ ok: false });
  const data = sheet.getDataRange().getValues();
  for (let i = 0; i < data.length; i++) {
    if (data[i][0] === name) {
      const col = Math.max(data[i].filter(c => c !== '').length + 1, 3);
      sheet.getRange(i+1, col).setValue(task);
      return json({ ok: true });
    }
  }
  return json({ ok: false, error: 'name not found' });
}

function adminDeleteHomework(name, task) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName('宿題');
  if (!sheet || !name || !task) return json({ ok: false });
  const data = sheet.getDataRange().getValues();
  for (let i = 0; i < data.length; i++) {
    if (data[i][0] === name) {
      for (let j = 2; j < data[i].length; j++) {
        if (data[i][j] === task) {
          const row = sheet.getRange(i+1, 1, 1, data[i].length);
          const vals = row.getValues()[0];
          vals.splice(j, 1); vals.push('');
          row.setValues([vals]);
          return json({ ok: true });
        }
      }
    }
  }
  return json({ ok: false });
}

function getHomeworkForUser(userName) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName('宿題');
  if (!sheet) return json({ tasks: [], userExists: false, status: '' });
  const data = sheet.getDataRange().getValues();
  for (const row of data) {
    if (row[0] === userName) {
      const status = String(row[1] || '').trim();
      const tasks = row.slice(2).filter(t => t !== '');
      // 「ランダム宿題」を日付シードで1個に差し替え
      // 「ランダム宿題」が複数ある場合も対応（重複しないよう順番に除外）
      const fixedTasks = tasks.filter(t => t !== 'ランダム宿題');
      const chosenRandom = [];
      const videoUrlMap = getVideoUrlMap();
      const videoUrls = {};
      let i = 0;
      while (i < tasks.length) {
        if (tasks[i] === 'ランダム宿題') {
          const exclude = [...fixedTasks, ...chosenRandom];
          const result = getRandomTaskForToday(exclude, chosenRandom.length);
          if (result) {
            tasks[i] = result.task;
            // 「動画」シート優先、なければランダム宿題B列
            const url = videoUrlMap[result.task] || result.videoUrl || '';
            if (url) videoUrls[result.task] = url;
            chosenRandom.push(result.task);
            i++;
          } else {
            tasks.splice(i, 1);
          }
        } else {
          // 固定宿題は「動画」シートから
          const url = videoUrlMap[tasks[i]] || '';
          if (url) videoUrls[tasks[i]] = url;
          i++;
        }
      }
      return json({ tasks, videoUrls, userExists: true, status });
    }
  }
  return json({ tasks: [], userExists: false, status: '' });
}

function rentalSlots(dateStr) {
  if (!dateStr) return json({ slots: [] });
  const date = new Date(dateStr + 'T00:00:00');
  const dow = date.getDay();
  const daySlots = RENTAL_DAY_SLOTS[dow];
  if (!daySlots) return json({ closed: true });

  const cal = CalendarApp.getCalendarById(CALENDAR_ID);
  const start = new Date(dateStr + 'T00:00:00');
  const end = new Date(dateStr + 'T23:59:59');
  const events = cal.getEvents(start, end);
  const takenKeys = {};
  events.forEach(ev => {
    const s = ev.getStartTime();
    takenKeys[s.getHours() + '_' + s.getMinutes()] = true;
  });

  const slots = daySlots.map(s => ({
    time: timeStr(s.h, s.m),
    available: !takenKeys[s.h + '_' + s.m]
  }));
  return json({ slots });
}

function bookRental(data) {
  const { name, date, time } = data;
  if (!name || !date || !time) return json({ ok: false, error: 'missing params' });

  const parts = time.split(':');
  const h = parseInt(parts[0]), m = parseInt(parts[1]);
  const dow = new Date(date + 'T00:00:00').getDay();
  const allowed = RENTAL_DAY_SLOTS[dow];
  if (!allowed) return json({ ok: false, error: '定休日です' });
  if (!allowed.some(s => s.h === h && s.m === m)) return json({ ok: false, error: 'その時間は予約できません' });

  const start = new Date(date + 'T' + pad(h) + ':' + pad(m) + ':00');
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  const cal = CalendarApp.getCalendarById(CALENDAR_ID);

  if (cal.getEvents(start, end).length > 0) return json({ ok: false, error: '既に埋まっています' });

  cal.createEvent('レンタルジム - ' + name, start, end);

  const dateLabel = Utilities.formatDate(start, 'Asia/Tokyo', 'M月d日(E)');
  MailApp.sendEmail(NOTIFY_EMAIL, 'レンタルジム予約：' + name,
    name + ' さんがレンタルジムを予約しました。\n\n日時：' + dateLabel + ' ' + time + '〜\n');

  return json({ ok: true });
}

function getRandomTasksList() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sheet = ss.getSheetByName('ランダム宿題');
  if (!sheet) return { tasks: [] };
  const tasks = sheet.getDataRange().getValues().map(r => r[0]).filter(t => t !== '' && t !== 'タスク');
  return { tasks };
}

function addRandomTask(task) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sheet = ss.getSheetByName('ランダム宿題');
  if (!sheet) {
    sheet = ss.insertSheet('ランダム宿題');
    sheet.getRange(1,1).setValue('タスク');
  }
  sheet.appendRow([task]);
}

function deleteRandomTask(index) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName('ランダム宿題');
  if (!sheet) return;
  // ヘッダー行（1行目）を除いた index 番目を削除
  sheet.deleteRow(index + 2);
}

function getVideoUrlMap() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName('動画');
  if (!sheet) return {};
  const rows = sheet.getDataRange().getValues();
  const map = {};
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] && rows[i][1]) map[rows[i][0]] = rows[i][1];
  }
  return map;
}

function getRandomTaskForToday(excludeTasks, offset) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName('ランダム宿題');
  if (!sheet) return null;
  let rows = sheet.getDataRange().getValues().filter(r => r[0] !== '' && r[0] !== 'タスク');
  // すでに固定宿題・選択済みランダムにある場合は除外
  if (excludeTasks && excludeTasks.length > 0) {
    rows = rows.filter(r => !excludeTasks.includes(r[0]));
  }
  if (rows.length === 0) return null;
  // 26時切り替えに合わせて2時間前の日付をシードにする
  const now = new Date(new Date().getTime() - 2 * 60 * 60 * 1000);
  const today = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyyMMdd');
  const seed = (parseInt(today) + (offset || 0)) % rows.length;
  return { task: rows[seed][0], videoUrl: rows[seed][1] || '' };
}

function adminClientHistory(name) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName('記録');
  if (!sheet || !name) return json([]);
  const rows = sheet.getDataRange().getValues();
  const records = [];
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][1] !== name) continue;
    const dateStr = rows[i][0] ? Utilities.formatDate(new Date(rows[i][0]), 'Asia/Tokyo', 'yyyy-MM-dd') : '';
    if (!dateStr) continue;
    records.push({
      date: dateStr,
      weight: parseFloat(rows[i][2]) || null,
      temperature: parseFloat(rows[i][4]) || null,
      p: parseFloat(rows[i][6]) || 0,
      f: parseFloat(rows[i][7]) || 0,
      c: parseFloat(rows[i][8]) || 0,
      kcal: parseFloat(rows[i][9]) || 0,
      cardio: parseFloat(rows[i][10]) || 0
    });
  }
  records.sort((a, b) => a.date.localeCompare(b.date));
  return json(records);
}

function json(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

// ============================================================
// 朝7時レポート：今日来店するお客さんのウィークリーレポートを送信
// GASのトリガーで毎朝7時に実行してください
// ============================================================

// ============================================================
// 月次レポート：毎月1日に先月分の全お客さんレポートを送信
// GASのトリガーで毎月1日 午前8時〜9時に実行してください
// ============================================================

function getClientPeriodData(name, fromStr, toStr) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName('記録');
  if (!sheet) return { records: [], feedback: [] };

  const rows = sheet.getDataRange().getValues();
  const records = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (row[1] !== name) continue;
    const dateStr = row[0] ? Utilities.formatDate(new Date(row[0]), 'Asia/Tokyo', 'yyyy-MM-dd') : '';
    if (dateStr < fromStr || dateStr > toStr) continue;
    records.push({
      date: dateStr,
      weight: parseFloat(row[2]) || null,
      temperature: parseFloat(row[4]) || null,
      p: parseFloat(row[6]) || 0,
      f: parseFloat(row[7]) || 0,
      c: parseFloat(row[8]) || 0,
      kcal: parseFloat(row[9]) || 0,
      cardio: parseFloat(row[10]) || 0,
      checkedTasks: row[11] || '',
      uncheckedTasks: row[12] || ''
    });
  }
  records.sort((a, b) => a.date.localeCompare(b.date));

  const fbSheet = ss.getSheetByName('意見箱');
  const feedback = [];
  if (fbSheet) {
    const fbRows = fbSheet.getDataRange().getValues();
    for (let i = 1; i < fbRows.length; i++) {
      if (fbRows[i][1] !== name) continue;
      const dateStr = fbRows[i][0] || '';
      if (dateStr < fromStr || dateStr > toStr) continue;
      feedback.push({ date: dateStr, training: fbRows[i][2], question: fbRows[i][3], goal: fbRows[i][4] });
    }
  }

  return { records, feedback };
}

function buildMonthlyReportHtml(name, data, monthLabel) {
  const { records, feedback } = data;
  if (records.length === 0) return `<p>${name}さんの${monthLabel}の記録はありません。</p>`;

  const weights = records.map(r => r.weight).filter(v => v);
  const temps = records.map(r => r.temperature).filter(v => v);
  const totalCardio = records.reduce((s, r) => s + r.cardio, 0);
  const avgCardio = records.length ? Math.round(totalCardio / records.length) : 0;
  const cardioDays = records.filter(r => r.cardio > 0).length;
  const avgP = records.length ? (records.reduce((s,r)=>s+r.p,0)/records.length).toFixed(1) : '-';
  const avgF = records.length ? (records.reduce((s,r)=>s+r.f,0)/records.length).toFixed(1) : '-';
  const avgC = records.length ? (records.reduce((s,r)=>s+r.c,0)/records.length).toFixed(1) : '-';
  const avgKcal = records.length ? Math.round(records.reduce((s,r)=>s+r.kcal,0)/records.length) : '-';
  const avgTemp = temps.length ? (temps.reduce((a,b)=>a+b,0)/temps.length).toFixed(1) : '-';
  const weightChange = weights.length >= 2 ? (weights[weights.length-1] - weights[0]).toFixed(1) : null;
  const startWeight = weights.length ? weights[0] : null;
  const endWeight = weights.length ? weights[weights.length-1] : null;

  let hwDays = 0, hwFullDays = 0;
  records.forEach(r => {
    if (r.checkedTasks || r.uncheckedTasks) {
      hwDays++;
      if (!r.uncheckedTasks) hwFullDays++;
    }
  });
  const hwRate = hwDays > 0 ? Math.round(hwFullDays / hwDays * 100) : 0;
  const mHwDetailRows = records.filter(r => r.checkedTasks || r.uncheckedTasks).map(r => {
    const full = !r.uncheckedTasks;
    const checked = (r.checkedTasks || '').split('、').filter(t => t);
    const unchecked = (r.uncheckedTasks || '').split('、').filter(t => t);
    const checkedHtml = checked.map(t => `<span style="color:#388e3c;">✓ ${t}</span>`).join('<br>');
    const uncheckedHtml = unchecked.map(t => `<span style="color:#aaa;">✗ ${t}</span>`).join('<br>');
    return `<tr style="border-bottom:1px solid #f0f0f0;vertical-align:top;">
      <td style="padding:6px 8px;color:#555;white-space:nowrap;">${r.date.slice(5).replace('-','/')}</td>
      <td style="padding:6px 8px;text-align:center;">${full ? '<span style="color:#388e3c;font-weight:bold;">全達成</span>' : '<span style="color:#f57c00;">一部</span>'}</td>
      <td style="padding:6px 8px;font-size:12px;line-height:1.8;">${checkedHtml}${uncheckedHtml ? '<br>' + uncheckedHtml : ''}</td>
    </tr>`;
  }).join('');
  const mHwHtml = hwDays === 0 ? '<p style="color:#aaa;font-size:13px;">記録なし</p>' : `
    <div style="display:flex;align-items:center;gap:16px;margin-bottom:12px;">
      <div style="font-size:36px;font-weight:bold;color:${hwRate >= 80 ? '#388e3c' : hwRate >= 50 ? '#f57c00' : '#c62828'};">${hwRate}%</div>
      <div style="color:#888;font-size:13px;">${hwDays}日中 ${hwFullDays}日 全達成</div>
    </div>
    <table style="width:100%;border-collapse:collapse;font-size:12px;">
      <tr style="background:#f5f0eb;"><th style="padding:6px 8px;text-align:left;color:#888;font-weight:normal;">日付</th><th style="padding:6px 8px;color:#888;font-weight:normal;">達成</th><th style="padding:6px 8px;text-align:left;color:#888;font-weight:normal;">内容</th></tr>
      ${mHwDetailRows}
    </table>`;

  const mWeightChartPts = records.filter(r => r.weight).map(r => ({label: r.date.slice(5).replace('-','/'), value: r.weight}));
  const mTempChartPts = records.filter(r => r.temperature).map(r => ({label: r.date.slice(5).replace('-','/'), value: r.temperature}));
  const mWeightSvg = buildSvgLineChart(mWeightChartPts, '#1a1a2e', 'kg');
  const mTempSvg = buildSvgLineChart(mTempChartPts, '#e57373', '℃');

  const fbHtml = feedback.length ? feedback.map(f => `
    <div style="background:#f9f9f9;border-radius:8px;padding:12px;margin-bottom:8px;">
      <div style="font-size:11px;color:#aaa;margin-bottom:4px;">${f.date}</div>
      ${f.training ? `<div>💪 <b>やってみたいトレーニング：</b>${f.training}</div>` : ''}
      ${f.question ? `<div>❓ <b>わからなかったこと：</b>${f.question}</div>` : ''}
      ${f.goal ? `<div>🎯 <b>今後の目標：</b>${f.goal}</div>` : ''}
    </div>
  `).join('') : '<p style="color:#aaa;">今月の意見箱はありません</p>';

  const monthlyTodayStr = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
  const mSoreness = getLastSorenessSession(name, monthlyTodayStr);
  let mSorenessHtml;
  if (!mSoreness) {
    mSorenessHtml = '<p style="color:#aaa;font-size:13px;">記録なし</p>';
  } else if (mSoreness.days === 0 && !mSoreness.recovered) {
    mSorenessHtml = '<p style="color:#aaa;font-size:13px;">筋肉痛の記録なし</p>';
  } else {
    const mStatusText = mSoreness.recovered ? '回復済み ✅' : '筋肉痛継続中 🔴';
    const mPartsText = mSoreness.parts ? `部位：${mSoreness.parts}` : '';
    mSorenessHtml = `
      <div style="font-size:13px;color:#555;margin-bottom:6px;">前回トレーニング：${mSoreness.trainDate.slice(5).replace('-','/')}</div>
      <div style="display:flex;gap:12px;align-items:center;">
        <div style="background:#f5f0eb;border-radius:10px;padding:12px 16px;text-align:center;">
          <div style="font-size:11px;color:#888;">筋肉痛日数</div>
          <div style="font-size:24px;font-weight:bold;color:#e57373;">${mSoreness.days}日</div>
        </div>
        <div>
          <div style="font-size:14px;font-weight:bold;">${mStatusText}</div>
          ${mPartsText ? `<div style="font-size:13px;color:#666;margin-top:4px;">${mPartsText}</div>` : ''}
        </div>
      </div>
    `;
  }

  return `<!DOCTYPE html><html lang="ja"><body style="margin:0;padding:0;background:#f5f0eb;font-family:'Hiragino Kaku Gothic ProN',sans-serif;"><div style="max-width:600px;margin:0 auto;padding:24px;"><div style="background:#1a1a2e;border-radius:16px;padding:24px;text-align:center;margin-bottom:20px;"><div style="color:#c8a97e;font-size:13px;margin-bottom:4px;">PUTTERS パーソナルジム</div><div style="color:white;font-size:22px;font-weight:bold;">${name} マンスリーレポート</div><div style="color:#aaa;font-size:13px;margin-top:4px;">${monthLabel}（記録${records.length}日）</div></div><div style="background:white;border-radius:16px;padding:20px;margin-bottom:16px;"><div style="font-size:15px;font-weight:bold;color:#1a1a2e;margin-bottom:12px;">⚖️ 体重</div><div style="display:flex;gap:12px;margin-bottom:12px;"><div style="flex:1;background:#f5f0eb;border-radius:10px;padding:12px;text-align:center;"><div style="font-size:11px;color:#888;">月初</div><div style="font-size:20px;font-weight:bold;color:#1a1a2e;">${startWeight ? startWeight + 'kg' : '-'}</div></div><div style="flex:1;background:#f5f0eb;border-radius:10px;padding:12px;text-align:center;"><div style="font-size:11px;color:#888;">月末</div><div style="font-size:20px;font-weight:bold;color:#1a1a2e;">${endWeight ? endWeight + 'kg' : '-'}</div></div><div style="flex:1;background:#f5f0eb;border-radius:10px;padding:12px;text-align:center;"><div style="font-size:11px;color:#888;">変化</div><div style="font-size:20px;font-weight:bold;color:${weightChange < 0 ? '#388e3c' : weightChange > 0 ? '#c62828' : '#333'};">${weightChange !== null ? (weightChange > 0 ? '+' : '') + weightChange + 'kg' : '-'}</div></div></div>${mWeightSvg}</div><div style="background:white;border-radius:16px;padding:20px;margin-bottom:16px;"><div style="font-size:15px;font-weight:bold;color:#1a1a2e;margin-bottom:8px;">🌡️ 体温</div>${mTempSvg}</div><div style="background:white;border-radius:16px;padding:20px;margin-bottom:16px;"><div style="font-size:15px;font-weight:bold;color:#1a1a2e;margin-bottom:8px;">🏃 有酸素</div><div style="font-size:16px;font-weight:bold;color:#81c784;">合計 ${totalCardio}分</div><div style="font-size:13px;color:#888;margin-top:4px;">1日平均 ${avgCardio}分 / 実施 ${cardioDays}日</div></div><div style="background:white;border-radius:16px;padding:20px;margin-bottom:16px;"><div style="font-size:15px;font-weight:bold;color:#1a1a2e;margin-bottom:12px;">🍽️ 食事（日別）</div><table style="width:100%;border-collapse:collapse;font-size:12px;"><tr style="background:#f5f0eb;"><th style="padding:6px 8px;text-align:left;color:#888;font-weight:normal;">日付</th><th style="padding:6px 8px;text-align:right;color:#e57373;">P(g)</th><th style="padding:6px 8px;text-align:right;color:#ffb74d;">F(g)</th><th style="padding:6px 8px;text-align:right;color:#81c784;">C(g)</th><th style="padding:6px 8px;text-align:right;color:#9575cd;">kcal</th></tr>${records.filter(r => r.kcal > 0).map(r => `<tr style="border-bottom:1px solid #f0f0f0;"><td style="padding:6px 8px;color:#555;">${r.date.slice(5).replace('-','/')}</td><td style="padding:6px 8px;text-align:right;font-weight:bold;color:#e57373;">${r.p}</td><td style="padding:6px 8px;text-align:right;font-weight:bold;color:#ffb74d;">${r.f}</td><td style="padding:6px 8px;text-align:right;font-weight:bold;color:#81c784;">${r.c}</td><td style="padding:6px 8px;text-align:right;font-weight:bold;color:#9575cd;">${r.kcal}</td></tr>`).join('')}${records.filter(r => r.kcal > 0).length === 0 ? '<tr><td colspan="5" style="padding:8px;color:#aaa;text-align:center;">記録なし</td></tr>' : ''}</table></div><div style="background:white;border-radius:16px;padding:20px;margin-bottom:16px;"><div style="font-size:15px;font-weight:bold;color:#1a1a2e;margin-bottom:12px;">📋 宿題達成率</div>${mHwHtml}</div><div style="background:white;border-radius:16px;padding:20px;margin-bottom:16px;"><div style="font-size:15px;font-weight:bold;color:#1a1a2e;margin-bottom:12px;">📮 意見箱（今月分）</div>${fbHtml}</div><div style="background:white;border-radius:16px;padding:20px;margin-bottom:16px;"><div style="font-size:15px;font-weight:bold;color:#1a1a2e;margin-bottom:12px;">💪 筋肉痛</div>${mSorenessHtml}</div><div style="text-align:center;color:#aaa;font-size:11px;">PUTTERS パーソナルジム｜自動送信メール</div></div></body></html>`;
}

function buildMonthlyReportPdf(name, data, monthLabel, monthStr) {
  const html = buildMonthlyReportHtml(name, data, monthLabel);
  const blob = Utilities.newBlob(html, 'text/html', 'report.html');
  const file = DriveApp.createFile(blob);
  const pdf = file.getAs('application/pdf');
  pdf.setName(name + '_マンスリーレポート_' + monthStr + '.pdf');
  file.setTrashed(true);
  return pdf;
}

function getMonthlySentLog() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sheet = ss.getSheetByName('月次送信済み');
  if (!sheet) {
    sheet = ss.insertSheet('月次送信済み');
    sheet.appendRow(['名前', '年月', '送信日']);
  }
  const rows = sheet.getDataRange().getValues();
  const log = new Set();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] && rows[i][1]) log.add(rows[i][0] + '_' + rows[i][1]);
  }
  return log;
}

function recordMonthlySent(name, monthStr) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName('月次送信済み') || ss.insertSheet('月次送信済み');
  sheet.appendRow([name, monthStr, Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd')]);
}

function shouldSendMonthly(name, todayStr, sentLog) {
  const cal = CalendarApp.getCalendarById(CALENDAR_ID);
  const today = new Date(todayStr + 'T12:00:00');
  const thisMonthStr = Utilities.formatDate(today, 'Asia/Tokyo', 'yyyy-MM');

  const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0, 23, 59, 59);
  const futureThisMonth = cal.getEvents(new Date(todayStr + 'T23:59:59'), monthEnd)
    .filter(ev => ev.getTitle() === name);

  if (futureThisMonth.length === 0) {
    if (!sentLog.has(name + '_' + thisMonthStr)) return { send: true, monthStr: thisMonthStr };
    return { send: false };
  }

  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const pastThisMonth = cal.getEvents(monthStart, new Date(todayStr + 'T00:00:00'))
    .filter(ev => ev.getTitle() === name);

  if (pastThisMonth.length === 0) {
    const lastMonthDate = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const lastMonthStr = Utilities.formatDate(lastMonthDate, 'Asia/Tokyo', 'yyyy-MM');
    const lastMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0, 23, 59, 59);
    const lastMonthEvents = cal.getEvents(new Date(lastMonthStr + '-01T00:00:00'), lastMonthEnd)
      .filter(ev => ev.getTitle() === name);
    if (lastMonthEvents.length > 0 && !sentLog.has(name + '_' + lastMonthStr)) {
      return { send: true, monthStr: lastMonthStr };
    }
  }

  return { send: false };
}

function getMonthlyPeriod(name, todayStr, monthStr) {
  const prevVisit = getPrevVisitDate(name, todayStr);
  const today = new Date(todayStr + 'T12:00:00');
  const thisMonthStr = Utilities.formatDate(today, 'Asia/Tokyo', 'yyyy-MM');

  let toStr;
  if (monthStr === thisMonthStr) {
    const yesterday = new Date(new Date(todayStr).getTime() - 24 * 60 * 60 * 1000);
    toStr = Utilities.formatDate(yesterday, 'Asia/Tokyo', 'yyyy-MM-dd');
  } else {
    const lastDay = new Date(today.getFullYear(), today.getMonth(), 0);
    toStr = Utilities.formatDate(lastDay, 'Asia/Tokyo', 'yyyy-MM-dd');
  }

  const fromStr = prevVisit || monthStr + '-01';
  const label = fromStr.slice(5).replace('-', '/') + ' 〜 ' + toStr.slice(5).replace('-', '/');
  return { fromStr, toStr, label };
}

function morningReport() {
  const today = new Date();
  const todayStr = Utilities.formatDate(today, 'Asia/Tokyo', 'yyyy-MM-dd');
  const dateLabel = Utilities.formatDate(today, 'Asia/Tokyo', 'M月d日');

  const cal = CalendarApp.getCalendarById(CALENDAR_ID);
  const start = new Date(todayStr + 'T00:00:00');
  const end = new Date(todayStr + 'T23:59:59');
  const events = cal.getEvents(start, end);

  if (events.length === 0) return;

  const names = [...new Set(events.map(ev => ev.getTitle()).filter(t => t))];

  const weeklyHtmls = [];
  const weeklyPdfs = [];
  const weeklyNames = [];

  names.forEach(name => {
    const weeklyData = getClientWeeklyData(name);
    // この1週間アプリに何も入れてない人は送らない。
    // ただし食事・体重等の記録が無くても、筋肉痛だけ記録している人には送る。
    const hasRecords = weeklyData.records && weeklyData.records.length > 0;
    const hasSoreness = weeklyData.soreness && weeklyData.soreness.length > 0;
    if (!hasRecords && !hasSoreness) return;
    weeklyHtmls.push(buildReportHtml(name, weeklyData, todayStr));
    weeklyPdfs.push(buildReportPdf(name, weeklyData, todayStr));
    weeklyNames.push(name);
  });

  if (weeklyHtmls.length === 0) return;

  MailApp.sendEmail({
    to: NOTIFY_EMAIL,
    subject: '【PUTTERS】週次レポート ' + dateLabel + '（' + weeklyNames.length + '名）',
    htmlBody: weeklyHtmls.join('<div style="page-break-after:always;border-top:2px dashed #ccc;margin:40px 0;"></div>'),
    attachments: weeklyPdfs
  });
}

function getPrevVisitDate(name, todayStr) {
  const cal = CalendarApp.getCalendarById(CALENDAR_ID);
  const searchStart = new Date(new Date(todayStr).getTime() - 90 * 24 * 60 * 60 * 1000);
  const searchEnd = new Date(todayStr + 'T00:00:00');
  const events = cal.getEvents(searchStart, searchEnd);
  const visitDates = events
    .filter(ev => ev.getTitle() === name)
    .map(ev => Utilities.formatDate(ev.getStartTime(), 'Asia/Tokyo', 'yyyy-MM-dd'))
    .sort();
  return visitDates.length > 0 ? visitDates[visitDates.length - 1] : null;
}

function getClientWeeklyData(name) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName('記録');
  if (!sheet) return { records: [], feedback: [], prevVisitStr: null };

  const todayStr = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');

  const prevVisitStr = getPrevVisitDate(name, todayStr);
  const cutoffStr = prevVisitStr || (() => {
    const d = new Date(); d.setDate(d.getDate() - 7);
    return Utilities.formatDate(d, 'Asia/Tokyo', 'yyyy-MM-dd');
  })();

  const rows = sheet.getDataRange().getValues();
  const records = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (row[1] !== name) continue;
    const dateStr = row[0] ? Utilities.formatDate(new Date(row[0]), 'Asia/Tokyo', 'yyyy-MM-dd') : '';
    if (dateStr < cutoffStr) continue;
    records.push({
      date: dateStr,
      weight: parseFloat(row[2]) || null,
      temperature: parseFloat(row[4]) || null,
      p: parseFloat(row[6]) || 0,
      f: parseFloat(row[7]) || 0,
      c: parseFloat(row[8]) || 0,
      kcal: parseFloat(row[9]) || 0,
      cardio: parseFloat(row[10]) || 0,
      checkedTasks: row[11] || '',
      uncheckedTasks: row[12] || ''
    });
  }
  records.sort((a, b) => a.date.localeCompare(b.date));

  const fbSheet = ss.getSheetByName('意見箱');
  const feedback = [];
  if (fbSheet) {
    const fbRows = fbSheet.getDataRange().getValues();
    for (let i = 1; i < fbRows.length; i++) {
      if (fbRows[i][1] !== name) continue;
      const dateStr = fbRows[i][0] || '';
      if (dateStr < cutoffStr) continue;
      feedback.push({ date: dateStr, training: fbRows[i][2], question: fbRows[i][3], goal: fbRows[i][4] });
    }
  }

  const soreness = getSorenessByPeriod(name, prevVisitStr || cutoffStr, todayStr);

  return { records, feedback, prevVisitStr, soreness };
}

function getSorenessByPeriod(name, fromStr, toStr) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName('筋肉痛');
  if (!sheet) return [];
  const rows = sheet.getDataRange().getValues();
  const result = [];
  for (let i = 1; i < rows.length; i++) {
    const d = rows[i][0] ? Utilities.formatDate(new Date(rows[i][0]), 'Asia/Tokyo', 'yyyy-MM-dd') : '';
    if (rows[i][1] === name && d >= fromStr && d <= toStr) {
      result.push({ date: d, parts: rows[i][2] });
    }
  }
  return result.sort((a, b) => a.date.localeCompare(b.date));
}

function getLastSorenessSession(name, todayStr) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName('筋肉痛');
  if (!sheet) return null;

  // 直近のトレーニング日を取得
  const cal = CalendarApp.getCalendarById(CALENDAR_ID);
  const thirtyDaysAgo = new Date(new Date(todayStr).getTime() - 30 * 24 * 60 * 60 * 1000);
  const today = new Date(todayStr + 'T23:59:59');
  const events = cal.getEvents(thirtyDaysAgo, today);
  const trainingDates = events
    .filter(ev => ev.getTitle() === name)
    .map(ev => Utilities.formatDate(ev.getStartTime(), 'Asia/Tokyo', 'yyyy-MM-dd'))
    .sort();

  if (trainingDates.length === 0) return null;
  const lastTraining = trainingDates[trainingDates.length - 1];

  // トレーニング後の筋肉痛記録を取得
  const rows = sheet.getDataRange().getValues();
  const sorenessAfter = [];
  for (let i = 1; i < rows.length; i++) {
    const d = rows[i][0] ? Utilities.formatDate(new Date(rows[i][0]), 'Asia/Tokyo', 'yyyy-MM-dd') : '';
    if (rows[i][1] === name && d > lastTraining) sorenessAfter.push({ date: d, parts: rows[i][2] });
  }
  sorenessAfter.sort((a, b) => a.date.localeCompare(b.date));

  if (sorenessAfter.length === 0) return { trainDate: lastTraining, days: 0, parts: '', recovered: false };

  let days = 0;
  let partsMap = {};
  let recovered = false;
  for (const r of sorenessAfter) {
    if (r.parts === 'none') { recovered = true; break; }
    days++;
    r.parts.split(',').forEach(p => { partsMap[p] = (partsMap[p] || 0) + 1; });
  }
  return { trainDate: lastTraining, days, parts: Object.keys(partsMap).join('・'), recovered };
}

function buildSvgLineChart(points, color, unit) {
  if (!points || points.length === 0) return '<p style="color:#aaa;font-size:13px;">記録なし</p>';
  const W = 520, H = 110, PL = 44, PR = 10, PT = 18, PB = 28;
  const chartW = W - PL - PR;
  const chartH = H - PT - PB;
  const values = points.map(function(p){ return p.value; });
  const minV = Math.min.apply(null, values);
  const maxV = Math.max.apply(null, values);
  const range = maxV === minV ? 1 : maxV - minV;
  const xs = points.map(function(p, i){ return PL + (points.length === 1 ? chartW / 2 : i / (points.length - 1) * chartW); });
  const ys = values.map(function(v){ return PT + (1 - (v - minV) / range) * chartH; });
  const polyline = xs.map(function(x, i){ return x.toFixed(1) + ',' + ys[i].toFixed(1); }).join(' ');
  const step = Math.ceil(points.length / 6);
  const xLabels = points.map(function(p, i){
    if (i % step !== 0 && i !== points.length - 1) return '';
    return '<text x="' + xs[i].toFixed(1) + '" y="' + (H - 4) + '" text-anchor="middle" font-size="9" fill="#aaa">' + p.label + '</text>';
  }).join('');
  const dots = xs.map(function(x, i){ return '<circle cx="' + x.toFixed(1) + '" cy="' + ys[i].toFixed(1) + '" r="3" fill="' + color + '"/>'; }).join('');
  const valLabels = points.map(function(p, i){
    const yOffset = i % 2 === 0 ? -7 : 16;
    return '<text x="' + xs[i].toFixed(1) + '" y="' + (ys[i] + yOffset).toFixed(1) + '" text-anchor="middle" font-size="9" fill="' + color + '">' + values[i] + unit + '</text>';
  }).join('');
  return '<svg width="100%" viewBox="0 0 ' + W + ' ' + H + '" xmlns="http://www.w3.org/2000/svg">' +
    '<line x1="' + PL + '" y1="' + PT + '" x2="' + PL + '" y2="' + (PT + chartH) + '" stroke="#eee" stroke-width="1"/>' +
    '<line x1="' + PL + '" y1="' + (PT + chartH) + '" x2="' + (PL + chartW) + '" y2="' + (PT + chartH) + '" stroke="#eee" stroke-width="1"/>' +
    '<text x="' + (PL - 4) + '" y="' + (PT + 4) + '" text-anchor="end" font-size="9" fill="#aaa">' + maxV + unit + '</text>' +
    '<text x="' + (PL - 4) + '" y="' + (PT + chartH) + '" text-anchor="end" font-size="9" fill="#aaa">' + minV + unit + '</text>' +
    '<polyline points="' + polyline + '" fill="none" stroke="' + color + '" stroke-width="2" stroke-linejoin="round"/>' +
    dots + valLabels + xLabels + '</svg>';
}

function buildReportHtml(name, data, todayStr) {
  const { records, feedback, prevVisitStr, soreness } = data;
  const periodLabel = prevVisitStr
    ? prevVisitStr.slice(5).replace('-', '/') + ' 〜 ' + todayStr.slice(5).replace('-', '/')
    : '直近' + records.length + '日間';
  const weights = records.map(r => r.weight).filter(v => v);
  const temps = records.map(r => r.temperature).filter(v => v);
  const totalCardio = records.reduce((s, r) => s + r.cardio, 0);
  const avgP = records.length ? (records.reduce((s,r)=>s+r.p,0)/records.length).toFixed(1) : '-';
  const avgF = records.length ? (records.reduce((s,r)=>s+r.f,0)/records.length).toFixed(1) : '-';
  const avgC = records.length ? (records.reduce((s,r)=>s+r.c,0)/records.length).toFixed(1) : '-';
  const avgKcal = records.length ? Math.round(records.reduce((s,r)=>s+r.kcal,0)/records.length) : '-';
  const weightChange = weights.length >= 2 ? ((weights[weights.length-1] - weights[0]).toFixed(1)) : null;
  const avgTemp = temps.length ? (temps.reduce((a,b)=>a+b,0)/temps.length).toFixed(1) : '-';

  let hwDays = 0, hwFullDays = 0;
  records.forEach(r => {
    if (r.checkedTasks || r.uncheckedTasks) {
      hwDays++;
      if (!r.uncheckedTasks) hwFullDays++;
    }
  });
  const hwRate = hwDays > 0 ? Math.round(hwFullDays / hwDays * 100) : 0;
  const hwDetailRows = records.filter(r => r.checkedTasks || r.uncheckedTasks).map(r => {
    const full = !r.uncheckedTasks;
    const checked = (r.checkedTasks || '').split('、').filter(t => t);
    const unchecked = (r.uncheckedTasks || '').split('、').filter(t => t);
    const checkedHtml = checked.map(t => `<span style="color:#388e3c;">✓ ${t}</span>`).join('<br>');
    const uncheckedHtml = unchecked.map(t => `<span style="color:#aaa;">✗ ${t}</span>`).join('<br>');
    return `<tr style="border-bottom:1px solid #f0f0f0;vertical-align:top;">
      <td style="padding:6px 8px;color:#555;white-space:nowrap;">${r.date.slice(5).replace('-','/')}</td>
      <td style="padding:6px 8px;text-align:center;">${full ? '<span style="color:#388e3c;font-weight:bold;">全達成</span>' : '<span style="color:#f57c00;">一部</span>'}</td>
      <td style="padding:6px 8px;font-size:12px;line-height:1.8;">${checkedHtml}${uncheckedHtml ? '<br>' + uncheckedHtml : ''}</td>
    </tr>`;
  }).join('');
  const hwHtml = hwDays === 0 ? '<p style="color:#aaa;font-size:13px;">記録なし</p>' : `
    <div style="display:flex;align-items:center;gap:16px;margin-bottom:12px;">
      <div style="font-size:36px;font-weight:bold;color:${hwRate >= 80 ? '#388e3c' : hwRate >= 50 ? '#f57c00' : '#c62828'};">${hwRate}%</div>
      <div style="color:#888;font-size:13px;">${hwDays}日中 ${hwFullDays}日 全達成</div>
    </div>
    <table style="width:100%;border-collapse:collapse;font-size:12px;">
      <tr style="background:#f5f0eb;"><th style="padding:6px 8px;text-align:left;color:#888;font-weight:normal;">日付</th><th style="padding:6px 8px;color:#888;font-weight:normal;">達成</th><th style="padding:6px 8px;text-align:left;color:#888;font-weight:normal;">内容</th></tr>
      ${hwDetailRows}
    </table>`;

  const weightChartPts = records.filter(r => r.weight).map(r => ({label: r.date.slice(5).replace('-','/'), value: r.weight}));
  const tempChartPts = records.filter(r => r.temperature).map(r => ({label: r.date.slice(5).replace('-','/'), value: r.temperature}));
  const weightSvg = buildSvgLineChart(weightChartPts, '#1a1a2e', 'kg');
  const tempSvg = buildSvgLineChart(tempChartPts, '#e57373', '℃');

  const fbHtml = feedback.length ? feedback.map(f => `
    <div style="background:#f9f9f9;border-radius:8px;padding:12px;margin-bottom:8px;">
      <div style="font-size:11px;color:#aaa;margin-bottom:4px;">${f.date}</div>
      ${f.training ? `<div>💪 <b>やってみたいトレーニング：</b>${f.training}</div>` : ''}
      ${f.question ? `<div>❓ <b>わからなかったこと：</b>${f.question}</div>` : ''}
      ${f.goal ? `<div>🎯 <b>今後の目標：</b>${f.goal}</div>` : ''}
    </div>
  `).join('') : '<p style="color:#aaa;">今週の意見箱はありません</p>';

  const sorenessRows = soreness || getSorenessByPeriod(name, prevVisitStr || records[0]?.date, todayStr);
  let sorenessHtml;
  if (!sorenessRows || sorenessRows.length === 0) {
    sorenessHtml = '<p style="color:#aaa;font-size:13px;">筋肉痛の記録なし</p>';
  } else {
    // 部位ごとの日数を集計
    const partsCount = {};
    sorenessRows.forEach(r => {
      if (r.parts && r.parts !== 'none') {
        r.parts.split(',').forEach(p => { p = p.trim(); if (p) partsCount[p] = (partsCount[p] || 0) + 1; });
      }
    });
    const partLines = Object.entries(partsCount).map(([p, d]) => `<span style="display:inline-block;background:#fde8e8;color:#c62828;border-radius:20px;padding:3px 12px;margin:2px 4px 2px 0;font-size:13px;">${p} ${d}日間</span>`).join('');
    sorenessHtml = partLines
      ? `<div style="margin-top:4px;">${partLines}</div>`
      : '<p style="color:#aaa;font-size:13px;">筋肉痛なし（全日noneまたは未記録）</p>';
  }

  return `<!DOCTYPE html><html lang="ja"><body style="margin:0;padding:0;background:#f5f0eb;font-family:'Hiragino Kaku Gothic ProN',sans-serif;"><div style="max-width:600px;margin:0 auto;padding:24px;"><div style="background:#1a1a2e;border-radius:16px;padding:24px;text-align:center;margin-bottom:20px;"><div style="color:#c8a97e;font-size:13px;margin-bottom:4px;">PUTTERS パーソナルジム</div><div style="color:white;font-size:22px;font-weight:bold;">${name} 週次レポート</div><div style="color:#aaa;font-size:13px;margin-top:4px;">${todayStr} 来店（${periodLabel}）</div></div><div style="background:white;border-radius:16px;padding:20px;margin-bottom:16px;"><div style="font-size:15px;font-weight:bold;color:#1a1a2e;margin-bottom:12px;">⚖️ 体重</div><div style="display:flex;gap:12px;margin-bottom:12px;"><div style="flex:1;background:#f5f0eb;border-radius:10px;padding:12px;text-align:center;"><div style="font-size:11px;color:#888;">開始時</div><div style="font-size:20px;font-weight:bold;color:#1a1a2e;">${weights.length ? weights[0] + 'kg' : '-'}</div></div><div style="flex:1;background:#f5f0eb;border-radius:10px;padding:12px;text-align:center;"><div style="font-size:11px;color:#888;">最新</div><div style="font-size:20px;font-weight:bold;color:#1a1a2e;">${weights.length ? weights[weights.length-1] + 'kg' : '-'}</div></div><div style="flex:1;background:#f5f0eb;border-radius:10px;padding:12px;text-align:center;"><div style="font-size:11px;color:#888;">変化</div><div style="font-size:20px;font-weight:bold;color:${weightChange < 0 ? '#388e3c' : weightChange > 0 ? '#c62828' : '#333'};">${weightChange !== null ? (weightChange > 0 ? '+' : '') + weightChange + 'kg' : '-'}</div></div></div>${weightSvg}</div><div style="background:white;border-radius:16px;padding:20px;margin-bottom:16px;"><div style="font-size:15px;font-weight:bold;color:#1a1a2e;margin-bottom:8px;">🌡️ 体温</div>${tempSvg}</div><div style="background:white;border-radius:16px;padding:20px;margin-bottom:16px;"><div style="font-size:15px;font-weight:bold;color:#1a1a2e;margin-bottom:8px;">🏃 有酸素</div><div style="font-size:28px;font-weight:bold;color:#81c784;">${totalCardio}分</div></div><div style="background:white;border-radius:16px;padding:20px;margin-bottom:16px;"><div style="font-size:15px;font-weight:bold;color:#1a1a2e;margin-bottom:12px;">🍽️ 食事（日別）</div><table style="width:100%;border-collapse:collapse;font-size:12px;"><tr style="background:#f5f0eb;"><th style="padding:6px 8px;text-align:left;color:#888;font-weight:normal;">日付</th><th style="padding:6px 8px;text-align:right;color:#e57373;">P(g)</th><th style="padding:6px 8px;text-align:right;color:#ffb74d;">F(g)</th><th style="padding:6px 8px;text-align:right;color:#81c784;">C(g)</th><th style="padding:6px 8px;text-align:right;color:#9575cd;">kcal</th></tr>${records.filter(r => r.kcal > 0).map(r => `<tr style="border-bottom:1px solid #f0f0f0;"><td style="padding:6px 8px;color:#555;">${r.date.slice(5).replace('-','/')}</td><td style="padding:6px 8px;text-align:right;font-weight:bold;color:#e57373;">${r.p}</td><td style="padding:6px 8px;text-align:right;font-weight:bold;color:#ffb74d;">${r.f}</td><td style="padding:6px 8px;text-align:right;font-weight:bold;color:#81c784;">${r.c}</td><td style="padding:6px 8px;text-align:right;font-weight:bold;color:#9575cd;">${r.kcal}</td></tr>`).join('')}${records.filter(r => r.kcal > 0).length === 0 ? '<tr><td colspan="5" style="padding:8px;color:#aaa;text-align:center;">記録なし</td></tr>' : ''}</table></div><div style="background:white;border-radius:16px;padding:20px;margin-bottom:16px;"><div style="font-size:15px;font-weight:bold;color:#1a1a2e;margin-bottom:12px;">📋 宿題達成</div>${hwHtml}</div><div style="background:white;border-radius:16px;padding:20px;margin-bottom:16px;"><div style="font-size:15px;font-weight:bold;color:#1a1a2e;margin-bottom:12px;">📮 意見箱</div>${fbHtml}</div><div style="background:white;border-radius:16px;padding:20px;margin-bottom:16px;"><div style="font-size:15px;font-weight:bold;color:#1a1a2e;margin-bottom:12px;">💪 筋肉痛</div>${sorenessHtml}</div><div style="text-align:center;color:#aaa;font-size:11px;">PUTTERS パーソナルジム｜自動送信メール</div></div></body></html>`;
}

function buildReportPdf(name, data, todayStr) {
  const html = buildReportHtml(name, data, todayStr);
  const blob = Utilities.newBlob(html, 'text/html', 'report.html');
  const file = DriveApp.createFile(blob);
  const pdf = file.getAs('application/pdf');
  pdf.setName(name + '_レポート_' + todayStr + '.pdf');
  file.setTrashed(true);
  return pdf;
}

// ========== 歩数ランキング ==========
function saveSteps(userId, displayName, steps, date) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sheet = ss.getSheetByName('steps');
  if (!sheet) {
    sheet = ss.insertSheet('steps');
    sheet.getRange(1,1,1,4).setValues([['date','userId','displayName','steps']]);
  }
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] == date && data[i][1] == userId) {
      sheet.getRange(i+1, 4).setValue(Number(steps));
      return;
    }
  }
  sheet.appendRow([date, userId, displayName, Number(steps)]);
}

function getWeeklyRanking() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName('steps');
  if (!sheet) return { ranking: [], period: '' };

  const today = new Date();
  const dow = today.getDay();
  const monday = new Date(today);
  monday.setDate(today.getDate() - (dow === 0 ? 6 : dow - 1));
  monday.setHours(0,0,0,0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  const fmt = d => Utilities.formatDate(d, 'Asia/Tokyo', 'M/d');
  const period = fmt(monday) + '（月）〜' + fmt(sunday) + '（日）';

  const data = sheet.getDataRange().getValues();
  const totals = {}, names = {}, dayCounts = {};
  for (let i = 1; i < data.length; i++) {
    const [date, userId, displayName, steps] = data[i];
    const d = new Date(date);
    if (d < monday || d > sunday) continue;
    if (!totals[userId]) { totals[userId] = 0; names[userId] = displayName; dayCounts[userId] = 0; }
    totals[userId] += Number(steps);
    dayCounts[userId]++;
  }

  const ranking = Object.keys(totals).map(userId => ({
    userId, displayName: names[userId],
    totalSteps: totals[userId], days: dayCounts[userId]
  })).sort((a, b) => b.totalSteps - a.totalSteps);

  return { ranking, period };
}

// ========== 筋肉痛トラッキング ==========

// 筋肉痛チェックを表示すべきか確認
function checkYesterdayTraining(name) {
  const today = new Date();
  const todayStr = Utilities.formatDate(today, 'Asia/Tokyo', 'yyyy-MM-dd');

  // 直近30日のトレーニング日を取得
  const cal = CalendarApp.getCalendarById(CALENDAR_ID);
  const thirtyDaysAgo = new Date(today);
  thirtyDaysAgo.setDate(today.getDate() - 30);
  const events = cal.getEvents(thirtyDaysAgo, today);
  const trainingDates = events
    .filter(ev => ev.getTitle() === name)
    .map(ev => Utilities.formatDate(ev.getStartTime(), 'Asia/Tokyo', 'yyyy-MM-dd'))
    .sort();

  if (trainingDates.length === 0) return { hadTraining: false };

  // 直近のトレーニング日
  const lastTrainingDate = trainingDates[trainingDates.length - 1];

  // 直近トレーニング後に「筋肉痛なし」を記録済みか確認
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName('筋肉痛');
  if (!sheet) return { hadTraining: lastTrainingDate < todayStr, hasPreviousSoreness: false };

  const yesterdayStr = Utilities.formatDate(new Date(today.getTime() - 86400000), 'Asia/Tokyo', 'yyyy-MM-dd');
  const rows = sheet.getDataRange().getValues();
  let hasPreviousSoreness = false;
  for (let i = 1; i < rows.length; i++) {
    const rowDate = rows[i][0] ? Utilities.formatDate(new Date(rows[i][0]), 'Asia/Tokyo', 'yyyy-MM-dd') : '';
    if (rows[i][1] === name && rowDate > lastTrainingDate) {
      if (rows[i][2] === 'none') return { hadTraining: false, hasPreviousSoreness: false }; // 「なし」記録済み→表示しない
      if (rowDate === yesterdayStr && rows[i][2] && rows[i][2] !== 'none') hasPreviousSoreness = true;
    }
  }

  // トレーニング後に「なし」記録なし→表示する（当日は除く）
  return { hadTraining: lastTrainingDate < todayStr, hasPreviousSoreness };
}

// 明日トレーニングがあるか確認
function checkTomorrowTraining(name) {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = Utilities.formatDate(tomorrow, 'Asia/Tokyo', 'yyyy-MM-dd');
  const start = new Date(tomorrowStr + 'T00:00:00');
  const end = new Date(tomorrowStr + 'T23:59:59');
  const cal = CalendarApp.getCalendarById(CALENDAR_ID);
  const events = cal.getEvents(start, end);
  const hasTraining = events.some(ev => ev.getTitle() === name);
  return { hasTraining };
}

// 筋肉痛を記録
// アイデアメモ保存（松本大樹専用）
function saveIdea(name, text) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sheet = ss.getSheetByName('アイデア');
  if (!sheet) {
    sheet = ss.insertSheet('アイデア');
    sheet.getRange(1, 1, 1, 3).setValues([['datetime', 'name', 'text']]);
  }
  const now = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm');
  sheet.appendRow([now, name, text]);
}

// アイデアメモ取得（新しい順）
function getIdeas(name) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName('アイデア');
  if (!sheet) return { ideas: [] };
  const rows = sheet.getDataRange().getValues();
  const ideas = [];
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][1] === name) {
      ideas.push({ date: rows[i][0], text: rows[i][2] });
    }
  }
  return { ideas: ideas.reverse() }; // 新しい順
}

function saveSoreness(name, date, parts) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sheet = ss.getSheetByName('筋肉痛');
  if (!sheet) {
    sheet = ss.insertSheet('筋肉痛');
    sheet.getRange(1,1,1,3).setValues([['date','name','parts']]);
  }
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    const rowDate = data[i][0] ? Utilities.formatDate(new Date(data[i][0]), 'Asia/Tokyo', 'yyyy-MM-dd') : '';
    if (rowDate === date && data[i][1] === name) {
      sheet.getRange(i+1, 3).setValue(parts);
      return;
    }
  }
  sheet.appendRow([date, name, parts]);
}

// 管理画面用：会員ごとの筋肉痛回復履歴
function getSorenessHistory() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName('筋肉痛');
  if (!sheet) return { history: [] };

  const cal = CalendarApp.getCalendarById(CALENDAR_ID);
  const today = new Date();
  const threeMonthsAgo = new Date(today);
  threeMonthsAgo.setMonth(today.getMonth() - 3);

  // 筋肉痛シートのデータ取得
  const rows = sheet.getDataRange().getValues();
  const byName = {};
  for (let i = 1; i < rows.length; i++) {
    const date = rows[i][0] ? Utilities.formatDate(new Date(rows[i][0]), 'Asia/Tokyo', 'yyyy-MM-dd') : '';
    const name = rows[i][1];
    const parts = rows[i][2] || '';
    if (!name || !date) continue;
    if (!byName[name]) byName[name] = [];
    byName[name].push({ date, parts });
  }

  // 各会員の直近トレーニング後の回復状況を集計
  const history = [];
  for (const name of Object.keys(byName)) {
    const records = byName[name].sort((a,b) => a.date.localeCompare(b.date));

    // 直近のトレーニング日を取得
    const events = cal.getEvents(threeMonthsAgo, today);
    const trainingDates = events
      .filter(ev => ev.getTitle() === name)
      .map(ev => Utilities.formatDate(ev.getStartTime(), 'Asia/Tokyo', 'yyyy-MM-dd'))
      .sort();

    const sessions = [];
    for (const trainDate of trainingDates) {
      // このトレーニング後の筋肉痛記録を集める
      const sorenessAfter = records.filter(r => r.date > trainDate);
      if (sorenessAfter.length === 0) continue;

      // 「なし」になった日まで何日かカウント
      let days = 0;
      let partsMap = {};
      for (const r of sorenessAfter) {
        if (r.parts === 'none') break;
        days++;
        r.parts.split(',').forEach(p => { partsMap[p] = (partsMap[p] || 0) + 1; });
      }
      if (days > 0) {
        sessions.push({ trainDate, sorenessdays: days, parts: Object.keys(partsMap).join(',') });
      }
    }

    if (sessions.length > 0) {
      history.push({ name, sessions: sessions.slice(-5) }); // 直近5セッション
    }
  }

  return { history };
}

// ========== noteテーマ週次メール ==========
function sendNoteTheme() {
  const themes = [
    { title: '筋肉はなぜ大きくなるのか？超回復のメカニズム', desc: 'トレーニング後に筋肉が回復・成長する仕組みをわかりやすく解説。なぜ休息が必要なのかも。' },
    { title: 'タンパク質はいつ摂るのが正解？', desc: '食事のタイミングとタンパク質の吸収率の関係。トレ前・後・朝・夜、それぞれの意味。' },
    { title: '正しいスクワットの5つのポイント', desc: '膝の向き、重心の位置、深さ。間違いがちなフォームを写真や動画で解説。' },
    { title: '体重が落ちないのは食事が原因？運動が原因？', desc: '停滞期に多い誤解と、正しい原因の見つけ方。体重より体脂肪率を見るべき理由。' },
    { title: '筋肉痛はトレーニングの証拠じゃない', desc: '筋肉痛があっても効いてない場合、ない場合でも効いている場合がある。正しい理解を解説。' },
    { title: '有酸素運動は筋肉を減らすのか？', desc: '筋トレとの組み合わせ方、順番、時間帯。脂肪を燃やしながら筋肉を守るコツ。' },
    { title: '体温と基礎代謝の関係', desc: '体温が1度上がると基礎代謝は13%アップ。体温を上げるための食事・生活習慣。' },
    { title: 'プロテインの選び方・飲み方完全ガイド', desc: 'ホエイ・カゼイン・ソイの違い。目的別の選び方と、一番効果的な飲むタイミング。' },
    { title: '睡眠とトレーニング効果の深い関係', desc: '成長ホルモンは睡眠中に分泌される。睡眠の質がパフォーマンスと回復に与える影響。' },
    { title: '食物繊維が腸内環境を変える理由', desc: '水溶性・不溶性食物繊維の違いと働き。腸内環境が免疫・代謝・メンタルに与える影響。' },
    { title: 'ストレッチポールの正しい使い方', desc: '背骨のリセット、肩まわりのほぐし方。毎日5分でできるセルフケアルーティン。' },
    { title: '炭水化物を抜くダイエットは正しいのか？', desc: '糖質制限のリスクと効果。筋肉を落とさずに体脂肪を減らすための炭水化物の考え方。' },
    { title: '体幹トレーニングで何が変わるのか？', desc: 'インナーマッスルとアウターマッスルの違い。姿勢・パフォーマンス・腰痛改善への効果。' },
    { title: '水を飲むだけで代謝は上がる？', desc: '1日の水分摂取量と代謝の関係。飲むタイミングと量の目安。トレーニング中の水分補給。' },
    { title: 'ミネラルが不足すると何が起きるか', desc: '筋肉のけいれん、疲れやすさ、冷え。現代人に不足しがちなミネラルとその補い方。' },
  ];

  // 週番号でテーマを循環
  const weekNum = Math.floor(Date.now() / (7 * 24 * 60 * 60 * 1000));
  const theme = themes[weekNum % themes.length];

  const subject = '📝 今週のnoteテーマ：' + theme.title;
  const body = `松本さん、おはようございます！\n\n今週のnoteテーマはこちらです。\n\n━━━━━━━━━━━━━━━━\n【テーマ】\n${theme.title}\n\n【内容イメージ】\n${theme.desc}\n━━━━━━━━━━━━━━━━\n\nボイスメモで話してもらえれば、記事にまとめます！\n\nPUTTERS Secretary`;

  GmailApp.sendEmail(NOTIFY_EMAIL, subject, body);
}

function saveTextbookWatch(name, videoId, watched) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sheet = ss.getSheetByName('教科書履修');
  if (!sheet) {
    sheet = ss.insertSheet('教科書履修');
    sheet.appendRow(['日時', 'ユーザー名', '動画番号', '状態']);
  }
  const now = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss');
  sheet.appendRow([now, name, videoId, watched ? '履修済み' : '未履修']);
}

function adminTextbookWatch() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName('教科書履修');
  if (!sheet) return json([]);
  const rows = sheet.getDataRange().getValues();
  const result = {};
  for (let i = 1; i < rows.length; i++) {
    const name = rows[i][1];
    const videoId = rows[i][2];
    const watched = rows[i][3] === '履修済み';
    if (!result[name]) result[name] = {};
    result[name][videoId] = watched;
  }
  return json(result);
}

function saveReasonRead(name, slug, read) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sheet = ss.getSheetByName('記事既読');
  if (!sheet) {
    sheet = ss.insertSheet('記事既読');
    sheet.appendRow(['日時', 'ユーザー名', '記事', '状態']);
  }
  const now = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss');
  sheet.appendRow([now, name, slug, read ? '既読' : '未読']);
}

function adminReasonRead() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName('記事既読');
  if (!sheet) return json({});
  const rows = sheet.getDataRange().getValues();
  const result = {};
  for (let i = 1; i < rows.length; i++) {
    const name = rows[i][1];
    const slug = rows[i][2];
    const read = rows[i][3] === '既読';
    if (!result[name]) result[name] = {};
    result[name][slug] = read;
  }
  return json(result);
}

// 管理画面用：今週(直近7日)の動きを人ごとにまとめる
// 記録(食事・体重)だけでなく、筋肉痛・記事既読・教科書履修も「動きあり」として拾う
function adminWeeklyActivity() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const today = new Date();
  const from = new Date(today.getTime() - 6 * 24 * 60 * 60 * 1000);
  const fromStr = Utilities.formatDate(from, 'Asia/Tokyo', 'yyyy-MM-dd');
  const dateOf = v => {
    if (!v) return '';
    if (Object.prototype.toString.call(v) === '[object Date]') return Utilities.formatDate(v, 'Asia/Tokyo', 'yyyy-MM-dd');
    return String(v).slice(0, 10);
  };

  const people = {};
  const touch = (name, kind, date, detail) => {
    if (!name || !date || date < fromStr) return;
    const key = String(name).trim();
    if (!key) return;
    if (!people[key]) people[key] = { name: key, kinds: {}, lastDate: date, details: {} };
    const p = people[key];
    p.kinds[kind] = (p.kinds[kind] || 0) + 1;
    if (date > p.lastDate) p.lastDate = date;
    if (detail) {
      if (!p.details[kind]) p.details[kind] = [];
      if (p.details[kind].indexOf(detail) === -1) p.details[kind].push(detail);
    }
  };

  // 記録（食事・体重・有酸素）
  const rec = ss.getSheetByName('記録') || ss.getSheets()[0];
  if (rec) {
    const rows = rec.getDataRange().getValues();
    for (let i = 1; i < rows.length; i++) touch(rows[i][1], 'record', dateOf(rows[i][0]));
  }

  // 筋肉痛（人体図）
  const sore = ss.getSheetByName('筋肉痛');
  if (sore) {
    const rows = sore.getDataRange().getValues();
    for (let i = 1; i < rows.length; i++) {
      const parts = rows[i][2];
      if (!parts) continue;
      touch(rows[i][1], 'soreness', dateOf(rows[i][0]), parts === 'none' ? '痛みなし' : String(parts));
    }
  }

  // 記事既読（松本のおすすめ）
  const art = ss.getSheetByName('記事既読');
  if (art) {
    const rows = art.getDataRange().getValues();
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][3] !== '既読') continue;
      touch(rows[i][1], 'article', dateOf(rows[i][0]), rows[i][2]);
    }
  }

  // 教科書履修
  const tb = ss.getSheetByName('教科書履修');
  if (tb) {
    const rows = tb.getDataRange().getValues();
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][3] !== '履修済み') continue;
      touch(rows[i][1], 'textbook', dateOf(rows[i][0]), rows[i][2]);
    }
  }

  const list = Object.keys(people).map(k => people[k])
    .sort((a, b) => b.lastDate.localeCompare(a.lastDate) || a.name.localeCompare(b.name));
  return json({ from: fromStr, to: Utilities.formatDate(today, 'Asia/Tokyo', 'yyyy-MM-dd'), people: list });
}
