// Standalone UGC brief export — generates a professional, print-ready HTML document
// for sharing with creators, agencies, or as an internal memo.

export function generateBriefHTML(brief, brandName = 'Chefly', contactSheetUrl = null) {
  const sanitize = (text) => {
    if (!text) return '';
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  };

  const today = new Date().toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  const renderVariations = (variations) => {
    if (!variations || variations.length === 0) return '';
    return `
      <div class="variations">
        <span class="variations-title">Variations</span>
        ${variations.map(v => `
          <div class="var-row">
            <span class="var-id">${sanitize(v.label)}</span>
            <div class="var-content">
              ${v.framing ? `<span><strong>Framing:</strong> ${sanitize(v.framing)}</span>` : ''}
              ${v.action ? `<span><strong>Action:</strong> ${sanitize(v.action)}</span>` : ''}
              ${v.notes ? `<span class="var-note">${sanitize(v.notes)}</span>` : ''}
            </div>
          </div>
        `).join('')}
      </div>
    `;
  };

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>UGC Creator Brief \u2014 ${sanitize(brief.concept || 'Production Brief')} \u2014 Chefly</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&family=Syne:wght@600;700;800&family=Instrument+Serif&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }

    html {
      font-size: 15px;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    body {
      font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      color: #1e1e2a;
      background: #ffffff;
      line-height: 1.6;
    }

    .page {
      max-width: 780px;
      margin: 0 auto;
      padding: 48px 40px;
    }

    /* === Cover === */
    .cover {
      padding-bottom: 36px;
      margin-bottom: 36px;
      border-bottom: 2px solid #e8e8ec;
    }

    .cover-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 28px;
    }

    .logo {
      font-family: 'Syne', sans-serif;
      font-weight: 800;
      font-size: 1.1rem;
      color: #7c3aed;
      letter-spacing: -0.02em;
    }

    .cover-date {
      font-size: 0.8rem;
      color: #71717a;
      font-weight: 500;
    }

    .doc-type {
      font-size: 0.73rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: #7c3aed;
      margin-bottom: 10px;
    }

    .cover-title {
      font-family: 'Instrument Serif', serif;
      font-size: 2.2rem;
      color: #111118;
      line-height: 1.25;
      margin-bottom: 10px;
    }

    .inspired {
      font-size: 0.87rem;
      color: #71717a;
      font-style: italic;
    }

    /* === Overview Grid === */
    .overview {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 12px;
      margin-bottom: 36px;
    }

    .ov-item {
      background: #faf5ff;
      border: 1px solid #ede9fe;
      border-radius: 8px;
      padding: 14px;
    }

    .ov-label {
      display: block;
      font-size: 0.7rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #7c3aed;
      margin-bottom: 4px;
    }

    .ov-value {
      display: block;
      font-size: 0.9rem;
      color: #27272a;
      font-weight: 500;
    }

    /* === Contact Sheet === */
    .ref-image {
      margin-bottom: 36px;
      border-radius: 8px;
      overflow: hidden;
      border: 1px solid #e4e4e7;
    }

    .ref-image img {
      width: 100%;
      height: auto;
      display: block;
    }

    .ref-caption {
      font-size: 0.73rem;
      color: #71717a;
      text-align: center;
      padding: 8px;
      background: #fafafa;
      border-top: 1px solid #e4e4e7;
    }

    /* === Section Titles === */
    .section-title {
      font-family: 'Plus Jakarta Sans', sans-serif;
      font-size: 0.85rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: #7c3aed;
      margin-bottom: 12px;
      padding-bottom: 6px;
      border-bottom: 1px solid #ededf0;
    }

    .section-block {
      margin-bottom: 32px;
    }

    /* === Production Tips === */
    .tips-list {
      padding-left: 20px;
      font-size: 0.9rem;
      color: #3f3f46;
      line-height: 1.65;
    }

    .tips-list li {
      margin-bottom: 8px;
    }

    .tips-list li::marker {
      color: #7c3aed;
      font-weight: 700;
    }

    /* === Shot Cards === */
    .shot {
      border: 1px solid #e4e4e7;
      border-radius: 8px;
      margin-bottom: 16px;
      overflow: hidden;
      page-break-inside: avoid;
    }

    .shot-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 10px 16px;
      background: #faf5ff;
      border-bottom: 1px solid #ede9fe;
    }

    .shot-num {
      font-family: 'Syne', sans-serif;
      font-weight: 700;
      font-size: 0.85rem;
      color: #7c3aed;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .shot-dur {
      font-size: 0.78rem;
      font-weight: 600;
      color: #7c3aed;
      background: #ede9fe;
      padding: 3px 8px;
      border-radius: 4px;
    }

    .shot-table {
      width: 100%;
      border-collapse: collapse;
    }

    .shot-table tr { border-bottom: 1px solid #f4f4f5; }
    .shot-table tr:last-child { border-bottom: none; }

    .shot-table td {
      padding: 8px 16px;
      font-size: 0.88rem;
      color: #27272a;
      vertical-align: top;
      line-height: 1.55;
    }

    .s-label {
      font-size: 0.73rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: #71717a;
      width: 80px;
    }

    .s-script {
      color: #6d28d9;
      font-style: italic;
      font-weight: 500;
    }

    .s-note {
      color: #71717a;
      font-style: italic;
    }

    /* === Variations === */
    .variations {
      padding: 12px 16px;
      border-top: 1px solid #f0f0f2;
      background: #fcfcfd;
    }

    .variations-title {
      display: block;
      font-size: 0.7rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: #7c3aed;
      margin-bottom: 10px;
    }

    .var-row {
      display: flex;
      gap: 12px;
      align-items: flex-start;
      padding: 6px 0;
      border-bottom: 1px solid #f4f4f5;
      font-size: 0.85rem;
    }

    .var-row:last-child { border-bottom: none; }

    .var-id {
      font-weight: 700;
      color: #7c3aed;
      font-size: 0.78rem;
      min-width: 20px;
      flex-shrink: 0;
      padding-top: 1px;
    }

    .var-content {
      display: flex;
      flex-direction: column;
      gap: 2px;
      color: #3f3f46;
    }

    .var-note {
      font-style: italic;
      color: #71717a;
    }

    /* === Footer === */
    .doc-footer {
      margin-top: 56px;
      padding-top: 20px;
      border-top: 2px solid #e8e8ec;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .footer-brand {
      font-family: 'Syne', sans-serif;
      font-weight: 800;
      font-size: 0.9rem;
      color: #7c3aed;
    }

    .footer-meta {
      font-size: 0.72rem;
      color: #a1a1aa;
      text-align: right;
    }

    /* === Print === */
    @media print {
      html { font-size: 13px; }
      body { background: #fff; }
      .page { max-width: 100%; padding: 24px 20px; }
      .ref-image img { max-width: 100%; }
      .shot { page-break-inside: avoid; }
      .doc-footer {
        position: fixed;
        bottom: 0;
        left: 0;
        right: 0;
        padding: 8px 24px;
        border-top: 1px solid #ddd;
        background: #fff;
        font-size: 0.65rem;
      }
    }

    @media (max-width: 600px) {
      .page { padding: 24px 16px; }
      .cover-title { font-size: 1.6rem; }
      .overview { grid-template-columns: 1fr 1fr; }
    }
  </style>
</head>
<body>
  <div class="page">

    <!-- ===== COVER ===== -->
    <div class="cover">
      <div class="cover-top">
        <span class="logo">Chefly</span>
        <span class="cover-date">${today}</span>
      </div>
      <div class="doc-type">UGC Creator Brief</div>
      <h1 class="cover-title">${sanitize(brief.concept)}</h1>
      ${brief.inspired_by ? `<p class="inspired">Inspired by: ${sanitize(brief.inspired_by)}</p>` : ''}
    </div>

    <!-- ===== REFERENCE IMAGE ===== -->
    ${contactSheetUrl ? `
      <div class="ref-image">
        <img src="${sanitize(contactSheetUrl)}" alt="Reference \u2014 Contact Sheet" />
        <div class="ref-caption">Reference contact sheet from source video analysis</div>
      </div>
    ` : ''}

    <!-- ===== OVERVIEW ===== -->
    <div class="overview">
      ${brief.target_duration ? `<div class="ov-item"><span class="ov-label">Duration</span><span class="ov-value">${sanitize(brief.target_duration)}</span></div>` : ''}
      ${brief.tone ? `<div class="ov-item"><span class="ov-label">Tone</span><span class="ov-value">${sanitize(brief.tone)}</span></div>` : ''}
      ${brief.music_direction ? `<div class="ov-item"><span class="ov-label">Music</span><span class="ov-value">${sanitize(brief.music_direction)}</span></div>` : ''}
      ${brief.pacing_notes ? `<div class="ov-item"><span class="ov-label">Pacing</span><span class="ov-value">${sanitize(brief.pacing_notes)}</span></div>` : ''}
    </div>

    <!-- ===== PRODUCTION TIPS ===== -->
    ${brief.production_tips && brief.production_tips.length > 0 ? `
      <div class="section-block">
        <div class="section-title">Production Tips</div>
        <ol class="tips-list">
          ${brief.production_tips.map(tip => `<li>${sanitize(tip)}</li>`).join('')}
        </ol>
      </div>
    ` : ''}

    <!-- ===== SHOT LIST ===== -->
    <div class="section-block">
      <div class="section-title">Shot List \u2014 ${brief.shots?.length || 0} shots</div>

      ${(brief.shots || []).map(shot => `
        <div class="shot">
          <div class="shot-head">
            <span class="shot-num">Shot ${shot.shot_number}</span>
            <span class="shot-dur">${sanitize(shot.duration_estimate)}</span>
          </div>
          <table class="shot-table">
            <tr><td class="s-label">Framing</td><td>${sanitize(shot.framing)}</td></tr>
            <tr><td class="s-label">Action</td><td>${sanitize(shot.action)}</td></tr>
            <tr><td class="s-label">Script</td><td class="s-script">\u201c${sanitize(shot.script_line)}\u201d</td></tr>
            ${shot.text_overlay ? `<tr><td class="s-label">Overlay</td><td>${sanitize(shot.text_overlay)}</td></tr>` : ''}
            ${shot.notes ? `<tr><td class="s-label">Notes</td><td class="s-note">${sanitize(shot.notes)}</td></tr>` : ''}
          </table>
          ${renderVariations(shot.variations)}
        </div>
      `).join('')}
    </div>

    <!-- ===== FOOTER ===== -->
    <div class="doc-footer">
      <span class="footer-brand">Chefly \u2014 Big Tasty Productions</span>
      <div class="footer-meta">
        UGC Creator Brief<br>
        Generated ${today}
      </div>
    </div>

  </div>
</body>
</html>`;

  return html;
}
