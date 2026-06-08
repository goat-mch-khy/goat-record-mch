const SHEET_ID = 'PASTE_YOUR_SPREADSHEET_ID_HERE';

function doPost(e) {
  try {
    var ss   = SpreadsheetApp.openById(SHEET_ID);
    var data = JSON.parse(e.postData.contents);
    var nameMap = {'AN':'AN','PN':'PN','FP':'FP','RPT':'REPORTING','PATIENTS':'Patients'};
    var tabName = nameMap[data.sheet] || data.sheet;
    var tab = ss.getSheetByName(tabName);
    if (!tab) tab = ss.insertSheet(tabName);
    var row = data.row;
    row['_submitted_at'] = new Date().toISOString();
    var headers = [];
    if (tab.getLastRow() >= 3 && tab.getLastColumn() > 0) {
      headers = tab.getRange(3, 1, 1, tab.getLastColumn()).getValues()[0];
    }
    if (headers.length === 0 || headers.every(function(h){ return h === ''; })) {
      headers = Object.keys(row);
      tab.appendRow(headers);
    }
    var outputRow = headers.map(function(header) {
      if (!header) return '';
      if (row[header] !== undefined && row[header] !== null) return row[header];
      var lh = String(header).toLowerCase().trim();
      var keys = Object.keys(row);
      for (var i = 0; i < keys.length; i++) {
        if (String(keys[i]).toLowerCase().trim() === lh) return row[keys[i]];
      }
      return '';
    });
    tab.appendRow(outputRow);
    return respond({status:'ok', visit_id: row.visit_id, sheet: tabName});
  } catch(err) {
    return respond({status:'error', message: err.toString()});
  }
}

function doGet(e) {
  var action = e.parameter.action;
  if (action === 'getData') {
    return getData(e.parameter.sheet);
  }
  return respond({status:'online', app:'GOAT Record MCH'});
}

function getData(sheetName) {
  try {
    var ss  = SpreadsheetApp.openById(SHEET_ID);
    var tab = ss.getSheetByName(sheetName);
    if (!tab) {
      return respond({status:'ok', sheet: sheetName, data: []});
    }
    var lastRow = tab.getLastRow();
    var lastCol = tab.getLastColumn();
    if (lastRow < 4 || lastCol < 1) {
      return respond({status:'ok', sheet: sheetName, data: []});
    }
    // Row 3 = headers, Row 4+ = data
    var headers = tab.getRange(3, 1, 1, lastCol).getValues()[0];
    var numDataRows = lastRow - 3;
    if (numDataRows < 1) return respond({status:'ok', sheet: sheetName, data: []});
    var rows = tab.getRange(4, 1, numDataRows, lastCol).getValues();
    var result = [];
    for (var i = 0; i < rows.length; i++) {
      var obj = {};
      var hasValue = false;
      for (var j = 0; j < headers.length; j++) {
        if (headers[j]) {
          var val = rows[i][j];
          // Convert Date objects to ISO string
          if (val instanceof Date) {
            val = Utilities.formatDate(val, Session.getScriptTimeZone(), 'yyyy-MM-dd');
          }
          obj[headers[j]] = (val !== undefined && val !== null) ? String(val) : '';
          if (obj[headers[j]] !== '' && obj[headers[j]] !== 'undefined') hasValue = true;
        }
      }
      if (hasValue) result.push(obj);
    }
    return respond({status:'ok', sheet: sheetName, count: result.length, data: result});
  } catch(err) {
    return respond({status:'error', message: err.toString()});
  }
}

function respond(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}