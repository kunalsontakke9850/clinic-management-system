/* =========================================================
   print.js
   Pixel-matches the real Maa Rajnandini / Clinic Doctor
   letterhead. Opens a popup, renders read-only prescription,
   auto-fires print dialog.
   ========================================================= */

(function () {

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function fmtDate(d) {
    if (!d) return "";
    try {
      const dt = new Date(d);
      if (isNaN(dt.getTime())) return d;
      const dd = String(dt.getDate()).padStart(2, "0");
      const mm = String(dt.getMonth() + 1).padStart(2, "0");
      const yy = String(dt.getFullYear()).slice(-2);
      return dd + "-" + mm + "-" + yy;
    } catch (e) { return d; }
  }

  function buildMedRows(meds) {
    if (!meds || !meds.length) {
      return '<tr><td colspan="5" style="text-align:center;color:#6b7280;padding:14px;">No medicines prescribed</td></tr>';
    }
    return meds.map(function (m, i) {
      return '<tr>' +
        '<td style="text-align:center;">' + (i + 1) + '</td>' +
        '<td>' + esc(m.name) + '</td>' +
        '<td>' + esc(m.dose) + '</td>' +
        '<td>' + esc(m.freq) + '</td>' +
        '<td>' + esc(m.duration) + '</td>' +
      '</tr>';
    }).join("");
  }

  function buildTags(arr) {
    if (!arr || !arr.length) return '<span style="color:#6b7280;font-style:italic;">None</span>';
    return arr.map(function (t) { return '<span class="tag">' + esc(t) + '</span>'; }).join(" ");
  }

  // Inline SVG tooth logo (centered between header columns)
  const TOOTH_SVG =
    '<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" width="56" height="56">' +
      '<path d="M32 6c-7 0-12 3-14 3s-6-2-9 0c-4 3-3 11-1 18 2 6 3 9 4 16 1 6 3 13 6 13 4 0 4-10 6-15 1-3 3-5 8-5s7 2 8 5c2 5 2 15 6 15 3 0 5-7 6-13 1-7 2-10 4-16 2-7 3-15-1-18-3-2-7 0-9 0S39 6 32 6z" ' +
      'fill="#ffffff" stroke="#b91c1c" stroke-width="2.5"/>' +
      '<path d="M28 22c-3 1-5 4-5 8" fill="none" stroke="#b91c1c" stroke-width="1.5" stroke-linecap="round"/>' +
    '</svg>';

  // Watermark - same tooth, very faint, large, behind content
  const WATERMARK_SVG =
    '<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" width="360" height="360">' +
      '<path d="M32 6c-7 0-12 3-14 3s-6-2-9 0c-4 3-3 11-1 18 2 6 3 9 4 16 1 6 3 13 6 13 4 0 4-10 6-15 1-3 3-5 8-5s7 2 8 5c2 5 2 15 6 15 3 0 5-7 6-13 1-7 2-10 4-16 2-7 3-15-1-18-3-2-7 0-9 0S39 6 32 6z" ' +
      'fill="#000" opacity="0.06"/>' +
    '</svg>';

  // Bottom strip — reads images/strip1.jpg … strip7.jpg; hides tile on missing image
  function bottomTile(n) {
    return '<div class="btile"><img src="images/strip' + n + '.jpg" alt="" onerror="this.style.display=\'none\'" /></div>';
  }
  const BOTTOM_STRIP =
    bottomTile(1) + bottomTile(2) + bottomTile(3) + bottomTile(4) +
    bottomTile(5) + bottomTile(6) + bottomTile(7);

  function buildHTML(d) {
    return '<!DOCTYPE html>' +
'<html><head><meta charset="UTF-8"/>' +
'<title>Prescription - ' + esc(d.name) + '</title>' +
'<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Devanagari:wght@400;600;700;800&family=Tiro+Devanagari+Marathi&display=swap" rel="stylesheet">' +
'<style>' +
'* { box-sizing: border-box; margin: 0; padding: 0; }' +
'html, body {' +
'  background: #fff; color: #1f2937;' +
'  font-family: "Segoe UI", Arial, sans-serif;' +
'  font-size: 13px;' +
'  -webkit-print-color-adjust: exact; print-color-adjust: exact;' +
'}' +

'.sheet { max-width: 800px; margin: 0 auto; background: #fff; position: relative; overflow: hidden; }' +

/* TOP TAGLINE */
'.tagline { text-align: center; font-size: 10px; letter-spacing: 4px; color: #1f2937; padding: 4px 0 2px; font-weight: 700; }' +

/* HEADER */
'.rx-header { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; padding: 2px 18px 8px; gap: 10px; border-bottom: 2px solid #0e6a3f; }' +
'.col-left { text-align: left; }' +
'.col-right { text-align: right; }' +
'.logo-center { display: flex; align-items: center; justify-content: center; padding: 0 6px; }' +

/* MARATHI LEFT */
'.mr-title { font-family: "Tiro Devanagari Marathi","Noto Sans Devanagari", sans-serif; font-size: 32px; font-weight: 800; color: #b91c1c; line-height: 1; letter-spacing: 1px; }' +
'.mr-sub { font-family: "Noto Sans Devanagari", sans-serif; font-size: 12px; color: #b91c1c; font-weight: 700; margin-top: 2px; }' +
'.spec-box { display: inline-block; background: #fff8d6; border: 1.5px solid #b91c1c; color: #b91c1c; padding: 3px 10px; font-family: "Noto Sans Devanagari",sans-serif; font-weight: 700; font-size: 12px; margin-top: 6px; border-radius: 2px; }' +
'.timings { font-family: "Noto Sans Devanagari", sans-serif; font-size: 10.5px; color: #1f2937; margin-top: 5px; line-height: 1.4; }' +
'.timings b { font-weight: 700; }' +
'.mob { font-size: 11px; color: #1f2937; font-weight: 700; margin-top: 2px; }' +

/* DOCTOR RIGHT */
'.dr-name { font-family: "Tiro Devanagari Marathi","Noto Sans Devanagari", sans-serif; font-size: 26px; font-weight: 800; color: #b91c1c; line-height: 1; }' +
'.dr-qual { font-size: 12px; color: #1f2937; font-weight: 700; margin-top: 3px; }' +
'.dr-spec { font-size: 12px; color: #b91c1c; font-weight: 700; text-decoration: underline; margin-top: 2px; }' +
'.dr-extra { font-size: 11px; color: #1f2937; margin-top: 1px; }' +
'.dr-reg { font-size: 11px; color: #1f2937; margin-top: 2px; font-weight: 600; }' +

/* ADDRESS BAR */
'.address-bar { background: #0e6a3f; color: #fff; padding: 6px 18px; font-family: "Noto Sans Devanagari", sans-serif; font-size: 12px; font-weight: 600; }' +

/* PATIENT STRIP */
'.patient-strip { display: flex; gap: 18px; padding: 8px 18px; border-bottom: 1px solid #cbd5e1; font-size: 13px; align-items: baseline; }' +
'.patient-strip .it { display: flex; gap: 6px; align-items: baseline; }' +
'.patient-strip .lbl { font-family: "Noto Sans Devanagari", sans-serif; font-size: 13px; font-weight: 700; color: #1f2937; }' +
'.patient-strip .val { font-weight: 600; border-bottom: 1px dotted #6b7280; min-width: 80px; padding: 0 4px; }' +
'.patient-strip .grow { flex: 1; }' +

/* BODY + WATERMARK */
'.rx-body { display: grid; grid-template-columns: 200px 1fr; min-height: 480px; position: relative; }' +
'.watermark { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); z-index: 0; pointer-events: none; }' +
'.sidebar, .main-area { position: relative; z-index: 1; }' +
'.sidebar { background: rgba(248,250,252,0.7); border-right: 1.5px solid #0e6a3f; padding: 10px 12px; }' +
'.side-block { margin-bottom: 12px; }' +
'.side-block h4 { font-size: 11px; font-weight: 800; color: #0e6a3f; border-bottom: 1.5px solid #0e6a3f; padding-bottom: 2px; margin-bottom: 5px; text-transform: uppercase; letter-spacing: .5px; }' +
'.vital-row { display: flex; justify-content: space-between; font-size: 12px; padding: 2px 0; }' +
'.vital-row .k { font-weight: 700; color: #374151; }' +
'.side-text { font-size: 12px; line-height: 1.4; color: #1f2937; white-space: pre-wrap; }' +

'.main-area { padding: 10px 18px; }' +
'.rx-glyph { font-size: 42px; font-weight: 900; color: #b91c1c; font-family: Georgia, serif; line-height: 1; margin-bottom: 2px; }' +

'table.med-table { width: 100%; border-collapse: collapse; margin-top: 4px; font-size: 13px; background: rgba(255,255,255,0.85); }' +
'table.med-table th { background: #0e6a3f; color: #fff; padding: 6px 8px; text-align: left; font-size: 12px; font-weight: 700; }' +
'table.med-table td { border: 1px solid #e5e7eb; padding: 6px 8px; }' +

'.block { margin-top: 12px; }' +
'.block h4 { font-size: 11px; font-weight: 800; color: #0e6a3f; border-bottom: 1.5px solid #0e6a3f; padding-bottom: 2px; margin-bottom: 5px; text-transform: uppercase; letter-spacing: .5px; }' +
'.block .content { font-size: 13px; line-height: 1.5; white-space: pre-wrap; min-height: 18px; }' +
'.tag { display: inline-block; background: #0e6a3f; color: #fff; padding: 3px 10px; border-radius: 20px; font-size: 12px; font-weight: 600; margin: 2px 3px 2px 0; }' +

/* FOOTER */
'.rx-footer { display: flex; justify-content: space-between; align-items: flex-end; padding: 16px 18px 10px; border-top: 1px dashed #cbd5e1; margin-top: 10px; position: relative; z-index: 1; }' +
'.comp-note { font-size: 10px; color: #6b7280; font-style: italic; }' +
'.footer-right { display: flex; gap: 26px; align-items: flex-end; }' +
'.stamp { width: 92px; height: 92px; border: 2px solid #b91c1c; border-radius: 50%; display: flex; align-items: center; justify-content: center; position: relative; }' +
'.stamp::before { content: ""; position: absolute; inset: 5px; border: 1px dashed #b91c1c; border-radius: 50%; }' +
'.stamp-inner { text-align: center; font-size: 9px; font-weight: 800; color: #b91c1c; line-height: 1.3; }' +
'.stamp-inner span { font-size: 8px; font-weight: 600; }' +
'.signature { text-align: center; min-width: 150px; }' +
'.sig-line { border-bottom: 1px solid #374151; height: 34px; }' +
'.sig-text { font-size: 11px; color: #374151; font-weight: 600; margin-top: 3px; }' +

/* BOTTOM STRIP - dental images */
'.bottom-strip { display: grid; grid-template-columns: repeat(7, 1fr); border-top: 2px solid #b91c1c; background: #e0d8c8; }' +
'.btile { height: 64px; overflow: hidden; border-right: 1px solid #d0c8b0; background: #e0d8c8; display: flex; align-items: center; justify-content: center; }' +
'.btile:last-child { border-right: none; }' +
'.btile img { width: 100%; height: 100%; object-fit: cover; display: block; }' +
'.pink-line { height: 4px; background: #ec4899; }' +

'@page { size: A4; margin: 6mm; }' +
'@media print { body { background: #fff; } .sheet { box-shadow: none; } }' +
'</style></head><body>' +

'<div class="sheet">' +

  '<img src="images/public-header.svg" style="width:100%;display:block;-webkit-print-color-adjust:exact;print-color-adjust:exact;" alt="Clinic header placeholder" />' +

  '<div class="patient-strip">' +
    '<div class="it grow"><span class="lbl">नाव:</span><span class="val">' + esc(d.name) + '</span></div>' +
    '<div class="it"><span class="val">' + esc(d.age) + '/' + esc(d.gender) + '</span></div>' +
    '<div class="it"><span class="lbl">दिनांक:</span><span class="val">' + esc(fmtDate(d.date)) + '</span></div>' +
  '</div>' +

  '<div class="rx-body">' +
    '<div class="watermark">' + WATERMARK_SVG + '</div>' +
    '<aside class="sidebar">' +
      '<div class="side-block"><h4>Vitals</h4>' +
        '<div class="vital-row"><span class="k">BP</span><span>' + esc(d.vitals.bp || "—") + '</span></div>' +
        '<div class="vital-row"><span class="k">Temp</span><span>' + esc(d.vitals.temp || "—") + '</span></div>' +
        '<div class="vital-row"><span class="k">Weight</span><span>' + esc(d.vitals.weight || "—") + '</span></div>' +
        '<div class="vital-row"><span class="k">Pulse</span><span>' + esc(d.vitals.pulse || "—") + '</span></div>' +
      '</div>' +
      '<div class="side-block"><h4>Diagnosis</h4>' +
        '<div class="side-text">' + esc(d.diagnosis || "—") + '</div>' +
      '</div>' +
      '<div class="side-block"><h4>Allergies</h4>' +
        '<div class="side-text">' + esc(d.allergies || "None known") + '</div>' +
      '</div>' +
    '</aside>' +
    '<main class="main-area">' +
      '<div class="rx-glyph">&#8478;</div>' +
      '<table class="med-table">' +
        '<thead><tr>' +
          '<th style="width:30px;">#</th>' +
          '<th>Medicine Name</th>' +
          '<th style="width:90px;">Dose</th>' +
          '<th style="width:140px;">Frequency</th>' +
          '<th style="width:90px;">Duration</th>' +
        '</tr></thead>' +
        '<tbody>' + buildMedRows(d.medicines) + '</tbody>' +
      '</table>' +
      '<div class="block"><h4>Lab Tests / Investigations</h4>' +
        '<div class="content">' + buildTags(d.tests) + '</div>' +
      '</div>' +
      '<div class="block"><h4>Notes / Instructions</h4>' +
        '<div class="content">' + esc(d.notes || "—") + '</div>' +
      '</div>' +
      '<div class="block"><h4>Follow-up Date</h4>' +
        '<div class="content">' + esc(fmtDate(d.followUp) || "—") + '</div>' +
      '</div>' +
    '</main>' +
  '</div>' +

  '<footer class="rx-footer">' +
    '<div></div>' +
    '<div class="footer-right">' +
      '<div class="signature"><div class="sig-line"></div><div class="sig-text">Doctor\'s Signature</div></div>' +
    '</div>' +
  '</footer>' +

  '<div class="pink-line"></div>' +
  '<div class="bottom-strip">' + BOTTOM_STRIP + '</div>' +

'</div>' +
'<script>' +
'window.addEventListener("load", function(){ setTimeout(function(){ window.focus(); window.print(); }, 350); });' +
'</' + 'script>' +
'</body></html>';
  }

  function openPrintWindow(data) {
    const w = window.open("", "_blank", "width=900,height=1100");
    if (!w) {
      alert("Pop-up blocked. Please allow pop-ups for this site.");
      return;
    }
    w.document.open();
    w.document.write(buildHTML(data));
    w.document.close();
  }

  window.RxPrint = { openPrintWindow: openPrintWindow };

})();
