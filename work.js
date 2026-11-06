(function () {
  "use strict";

  var STATE_KEY = "lifeclock:v1";
  var SCHEDULE_KEY = "lifeclock:encourager:v1";
  var YEAR_DAYS = 365.2425;
  var DAY_MS = 86400000;

  var STATE_DEFAULTS = {
    workStartDate: "2018-07-01",
    monthlySalary: 15000,
    dailyHours: 8,
    workdaysPerWeek: 5,
    statutoryHolidays: 13,
    priorYears: 0,
    extraLeaveEnabled: true,
    extraInterval: 1,
    extraIncrement: 1,
    extraCap: 10
  };

  var state = loadState();
  var schedule = loadSchedule();
  var lastSecond = -1;

  /* ---------------- helpers ---------------- */

  function $(id) {
    return document.getElementById(id);
  }

  function num(value, fallback) {
    var parsed = parseFloat(value);
    return isFinite(parsed) ? parsed : fallback;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  function fmt1(value) {
    return value.toLocaleString("zh-CN", { maximumFractionDigits: 1, minimumFractionDigits: 0 });
  }

  function fmt2(value) {
    return value.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function fmt4(value) {
    return value.toLocaleString("zh-CN", { minimumFractionDigits: 4, maximumFractionDigits: 4 });
  }

  function parseDate(value) {
    if (!value) return null;
    var parts = String(value).split("-");
    if (parts.length !== 3) return null;
    var y = parseInt(parts[0], 10);
    var m = parseInt(parts[1], 10);
    var d = parseInt(parts[2], 10);
    if (!isFinite(y) || !isFinite(m) || !isFinite(d)) return null;
    var date = new Date(Date.UTC(y, m - 1, d));
    if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
    return date;
  }

  function diffDays(from, to) {
    return Math.round((to.getTime() - from.getTime()) / DAY_MS);
  }

  function weekdayName(date) {
    return ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][date.getDay()];
  }

  function fmtDateLong(date) {
    return date.getFullYear() + " 年 " + (date.getMonth() + 1) + " 月 " + date.getDate() + " 日 " + weekdayName(date);
  }

  function fmtDateShort(date) {
    return date.getFullYear() + "." + pad2(date.getMonth() + 1) + "." + pad2(date.getDate());
  }

  function fmtMonthDay(date) {
    return pad2(date.getMonth() + 1) + "." + pad2(date.getDate());
  }

  function minutesToTime(minutes) {
    var m = ((minutes % 1440) + 1440) % 1440;
    return pad2(Math.floor(m / 60)) + ":" + pad2(m % 60);
  }

  function durationText(ms) {
    var total = Math.max(0, Math.floor(ms / 1000));
    var h = Math.floor(total / 3600);
    var m = Math.floor((total % 3600) / 60);
    var s = total % 60;
    if (h > 0) return h + " 小时 " + pad2(m) + " 分 " + pad2(s) + " 秒";
    return pad2(m) + " 分 " + pad2(s) + " 秒";
  }

  /* ---------------- persistence ---------------- */

  function loadState() {
    var saved = {};
    try {
      saved = JSON.parse(localStorage.getItem(STATE_KEY)) || {};
    } catch (err) {
      saved = {};
    }
    return Object.assign({}, STATE_DEFAULTS, saved);
  }

  function defaultWorkdays(perWeek) {
    var count = clamp(parseInt(perWeek, 10) || 5, 1, 7);
    return [1, 2, 3, 4, 5, 6, 0].slice(0, count);
  }

  function loadSchedule() {
    var saved = {};
    try {
      saved = JSON.parse(localStorage.getItem(SCHEDULE_KEY)) || {};
    } catch (err) {
      saved = {};
    }

    var startTime = /^\d{1,2}:\d{2}$/.test(String(saved.startTime || ""))
      ? saved.startTime
      : "09:00";

    var workdays;
    if (Array.isArray(saved.workdays)) {
      workdays = saved.workdays
        .map(function (day) { return Number(day); })
        .filter(function (day, index, arr) {
          return isFinite(day) && day >= 0 && day <= 6 && arr.indexOf(day) === index;
        });
    } else {
      workdays = defaultWorkdays(state.workdaysPerWeek);
    }

    return { startTime: startTime, workdays: workdays };
  }

  function saveSchedule() {
    try {
      localStorage.setItem(SCHEDULE_KEY, JSON.stringify(schedule));
    } catch (err) {
      /* 本地存储不可用时静默忽略 */
    }
  }

  /* ---------------- salary ---------------- */

  function statutoryLeave(years) {
    if (years < 1) return 0;
    if (years < 10) return 5;
    if (years < 20) return 10;
    return 15;
  }

  function extraLeave(tenure) {
    if (state.extraLeaveEnabled === false) return 0;
    var interval = Math.max(0.5, num(state.extraInterval, 1));
    var increment = Math.max(0, num(state.extraIncrement, 1));
    var cap = Math.max(0, num(state.extraCap, 10));
    return Math.min(cap, Math.floor(tenure / interval) * increment);
  }

  function salaryMetrics() {
    var salary = Math.max(0, num(state.monthlySalary, 0));
    var dailyHours = Math.max(1, num(state.dailyHours, 8));
    var workdaysPerWeek = clamp(num(state.workdaysPerWeek, 5), 1, 7);
    var start = parseDate(state.workStartDate);
    var now = new Date();
    var today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
    var elapsed = start ? Math.max(0, diffDays(start, today)) : 0;
    var tenure = elapsed / YEAR_DAYS;
    var stat = statutoryLeave(num(state.priorYears, 0) + tenure);
    var extra = extraLeave(tenure);
    var annualWorkDays =
      workdaysPerWeek * (YEAR_DAYS / 7) -
      Math.max(0, num(state.statutoryHolidays, 13)) -
      stat -
      extra;
    annualWorkDays = Math.max(1, annualWorkDays);
    var monthlyHours = (annualWorkDays / 12) * dailyHours;
    var hourly = salary > 0 ? salary / monthlyHours : 0;

    return {
      salary: salary,
      dailyHours: dailyHours,
      monthlyHours: monthlyHours,
      hourly: hourly
    };
  }

  function startMinutes() {
    var match = /^(\d{1,2}):(\d{2})$/.exec(schedule.startTime);
    if (!match) return 540;
    return clamp(parseInt(match[1], 10), 0, 23) * 60 + clamp(parseInt(match[2], 10), 0, 59);
  }

  /* ---------------- time math ---------------- */

  function compute(now) {
    var metrics = salaryMetrics();
    var hourly = metrics.hourly;
    var configuredDaily = clamp(num(state.dailyHours, 8), 0, 24);
    var startMin = startMinutes();
    var paidHours = Math.min(configuredDaily, Math.max(0, (1440 - startMin) / 60));
    var paidMs = paidHours * 3600000;

    var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var startMs = today.getTime() + startMin * 60000;
    var endMs = startMs + paidMs;

    var isWorkday = schedule.workdays.indexOf(now.getDay()) !== -1;
    var status;
    var workedMs = 0;

    if (!isWorkday) {
      status = "rest";
    } else if (now.getTime() < startMs) {
      status = "before";
    } else if (now.getTime() >= endMs) {
      status = "after";
      workedMs = paidMs;
    } else {
      status = "working";
      workedMs = now.getTime() - startMs;
    }

    workedMs = clamp(workedMs, 0, paidMs);
    var todayEarned = hourly > 0 ? (workedMs / 3600000) * hourly : 0;
    var perSecond = hourly / 3600;

    var weekdayIndex = (now.getDay() + 6) % 7;
    var monday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - weekdayIndex);

    var weekTargetMs = 0;
    var weekWorkedMs = 0;
    var weekWorkdays = 0;
    var i;
    for (i = 0; i < 7; i++) {
      var day = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i);
      if (schedule.workdays.indexOf(day.getDay()) === -1) continue;
      weekWorkdays += 1;
      weekTargetMs += paidMs;
      if (day.getTime() === today.getTime()) {
        weekWorkedMs += workedMs;
      } else if (day.getTime() < today.getTime()) {
        weekWorkedMs += paidMs;
      }
    }

    var monthDays = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
    var monthTargetMs = 0;
    var monthWorkedMs = 0;
    var monthWorkdays = 0;
    for (i = 1; i <= monthDays; i++) {
      var monthDay = new Date(today.getFullYear(), today.getMonth(), i);
      if (schedule.workdays.indexOf(monthDay.getDay()) === -1) continue;
      monthWorkdays += 1;
      monthTargetMs += paidMs;
      if (monthDay.getTime() === today.getTime()) {
        monthWorkedMs += workedMs;
      } else if (monthDay.getTime() < today.getTime()) {
        monthWorkedMs += paidMs;
      }
    }

    return {
      now: now,
      today: today,
      monday: monday,
      hourly: hourly,
      perSecond: perSecond,
      paidHours: paidHours,
      startMin: startMin,
      startMs: startMs,
      endMs: endMs,
      status: status,
      workedMs: workedMs,
      todayEarned: todayEarned,
      week: {
        targetMs: weekTargetMs,
        workedMs: weekWorkedMs,
        workdays: weekWorkdays,
        earned: hourly > 0 ? (weekWorkedMs / 3600000) * hourly : 0
      },
      month: {
        targetMs: monthTargetMs,
        workedMs: monthWorkedMs,
        workdays: monthWorkdays,
        earned: hourly > 0 ? (monthWorkedMs / 3600000) * hourly : 0
      }
    };
  }

  function percent(workedMs, targetMs) {
    if (!(targetMs > 0)) return 0;
    return clamp((workedMs / targetMs) * 100, 0, 100);
  }

  /* ---------------- rendering ---------------- */

  function setBar(barId, trackId, pct) {
    $(barId).style.width = pct.toFixed(1) + "%";
    $(trackId).setAttribute("aria-valuenow", String(Math.round(pct)));
  }

  function renderLive(now) {
    var data = compute(now);

    $("todayAmount").textContent = fmt4(data.todayEarned);
    $("speedValue").textContent = "¥ " + fmt4(data.perSecond);
    $("weekAmount").textContent = fmt4(data.week.earned);
    $("monthAmount").textContent = fmt4(data.month.earned);

    if (data.hourly <= 0) {
      $("workWarning").hidden = false;
    } else {
      $("workWarning").hidden = true;
    }

    if (now.getSeconds() !== lastSecond) {
      lastSecond = now.getSeconds();
      renderSlow(data, now);
    }
  }

  function renderSlow(data, now) {
    var statusText = {
      working: "上班中",
      before: "还未上班",
      after: "已下班",
      rest: "休息日"
    }[data.status];

    var pill = $("workStatus");
    pill.className = "status-pill is-" + data.status;
    $("statusText").textContent = statusText;

    $("todayDate").textContent = fmtDateLong(now);
    $("boardDate").textContent = fmtDateShort(now) + " " + weekdayName(now);
    $("liveClock").textContent =
      pad2(now.getHours()) + ":" + pad2(now.getMinutes()) + ":" + pad2(now.getSeconds());

    var scheduleEnd = minutesToTime(data.startMin + Math.round(data.paidHours * 60));
    if (data.status === "rest") {
      $("scheduleLine").textContent = schedule.workdays.length
        ? "今天休息 · 工作日 " + schedule.workdays.map(dayName).join("")
        : "还没有设置工作日";
    } else if (data.paidHours > 0) {
      $("scheduleLine").textContent =
        minutesToTime(data.startMin) + " – " + scheduleEnd + " · 每日 " + fmt1(data.paidHours) + " 小时";
    } else {
      $("scheduleLine").textContent = "还没有设置每日工作时长";
    }

    var todayPct = percent(data.workedMs, data.paidHours * 3600000);
    var weekPct = percent(data.week.workedMs, data.week.targetMs);
    var monthPct = percent(data.month.workedMs, data.month.targetMs);

    setBar("todayBar", "todayBarTrack", todayPct);
    setBar("weekBar", "weekBarTrack", weekPct);
    setBar("monthBar", "monthBarTrack", monthPct);

    $("todayPct").textContent = fmt1(todayPct) + "%";
    $("weekPct").textContent = fmt1(weekPct) + "%";
    $("monthPct").textContent = fmt1(monthPct) + "%";

    var workHours = data.workedMs / 3600000;
    $("todayHours").textContent =
      "已工作 " + workHours.toFixed(2) + " / " + data.paidHours.toFixed(2) + " 小时";
    $("todayHint").textContent = todayHint(data, now);

    $("weekRange").textContent =
      fmtMonthDay(data.monday) + " – " +
      fmtMonthDay(new Date(data.monday.getFullYear(), data.monday.getMonth(), data.monday.getDate() + 6));
    $("monthRange").textContent = now.getFullYear() + " 年 " + (now.getMonth() + 1) + " 月";

    $("weekHours").textContent =
      (data.week.workedMs / 3600000).toFixed(1) + " / " +
      (data.week.targetMs / 3600000).toFixed(1) + " 小时";
    $("monthHours").textContent =
      (data.month.workedMs / 3600000).toFixed(1) + " / " +
      (data.month.targetMs / 3600000).toFixed(1) + " 小时";

    $("weekHint").textContent = periodHint(data.week);
    $("monthHint").textContent = periodHint(data.month);

    var metric = salaryMetrics();
    $("miniRate").textContent = metric.hourly > 0 ? "¥ " + fmt2(metric.hourly) : "—";
    $("miniDaily").textContent = "每日 " + fmt1(metric.dailyHours) + " 小时";
  }

  function todayHint(data, now) {
    if (data.hourly <= 0) return "填写月薪后显示收入";
    if (data.status === "working") return "距离下班还有 " + durationText(data.endMs - now.getTime());
    if (data.status === "before") return "距上班还有 " + durationText(data.startMs - now.getTime());
    if (data.status === "after") return "今天的工作已完成";
    return "今天休息，不计收入";
  }

  function periodHint(period) {
    if (!(period.targetMs > 0)) return "未设置工作日";
    var remaining = Math.max(0, period.targetMs - period.workedMs);
    if (remaining <= 0) return "目标已完成";
    return "还剩 " + (remaining / 3600000).toFixed(1) + " 小时";
  }

  function dayName(day) {
    return { 1: "一", 2: "二", 3: "三", 4: "四", 5: "五", 6: "六", 0: "日" }[day] || "";
  }

  /* ---------------- interactions ---------------- */

  function syncScheduleUI() {
    $("startTime").value = schedule.startTime;
    Array.prototype.forEach.call($("weekdayToggles").querySelectorAll("button[data-day]"), function (btn) {
      var day = Number(btn.dataset.day);
      var active = schedule.workdays.indexOf(day) !== -1;
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-pressed", active ? "true" : "false");
    });
  }

  function bindEvents() {
    $("startTime").addEventListener("change", function () {
      if (!this.value) return;
      schedule.startTime = this.value;
      saveSchedule();
      lastSecond = -1;
      renderLive(new Date());
    });

    $("weekdayToggles").addEventListener("click", function (event) {
      var btn = event.target.closest("button[data-day]");
      if (!btn) return;
      var day = Number(btn.dataset.day);
      var index = schedule.workdays.indexOf(day);
      if (index === -1) {
        schedule.workdays.push(day);
      } else {
        schedule.workdays.splice(index, 1);
      }
      saveSchedule();
      syncScheduleUI();
      lastSecond = -1;
      renderLive(new Date());
    });

    window.addEventListener("storage", function (event) {
      if (event.key === STATE_KEY) {
        state = loadState();
        lastSecond = -1;
        renderLive(new Date());
      }
    });

    window.addEventListener("pageshow", function () {
      state = loadState();
      lastSecond = -1;
      renderLive(new Date());
    });
  }

  /* ---------------- clock ---------------- */

  function startLoop() {
    if (typeof window.requestAnimationFrame === "function") {
      (function frame() {
        renderLive(new Date());
        window.requestAnimationFrame(frame);
      })();
    } else {
      setInterval(function () { renderLive(new Date()); }, 50);
    }
  }

  function init() {
    syncScheduleUI();
    bindEvents();
    renderLive(new Date());
    startLoop();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
