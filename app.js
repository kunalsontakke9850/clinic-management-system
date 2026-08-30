/* =========================================================
   app.js - Main UI logic for the prescription form
   ========================================================= */

(function () {

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  function todayISO() {
    const d = new Date();
    const off = d.getTimezoneOffset();
    const local = new Date(d.getTime() - off * 60000);
    return local.toISOString().slice(0, 10);
  }

  function setStatus(msg, isError) {
    const s = $("#statusMsg");
    if (!s) return;
    s.textContent = msg || "";
    s.classList.toggle("error", !!isError);
    if (msg) {
      setTimeout(() => { if (s.textContent === msg) s.textContent = ""; }, 5000);
    }
  }

  function addMedRow(data) {
    data = data || {};
    const tbody = $("#medBody");
    if (!tbody) return;
    const idx = tbody.querySelectorAll("tr").length + 1;
    const tr = document.createElement("tr");
    tr.innerHTML =
      '<td class="row-num">' + idx + '</td>' +
      '<td><input type="text" class="m-name" value="' + (data.name || "") + '" placeholder="e.g., Amoxicillin" /></td>' +
      '<td><input type="text" class="m-dose" value="' + (data.dose || "") + '" placeholder="250mg" /></td>' +
      '<td><input type="text" class="m-freq" value="' + (data.freq || "") + '" placeholder="Twice daily" /></td>' +
      '<td><input type="text" class="m-dur"  value="' + (data.duration || "") + '" placeholder="5 days" /></td>' +
      '<td class="no-print"><button class="row-del" title="Remove">&times;</button></td>';
    tr.querySelector(".row-del").addEventListener("click", () => {
      tr.remove();
      renumber();
    });
    tbody.appendChild(tr);
  }

  function renumber() {
    $$("#medBody tr").forEach((tr, i) => {
      tr.querySelector(".row-num").textContent = i + 1;
    });
  }

  function getMedicines() {
    const list = [];
    $$("#medBody tr").forEach((tr) => {
      const name = tr.querySelector(".m-name").value.trim();
      const dose = tr.querySelector(".m-dose").value.trim();
      const freq = tr.querySelector(".m-freq").value.trim();
      const duration = tr.querySelector(".m-dur").value.trim();
      if (name || dose || freq || duration) {
        list.push({ name: name, dose: dose, freq: freq, duration: duration });
      }
    });
    return list;
  }

  const tests = [];

  function renderTags() {
    const wrap = $("#testTags");
    if (!wrap) return;
    wrap.innerHTML = "";
    tests.forEach((t, i) => {
      const span = document.createElement("span");
      span.className = "tag";
      span.innerHTML = t + ' <span class="x" data-i="' + i + '">&times;</span>';
      wrap.appendChild(span);
    });
    wrap.querySelectorAll(".x").forEach((x) => {
      x.addEventListener("click", () => {
        tests.splice(Number(x.dataset.i), 1);
        renderTags();
      });
    });
  }

  function addTest(value) {
    const v = (value || "").trim();
    if (!v) return;
    tests.push(v);
    renderTags();
  }

  function val(id) {
    const el = $(id);
    return el ? (el.value || "").trim() : "";
  }
  function rawVal(id) {
    const el = $(id);
    return el ? el.value : "";
  }

  function collectData() {
    return {
      name:   val("#pName"),
      age:    val("#pAge"),
      gender: rawVal("#pGender"),
      date:   rawVal("#pDate"),
      vitals: {
        bp:     val("#vBP"),
        temp:   val("#vTemp"),
        weight: val("#vWeight"),
        pulse:  val("#vPulse")
      },
      diagnosis: val("#diagnosis"),
      allergies: val("#allergies"),
      medicines: getMedicines(),
      tests:     tests.slice(),
      notes:     val("#notes"),
      followUp:  rawVal("#followUp"),
      billAmount: rawVal("#billAmount"),
      billMode:   rawVal("#billMode")
    };
  }

  window.RxApp = {
    addMedRow: addMedRow,
    addTest: addTest,
    collectData: collectData,
    setStatus: setStatus,
    todayISO: todayISO,
    clearTests: function () { tests.length = 0; renderTags(); }
  };

  document.addEventListener("DOMContentLoaded", function () {

    const pDate = $("#pDate");
    if (pDate && !pDate.value) pDate.value = todayISO();

    addMedRow();

    const btnAdd = $("#btnAddMed");
    if (btnAdd) btnAdd.addEventListener("click", function () { addMedRow(); });

    const testInp = $("#testInput");
    if (testInp) {
      testInp.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === ",") {
          e.preventDefault();
          addTest(e.target.value);
          e.target.value = "";
        }
      });
      testInp.addEventListener("blur", function (e) {
        if (e.target.value.trim()) {
          addTest(e.target.value);
          e.target.value = "";
        }
      });
    }

    const btnS = $("#btnSave");
    if (btnS) {
      btnS.addEventListener("click", async function () {
        const data = collectData();
        if (!data.name) {
          setStatus("Patient name is required.", true);
          return;
        }
        setStatus("Saving...");
        try {
          const res = await window.RxSheets.savePatient(data);
          if (res && res.ok) setStatus("Saved to Google Sheets");
          else setStatus("Saved locally (check Sheets URL in config.js).", true);
        } catch (err) {
          console.error(err);
          setStatus("Save failed: " + err.message, true);
        }
      });
    }

    const btnP = $("#btnPrint");
    if (btnP) {
      btnP.addEventListener("click", function () {
        const data = collectData();
        if (!data.name) {
          setStatus("Add patient name before printing.", true);
          return;
        }
        window.RxPrint.openPrintWindow(data);
      });
    }

    const btnR = $("#btnReset");
    if (btnR) {
      btnR.addEventListener("click", function () {
        if (!confirm("Start a new prescription? Current data will be cleared.")) return;
        document.querySelectorAll("input[type=text], input[type=date], textarea")
          .forEach(function (el) { el.value = ""; });
        const g = $("#pGender"); if (g) g.value = "M";
        const d = $("#pDate");   if (d) d.value = todayISO();
        const mb = $("#medBody"); if (mb) mb.innerHTML = "";
        addMedRow();
        tests.length = 0;
        renderTags();
        setStatus("New prescription started.");
      });
    }

  });

})();
