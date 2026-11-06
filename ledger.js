(function () {
  "use strict";

  var STATE_KEY = "lifeclock:v1";
  var LEDGER_KEY = "lifeclock:ledger:v1";
  var YEAR_DAYS = 365.2425;
  var DAY_MS = 86400000;

  var CATS = {
    "数码": "#38bdf8",
    "家居": "#34d399",
    "出行": "#f0a03a",
    "体验": "#8b8cf0",
    "其他": "#8ba0b8"
  };
  var CAT_NAMES = Object.keys(CATS);

  var STATE_DEFAULTS = {
    workStartDate: "2018-07-01",
    monthlySalary: 15000,
    bonusMonths: 0,
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
  var items = loadItems();
  var activeCategory = "全部";
  var sortMode = "newest";
  var formCategory = "数码";
  var period = "month";
  var periodOffset = 0;

  var PERIOD_NAMES = { week: "周度", month: "月度", year: "年度", all: "全部" };

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

  function fmt1(value) {
    return value.toLocaleString("zh-CN", { maximumFractionDigits: 1, minimumFractionDigits: 0 });
  }

  function fmt2(value) {
    return value.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function fmtMoney(value) {
    if (value >= 100000000) return "¥ " + (value / 100000000).toFixed(2) + " 亿";
    if (value >= 1000000) return "¥ " + (value / 10000).toFixed(1) + " 万";
    return "¥ " + value.toLocaleString("zh-CN", {
      minimumFractionDigits: value % 1 ? 2 : 0,
      maximumFractionDigits: 2
    });
  }

  function fmtAmount(value) {
    return "¥ " + value.toLocaleString("zh-CN", {
      minimumFractionDigits: value % 1 ? 2 : 0,
      maximumFractionDigits: 2
    });
  }

  function startOfLocalDay(ts) {
    var d = new Date(ts);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  }

  function fmtShortDate(ts) {
    var d = new Date(ts);
    return d.getFullYear() + "." + pad2(d.getMonth() + 1) + "." + pad2(d.getDate());
  }

  function fmtDateTime(ts) {
    var d = new Date(ts);
    var week = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][d.getDay()];
    return fmtShortDate(ts) + " " + week + " " + pad2(d.getHours()) + ":" + pad2(d.getMinutes());
  }

  function localDateTimeValue(date) {
    var d = date || new Date();
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()) +
      "T" + pad2(d.getHours()) + ":" + pad2(d.getMinutes());
  }

  function parseLocalDateTime(value) {
    if (!value) return Date.now();
    var match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(value));
    if (!match) return Date.now();
    var d = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]), 0, 0);
    return isFinite(d.getTime()) ? d.getTime() : Date.now();
  }

  /* ---------------- data ---------------- */

  function loadState() {
    var saved = {};
    try {
      saved = JSON.parse(localStorage.getItem(STATE_KEY)) || {};
    } catch (err) {
      saved = {};
    }
    return Object.assign({}, STATE_DEFAULTS, saved);
  }

  function loadItems() {
    try {
      var raw = localStorage.getItem(LEDGER_KEY);
      if (!raw) return [];
      var parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .map(function (item, index) {
          var amount = Number(item && item.amount);
          if (!isFinite(amount) || amount <= 0) return null;
          var createdAt = Number(item.createdAt);
          if (!isFinite(createdAt) || createdAt <= 0) {
            var match = /^(\d{10,})/.exec(String(item.id || ""));
            createdAt = match ? Number(match[1]) : Date.now() - index;
          }
          var occurredAt = Number(item.occurredAt);
          if (!isFinite(occurredAt) || occurredAt <= 0) occurredAt = createdAt;
          return {
            id: String(item.id || "m-" + createdAt + "-" + index),
            name: String(item.name || "未命名").slice(0, 40),
            amount: amount,
            category: CATS[item.category] ? item.category : "其他",
            createdAt: createdAt,
            occurredAt: occurredAt
          };
        })
        .filter(Boolean);
    } catch (err) {
      return [];
    }
  }

  function saveItems() {
    try {
      localStorage.setItem(LEDGER_KEY, JSON.stringify(items));
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

  /* ---------------- periods ---------------- */

  function periodRange(kind, offset) {
    var now = new Date();
    if (kind === "week") {
      var day = (now.getDay() + 6) % 7;
      var weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day + offset * 7);
      var weekEnd = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + 7);
      return { start: weekStart.getTime(), end: weekEnd.getTime() };
    }
    if (kind === "month") {
      var monthStart = new Date(now.getFullYear(), now.getMonth() + offset, 1);
      var monthEnd = new Date(now.getFullYear(), now.getMonth() + offset + 1, 1);
      return { start: monthStart.getTime(), end: monthEnd.getTime() };
    }
    if (kind === "year") {
      var yearStart = new Date(now.getFullYear() + offset, 0, 1);
      var yearEnd = new Date(now.getFullYear() + offset + 1, 0, 1);
      return { start: yearStart.getTime(), end: yearEnd.getTime() };
    }
    return { start: null, end: null };
  }

  function itemsInPeriod() {
    var range = periodRange(period, periodOffset);
    if (range.start === null) return items.slice();
    return items.filter(function (item) {
      return item.occurredAt >= range.start && item.occurredAt < range.end;
    });
  }

  function periodRangeText() {
    var range = periodRange(period, periodOffset);
    if (period === "all") return items.length ? "全部 " + items.length + " 件记录" : "全部记录";
    var start = new Date(range.start);
    if (period === "year") return start.getFullYear() + " 年";
    if (period === "month") return start.getFullYear() + " 年 " + (start.getMonth() + 1) + " 月";
    return fmtShortDate(range.start) + " – " + fmtShortDate(range.end - 1);
  }

  function periodDayCount() {
    if (period === "week") return 7;
    if (period === "month") {
      var m = periodRange("month", periodOffset);
      return Math.round((m.end - m.start) / DAY_MS);
    }
    if (period === "year") {
      var y = periodRange("year", periodOffset);
      return Math.round((y.end - y.start) / DAY_MS);
    }
    if (!items.length) return 0;
    var earliest = Math.min.apply(null, items.map(function (item) { return startOfLocalDay(item.occurredAt); }));
    return Math.max(1, Math.round((startOfLocalDay(Date.now()) - earliest) / DAY_MS) + 1);
  }

  function trendTitle() {
    var range = periodRange(period, periodOffset);
    if (period === "week") return fmtShortDate(range.start) + " – " + fmtShortDate(range.end - 1) + " 每日支出";
    if (period === "month") {
      var d = new Date(range.start);
      return d.getFullYear() + " 年 " + (d.getMonth() + 1) + " 月每日支出";
    }
    if (period === "year") return new Date(range.start).getFullYear() + " 年每月支出";
    return "全部年份支出";
  }

  function buildTrend(list) {
    var buckets = [];
    var i;

    if (period === "week") {
      var weekRange = periodRange("week", periodOffset);
      for (i = 0; i < 7; i++) {
        var dayDate = new Date(weekRange.start);
        dayDate.setDate(dayDate.getDate() + i);
        buckets.push({
          label: ["一", "二", "三", "四", "五", "六", "日"][i],
          fullLabel: fmtShortDate(dayDate.getTime()) + " 周" + ["一", "二", "三", "四", "五", "六", "日"][i],
          value: 0
        });
      }
      list.forEach(function (item) {
        var index = Math.round((startOfLocalDay(item.occurredAt) - weekRange.start) / DAY_MS);
        if (index >= 0 && index < 7) buckets[index].value += item.amount;
      });
      return buckets;
    }

    if (period === "month") {
      var monthRange = periodRange("month", periodOffset);
      var monthStart = new Date(monthRange.start);
      var days = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0).getDate();
      for (i = 1; i <= days; i++) {
        var date = new Date(monthStart.getFullYear(), monthStart.getMonth(), i);
        buckets.push({
          label: i === 1 || i % 5 === 0 ? String(i) : "",
          fullLabel: fmtShortDate(date.getTime()),
          value: 0
        });
      }
      list.forEach(function (item) {
        var index = Math.round((startOfLocalDay(item.occurredAt) - monthRange.start) / DAY_MS);
        if (index >= 0 && index < days) buckets[index].value += item.amount;
      });
      return buckets;
    }

    if (period === "year") {
      var yearRange = periodRange("year", periodOffset);
      var year = new Date(yearRange.start).getFullYear();
      for (i = 0; i < 12; i++) {
        buckets.push({
          label: (i + 1) + "月",
          fullLabel: year + " 年 " + (i + 1) + " 月",
          value: 0
        });
      }
      list.forEach(function (item) {
        var d = new Date(item.occurredAt);
        if (d.getFullYear() === year) buckets[d.getMonth()].value += item.amount;
      });
      return buckets;
    }

    var years = list.map(function (item) { return new Date(item.occurredAt).getFullYear(); });
    var currentYear = new Date().getFullYear();
    var minYear = years.length ? Math.min.apply(null, years) : currentYear;
    var maxYear = years.length ? Math.max.apply(null, years) : currentYear;
    minYear = Math.min(minYear, currentYear);
    maxYear = Math.max(maxYear, currentYear);
    for (i = minYear; i <= maxYear; i++) {
      buckets.push({ label: String(i), fullLabel: i + " 年", value: 0 });
    }
    list.forEach(function (item) {
      var index = new Date(item.occurredAt).getFullYear() - minYear;
      if (index >= 0 && index < buckets.length) buckets[index].value += item.amount;
    });
    return buckets;
  }

  /* ---------------- rendering ---------------- */

  function renderAll() {
    var rate = salaryMetrics();
    var list = itemsInPeriod();
    renderHero(rate);
    renderRatePanel(rate);
    renderList(rate);
    renderPeriodStats(rate, list);
    renderCategoryChart(rate, list);
    renderRanking(rate, list);
    $("rateWarning").hidden = rate.hourly > 0;
  }

  function renderPeriodViews() {
    var rate = salaryMetrics();
    var list = itemsInPeriod();
    renderPeriodStats(rate, list);
    renderCategoryChart(rate, list);
    renderRanking(rate, list);
  }

  function renderHero(rate) {
    var total = items.reduce(function (sum, item) { return sum + item.amount; }, 0);
    var totalHours = rate.hourly > 0 ? total / rate.hourly : 0;
    var totalDays = rate.dailyHours > 0 ? totalHours / rate.dailyHours : 0;
    var share = rate.salary > 0 ? total / rate.salary : 0;
    var top = items.slice().sort(function (a, b) { return b.amount - a.amount; })[0];

    $("rateValue").textContent = rate.hourly > 0 ? "¥ " + fmt2(rate.hourly) + " / 小时" : "待设置";

    $("totalSpent").textContent = fmtMoney(total);
    $("totalSpentSub").textContent = items.length
      ? items.length + " 件物品 · 平均 " + fmtMoney(total / items.length)
      : "还没有记录";

    $("totalHours").textContent = rate.hourly > 0 ? fmt1(totalHours) + " 小时" : "—";
    $("totalDaysSub").textContent = rate.hourly > 0
      ? "≈ " + fmt1(totalDays) + " 个工作日"
      : "填写月薪后自动换算";

    if (rate.salary > 0 && total > 0) {
      $("salaryShare").textContent = share >= 1 ? fmt1(share) + " 个月工资" : fmt1(share * 100) + "% 月薪";
      $("salaryShareSub").textContent = "按月薪 " + fmtMoney(rate.salary) + " 计";
    } else {
      $("salaryShare").textContent = total > 0 ? "—" : "0%";
      $("salaryShareSub").textContent = "按月薪计算";
    }

    if (top) {
      $("topItem").textContent = top.name.length > 10 ? top.name.slice(0, 10) + "…" : top.name;
      $("topItem").title = top.name;
      $("topItemSub").textContent =
        fmtAmount(top.amount) + (rate.hourly > 0 ? " · " + fmt1(top.amount / rate.hourly) + " 小时" : "");
    } else {
      $("topItem").textContent = "—";
      $("topItemSub").textContent = "还没有记录";
    }
  }

  function renderRatePanel(rate) {
    $("baseSalary").textContent = rate.salary > 0 ? fmtMoney(rate.salary) : "未设置";
    $("baseMonthlyHours").textContent = fmt1(rate.monthlyHours) + " 小时";
    $("baseDailyHours").textContent = fmt1(rate.dailyHours) + " 小时";
    $("baseRate").textContent = rate.hourly > 0 ? "¥ " + fmt2(rate.hourly) : "—";
  }

  function renderPeriodStats(rate, list) {
    var total = list.reduce(function (sum, item) { return sum + item.amount; }, 0);
    var hours = rate.hourly > 0 ? total / rate.hourly : 0;
    var days = periodDayCount();
    var top = list.slice().sort(function (a, b) { return b.amount - a.amount; })[0];

    $("statsRange").textContent = periodRangeText();
    $("categoryPeriodLabel").textContent = PERIOD_NAMES[period] + " / BY CATEGORY";
    $("rankingPeriodLabel").textContent = PERIOD_NAMES[period] + " / WORK RANKING";

    $("periodSpent").textContent = fmtMoney(total);
    $("periodSpentSub").textContent = list.length + " 件物品";

    $("periodHours").textContent = rate.hourly > 0 ? fmt1(hours) + " 小时" : "—";
    $("periodHoursSub").textContent = rate.hourly > 0
      ? "≈ " + fmt1(hours / rate.dailyHours) + " 个工作日"
      : "填写月薪后换算";

    if (total > 0 && days > 0) {
      $("periodDaily").textContent = fmtMoney(total / days);
      $("periodDailySub").textContent = "按 " + days + " 天计";
    } else {
      $("periodDaily").textContent = "—";
      $("periodDailySub").textContent = "—";
    }

    if (top) {
      $("periodTop").textContent = top.name.length > 8 ? top.name.slice(0, 8) + "…" : top.name;
      $("periodTop").title = top.name;
      $("periodTopSub").textContent = fmtAmount(top.amount);
    } else {
      $("periodTop").textContent = "—";
      $("periodTopSub").textContent = "这个周期还没有记录";
    }

    $("periodNav").hidden = period === "all";
    $("periodNext").disabled = periodOffset >= 0;
    renderTrend(list);
  }

  function renderTrend(list) {
    var buckets = buildTrend(list);
    var chart = $("trendChart");
    var max = 1;
    chart.textContent = "";
    $("trendTitle").textContent = trendTitle();

    buckets.forEach(function (bucket) { max = Math.max(max, bucket.value); });
    var hasData = buckets.some(function (bucket) { return bucket.value > 0; });

    if (!list.length || !hasData) {
      var empty = document.createElement("div");
      empty.className = "trend-empty";
      empty.textContent = "这个周期还没有支出记录。";
      chart.appendChild(empty);
      return;
    }

    buckets.forEach(function (bucket) {
      var col = document.createElement("div");
      col.className = "trend-col" + (bucket.value ? "" : " is-zero");

      var wrap = document.createElement("div");
      wrap.className = "trend-bar-wrap";

      var bar = document.createElement("i");
      bar.style.height = bucket.value ? Math.max(4, (bucket.value / max) * 100) + "%" : "2px";
      bar.title = bucket.fullLabel + " · " + fmtAmount(bucket.value);
      wrap.appendChild(bar);

      var label = document.createElement("span");
      label.className = "trend-label";
      label.textContent = bucket.label;

      col.appendChild(wrap);
      col.appendChild(label);
      chart.appendChild(col);
    });
  }

  function visibleItems() {
    var list = activeCategory === "全部"
      ? items.slice()
      : items.filter(function (item) { return item.category === activeCategory; });

    if (sortMode === "amount-desc") {
      list.sort(function (a, b) { return b.amount - a.amount; });
    } else if (sortMode === "amount-asc") {
      list.sort(function (a, b) { return a.amount - b.amount; });
    } else if (sortMode === "oldest") {
      list.sort(function (a, b) { return a.occurredAt - b.occurredAt; });
    } else {
      list.sort(function (a, b) { return b.occurredAt - a.occurredAt; });
    }
    return list;
  }

  function renderList(rate) {
    var listEl = $("entryList");
    var visible = visibleItems();
    var maxAmount = items.reduce(function (max, item) { return Math.max(max, item.amount); }, 1);

    listEl.textContent = "";
    $("listMeta").textContent = activeCategory === "全部"
      ? "共 " + items.length + " 件"
      : "共 " + items.length + " 件 · 当前分类 " + visible.length + " 件";

    if (!visible.length) {
      var empty = document.createElement("li");
      empty.className = "entry-empty";

      var mark = document.createElement("span");
      mark.className = "empty-mark";
      mark.textContent = "¥";

      var title = document.createElement("strong");
      title.textContent = items.length ? "这个分类还没有记录" : "账本还是空的";

      var hint = document.createElement("span");
      hint.textContent = items.length
        ? "切换分类，或者记下第一件这个分类里的东西。"
        : "在左侧记下第一件想买的东西，看看它值多少工作时间。";

      empty.appendChild(mark);
      empty.appendChild(title);
      empty.appendChild(hint);
      listEl.appendChild(empty);
      return;
    }

    visible.forEach(function (item) {
      var color = CATS[item.category] || CATS["其他"];
      var amount = rate.hourly > 0 ? item.amount / rate.hourly : 0;

      var li = document.createElement("li");
      li.className = "entry";
      li.style.setProperty("--c", color);

      var top = document.createElement("div");
      top.className = "entry-top";

      var dot = document.createElement("span");
      dot.className = "entry-dot";
      dot.setAttribute("aria-hidden", "true");

      var name = document.createElement("span");
      name.className = "entry-name";
      name.textContent = item.name;
      name.title = item.name;

      var tag = document.createElement("span");
      tag.className = "entry-tag";
      tag.textContent = item.category;

      var amountEl = document.createElement("span");
      amountEl.className = "entry-amount";
      amountEl.textContent = fmtAmount(item.amount);

      var del = document.createElement("button");
      del.type = "button";
      del.className = "entry-del";
      del.dataset.id = item.id;
      del.setAttribute("aria-label", "删除 " + item.name);
      del.textContent = "×";

      top.appendChild(dot);
      top.appendChild(name);
      top.appendChild(tag);
      top.appendChild(amountEl);
      top.appendChild(del);

      var meta = document.createElement("div");
      meta.className = "entry-meta";

      var date = document.createElement("span");
      date.className = "entry-date";
      date.textContent = fmtDateTime(item.occurredAt);

      var time = document.createElement("span");
      time.className = "entry-time";
      if (rate.hourly > 0) {
        var days = amount / rate.dailyHours;
        time.innerHTML =
          "需要工作 <b>" + fmt1(amount) + "</b> 小时<span class=\"sep\">·</span><b>" +
          fmt1(days) + "</b> 个工作日";
      } else {
        time.textContent = "填写月薪后可换算工作时间";
      }

      meta.appendChild(date);
      meta.appendChild(time);

      var bar = document.createElement("div");
      bar.className = "entry-bar";
      bar.setAttribute("aria-hidden", "true");
      var fill = document.createElement("i");
      fill.style.width = Math.max(4, Math.round((item.amount / maxAmount) * 100)) + "%";
      bar.appendChild(fill);

      li.appendChild(top);
      li.appendChild(meta);
      li.appendChild(bar);
      listEl.appendChild(li);
    });
  }

  function renderCategoryChart(rate, list) {
    var totals = {};
    CAT_NAMES.forEach(function (name) { totals[name] = 0; });
    list.forEach(function (item) { totals[item.category] = (totals[item.category] || 0) + item.amount; });

    var total = list.reduce(function (sum, item) { return sum + item.amount; }, 0);
    var segments = [];
    var cursor = 0;

    CAT_NAMES.forEach(function (name) {
      if (totals[name] <= 0) return;
      var start = cursor;
      cursor += (totals[name] / total) * 100;
      segments.push(CATS[name] + " " + start.toFixed(2) + "% " + cursor.toFixed(2) + "%");
    });

    $("catDonut").style.background = segments.length
      ? "conic-gradient(" + segments.join(",") + ")"
      : "conic-gradient(rgba(148, 178, 210, 0.14) 0 100%)";
    $("catCenter").textContent = String(list.length);

    var legend = $("catLegend");
    legend.textContent = "";

    if (!list.length) {
      var empty = document.createElement("li");
      empty.className = "rank-empty";
      empty.textContent = "这个周期还没有消费数据。";
      legend.appendChild(empty);
      return;
    }

    CAT_NAMES.forEach(function (name) {
      if (totals[name] <= 0) return;
      var share = (totals[name] / total) * 100;
      var li = document.createElement("li");

      var dot = document.createElement("i");
      dot.style.background = CATS[name];

      var label = document.createElement("span");
      label.className = "name";
      label.textContent = name;

      var value = document.createElement("span");
      value.className = "value";
      value.textContent = fmtMoney(totals[name]);

      var pct = document.createElement("span");
      pct.className = "pct";
      pct.textContent = fmt1(share) + "%";

      li.appendChild(dot);
      li.appendChild(label);
      li.appendChild(value);
      li.appendChild(pct);
      legend.appendChild(li);
    });
  }

  function renderRanking(rate, list) {
    var listEl = $("rankList");
    listEl.textContent = "";

    if (!list.length) {
      var empty = document.createElement("li");
      empty.className = "rank-empty";
      empty.textContent = "这个周期还没有记录，无法生成排行。";
      listEl.appendChild(empty);
      return;
    }

    var top = list.slice().sort(function (a, b) { return b.amount - a.amount; }).slice(0, 3);
    var max = top[0].amount || 1;

    top.forEach(function (item, index) {
      var li = document.createElement("li");
      li.className = "rank-item";

      var head = document.createElement("div");
      head.className = "rank-top";

      var no = document.createElement("span");
      no.className = "rank-no";
      no.textContent = pad2(index + 1);

      var name = document.createElement("span");
      name.className = "rank-name";
      name.textContent = item.name;
      name.title = item.name;

      var hours = document.createElement("span");
      hours.className = "rank-hours";
      hours.textContent = rate.hourly > 0
        ? fmt1(item.amount / rate.hourly) + " 小时"
        : fmtAmount(item.amount);

      var bar = document.createElement("div");
      bar.className = "rank-bar";
      var fill = document.createElement("i");
      fill.style.width = Math.max(6, Math.round((item.amount / max) * 100)) + "%";
      bar.appendChild(fill);

      head.appendChild(no);
      head.appendChild(name);
      head.appendChild(hours);
      li.appendChild(head);
      li.appendChild(bar);
      listEl.appendChild(li);
    });
  }

  /* ---------------- interactions ---------------- */

  function bindEvents() {
    $("catPicker").addEventListener("click", function (event) {
      var btn = event.target.closest("button[data-cat]");
      if (!btn) return;
      formCategory = btn.dataset.cat;
      Array.prototype.forEach.call(this.querySelectorAll("button[data-cat]"), function (el) {
        el.classList.toggle("active", el === btn);
      });
    });

    $("ledgerForm").addEventListener("submit", function (event) {
      event.preventDefault();
      var nameEl = $("itemName");
      var amountEl = $("itemAmount");
      var dateEl = $("itemDate");
      var name = nameEl.value.trim();
      var amount = num(amountEl.value, 0);
      var occurredAt = parseLocalDateTime(dateEl.value);

      if (!name) {
        nameEl.focus();
        return;
      }
      if (!(amount > 0)) {
        amountEl.focus();
        return;
      }

      items.unshift({
        id: String(Date.now()) + "-" + Math.random().toString(16).slice(2, 7),
        name: name.slice(0, 40),
        amount: Math.round(amount * 100) / 100,
        category: formCategory,
        createdAt: Date.now(),
        occurredAt: occurredAt
      });

      saveItems();
      this.reset();
      dateEl.value = localDateTimeValue();
      nameEl.focus();
      renderAll();
    });

    $("entryList").addEventListener("click", function (event) {
      var btn = event.target.closest("button[data-id]");
      if (!btn) return;
      items = items.filter(function (item) { return item.id !== btn.dataset.id; });
      saveItems();
      renderAll();
    });

    $("filterChips").addEventListener("click", function (event) {
      var btn = event.target.closest("button[data-filter]");
      if (!btn) return;
      activeCategory = btn.dataset.filter;
      Array.prototype.forEach.call(this.querySelectorAll("button[data-filter]"), function (el) {
        el.classList.toggle("active", el === btn);
      });
      renderList(salaryMetrics());
    });

    $("sortSelect").addEventListener("change", function () {
      sortMode = this.value;
      renderList(salaryMetrics());
    });

    $("periodTabs").addEventListener("click", function (event) {
      var btn = event.target.closest("button[data-period]");
      if (!btn) return;
      period = btn.dataset.period;
      periodOffset = 0;
      Array.prototype.forEach.call(this.querySelectorAll("button[data-period]"), function (el) {
        el.classList.toggle("active", el === btn);
      });
      renderPeriodViews();
    });

    $("periodPrev").addEventListener("click", function () {
      periodOffset -= 1;
      renderPeriodViews();
    });

    $("periodNext").addEventListener("click", function () {
      if (periodOffset >= 0) return;
      periodOffset += 1;
      renderPeriodViews();
    });

    window.addEventListener("storage", function (event) {
      if (event.key === STATE_KEY) {
        state = loadState();
        renderAll();
      } else if (event.key === LEDGER_KEY) {
        items = loadItems();
        renderAll();
      }
    });

    window.addEventListener("pageshow", function () {
      state = loadState();
      items = loadItems();
      renderAll();
    });
  }

  /* ---------------- clock ---------------- */

  function startClock() {
    var lastSecond = -1;
    function update() {
      var now = new Date();
      $("navTime").textContent =
        pad2(now.getHours()) + ":" + pad2(now.getMinutes()) + ":" + pad2(now.getSeconds()) +
        "." + String(now.getMilliseconds()).padStart(3, "0");

      if (now.getSeconds() !== lastSecond) {
        lastSecond = now.getSeconds();
        var week = ["日", "一", "二", "三", "四", "五", "六"][now.getDay()];
        $("navDate").textContent =
          now.getFullYear() + "." + pad2(now.getMonth() + 1) + "." + pad2(now.getDate()) + " 周" + week;
      }
    }

    if (typeof window.requestAnimationFrame === "function") {
      (function frame() {
        update();
        window.requestAnimationFrame(frame);
      })();
    } else {
      setInterval(update, 40);
    }
  }

  /* ---------------- boot ---------------- */

  function init() {
    $("itemDate").value = localDateTimeValue();
    bindEvents();
    renderAll();
    startClock();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
