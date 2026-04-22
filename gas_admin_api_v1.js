// ============================================================
// 既存のGASコードの末尾にこれを追加してください
// 追加後：デプロイ → デプロイを管理 → 編集 → 新バージョン → デプロイ
// ============================================================

// 管理画面用：GETリクエストのルーティング
// 既存のdoGet関数がある場合は、その中にelseif分岐を追加してください
// 既存のdoGetがない場合はこのままコピーしてください

function doGet(e) {
  const action = e && e.parameter && e.parameter.action;

  // 管理画面：お客さん全員の直近データ
  if (action === 'admin_summary') {
    return adminSummary();
  }

  // 管理画面：マンスリーレポート
  if (action === 'admin_monthly') {
    const month = e.parameter.month; // "2026-04"
    return adminMonthly(month);
  }

  // 管理画面：宿題シート取得
  if (action === 'admin_homework') {
    return adminHomework();
  }

  // 管理画面：宿題を追加
  if (action === 'admin_add_homework') {
    const name = e.parameter.name;
    const task = e.parameter.task;
    return adminAddHomework(name, task);
  }

  // 管理画面：宿題を削除
  if (action === 'admin_delete_homework') {
    const name = e.parameter.name;
    const task = e.parameter.task;
    return adminDeleteHomework(name, task);
  }

  // 既存のdoGet処理（宿題取得）
  const userName = e && e.parameter && e.parameter.name;
  if (userName) {
    return getHomeworkForUser(userName);
  }

  return ContentService.createTextOutput('ok');
}

// お客さん全員の直近データをまとめて返す
function adminSummary() {
  const ss = SpreadsheetApp.openById('1Me9JRGM8VKahuYrSSHskJ75z2OCcQSUg42zOojOTmf8');
  const sheet = ss.getSheetByName('記録') || ss.getSheets()[0];
  const data = sheet.getDataRange().getValues();

  // 名前ごとの最新レコードを収集
  const latest = {};
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const date = row[0];
    const name = row[1];
    if (!name) continue;
    if (!latest[name] || new Date(date) > new Date(latest[name].date)) {
      latest[name] = {
        date: Utilities.formatDate(new Date(date), 'Asia/Tokyo', 'yyyy-MM-dd'),
        name: name,
        weight: row[2] || '-',
        foods: row[3] || '-',
        p: row[4] || 0,
        f: row[5] || 0,
        c: row[6] || 0,
        kcal: row[7] || 0,
        cardio: row[8] || 0
      };
    }
  }

  const result = Object.values(latest).sort((a, b) => b.date.localeCompare(a.date));
  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

// マンスリーレポート（指定月のデータを名前別に集計）
function adminMonthly(month) {
  const ss = SpreadsheetApp.openById('1Me9JRGM8VKahuYrSSHskJ75z2OCcQSUg42zOojOTmf8');
  const sheet = ss.getSheetByName('記録') || ss.getSheets()[0];
  const data = sheet.getDataRange().getValues();

  const grouped = {};
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const date = row[0];
    if (!date) continue;
    const dateStr = Utilities.formatDate(new Date(date), 'Asia/Tokyo', 'yyyy-MM-dd');
    if (!dateStr.startsWith(month)) continue;
    const name = row[1];
    if (!name) continue;
    if (!grouped[name]) grouped[name] = [];
    grouped[name].push({
      date: dateStr,
      weight: parseFloat(row[2]) || null,
      p: parseFloat(row[4]) || 0,
      f: parseFloat(row[5]) || 0,
      c: parseFloat(row[6]) || 0,
      kcal: parseFloat(row[7]) || 0,
      cardio: parseFloat(row[8]) || 0
    });
  }

  const result = Object.entries(grouped).map(([name, records]) => {
    records.sort((a, b) => a.date.localeCompare(b.date));
    const weights = records.map(r => r.weight).filter(w => w !== null);
    const avgWeight = weights.length > 0 ? (weights.reduce((s, v) => s + v, 0) / weights.length).toFixed(1) : '-';
    const weightChange = weights.length >= 2 ? (weights[weights.length - 1] - weights[0]).toFixed(1) : '-';
    const avg = key => (records.reduce((s, r) => s + r[key], 0) / records.length).toFixed(1);
    return {
      name,
      days: records.length,
      avgWeight,
      weightChange,
      avgP: avg('p'),
      avgF: avg('f'),
      avgC: avg('c'),
      avgKcal: Math.round(records.reduce((s, r) => s + r.kcal, 0) / records.length),
      totalCardio: records.reduce((s, r) => s + r.cardio, 0)
    };
  }).sort((a, b) => b.days - a.days);

  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

// 宿題シート全員分を返す
function adminHomework() {
  const ss = SpreadsheetApp.openById('1Me9JRGM8VKahuYrSSHskJ75z2OCcQSUg42zOojOTmf8');
  const sheet = ss.getSheetByName('宿題');
  if (!sheet) {
    return ContentService.createTextOutput(JSON.stringify([])).setMimeType(ContentService.MimeType.JSON);
  }
  const data = sheet.getDataRange().getValues();
  const result = data.map(row => ({
    name: row[0],
    tasks: row.slice(1).filter(t => t !== '')
  })).filter(r => r.name);

  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

// 宿題を追加
function adminAddHomework(name, task) {
  const ss = SpreadsheetApp.openById('1Me9JRGM8VKahuYrSSHskJ75z2OCcQSUg42zOojOTmf8');
  const sheet = ss.getSheetByName('宿題');
  if (!sheet || !name || !task) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false })).setMimeType(ContentService.MimeType.JSON);
  }
  const data = sheet.getDataRange().getValues();
  for (let i = 0; i < data.length; i++) {
    if (data[i][0] === name) {
      const col = data[i].filter(c => c !== '').length + 1;
      sheet.getRange(i + 1, col).setValue(task);
      return ContentService.createTextOutput(JSON.stringify({ ok: true })).setMimeType(ContentService.MimeType.JSON);
    }
  }
  return ContentService.createTextOutput(JSON.stringify({ ok: false, error: 'name not found' })).setMimeType(ContentService.MimeType.JSON);
}

// 宿題を削除
function adminDeleteHomework(name, task) {
  const ss = SpreadsheetApp.openById('1Me9JRGM8VKahuYrSSHskJ75z2OCcQSUg42zOojOTmf8');
  const sheet = ss.getSheetByName('宿題');
  if (!sheet || !name || !task) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false })).setMimeType(ContentService.MimeType.JSON);
  }
  const data = sheet.getDataRange().getValues();
  for (let i = 0; i < data.length; i++) {
    if (data[i][0] === name) {
      for (let j = 1; j < data[i].length; j++) {
        if (data[i][j] === task) {
          // その列を削除して詰める
          const row = sheet.getRange(i + 1, 1, 1, data[i].length);
          const vals = row.getValues()[0];
          vals.splice(j, 1);
          vals.push('');
          row.setValues([vals]);
          return ContentService.createTextOutput(JSON.stringify({ ok: true })).setMimeType(ContentService.MimeType.JSON);
        }
      }
    }
  }
  return ContentService.createTextOutput(JSON.stringify({ ok: false })).setMimeType(ContentService.MimeType.JSON);
}

// 既存のユーザー別宿題取得（既存のdoGetがある場合は不要）
function getHomeworkForUser(userName) {
  const ss = SpreadsheetApp.openById('1Me9JRGM8VKahuYrSSHskJ75z2OCcQSUg42zOojOTmf8');
  const sheet = ss.getSheetByName('宿題');
  if (!sheet) {
    return ContentService.createTextOutput(JSON.stringify({ tasks: [] })).setMimeType(ContentService.MimeType.JSON);
  }
  const data = sheet.getDataRange().getValues();
  for (const row of data) {
    if (row[0] === userName) {
      const tasks = row.slice(1).filter(t => t !== '');
      return ContentService.createTextOutput(JSON.stringify({ tasks })).setMimeType(ContentService.MimeType.JSON);
    }
  }
  return ContentService.createTextOutput(JSON.stringify({ tasks: [] })).setMimeType(ContentService.MimeType.JSON);
}
