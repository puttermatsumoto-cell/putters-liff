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

  const userName = e && e.parameter && e.parameter.name;
  if (userName) return getHomeworkForUser(userName);

  return ContentService.createTextOutput('ok');
}

function doPost(e) {
  const data = JSON.parse(e.postData.contents);
  if (data.action === 'book') return bookAppointment(data);
  if (data.action === 'book_all') return bookAll(data);
  if (data.action === 'feedback') return saveFeedback(data);
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
  if (!sheet || !name) return json({ isShift: false });
  const data = sheet.getDataRange().getValues();
  for (const row of data) {
    if (row[0] === name) {
      const isShift = row[1] && String(row[1]).includes('シフト制');
      return json({ isShift: !!isShift });
    }
  }
  return json({ isShift: false });
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
    .filter(ev => ev.getTitle() === name)
    .map(ev => ({
      date: Utilities.formatDate(ev.getStartTime(), 'Asia/Tokyo', 'yyyy-MM-dd'),
      time: Utilities.formatDate(ev.getStartTime(), 'Asia/Tokyo', 'HH:mm')
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
      latest[name] = { date: Utilities.formatDate(new Date(date), 'Asia/Tokyo', 'yyyy-MM-dd'), name, weight: row[2]||'-', foods: row[3]||'-', p: row[4]||0, f: row[5]||0, c: row[6]||0, kcal: row[7]||0, cardio: row[8]||0 };
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
    grouped[name].push({ date: dateStr, weight: parseFloat(row[2])||null, p: parseFloat(row[4])||0, f: parseFloat(row[5])||0, c: parseFloat(row[6])||0, kcal: parseFloat(row[7])||0, cardio: parseFloat(row[8])||0 });
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
      // A列=名前、B列=シフト制、C列以降=宿題
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
      for (let j = 2; j < data[i].length; j++) { // C列（index 2）から
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
  if (!sheet) return json({ tasks: [] });
  const data = sheet.getDataRange().getValues();
  for (const row of data) {
    if (row[0] === userName) return json({ tasks: row.slice(2).filter(t => t !== '') });
  }
  return json({ tasks: [] });
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

  // 宿題達成率
  let hwDays = 0, hwFullDays = 0;
  records.forEach(r => {
    if (r.checkedTasks || r.uncheckedTasks) {
      hwDays++;
      if (!r.uncheckedTasks) hwFullDays++;
    }
  });
  const hwRate = hwDays > 0 ? Math.round(hwFullDays / hwDays * 100) : 0;

  // 体重推移テーブル（全記録）
  const weightRows = records.filter(r => r.weight).map(r =>
    `<tr><td style="padding:6px 12px;border-bottom:1px solid #f0f0f0;">${r.date.slice(5)}</td><td style="padding:6px 12px;border-bottom:1px solid #f0f0f0;font-weight:bold;">${r.weight}kg</td></tr>`
  ).join('');

  const fbHtml = feedback.length ? feedback.map(f => `
    <div style="background:#f9f9f9;border-radius:8px;padding:12px;margin-bottom:8px;">
      <div style="font-size:11px;color:#aaa;margin-bottom:4px;">${f.date}</div>
      ${f.training ? `<div>💪 <b>やってみたいトレーニング：</b>${f.training}</div>` : ''}
      ${f.question ? `<div>❓ <b>わからなかったこと：</b>${f.question}</div>` : ''}
      ${f.goal ? `<div>🎯 <b>今後の目標：</b>${f.goal}</div>` : ''}
    </div>
  `).join('') : '<p style="color:#aaa;">今月の意見箱はありません</p>';

  return `
<!DOCTYPE html>
<html lang="ja">
<body style="margin:0;padding:0;background:#f5f0eb;font-family:'Hiragino Kaku Gothic ProN',sans-serif;">
<div style="max-width:600px;margin:0 auto;padding:24px;">

  <div style="background:#1a1a2e;border-radius:16px;padding:24px;text-align:center;margin-bottom:20px;">
    <div style="color:#c8a97e;font-size:13px;margin-bottom:4px;">PUTTERS パーソナルジム</div>
    <div style="color:white;font-size:22px;font-weight:bold;">${name} マンスリーレポート</div>
    <div style="color:#aaa;font-size:13px;margin-top:4px;">${monthLabel}（記録${records.length}日）</div>
  </div>

  <!-- 体重まとめ -->
  <div style="background:white;border-radius:16px;padding:20px;margin-bottom:16px;">
    <div style="font-size:15px;font-weight:bold;color:#1a1a2e;margin-bottom:12px;">⚖️ 体重</div>
    <div style="display:flex;gap:12px;margin-bottom:12px;">
      <div style="flex:1;background:#f5f0eb;border-radius:10px;padding:12px;text-align:center;">
        <div style="font-size:11px;color:#888;">月初</div>
        <div style="font-size:20px;font-weight:bold;color:#1a1a2e;">${startWeight ? startWeight + 'kg' : '-'}</div>
      </div>
      <div style="flex:1;background:#f5f0eb;border-radius:10px;padding:12px;text-align:center;">
        <div style="font-size:11px;color:#888;">月末</div>
        <div style="font-size:20px;font-weight:bold;color:#1a1a2e;">${endWeight ? endWeight + 'kg' : '-'}</div>
      </div>
      <div style="flex:1;background:#f5f0eb;border-radius:10px;padding:12px;text-align:center;">
        <div style="font-size:11px;color:#888;">変化</div>
        <div style="font-size:20px;font-weight:bold;color:${weightChange < 0 ? '#388e3c' : weightChange > 0 ? '#c62828' : '#333'};">${weightChange !== null ? (weightChange > 0 ? '+' : '') + weightChange + 'kg' : '-'}</div>
      </div>
    </div>
    ${weightRows ? `<table style="width:100%;border-collapse:collapse;font-size:13px;">${weightRows}</table>` : '<p style="color:#aaa;font-size:13px;">記録なし</p>'}
  </div>

  <!-- 体温・有酸素 -->
  <div style="display:flex;gap:12px;margin-bottom:16px;">
    <div style="flex:1;background:white;border-radius:16px;padding:20px;">
      <div style="font-size:15px;font-weight:bold;color:#1a1a2e;margin-bottom:8px;">🌡️ 体温平均</div>
      <div style="font-size:28px;font-weight:bold;color:#e57373;">${avgTemp}℃</div>
    </div>
    <div style="flex:1;background:white;border-radius:16px;padding:20px;">
      <div style="font-size:15px;font-weight:bold;color:#1a1a2e;margin-bottom:8px;">🏃 有酸素</div>
      <div style="font-size:16px;font-weight:bold;color:#81c784;">合計 ${totalCardio}分</div>
      <div style="font-size:13px;color:#888;margin-top:4px;">1日平均 ${avgCardio}分 / 実施 ${cardioDays}日</div>
    </div>
  </div>

  <!-- 食事 -->
  <div style="background:white;border-radius:16px;padding:20px;margin-bottom:16px;">
    <div style="font-size:15px;font-weight:bold;color:#1a1a2e;margin-bottom:12px;">🍽️ 食事（月平均）</div>
    <div style="display:flex;gap:8px;text-align:center;">
      <div style="flex:1;background:#f5f0eb;border-radius:10px;padding:10px;">
        <div style="font-size:11px;color:#888;">タンパク質</div>
        <div style="font-size:18px;font-weight:bold;color:#e57373;">${avgP}g</div>
      </div>
      <div style="flex:1;background:#f5f0eb;border-radius:10px;padding:10px;">
        <div style="font-size:11px;color:#888;">脂質</div>
        <div style="font-size:18px;font-weight:bold;color:#ffb74d;">${avgF}g</div>
      </div>
      <div style="flex:1;background:#f5f0eb;border-radius:10px;padding:10px;">
        <div style="font-size:11px;color:#888;">炭水化物</div>
        <div style="font-size:18px;font-weight:bold;color:#81c784;">${avgC}g</div>
      </div>
      <div style="flex:1;background:#f5f0eb;border-radius:10px;padding:10px;">
        <div style="font-size:11px;color:#888;">kcal</div>
        <div style="font-size:18px;font-weight:bold;color:#9575cd;">${avgKcal}</div>
      </div>
    </div>
  </div>

  <!-- 宿題達成率 -->
  <div style="background:white;border-radius:16px;padding:20px;margin-bottom:16px;">
    <div style="font-size:15px;font-weight:bold;color:#1a1a2e;margin-bottom:12px;">📋 宿題達成率</div>
    <div style="display:flex;align-items:center;gap:16px;">
      <div style="font-size:36px;font-weight:bold;color:${hwRate >= 80 ? '#388e3c' : hwRate >= 50 ? '#f57c00' : '#c62828'};">${hwRate}%</div>
      <div style="color:#888;font-size:13px;">${hwDays}日中 ${hwFullDays}日 全達成</div>
    </div>
  </div>

  <!-- 意見箱 -->
  <div style="background:white;border-radius:16px;padding:20px;margin-bottom:16px;">
    <div style="font-size:15px;font-weight:bold;color:#1a1a2e;margin-bottom:12px;">📮 意見箱（今月分）</div>
    ${fbHtml}
  </div>

  <div style="text-align:center;color:#aaa;font-size:11px;">PUTTERS パーソナルジム｜自動送信メール</div>
</div>
</body>
</html>`;
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

  // 今日より後、今月末までにこの人の予定があるか確認
  const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0, 23, 59, 59);
  const futureThisMonth = cal.getEvents(new Date(todayStr + 'T23:59:59'), monthEnd)
    .filter(ev => ev.getTitle() === name);

  if (futureThisMonth.length === 0) {
    // 今月最後の来店 → 未送信なら送る
    if (!sentLog.has(name + '_' + thisMonthStr)) return { send: true, monthStr: thisMonthStr };
    return { send: false };
  }

  // 今月が初来店で先月来店があった場合（先月キャンセルでマンスリー未送信）
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
  // fromStr：対象月の前月最終来店日（なければ対象月の1日）
  // toStr：今日の前日（今月最後来店の場合）or 対象月末（先月分送信の場合）
  const prevVisit = getPrevVisitDate(name, todayStr);
  const today = new Date(todayStr + 'T12:00:00');
  const thisMonthStr = Utilities.formatDate(today, 'Asia/Tokyo', 'yyyy-MM');

  let toStr;
  if (monthStr === thisMonthStr) {
    // 今月最終来店 → 前日まで
    const yesterday = new Date(new Date(todayStr).getTime() - 24 * 60 * 60 * 1000);
    toStr = Utilities.formatDate(yesterday, 'Asia/Tokyo', 'yyyy-MM-dd');
  } else {
    // 先月分（キャンセルで翌月に） → 先月末まで
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

  // 今日のカレンダーを確認
  const cal = CalendarApp.getCalendarById(CALENDAR_ID);
  const start = new Date(todayStr + 'T00:00:00');
  const end = new Date(todayStr + 'T23:59:59');
  const events = cal.getEvents(start, end);

  if (events.length === 0) return; // 今日来店なし

  const names = [...new Set(events.map(ev => ev.getTitle()).filter(t => t))];

  // 週次レポート（全員まとめて1通）
  const weeklyHtmls = [];
  const weeklyPdfs = [];
  const monthlyHtmls = [];
  const monthlyPdfs = [];
  const monthlyNames = [];

  const sentLog = getMonthlySentLog();

  names.forEach(name => {
    const weeklyData = getClientWeeklyData(name);
    weeklyHtmls.push(buildReportHtml(name, weeklyData, todayStr));
    weeklyPdfs.push(buildReportPdf(name, weeklyData, todayStr));

    const monthly = shouldSendMonthly(name, todayStr, sentLog);
    if (monthly.send) {
      const { fromStr, toStr, label } = getMonthlyPeriod(name, todayStr, monthly.monthStr);
      const monthlyData = getClientPeriodData(name, fromStr, toStr);
      monthlyHtmls.push(buildMonthlyReportHtml(name, monthlyData, label));
      monthlyPdfs.push(buildMonthlyReportPdf(name, monthlyData, label, monthly.monthStr));
      monthlyNames.push(name);
      recordMonthlySent(name, monthly.monthStr);
    }
  });

  MailApp.sendEmail({
    to: NOTIFY_EMAIL,
    subject: '【PUTTERS】週次レポート ' + dateLabel + '（' + names.length + '名）',
    htmlBody: weeklyHtmls.join('<div style="page-break-after:always;border-top:2px dashed #ccc;margin:40px 0;"></div>'),
    attachments: weeklyPdfs
  });

  if (monthlyHtmls.length > 0) {
    MailApp.sendEmail({
      to: NOTIFY_EMAIL,
      subject: '【PUTTERS】月次レポート ' + dateLabel + '（' + monthlyNames.length + '名）',
      htmlBody: monthlyHtmls.join('<div style="page-break-after:always;border-top:2px dashed #ccc;margin:40px 0;"></div>'),
      attachments: monthlyPdfs
    });
  }
}

function getPrevVisitDate(name, todayStr) {
  // カレンダーから今日より前の直近来店日を取得
  const cal = CalendarApp.getCalendarById(CALENDAR_ID);
  const searchStart = new Date(new Date(todayStr).getTime() - 90 * 24 * 60 * 60 * 1000); // 90日前まで遡る
  const searchEnd = new Date(todayStr + 'T00:00:00'); // 今日の0時（今日は含まない）
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

  // 前回来店日を取得（なければ7日前をデフォルト）
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

  // 意見箱
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

  return { records, feedback, prevVisitStr };
}

function buildReportHtml(name, data, todayStr) {
  const { records, feedback, prevVisitStr } = data;
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

  // 宿題達成率
  let hwDays = 0, hwFullDays = 0;
  records.forEach(r => {
    if (r.checkedTasks || r.uncheckedTasks) {
      hwDays++;
      if (!r.uncheckedTasks) hwFullDays++;
    }
  });

  const weightRows = records.filter(r => r.weight).map(r =>
    `<tr><td style="padding:6px 12px;border-bottom:1px solid #f0f0f0;">${r.date.slice(5)}</td><td style="padding:6px 12px;border-bottom:1px solid #f0f0f0;font-weight:bold;">${r.weight}kg</td></tr>`
  ).join('');

  const fbHtml = feedback.length ? feedback.map(f => `
    <div style="background:#f9f9f9;border-radius:8px;padding:12px;margin-bottom:8px;">
      <div style="font-size:11px;color:#aaa;margin-bottom:4px;">${f.date}</div>
      ${f.training ? `<div>💪 <b>やってみたいトレーニング：</b>${f.training}</div>` : ''}
      ${f.question ? `<div>❓ <b>わからなかったこと：</b>${f.question}</div>` : ''}
      ${f.goal ? `<div>🎯 <b>今後の目標：</b>${f.goal}</div>` : ''}
    </div>
  `).join('') : '<p style="color:#aaa;">今週の意見箱はありません</p>';

  return `
<!DOCTYPE html>
<html lang="ja">
<body style="margin:0;padding:0;background:#f5f0eb;font-family:'Hiragino Kaku Gothic ProN',sans-serif;">
<div style="max-width:600px;margin:0 auto;padding:24px;">

  <div style="background:#1a1a2e;border-radius:16px;padding:24px;text-align:center;margin-bottom:20px;">
    <div style="color:#c8a97e;font-size:13px;margin-bottom:4px;">PUTTERS パーソナルジム</div>
    <div style="color:white;font-size:22px;font-weight:bold;">${name} 週次レポート</div>
    <div style="color:#aaa;font-size:13px;margin-top:4px;">${todayStr} 来店（${periodLabel}）</div>
  </div>

  <!-- 体重 -->
  <div style="background:white;border-radius:16px;padding:20px;margin-bottom:16px;">
    <div style="font-size:15px;font-weight:bold;color:#1a1a2e;margin-bottom:12px;">⚖️ 体重</div>
    <div style="display:flex;gap:12px;margin-bottom:12px;">
      <div style="flex:1;background:#f5f0eb;border-radius:10px;padding:12px;text-align:center;">
        <div style="font-size:11px;color:#888;">開始時</div>
        <div style="font-size:20px;font-weight:bold;color:#1a1a2e;">${weights.length ? weights[0] + 'kg' : '-'}</div>
      </div>
      <div style="flex:1;background:#f5f0eb;border-radius:10px;padding:12px;text-align:center;">
        <div style="font-size:11px;color:#888;">最新</div>
        <div style="font-size:20px;font-weight:bold;color:#1a1a2e;">${weights.length ? weights[weights.length-1] + 'kg' : '-'}</div>
      </div>
      <div style="flex:1;background:#f5f0eb;border-radius:10px;padding:12px;text-align:center;">
        <div style="font-size:11px;color:#888;">変化</div>
        <div style="font-size:20px;font-weight:bold;color:${weightChange < 0 ? '#388e3c' : weightChange > 0 ? '#c62828' : '#333'};">${weightChange !== null ? (weightChange > 0 ? '+' : '') + weightChange + 'kg' : '-'}</div>
      </div>
    </div>
    ${weightRows ? `<table style="width:100%;border-collapse:collapse;font-size:13px;">${weightRows}</table>` : '<p style="color:#aaa;font-size:13px;">記録なし</p>'}
  </div>

  <!-- 体温・有酸素 -->
  <div style="display:flex;gap:12px;margin-bottom:16px;">
    <div style="flex:1;background:white;border-radius:16px;padding:20px;">
      <div style="font-size:15px;font-weight:bold;color:#1a1a2e;margin-bottom:8px;">🌡️ 体温平均</div>
      <div style="font-size:28px;font-weight:bold;color:#e57373;">${avgTemp}℃</div>
    </div>
    <div style="flex:1;background:white;border-radius:16px;padding:20px;">
      <div style="font-size:15px;font-weight:bold;color:#1a1a2e;margin-bottom:8px;">🏃 有酸素</div>
      <div style="font-size:28px;font-weight:bold;color:#81c784;">${totalCardio}分</div>
    </div>
  </div>

  <!-- 食事 -->
  <div style="background:white;border-radius:16px;padding:20px;margin-bottom:16px;">
    <div style="font-size:15px;font-weight:bold;color:#1a1a2e;margin-bottom:12px;">🍽️ 食事（週平均）</div>
    <div style="display:flex;gap:8px;text-align:center;">
      <div style="flex:1;background:#f5f0eb;border-radius:10px;padding:10px;">
        <div style="font-size:11px;color:#888;">タンパク質</div>
        <div style="font-size:18px;font-weight:bold;color:#e57373;">${avgP}g</div>
      </div>
      <div style="flex:1;background:#f5f0eb;border-radius:10px;padding:10px;">
        <div style="font-size:11px;color:#888;">脂質</div>
        <div style="font-size:18px;font-weight:bold;color:#ffb74d;">${avgF}g</div>
      </div>
      <div style="flex:1;background:#f5f0eb;border-radius:10px;padding:10px;">
        <div style="font-size:11px;color:#888;">炭水化物</div>
        <div style="font-size:18px;font-weight:bold;color:#81c784;">${avgC}g</div>
      </div>
      <div style="flex:1;background:#f5f0eb;border-radius:10px;padding:10px;">
        <div style="font-size:11px;color:#888;">kcal</div>
        <div style="font-size:18px;font-weight:bold;color:#9575cd;">${avgKcal}</div>
      </div>
    </div>
  </div>

  <!-- 宿題達成率 -->
  <div style="background:white;border-radius:16px;padding:20px;margin-bottom:16px;">
    <div style="font-size:15px;font-weight:bold;color:#1a1a2e;margin-bottom:12px;">📋 宿題達成</div>
    <div style="font-size:28px;font-weight:bold;color:#1a1a2e;">${hwDays > 0 ? hwFullDays + '/' + hwDays + '日 全達成' : '記録なし'}</div>
  </div>

  <!-- 意見箱 -->
  <div style="background:white;border-radius:16px;padding:20px;margin-bottom:16px;">
    <div style="font-size:15px;font-weight:bold;color:#1a1a2e;margin-bottom:12px;">📮 意見箱</div>
    ${fbHtml}
  </div>

  <div style="text-align:center;color:#aaa;font-size:11px;">PUTTERS パーソナルジム｜自動送信メール</div>
</div>
</body>
</html>`;
}

function buildReportPdf(name, data, todayStr) {
  const html = buildReportHtml(name, data, todayStr);
  const blob = Utilities.newBlob(html, 'text/html', 'report.html');
  // Google DriveにHTMLを一時保存してPDF化
  const file = DriveApp.createFile(blob);
  const pdf = file.getAs('application/pdf');
  pdf.setName(name + '_レポート_' + todayStr + '.pdf');
  file.setTrashed(true); // 一時ファイルを削除
  return pdf;
}
