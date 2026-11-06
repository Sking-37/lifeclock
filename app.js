(function () {
  "use strict";

  var STORAGE_KEY = "lifeclock:v1";
  var YEAR_DAYS = 365.2425;
  var DAY_MS = 86400000;

  var DEFAULTS = {
    birthDate: "1995-06-15",
    workStartDate: "2018-07-01",
    gender: "male",
    retireMode: "reform",
    customAge: 60,
    flexMonths: 0,
    dailyHours: 8,
    sleepHours: 8,
    restSleepHours: 9,
    commuteHours: 1,
    workdaysPerWeek: 5,
    statutoryHolidays: 13,
    priorYears: 0,
    extraLeaveEnabled: true,
    extraInterval: 1,
    extraIncrement: 1,
    extraCap: 10,
    standardHours: 8,
    weekendOTDays: 0,
    weekendOTHours: 8,
    otRate: 1.5,
    monthlySalary: 15000,
    bonusMonths: 0
  };

  var PRESETS = {
    male: { base: 60, startYear: 1965, step: 4, maxDelay: 36, label: "男职工" },
    female55: { base: 55, startYear: 1970, step: 4, maxDelay: 36, label: "女职工（原 55 岁）" },
    female50: { base: 50, startYear: 1975, step: 2, maxDelay: 60, label: "女职工（原 50 岁）" }
  };

  var state = loadState();
  var lastRetireTime = null;
  var lastSecond = -1;
  var lunarCacheKey = "";
  var lunarCacheText = "";

  /* ---------------- 工具函数 ---------------- */

  function $(id) {
    return document.getElementById(id);
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function num(value, fallback) {
    var parsed = parseFloat(value);
    return isFinite(parsed) ? parsed : fallback;
  }

  function parseIntSafe(value, fallback) {
    var parsed = parseInt(value, 10);
    return isFinite(parsed) ? parsed : fallback;
  }

  function parseDate(value) {
    if (!value) return null;
    var parts = value.split("-");
    if (parts.length !== 3) return null;
    var y = parseInt(parts[0], 10);
    var m = parseInt(parts[1], 10);
    var d = parseInt(parts[2], 10);
    if (!isFinite(y) || !isFinite(m) || !isFinite(d)) return null;
    var date = new Date(Date.UTC(y, m - 1, d));
    if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
    return date;
  }

  function addMonths(date, months) {
    var y = date.getUTCFullYear();
    var m = date.getUTCMonth();
    var d = date.getUTCDate();
    var target = new Date(Date.UTC(y, m + months, 1));
    var lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
    target.setUTCDate(Math.min(d, lastDay));
    return target;
  }

  function diffDays(from, to) {
    return Math.round((to.getTime() - from.getTime()) / DAY_MS);
  }

  /* ---------------- 农历换算（1900-2100） ---------------- */

  var LUNAR_INFO = [
    0x04bd8, 0x04ae0, 0x0a570, 0x054d5, 0x0d260, 0x0d950, 0x16554, 0x056a0, 0x09ad0, 0x055d2,
    0x04ae0, 0x0a5b6, 0x0a4d0, 0x0d250, 0x1d255, 0x0b540, 0x0d6a0, 0x0ada2, 0x095b0, 0x14977,
    0x04970, 0x0a4b0, 0x0b4b5, 0x06a50, 0x06d40, 0x1ab54, 0x02b60, 0x09570, 0x052f2, 0x04970,
    0x06566, 0x0d4a0, 0x0ea50, 0x06e95, 0x05ad0, 0x02b60, 0x186e3, 0x092e0, 0x1c8d7, 0x0c950,
    0x0d4a0, 0x1d8a6, 0x0b550, 0x056a0, 0x1a5b4, 0x025d0, 0x092d0, 0x0d2b2, 0x0a950, 0x0b557,
    0x06ca0, 0x0b550, 0x15355, 0x04da0, 0x0a5b0, 0x14573, 0x052b0, 0x0a9a8, 0x0e950, 0x06aa0,
    0x0aea6, 0x0ab50, 0x04b60, 0x0aae4, 0x0a570, 0x05260, 0x0f263, 0x0d950, 0x05b57, 0x056a0,
    0x096d0, 0x04dd5, 0x04ad0, 0x0a4d0, 0x0d4d4, 0x0d250, 0x0d558, 0x0b540, 0x0b6a0, 0x195a6,
    0x095b0, 0x049b0, 0x0a974, 0x0a4b0, 0x0b27a, 0x06a50, 0x06d40, 0x0af46, 0x0ab60, 0x09570,
    0x04af5, 0x04970, 0x064b0, 0x074a3, 0x0ea50, 0x06b58, 0x055c0, 0x0ab60, 0x096d5, 0x092e0,
    0x0c960, 0x0d954, 0x0d4a0, 0x0da50, 0x07552, 0x056a0, 0x0abb7, 0x025d0, 0x092d0, 0x0cab5,
    0x0a950, 0x0b4a0, 0x0baa4, 0x0ad50, 0x055d9, 0x04ba0, 0x0a5b0, 0x15176, 0x052b0, 0x0a930,
    0x07954, 0x06aa0, 0x0ad50, 0x05b52, 0x04b60, 0x0a6e6, 0x0a4e0, 0x0d260, 0x0ea65, 0x0d530,
    0x05aa0, 0x076a3, 0x096d0, 0x04afb, 0x04ad0, 0x0a4d0, 0x1d0b6, 0x0d250, 0x0d520, 0x0dd45,
    0x0b5a0, 0x056d0, 0x055b2, 0x049b0, 0x0a577, 0x0a4b0, 0x0aa50, 0x1b255, 0x06d20, 0x0ada0,
    0x14b63, 0x09370, 0x049f8, 0x04970, 0x064b0, 0x168a6, 0x0ea50, 0x06b20, 0x1a6c4, 0x0aae0,
    0x0a2e0, 0x0d2e3, 0x0c960, 0x0d557, 0x0d4a0, 0x0da50, 0x05d55, 0x056a0, 0x0a6d0, 0x055d4,
    0x052d0, 0x0a9b8, 0x0a950, 0x0b4a0, 0x0b6a6, 0x0ad50, 0x055a0, 0x0aba4, 0x0a5b0, 0x052b0,
    0x0b273, 0x06930, 0x07337, 0x06aa0, 0x0ad50, 0x14b55, 0x04b60, 0x0a570, 0x054e4, 0x0d160,
    0x0e968, 0x0d520, 0x0daa0, 0x16aa6, 0x056d0, 0x04ae0, 0x0a9d4, 0x0a2d0, 0x0d150, 0x0f252,
    0x0d520
  ];

  var LUNAR_MONTHS = ["正", "二", "三", "四", "五", "六", "七", "八", "九", "十", "冬", "腊"];
  var LUNAR_DAY_UNITS = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];
  var HEAVENLY_STEMS = ["甲", "乙", "丙", "丁", "戊", "己", "庚", "辛", "壬", "癸"];
  var EARTHLY_BRANCHES = ["子", "丑", "寅", "卯", "辰", "巳", "午", "未", "申", "酉", "戌", "亥"];
  var ZODIAC = ["鼠", "牛", "虎", "兔", "龙", "蛇", "马", "羊", "猴", "鸡", "狗", "猪"];

  function lunarYearDays(year) {
    var sum = 348;
    for (var bit = 0x8000; bit > 0x8; bit >>= 1) {
      sum += (LUNAR_INFO[year - 1900] & bit) ? 1 : 0;
    }
    return sum + lunarLeapDays(year);
  }

  function lunarLeapMonth(year) {
    return LUNAR_INFO[year - 1900] & 0xf;
  }

  function lunarLeapDays(year) {
    if (!lunarLeapMonth(year)) return 0;
    return (LUNAR_INFO[year - 1900] & 0x10000) ? 30 : 29;
  }

  function lunarMonthDays(year, month) {
    return (LUNAR_INFO[year - 1900] & (0x10000 >> month)) ? 30 : 29;
  }

  function solarToLunar(date) {
    var offset = Math.floor(
      (Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - Date.UTC(1900, 0, 31)) / DAY_MS
    );
    var year = 1900;
    var temp = 0;
    for (; year < 2101 && offset > 0; year++) {
      temp = lunarYearDays(year);
      offset -= temp;
    }
    if (offset < 0) {
      offset += temp;
      year--;
    }

    var leap = lunarLeapMonth(year);
    var isLeap = false;
    var month = 1;
    for (month = 1; month < 13 && offset > 0; month++) {
      if (leap > 0 && month === leap + 1 && !isLeap) {
        month--;
        isLeap = true;
        temp = lunarLeapDays(year);
      } else {
        temp = lunarMonthDays(year, month);
      }
      if (isLeap && month === leap + 1) isLeap = false;
      offset -= temp;
    }
    if (offset === 0 && leap > 0 && month === leap + 1) {
      if (isLeap) {
        isLeap = false;
      } else {
        isLeap = true;
        month--;
      }
    }
    if (offset < 0) {
      offset += temp;
      month--;
    }
    return { year: year, month: month, day: offset + 1, isLeap: isLeap };
  }

  function lunarDayName(day) {
    if (day === 10) return "初十";
    if (day === 20) return "二十";
    if (day === 30) return "三十";
    var tens = Math.floor(day / 10);
    var unit = day % 10;
    if (tens === 0) return "初" + LUNAR_DAY_UNITS[unit - 1];
    return ["十", "廿", "三"][tens - 1] + LUNAR_DAY_UNITS[unit - 1];
  }

  function lunarDateText(date) {
    var lunar = solarToLunar(date);
    var yearName =
      HEAVENLY_STEMS[(lunar.year - 4) % 10] +
      EARTHLY_BRANCHES[(lunar.year - 4) % 12] +
      ZODIAC[(lunar.year - 4) % 12] +
      "年";
    var monthName = (lunar.isLeap ? "闰" : "") + LUNAR_MONTHS[lunar.month - 1] + "月";
    return "农历" + yearName + " " + monthName + lunarDayName(lunar.day);
  }

  function fmtInt(value) {
    return Math.round(value).toLocaleString("zh-CN");
  }

  function fmt1(value) {
    return value.toLocaleString("zh-CN", { maximumFractionDigits: 1, minimumFractionDigits: 0 });
  }

  function fmtMoney(value, decimals) {
    var digits = typeof decimals === "number" ? decimals : value % 1 ? 2 : 0;
    return value.toLocaleString("zh-CN", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits
    });
  }

  function fmtMoneyCompact(value) {
    if (value >= 100000000) return "¥ " + (value / 100000000).toFixed(2) + " 亿";
    if (value >= 10000) return "¥ " + (value / 10000).toFixed(1) + " 万";
    return "¥ " + fmtInt(value);
  }

  function fmtDate(date) {
    var y = date.getUTCFullYear();
    var m = String(date.getUTCMonth() + 1).padStart(2, "0");
    var d = String(date.getUTCDate()).padStart(2, "0");
    return y + " 年 " + m + " 月 " + d + " 日";
  }

  function fmtShort(date) {
    var y = date.getUTCFullYear();
    var m = String(date.getUTCMonth() + 1).padStart(2, "0");
    return y + "." + m;
  }

  function fmtHours(hours) {
    return fmtInt(hours) + " 小时";
  }

  function fmtDays(days) {
    return fmtInt(days) + " 天";
  }

  function yearsOf(days) {
    return days / YEAR_DAYS;
  }

  function pctOf(part, total) {
    if (!total) return 0;
    return (part / total) * 100;
  }

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  /* ---------------- 状态读写 ---------------- */

  function loadState() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return Object.assign({}, DEFAULTS);
      var saved = JSON.parse(raw);
      return Object.assign({}, DEFAULTS, saved);
    } catch (err) {
      return Object.assign({}, DEFAULTS);
    }
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (err) {
      /* 本地存储不可用时静默忽略 */
    }
  }

  function readInputs() {
    state.birthDate = $("birthDate").value || DEFAULTS.birthDate;
    state.workStartDate = $("workStartDate").value || DEFAULTS.workStartDate;
    state.customAge = clamp(num($("customAge").value, 60), 45, 70);
    state.flexMonths = parseIntSafe($("flexMonths").value, 0);
    state.dailyHours = num($("dailyHours").value, 8);
    state.sleepHours = num($("sleepHours").value, 8);
    state.restSleepHours = num($("restSleepHours").value, 9);
    state.commuteHours = num($("commuteHours").value, 1);
    state.workdaysPerWeek = parseIntSafe($("workdaysPerWeek").value, 5);
    state.statutoryHolidays = clamp(num($("statutoryHolidays").value, 13), 0, 40);
    state.priorYears = clamp(num($("priorYears").value, 0), 0, 40);
    state.extraLeaveEnabled = $("extraLeaveEnabled").checked;
    state.extraInterval = clamp(num($("extraInterval").value, 1), 0.5, 10);
    state.extraIncrement = clamp(num($("extraIncrement").value, 1), 0, 10);
    state.extraCap = clamp(num($("extraCap").value, 10), 0, 40);
    state.standardHours = num($("standardHours").value, 8);
    state.weekendOTDays = clamp(num($("weekendOTDays").value, 0), 0, 15);
    state.weekendOTHours = clamp(num($("weekendOTHours").value, 8), 0, 16);
    state.otRate = num($("otRate").value, 1.5);
    state.monthlySalary = clamp(num($("monthlySalary").value, 0), 0, 1000000);
    state.bonusMonths = clamp(num($("bonusMonths").value, 0), 0, 24);
  }

  function writeInputs() {
    $("birthDate").value = state.birthDate;
    $("workStartDate").value = state.workStartDate;
    $("customAge").value = state.customAge;
    $("flexMonths").value = state.flexMonths;
    $("dailyHours").value = state.dailyHours;
    $("sleepHours").value = state.sleepHours;
    $("restSleepHours").value = state.restSleepHours;
    $("commuteHours").value = state.commuteHours;
    $("workdaysPerWeek").value = state.workdaysPerWeek;
    $("statutoryHolidays").value = state.statutoryHolidays;
    $("priorYears").value = state.priorYears;
    $("extraLeaveEnabled").checked = state.extraLeaveEnabled;
    $("extraInterval").value = state.extraInterval;
    $("extraIncrement").value = state.extraIncrement;
    $("extraCap").value = state.extraCap;
    $("standardHours").value = state.standardHours;
    $("weekendOTDays").value = state.weekendOTDays;
    $("weekendOTHours").value = state.weekendOTHours;
    $("otRate").value = state.otRate;
    $("monthlySalary").value = state.monthlySalary;
    $("bonusMonths").value = state.bonusMonths;
    syncSegments();
  }

  function syncSegments() {
    var genderButtons = $("genderGroup").querySelectorAll("button");
    genderButtons.forEach(function (btn) {
      btn.classList.toggle("active", btn.dataset.gender === state.gender);
      btn.setAttribute("aria-pressed", btn.dataset.gender === state.gender ? "true" : "false");
    });
    var modeButtons = $("retireModeGroup").querySelectorAll("button");
    modeButtons.forEach(function (btn) {
      btn.classList.toggle("active", btn.dataset.mode === state.retireMode);
      btn.setAttribute("aria-pressed", btn.dataset.mode === state.retireMode ? "true" : "false");
    });
    $("customAgeField").hidden = state.retireMode !== "custom";
    $("extraLeaveFields").hidden = !state.extraLeaveEnabled;
  }

  /* ---------------- 核心计算 ---------------- */

  function retireDelayMonths(birth, preset) {
    var idx = (birth.getUTCFullYear() - preset.startYear) * 12 + birth.getUTCMonth();
    if (idx < 0) return 0;
    return Math.min(preset.maxDelay, Math.floor(idx / preset.step) + 1);
  }

  function statutoryLeaveForYears(years) {
    if (years < 1) return 0;
    if (years < 10) return 5;
    if (years < 20) return 10;
    return 15;
  }

  function extraLeaveForTenure(tenureYears) {
    if (!state.extraLeaveEnabled) return 0;
    var interval = Math.max(0.5, state.extraInterval);
    var days = Math.floor(tenureYears / interval) * state.extraIncrement;
    return Math.min(state.extraCap, Math.max(0, days));
  }

  function integrateLeave(totalDays) {
    var sliceSize = YEAR_DAYS / 12;
    var cursor = 0;
    var statutory = 0;
    var extra = 0;
    while (cursor < totalDays - 1e-9) {
      var slice = Math.min(sliceSize, totalDays - cursor);
      var midYears = (cursor + slice / 2) / YEAR_DAYS;
      statutory += statutoryLeaveForYears(state.priorYears + midYears) * (slice / YEAR_DAYS);
      extra += extraLeaveForTenure(midYears) * (slice / YEAR_DAYS);
      cursor += slice;
    }
    return { statutory: statutory, extra: extra };
  }

  function salaryMetrics() {
    var start = parseDate(state.workStartDate);
    var now = new Date();
    var today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
    var elapsed = start ? Math.max(0, diffDays(start, today)) : 0;
    var tenure = yearsOf(elapsed);
    var statutory = statutoryLeaveForYears(state.priorYears + tenure);
    var extra = extraLeaveForTenure(tenure);
    var annualWorkDays =
      state.workdaysPerWeek * (YEAR_DAYS / 7) -
      state.statutoryHolidays -
      statutory -
      extra;
    annualWorkDays = Math.max(1, annualWorkDays);
    var monthlyHours = (annualWorkDays / 12) * state.dailyHours;
    var hourly = monthlyHours > 0 ? state.monthlySalary / monthlyHours : 0;
    return {
      tenure: tenure,
      statutory: statutory,
      extra: extra,
      annualWorkDays: annualWorkDays,
      monthlyHours: monthlyHours,
      hourly: hourly
    };
  }

  function compute() {
    var birth = parseDate(state.birthDate);
    var start = parseDate(state.workStartDate);
    var preset = PRESETS[state.gender] || PRESETS.male;

    if (!birth || !start) {
      return { error: "请填写有效的出生日期和参加工作日期。" };
    }

    var baseMonths = preset.base * 12;
    var legalMonths;
    if (state.retireMode === "reform") {
      legalMonths = baseMonths + retireDelayMonths(birth, preset);
    } else {
      legalMonths = state.customAge * 12;
    }

    var flex = state.flexMonths;
    if (state.retireMode === "reform") {
      if (legalMonths + flex < baseMonths) flex = baseMonths - legalMonths;
      if (legalMonths + flex > legalMonths + 36) flex = 36;
    } else {
      var lower = legalMonths - 36;
      if (legalMonths + flex < lower) flex = lower - legalMonths;
      if (legalMonths + flex > legalMonths + 36) flex = 36;
    }
    var actualMonths = legalMonths + flex;
    var retire = addMonths(birth, actualMonths);

    var totalDays = diffDays(start, retire);
    if (totalDays <= 0) {
      return { error: "按当前设置推算的退休日期早于参加工作日期，请检查出生日期、性别或退休规则。", birth: birth, start: start, retire: retire };
    }

    var nowUtc = new Date();
    var nowDay = new Date(Date.UTC(nowUtc.getFullYear(), nowUtc.getMonth(), nowUtc.getDate()));
    var elapsedDays = clamp(diffDays(start, nowDay), 0, totalDays);
    var remainDays = totalDays - elapsedDays;

    var years = yearsOf(totalDays);
    var leaveTotals = integrateLeave(totalDays);
    var sal = salaryMetrics();
    var annualCash = state.monthlySalary * (12 + state.bonusMonths);

    var weekendPerYear = (YEAR_DAYS / 7) * (7 - state.workdaysPerWeek);
    var totalWeekendDays = years * weekendPerYear;
    var weekendOTDays = Math.min(totalWeekendDays, years * 12 * state.weekendOTDays);
    var holidayDays = years * state.statutoryHolidays;
    var statutoryLeaveDays = leaveTotals.statutory;
    var extraLeaveDays = leaveTotals.extra;

    var weekendDays = totalWeekendDays - weekendOTDays;
    var vacationDays = weekendDays + holidayDays + statutoryLeaveDays + extraLeaveDays;
    var workDays = totalDays - vacationDays;
    var regularWorkDays = workDays - weekendOTDays;

    var weekdayOT = regularWorkDays * Math.max(0, state.dailyHours - state.standardHours);
    var weekendOT = weekendOTDays * state.weekendOTHours;
    var totalOT = weekdayOT + weekendOT;

    var workHours = regularWorkDays * state.dailyHours + weekendOT;
    var offDays = totalDays - workDays;
    var sleepHours = workDays * state.sleepHours + offDays * state.restSleepHours;
    var commuteHours = workDays * state.commuteHours;
    var totalHours = totalDays * 24;
    var freeHours = totalHours - sleepHours - workHours - commuteHours;

    var dailyFree = clamp(24 - state.dailyHours - state.sleepHours - state.commuteHours, 0, 24);
    var restDailyFree = clamp(24 - state.restSleepHours, 0, 24);
    var dailyOverflow =
      state.dailyHours + state.sleepHours + state.commuteHours > 24 ||
      state.restSleepHours > 24;

    return {
      birth: birth,
      start: start,
      retire: retire,
      legalMonths: legalMonths,
      actualMonths: actualMonths,
      flexApplied: flex,
      totalDays: totalDays,
      elapsedDays: elapsedDays,
      remainDays: remainDays,
      years: years,
      workDays: workDays,
      regularWorkDays: regularWorkDays,
      weekendDays: weekendDays,
      holidayDays: holidayDays,
      statutoryLeaveDays: statutoryLeaveDays,
      extraLeaveDays: extraLeaveDays,
      vacationDays: vacationDays,
      offDays: offDays,
      weekdayOT: weekdayOT,
      weekendOT: weekendOT,
      totalOT: totalOT,
      workHours: workHours,
      sleepHours: sleepHours,
      commuteHours: commuteHours,
      totalHours: totalHours,
      freeHours: freeHours,
      dailyFree: dailyFree,
      restDailyFree: restDailyFree,
      dailyOverflow: dailyOverflow,
      progress: clamp((elapsedDays / totalDays) * 100, 0, 100),
      hourlyWage: sal.hourly,
      monthlyHours: sal.monthlyHours,
      annualCash: annualCash,
      totalIncome: annualCash * years,
      remainingIncome: annualCash * yearsOf(remainDays)
    };
  }

  /* ---------------- 渲染 ---------------- */

  function render() {
    readInputs();
    syncSegments();
    updateOutputs();
    renderResults();
    saveState();
  }

  function updateOutputs() {
    $("customAgeOut").textContent = state.customAge + " 岁";
    $("flexOut").textContent =
      state.flexMonths === 0
        ? "不调整"
        : state.flexMonths > 0
          ? "延迟 " + state.flexMonths + " 个月"
          : "提前 " + Math.abs(state.flexMonths) + " 个月";
    $("dailyHoursOut").textContent = fmt1(state.dailyHours) + " 小时";
    $("sleepHoursOut").textContent = fmt1(state.sleepHours) + " 小时";
    $("restSleepHoursOut").textContent = fmt1(state.restSleepHours) + " 小时";
    $("commuteHoursOut").textContent = fmt1(state.commuteHours) + " 小时";
    $("workdaysOut").textContent = state.workdaysPerWeek + " 天";
    $("standardHoursOut").textContent = "每天 " + fmt1(state.standardHours) + " 小时";
    $("otRateOut").textContent = fmt1(state.otRate) + " 倍";

    var sal = salaryMetrics();
    $("hourlyWage").textContent = sal.hourly > 0 ? "¥ " + fmtMoney(sal.hourly, 2) : "—";
    $("monthlyHours").textContent = fmt1(sal.monthlyHours) + " 小时";

    $("flexNote").textContent =
      state.retireMode === "reform"
        ? "新规允许最多提前 3 年或延迟 3 年，提前后不低于原法定年龄。"
        : "在自定义退休年龄基础上，前后最多调整 3 年。";
  }

  function renderResults() {
    var r = compute();
    var notice = $("notice");

    if (r.error) {
      notice.hidden = false;
      notice.textContent = r.error;
      resetResults();
      return;
    }

    notice.hidden = true;
    if (r.dailyOverflow) {
      notice.hidden = false;
      notice.textContent = "每日工作、睡眠与通勤之和已超过 24 小时，每天的可支配时间已经为零，请调整参数。";
    }

    var tenureNow = yearsOf(r.elapsedDays);
    $("statutoryNow").textContent = statutoryLeaveForYears(state.priorYears + tenureNow) + " 天";
    $("extraNow").textContent = state.extraLeaveEnabled ? fmt1(extraLeaveForTenure(tenureNow)) + " 天" : "未启用";

    var preset = PRESETS[state.gender] || PRESETS.male;
    var legalYears = Math.floor(r.legalMonths / 12);
    var legalRest = r.legalMonths % 12;
    var actualYears = Math.floor(r.actualMonths / 12);
    var actualRest = r.actualMonths % 12;

    $("legalAge").textContent = legalYears + " 岁" + (legalRest ? " " + legalRest + " 个月" : "");
    $("actualAge").textContent = actualYears + " 岁" + (actualRest ? " " + actualRest + " 个月" : "");

    $("retireDate").textContent = fmtDate(r.retire);
    $("retireAge").textContent = "退休年龄 " + actualYears + " 岁" + (actualRest ? " " + actualRest + " 个月" : "");
    $("careerSpan").textContent = "职业生涯 " + fmt1(r.years) + " 年";
    $("ruleBadge").textContent =
      state.retireMode === "reform"
        ? "中国渐进式延迟退休"
        : "自定义退休年龄 · " + preset.label;

    $("startLabel").textContent = fmtShort(r.start);
    $("retireLabel").textContent = fmtShort(r.retire);
    $("elapsedLabel").textContent = fmt1(yearsOf(r.elapsedDays)) + " 年";

    var progress = Math.round(r.progress);
    $("progressPct").textContent = progress + "%";
    $("progressFill").style.width = r.progress + "%";
    $("progressBar").setAttribute("aria-valuenow", String(progress));

    var paidHours = r.workHours;
    var sleepTotal = r.sleepHours;
    var freeTotal = Math.max(0, r.freeHours);

    $("statWork").textContent = fmtHours(paidHours);
    $("statWorkSub").textContent =
      "约 " + fmt1(yearsOf(paidHours / 24)) + " 年 · 含加班 " + fmtHours(r.totalOT);

    $("statSleep").textContent = fmtHours(sleepTotal);
    $("statSleepSub").textContent =
      "约 " + fmt1(yearsOf(sleepTotal / 24)) + " 年 · 占 " + fmt1(pctOf(sleepTotal, r.totalHours)) + "%";

    $("statVacation").textContent = fmtDays(r.vacationDays);
    $("statVacationSub").textContent =
      "约 " + fmt1(yearsOf(r.vacationDays)) + " 年 · 占 " + fmt1(pctOf(r.vacationDays, r.totalDays)) + "%";

    $("statFree").textContent = fmtHours(freeTotal);
    $("statFreeSub").textContent =
      "约 " + fmt1(yearsOf(freeTotal / 24)) + " 年 · 摊到每天 " + fmt1(freeTotal / r.totalDays) + " 小时";

    renderDonut(r, freeTotal);
    renderDaily(r);
    renderDetails(r);
    renderIncome(r);

    lastRetireTime = new Date(
      r.retire.getUTCFullYear(),
      r.retire.getUTCMonth(),
      r.retire.getUTCDate(),
      0,
      0,
      0
    ).getTime();
    updateCountdown();
  }

  function renderDonut(r, freeTotal) {
    var work = r.workHours;
    var sleep = r.sleepHours;
    var commute = r.commuteHours;
    var total = work + sleep + commute + freeTotal || 1;
    var pWork = pctOf(work, total);
    var pSleep = pctOf(sleep, total);
    var pCommute = pctOf(commute, total);
    var a = pWork;
    var b = a + pSleep;
    var c = b + pCommute;

    $("donut").style.background =
      "conic-gradient(" +
      "var(--sky) 0 " + a.toFixed(2) + "%," +
      "var(--indigo) " + a.toFixed(2) + "% " + b.toFixed(2) + "%," +
      "var(--amber) " + b.toFixed(2) + "% " + c.toFixed(2) + "%," +
      "var(--mint) " + c.toFixed(2) + "% 100%)";

    $("donutCenter").textContent = fmt1(r.years) + " 年";
    $("legendWork").textContent = fmt1(pWork) + "%";
    $("legendSleep").textContent = fmt1(pSleep) + "%";
    $("legendCommute").textContent = fmt1(pCommute) + "%";
    $("legendFree").textContent = fmt1(100 - a - (b - a) - (c - b)) + "%";
  }

  function renderDaily(r) {
    var total = 24;
    var work = clamp(state.dailyHours, 0, 24);
    var commute = clamp(state.commuteHours, 0, 24);
    var sleep = clamp(state.sleepHours, 0, 24);
    var free = clamp(total - work - commute - sleep, 0, 24);

    $("segWork").style.width = (work / total) * 100 + "%";
    $("segCommute").style.width = (commute / total) * 100 + "%";
    $("segSleep").style.width = (sleep / total) * 100 + "%";
    $("segFree").style.width = (free / total) * 100 + "%";

    $("dayWork").textContent = fmt1(work) + " h";
    $("dayCommute").textContent = fmt1(commute) + " h";
    $("daySleep").textContent = fmt1(sleep) + " h";
    $("dayFree").textContent = fmt1(free) + " h";
    $("workdayFreeLabel").textContent = "可自由支配 " + fmt1(free) + " 小时";

    var restSleep = clamp(state.restSleepHours, 0, 24);
    var restFree = clamp(total - restSleep, 0, 24);
    $("segRestSleep").style.width = (restSleep / total) * 100 + "%";
    $("segRestFree").style.width = (restFree / total) * 100 + "%";
    $("restSleep").textContent = fmt1(restSleep) + " h";
    $("restFree").textContent = fmt1(restFree) + " h";
    $("restdayFreeLabel").textContent = "可自由支配 " + fmt1(restFree) + " 小时";

    var offYears = r && r.totalDays ? r.offDays / r.totalDays : 0;
    $("dailyHint").textContent =
      "休息日约占 " + fmt1(offYears * 100) + "%，睡眠按每日 " + fmt1(restSleep) + " 小时计";
  }

  function renderDetails(r) {
    $("dTotal").textContent = fmtDays(r.totalDays) + "（" + fmt1(r.years) + " 年）";
    $("dElapsed").textContent = fmtDays(r.elapsedDays) + "（" + fmt1(pctOf(r.elapsedDays, r.totalDays)) + "%）";
    $("dRemain").textContent = fmtDays(r.remainDays);
    $("dElapsedWork").textContent = fmtHours(r.workHours * (r.elapsedDays / r.totalDays));
    $("dRemainWork").textContent = fmtHours(r.workHours * (r.remainDays / r.totalDays));
    $("dWorkdays").textContent = fmtDays(r.workDays);
    $("dVacation").textContent = fmtDays(r.vacationDays);
    $("dWeekend").textContent = fmtDays(r.weekendDays);
    $("dHoliday").textContent = fmtDays(r.holidayDays);
    $("dStatutoryLeave").textContent = fmtDays(r.statutoryLeaveDays);
    $("dExtraLeave").textContent = fmtDays(r.extraLeaveDays);
    $("dWeekdayOT").textContent = fmtHours(r.weekdayOT);
    $("dWeekendOT").textContent = fmtHours(r.weekendOT);
    $("dOTOfficial").textContent = fmtHours(r.totalOT * state.otRate);
    $("dCommute").textContent = fmtHours(r.commuteHours);
  }

  function renderIncome(r) {
    var hasSalary = state.monthlySalary > 0;
    $("incomeHourly").textContent = hasSalary ? "¥ " + fmtMoney(r.hourlyWage, 2) : "—";
    $("incomeHourlyNote").textContent =
      "月薪 ¥ " + fmtMoney(state.monthlySalary, 0) + " · 每月 " + fmt1(r.monthlyHours) + " 小时";

    $("incomeTotal").textContent = hasSalary ? fmtMoneyCompact(r.totalIncome) : "—";
    $("incomeTotalNote").textContent =
      "年薪 ¥ " + fmtMoney(r.annualCash, 0) + " × " + fmt1(r.years) + " 年";

    $("incomeRemain").textContent = hasSalary ? fmtMoneyCompact(r.remainingIncome) : "—";
    $("incomeRemainNote").textContent =
      "剩余 " + fmt1(yearsOf(r.remainDays)) + " 年 · " + fmt1(r.progress) + "% 已经走过";
  }

  function resetResults() {
    var ids = [
      "retireDate", "retireAge", "careerSpan", "legalAge", "actualAge",
      "statWork", "statWorkSub", "statSleep", "statSleepSub",
      "statVacation", "statVacationSub", "statFree", "statFreeSub",
      "donutCenter", "legendWork", "legendSleep", "legendCommute", "legendFree",
      "dayWork", "dayCommute", "daySleep", "dayFree",
      "workdayFreeLabel", "restdayFreeLabel", "restSleep", "restFree",
      "statutoryNow", "extraNow",
      "incomeHourly", "incomeHourlyNote", "incomeTotal", "incomeTotalNote",
      "incomeRemain", "incomeRemainNote",
      "dTotal", "dElapsed", "dRemain", "dElapsedWork", "dRemainWork", "dWorkdays", "dVacation",
      "dWeekend", "dHoliday", "dStatutoryLeave", "dExtraLeave", "dWeekdayOT", "dWeekendOT", "dOTOfficial", "dCommute"
    ];
    ids.forEach(function (id) {
      var el = $(id);
      if (el) el.textContent = "—";
    });
    $("progressFill").style.width = "0%";
    $("progressPct").textContent = "0%";
    $("donut").style.background = "conic-gradient(var(--line) 0 100%)";
    ["segWork", "segCommute", "segSleep", "segFree", "segRestSleep", "segRestFree"].forEach(function (id) {
      $(id).style.width = "0%";
    });
    $("dailyHint").textContent = "—";
    $("cdDays").textContent = "—";
    $("cdHours").textContent = "—";
    $("cdMinutes").textContent = "—";
    $("cdSeconds").textContent = "—";
    lastRetireTime = null;
  }

  function updateCountdown() {
    if (!lastRetireTime) return;
    var diff = lastRetireTime - Date.now();
    if (diff < 0) diff = 0;
    var days = Math.floor(diff / DAY_MS);
    var hours = Math.floor((diff % DAY_MS) / 3600000);
    var minutes = Math.floor((diff % 3600000) / 60000);
    var seconds = Math.floor((diff % 60000) / 1000);
    $("cdDays").textContent = fmtInt(days);
    $("cdHours").textContent = pad2(hours);
    $("cdMinutes").textContent = pad2(minutes);
    $("cdSeconds").textContent = pad2(seconds);
  }

  function updateClocks() {
    var now = new Date();
    $("liveTime").textContent =
      pad2(now.getHours()) + ":" + pad2(now.getMinutes()) + ":" + pad2(now.getSeconds()) +
      "." + String(now.getMilliseconds()).padStart(3, "0");

    if (now.getSeconds() !== lastSecond) {
      lastSecond = now.getSeconds();
      var week = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"][now.getDay()];
      var dateKey =
        now.getFullYear() + "-" + now.getMonth() + "-" + now.getDate();
      if (dateKey !== lunarCacheKey) {
        lunarCacheKey = dateKey;
        lunarCacheText = lunarDateText(now);
      }
      $("liveDate").textContent =
        now.getFullYear() + " 年 " + (now.getMonth() + 1) + " 月 " + now.getDate() + " 日";
      $("liveWeek").textContent = week;
      $("liveLunar").textContent = lunarCacheText;
      $("footerClock").textContent =
        pad2(now.getHours()) + ":" + pad2(now.getMinutes()) + ":" + pad2(now.getSeconds());
      updateCountdown();
    }
  }

  function startClock() {
    if (typeof window.requestAnimationFrame === "function") {
      var frame = function () {
        updateClocks();
        window.requestAnimationFrame(frame);
      };
      window.requestAnimationFrame(frame);
    } else {
      setInterval(updateClocks, 40);
    }
  }

  /* ---------------- 事件绑定 ---------------- */

  function bindEvents() {
    var settings = document.querySelector(".settings");

    settings.addEventListener("input", function (event) {
      if (event.target.matches("input")) {
        render();
      }
    });

    settings.addEventListener("change", function (event) {
      var el = event.target;
      if (!el.matches("input")) return;
      if (el.matches("input[type='number']")) {
        var min = num(el.min, -Infinity);
        var max = num(el.max, Infinity);
        var value = clamp(num(el.value, num(el.defaultValue, 0)), min, max);
        el.value = value;
      }
      render();
    });

    $("genderGroup").addEventListener("click", function (event) {
      var btn = event.target.closest("button[data-gender]");
      if (!btn) return;
      state.gender = btn.dataset.gender;
      render();
    });

    $("retireModeGroup").addEventListener("click", function (event) {
      var btn = event.target.closest("button[data-mode]");
      if (!btn) return;
      state.retireMode = btn.dataset.mode;
      render();
    });

    $("resetBtn").addEventListener("click", function () {
      state = Object.assign({}, DEFAULTS);
      writeInputs();
      render();
    });
  }

  /* ---------------- 启动 ---------------- */

  function init() {
    writeInputs();
    bindEvents();
    render();
    startClock();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
