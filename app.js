(function () {
  const els = {
    domain: document.getElementById("domain"),
    rtype: document.getElementById("rtype"),
    checkBtn: document.getElementById("checkBtn"),
    banner: document.getElementById("banner"),
    bannerIcon: document.getElementById("bannerIcon"),
    bannerTitle: document.getElementById("bannerTitle"),
    bannerText: document.getElementById("bannerText"),
    bannerSub: document.getElementById("bannerSub"),
    resultsBody: document.getElementById("resultsBody"),
    countryFilters: document.getElementById("countryFilters"),
  };

  let ws = null;
  let isConnected = false;
  let isRunning = false;

  let results = [];
  let activeCountry = null;

  function wsUrl() {
    const isHttps = location.protocol === "https:";
    const proto = isHttps ? "wss:" : "ws:";
    const params = new URLSearchParams(location.search);
    const override = params.get("ws");
    if (override) return override;
    return `${proto}//${location.host}/ws/`;
  }

  function escapeHtml(str) {
    return String(str ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function normalizeDomain(d) {
    d = String(d || "").trim();
    try {
      if (d.includes("://")) {
        const u = new URL(d);
        d = u.hostname;
      }
    } catch (_) {}
    d = d.replace(/\s+/g, "");
    d = d.replace(/\.$/, "");
    return d;
  }

  function setBanner(kind, title, text, sub) {
    const iconMap = { ok: "✓", warn: "i", bad: "!" };
    els.banner.className = `banner ${kind}`;
    els.bannerIcon.textContent = iconMap[kind] || "i";
    els.bannerTitle.textContent = title || "Info";
    els.bannerText.textContent = text ? ` ${text}` : "";
    els.bannerSub.textContent = sub || "";
    els.banner.classList.remove("hidden");
  }

  function hideBanner() {
    els.banner.classList.add("hidden");
  }

  function humanLimit(code) {
    if (code === "minute_limit") return "Too many requests. Please wait a moment and try again.";
    if (code === "hour_limit") return "Hourly limit reached. Please try again later.";
    if (code === "day_limit") return "Daily limit reached. Please try again tomorrow.";
    return "Rate limit reached. Please try again later.";
  }

  function setRunning(on) {
    isRunning = on;
    els.checkBtn.disabled = !isConnected || isRunning;
  }

  function resetRun() {
    results = [];
    activeCountry = null;
    els.resultsBody.innerHTML = "";
    els.countryFilters.innerHTML = "";
  }

  function colorForCountry(country) {
    const s = String(country || "Other");
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    const hue = h % 360;
    return `hsl(${hue} 75% 58%)`;
  }

  function buildFilters() {
    const counts = new Map();
    for (const r of results) {
      const c = r.country || "Other";
      counts.set(c, (counts.get(c) || 0) + 1);
    }
    const items = [...counts.entries()].sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]));
    els.countryFilters.innerHTML = "";
    if (items.length === 0) return;

    const allPill = document.createElement("div");
    allPill.className = `pill ${activeCountry === null ? "active" : ""}`;
    allPill.innerHTML = `
      <span class="dot" style="background:hsl(220 75% 58%)"></span>
      <span class="name">All</span>
      <span class="count">${results.length}</span>
    `;
    allPill.addEventListener("click", () => {
      activeCountry = null;
      buildFilters();
      renderTable();
    });
    els.countryFilters.appendChild(allPill);

    for (const [country, count] of items) {
      const pill = document.createElement("div");
      const color = colorForCountry(country);
      pill.className = `pill ${activeCountry === country ? "active" : ""}`;
      const flag = (results.find(r => (r.country || "Other") === country)?.flag) || "🌐";
      pill.innerHTML = `
        <span class="dot" style="background:${escapeHtml(color)}"></span>
        <span class="flag">${escapeHtml(flag)}</span>
        <span class="name">${escapeHtml(country)}</span>
        <span class="count">${count}</span>
      `;
      pill.addEventListener("click", () => {
        activeCountry = (activeCountry === country) ? null : country;
        buildFilters();
        renderTable();
      });
      els.countryFilters.appendChild(pill);
    }
  }

  function rowHtml(r) {
    const ok = !!r.status;
    const code = (r.flag && String(r.flag).trim()) ? String(r.flag) : (r.country ? String(r.country).slice(0,2).toUpperCase() : "WW");
    const resolverTitle = `${r.name || "Resolver"} • ${r.country || ""}`.trim();
    const latency = (r.latency_ms != null) ? `${r.latency_ms} ms` : "-";
    const ttl = (r.ttl != null) ? String(r.ttl) : "-";
    // const result = (r.result != null) ? String(r.result) : "";

    const resultHtml = (Array.isArray(r.results) && r.results.length)
      ? r.results.map(x => `<div>${escapeHtml(x)}</div>`).join("")
      : escapeHtml((r.result != null) ? String(r.result) : "");

    return `
      <tr>
        <td>
          <div class="resolver">
            <span class="tag">${escapeHtml(code)}</span>
            <div>
              <div class="rname">${escapeHtml(resolverTitle)}</div>
              <div class="rip">${escapeHtml(r.server_ip || "")}</div>
            </div>
          </div>
        </td>
        <td><span class="badge ${ok ? "ok" : "bad"}">${ok ? "SUCCESS" : "FAILED"}</span></td>
        <td class="mono">${escapeHtml(latency)}</td>
        <td class="mono">${escapeHtml(ttl)}</td>
<!--        <td class="mono">${escapeHtml(result)}</td>-->
        <td class="mono">${resultHtml}</td>


      </tr>
    `;
  }

  function renderTable() {
    const visible = activeCountry ? results.filter(r => (r.country || "Other") === activeCountry) : results;
    els.resultsBody.innerHTML = visible.map(rowHtml).join("");
  }

  function connect() {
    try {
      ws = new WebSocket(wsUrl());

      ws.onopen = () => {
        isConnected = true;
        els.checkBtn.disabled = false;
      };

      ws.onmessage = (ev) => {
        let msg = null;
        try { msg = JSON.parse(ev.data); } catch (_) {}

        if (msg && msg.type === "resolver_result" && msg.data) {
          results.push(msg.data);
          buildFilters();
          renderTable();
          return;
        }

        const text = msg && (msg.text || msg.message) ? (msg.text || msg.message) : (ev.data || "");

        if (text === "day_limit" || text === "hour_limit" || text === "minute_limit") {
          setBanner("warn", "Limit reached", humanLimit(text));
          setRunning(false);
          return;
        }

        if (String(text).toLowerCase() === "done") {
          setBanner("ok", "Completed", "The query has finished.");
          setRunning(false);
          return;
        }

        if (text) {
          const t = String(text).toLowerCase();
          if (t.includes("error") || t.includes("not") || t.includes("failed")) {
            setBanner("bad", "Error", text);
          }
        }
      };

      ws.onclose = () => {
        isConnected = false;
        els.checkBtn.disabled = true;
        setRunning(false);
        setTimeout(connect, 1200);
      };

      ws.onerror = () => {};
    } catch (e) {
      isConnected = false;
      els.checkBtn.disabled = true;
      setRunning(false);
      setTimeout(connect, 1500);
    }
  }

  function validateInputs(domain, rtype) {
    if (!domain) {
      setBanner("bad", "Missing input", "Please enter a domain/hostname.");
      return false;
    }
    if (!rtype) {
      setBanner("bad", "Missing input", "Please select a record type.");
      return false;
    }
    if (domain.length > 253) {
      setBanner("bad", "Invalid domain", "The domain looks too long.");
      return false;
    }
    return true;
  }

  function runCheck() {
    if (!isConnected || !ws || ws.readyState !== 1) {
      setBanner("bad", "Offline", "The service is not reachable. Please try again.");
      return;
    }

    const domain = normalizeDomain(els.domain.value);
    const rtype = els.rtype.value;

    if (!validateInputs(domain, rtype)) return;

    hideBanner();
    resetRun();
    setBanner("warn", "Running", `${domain} / ${rtype}`, "Results will appear below as they arrive.");
    setRunning(true);

    ws.send(JSON.stringify({ query_name: domain, query_type: rtype }));
  }

  els.domain.addEventListener("keydown", (e) => { if (e.key === "Enter") runCheck(); });
  els.checkBtn.addEventListener("click", runCheck);

  els.checkBtn.disabled = true;
  connect();
})();