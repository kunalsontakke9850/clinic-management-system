/* =========================================================
   sheets.js
   Sends patient data to Google Apps Script Web App.
   The Apps Script appends one row to the Google Sheet.

   Column order matches the sheet exactly (A → R):
   A:Timestamp  B:Name     C:Age      D:Gender   E:Phone
   F:Address    G:Date     H:BP       I:Temp     J:Weight
   K:Pulse      L:Diagnosis M:Allergies N:Medicines O:Tests
   P:Notes      Q:FollowUp  R:PMH
   ========================================================= */

(function () {

  function flattenForSheet(d) {
    const meds = Array.isArray(d.medicines)
      ? d.medicines.map(m =>
          `${m.name || ""} ${m.dose || ""} - ${m.freq || ""} - ${m.duration || ""}`.trim()
        ).join(" | ")
      : (d.medicines || "");

    const tests = Array.isArray(d.tests) ? d.tests.join(", ") : (d.tests || "");

    return {
      timestamp: new Date().toISOString(),
      name:      d.name      || "",
      age:       d.age       || "",
      gender:    d.gender    || "",
      phone:     d.phone     || "",
      address:   d.address   || "",
      date:      d.date      || "",
      bp:        (d.vitals && d.vitals.bp)     || d.bp     || "",
      temp:      (d.vitals && d.vitals.temp)   || d.temp   || "",
      weight:    (d.vitals && d.vitals.weight) || d.weight || "",
      pulse:     (d.vitals && d.vitals.pulse)  || d.pulse  || "",
      diagnosis: d.diagnosis || "",
      allergies: d.allergies || "",
      medicines: meds,
      tests:     tests,
      notes:     d.notes    || "",
      followUp:  d.followUp || "",
      pmh:       d.pmh      || ""
    };
  }

  async function savePatient(data) {
    if (!window.CONFIG || !CONFIG.GOOGLE_SHEETS_URL ||
        CONFIG.GOOGLE_SHEETS_URL.indexOf("PASTE_") === 0) {
      console.warn("Google Sheets URL not configured. See config.js.");
      return { ok: false, reason: "no_url" };
    }

    const payload = Object.assign({ appWriteKey: (window.CONFIG && CONFIG.APP_WRITE_KEY) || '' }, flattenForSheet(data));

    try {
      const response = await fetch(CONFIG.GOOGLE_SHEETS_URL, {
        method: "POST",
        mode: "cors",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(payload)
      });
      if (!response.ok) throw new Error("Cloud save failed.");
      const result = await response.json();
      if (!result || !result.ok) throw new Error((result && (result.message || result.error)) || "Cloud save was rejected.");
      return { ok: true, payload, result };
    } catch (err) {
      console.error("Sheets save error:", err);
      return { ok: false, error: err.message };
    }
  }

  window.RxSheets = { savePatient, flattenForSheet };

})();
