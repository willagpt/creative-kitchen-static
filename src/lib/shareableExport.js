export function generateShareableHTML(analysis, shots, brief = null) {
  const {
    id,
    competitor_ad_id,
    video_url,
    duration_seconds,
    total_shots,
    total_cuts,
    avg_shot_duration,
    cuts_per_second,
    pacing_profile,
    transcript_text,
    ocr_text,
    combined_script,
    contact_sheet_url,
    ai_analysis,
    status,
    created_at,
    brand_name = 'Unknown',
    page_name = 'Unknown',
  } = analysis;

  const formatDate = (dateStr) => {
    if (!dateStr) return 'N/A';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-GB', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  const formatTime = (seconds) => {
    if (!seconds && seconds !== 0) return '0s';
    const mins = Math.floor(seconds / 60);
    const secs = (seconds % 60).toFixed(1);
    return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  };

  const sanitize = (text) => {
    if (!text) return '';
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  };

  // --- Section Renderers ---

  const renderMetricsTable = () => {
    const metrics = [
      { label: 'Duration', value: formatTime(duration_seconds) },
      { label: 'Total Shots', value: total_shots || '\u2014' },
      { label: 'Avg Shot Length', value: formatTime(avg_shot_duration) },
      { label: 'Cuts / Second', value: cuts_per_second ? cuts_per_second.toFixed(2) : '\u2014' },
      { label: 'Pacing Profile', value: pacing_profile ? pacing_profile.charAt(0).toUpperCase() + pacing_profile.slice(1) : '\u2014' },
    ];

    return `
      <div class="metrics-row">
        ${metrics.map(m => `
          <div class="metric">
            <span class="metric-value">${sanitize(String(m.value))}</span>
            <span class="metric-label">${sanitize(m.label)}</span>
          </div>
        `).join('')}
      </div>
    `;
  };

  const renderHook = () => {
    if (!ai_analysis?.hook) return '';
    const { text, type, effectiveness, effectiveness_score } = ai_analysis.hook;
    if (!text && !type) return '';

    return `
      <div class="subsection">
        <h3 class="subsection-title">Opening Hook</h3>
        <div class="hook-meta">
          ${type ? `<span class="tag">${sanitize(type)}</span>` : ''}
          ${effectiveness_score ? `<span class="tag tag-score">${effectiveness_score}/10 effectiveness</span>` : ''}
          ${effectiveness && !effectiveness_score ? `<span class="tag">${sanitize(effectiveness)} effectiveness</span>` : ''}
        </div>
        ${text ? `<p class="body-text">${sanitize(text)}</p>` : ''}
      </div>
    `;
  };

  const renderNarrativeArc = () => {
    if (!ai_analysis?.narrative_arc) return '';
    const { structure, beats } = ai_analysis.narrative_arc;
    if (!structure && (!beats || beats.length === 0)) return '';

    return `
      <div class="subsection">
        <h3 class="subsection-title">Narrative Arc</h3>
        ${structure ? `<p class="body-text"><strong>Structure:</strong> ${sanitize(structure)}</p>` : ''}
        ${beats && beats.length > 0 ? `
          <ol class="beat-list">
            ${beats.map(beat => {
              const label = typeof beat === 'string' ? beat : (beat.name || beat.phase || '');
              const desc = typeof beat === 'object' ? (beat.description || '') : '';
              return `<li><strong>${sanitize(label)}</strong>${desc ? ` — ${sanitize(desc)}` : ''}</li>`;
            }).join('')}
          </ol>
        ` : ''}
      </div>
    `;
  };

  const renderCTA = () => {
    if (!ai_analysis?.cta) return '';
    const { text, type, placement } = ai_analysis.cta;
    if (!text && !type) return '';

    return `
      <div class="subsection">
        <h3 class="subsection-title">Call-to-Action</h3>
        <div class="hook-meta">
          ${type ? `<span class="tag">${sanitize(type)}</span>` : ''}
          ${placement ? `<span class="tag tag-muted">${sanitize(placement)}</span>` : ''}
        </div>
        ${text ? `<p class="body-text">${sanitize(text)}</p>` : ''}
      </div>
    `;
  };

  const renderPillGroup = (title, items) => {
    if (!items || items.length === 0) return '';
    return `
      <div class="subsection">
        <h3 class="subsection-title">${sanitize(title)}</h3>
        <div class="pill-row">
          ${items.map(item => `<span class="pill">${sanitize(item)}</span>`).join('')}
        </div>
      </div>
    `;
  };

  const renderTargetAudience = () => {
    if (!ai_analysis?.target_audience) return '';
    const { primary, description, signals } = ai_analysis.target_audience;
    if (!primary && !description) return '';

    return `
      <div class="subsection">
        <h3 class="subsection-title">Target Audience</h3>
        ${primary ? `<p class="body-text"><strong>Primary:</strong> ${sanitize(primary)}</p>` : ''}
        ${description ? `<p class="body-text">${sanitize(description)}</p>` : ''}
        ${signals && signals.length > 0 ? `
          <div class="pill-row" style="margin-top:8px;">
            ${signals.map(s => `<span class="pill pill-muted">${sanitize(s)}</span>`).join('')}
          </div>
        ` : ''}
      </div>
    `;
  };

  const renderProductionStyle = () => {
    if (!ai_analysis?.production_style) return '';
    const ps = ai_analysis.production_style;
    const items = [
      { label: 'Format', value: ps.format },
      { label: 'Quality', value: ps.quality },
      { label: 'Music/Pacing', value: ps.music_pacing || ps.music },
      { label: 'Text Overlays', value: ps.text_overlays || ps.overlays },
    ].filter(i => i.value);
    if (items.length === 0) return '';

    return `
      <div class="subsection">
        <h3 class="subsection-title">Production Style</h3>
        <table class="data-table">
          ${items.map(i => `
            <tr>
              <td class="data-label">${sanitize(i.label)}</td>
              <td class="data-value">${sanitize(i.value)}</td>
            </tr>
          `).join('')}
        </table>
      </div>
    `;
  };

  const renderCompetitorInsights = () => {
    if (!ai_analysis?.competitor_insights) return '';
    const ci = ai_analysis.competitor_insights;

    const renderInsightCol = (title, items, accentClass) => {
      if (!items || (Array.isArray(items) && items.length === 0)) return '';
      const list = Array.isArray(items) ? items : [items];
      return `
        <div class="insight-col">
          <h4 class="insight-heading ${accentClass}">${sanitize(title)}</h4>
          <ul class="insight-list">
            ${list.map(item => `<li>${sanitize(item)}</li>`).join('')}
          </ul>
        </div>
      `;
    };

    const cols = [
      renderInsightCol('What Works', ci.what_works, 'accent-green'),
      renderInsightCol('What to Steal', ci.what_to_steal, 'accent-amber'),
      renderInsightCol('Weaknesses', ci.weaknesses, 'accent-red'),
    ].filter(Boolean);

    if (cols.length === 0) return '';

    return `
      <div class="subsection">
        <h3 class="subsection-title">Competitor Insights</h3>
        <div class="insight-grid">${cols.join('')}</div>
      </div>
    `;
  };

  const renderScript = () => {
    if (!combined_script) return '';
    const lines = combined_script.split('\n').filter(l => l.trim());
    return `
      <div class="script-block">
        ${lines.map(line => {
          const isVO = line.includes('VOICEOVER:');
          const isVisual = line.includes('VISUAL:') || line.includes('TEXT ON SCREEN:');
          const cls = isVO ? 'script-vo' : isVisual ? 'script-visual' : 'script-default';
          return `<div class="script-line ${cls}">${sanitize(line)}</div>`;
        }).join('')}
      </div>
    `;
  };

  const renderShotBreakdown = () => {
    if (!shots || shots.length === 0) return '';

    return `
      ${shots.map(shot => `
        <div class="shot-card">
          <div class="shot-header-row">
            <span class="shot-number">Shot ${shot.shot_number}</span>
            <span class="shot-timing">${formatTime(shot.start_time)} \u2013 ${formatTime(shot.end_time)} (${formatTime(shot.duration)})</span>
          </div>
          <div class="shot-body">
            ${shot.frame_url ? `<img class="shot-frame" src="${shot.frame_url}" alt="Shot ${shot.shot_number}" />` : ''}
            <div class="shot-details">
              ${shot.description ? `<p class="body-text">${sanitize(shot.description)}</p>` : ''}
              ${shot.ocr_text ? `<p class="shot-ocr"><strong>On-screen text:</strong> ${sanitize(shot.ocr_text)}</p>` : ''}
            </div>
          </div>
        </div>
      `).join('')}
    `;
  };

  // --- Brief Section (appended when brief data exists) ---
  const renderBriefSection = () => {
    if (!brief) return '';

    const renderVariations = (variations) => {
      if (!variations || variations.length === 0) return '';
      return `
        <div class="variations-block">
          <span class="variations-label">Variations</span>
          ${variations.map(v => `
            <div class="variation-row">
              <span class="variation-id">${sanitize(v.label)}</span>
              <div class="variation-details">
                ${v.framing ? `<span><strong>Framing:</strong> ${sanitize(v.framing)}</span>` : ''}
                ${v.action ? `<span><strong>Action:</strong> ${sanitize(v.action)}</span>` : ''}
                ${v.notes ? `<span class="variation-note">${sanitize(v.notes)}</span>` : ''}
              </div>
            </div>
          `).join('')}
        </div>
      `;
    };

    return `
      <!-- Page Break: Chefly UGC Brief -->
      <div class="page-break"></div>

      <div class="section-header brief-header">
        <div class="section-number">04</div>
        <div>
          <h2 class="section-heading">Chefly UGC Brief</h2>
          <p class="section-desc">Production-ready creator brief derived from this analysis</p>
        </div>
      </div>

      <div class="subsection">
        <h3 class="subsection-title">Creative Concept</h3>
        <p class="concept-text">${sanitize(brief.concept)}</p>
        ${brief.inspired_by ? `<p class="inspired-text">Inspired by: ${sanitize(brief.inspired_by)}</p>` : ''}
      </div>

      <div class="brief-overview">
        ${brief.target_duration ? `<div class="brief-meta-item"><span class="brief-meta-label">Duration</span><span class="brief-meta-value">${sanitize(brief.target_duration)}</span></div>` : ''}
        ${brief.tone ? `<div class="brief-meta-item"><span class="brief-meta-label">Tone</span><span class="brief-meta-value">${sanitize(brief.tone)}</span></div>` : ''}
        ${brief.music_direction ? `<div class="brief-meta-item"><span class="brief-meta-label">Music</span><span class="brief-meta-value">${sanitize(brief.music_direction)}</span></div>` : ''}
        ${brief.pacing_notes ? `<div class="brief-meta-item"><span class="brief-meta-label">Pacing</span><span class="brief-meta-value">${sanitize(brief.pacing_notes)}</span></div>` : ''}
      </div>

      ${brief.production_tips && brief.production_tips.length > 0 ? `
        <div class="subsection">
          <h3 class="subsection-title">Production Tips</h3>
          <ol class="tips-list">
            ${brief.production_tips.map(tip => `<li>${sanitize(tip)}</li>`).join('')}
          </ol>
        </div>
      ` : ''}

      <div class="subsection">
        <h3 class="subsection-title">Shot List (${brief.shots?.length || 0} shots)</h3>
        ${(brief.shots || []).map(shot => `
          <div class="brief-shot">
            <div class="brief-shot-head">
              <span class="brief-shot-num">Shot ${shot.shot_number}</span>
              <span class="brief-shot-dur">${sanitize(shot.duration_estimate)}</span>
            </div>
            <table class="brief-shot-table">
              <tr><td class="bst-label">Framing</td><td>${sanitize(shot.framing)}</td></tr>
              <tr><td class="bst-label">Action</td><td>${sanitize(shot.action)}</td></tr>
              <tr><td class="bst-label">Script</td><td class="bst-script">"${sanitize(shot.script_line)}"</td></tr>
              ${shot.text_overlay ? `<tr><td class="bst-label">Overlay</td><td>${sanitize(shot.text_overlay)}</td></tr>` : ''}
              ${shot.notes ? `<tr><td class="bst-label">Notes</td><td class="bst-note">${sanitize(shot.notes)}</td></tr>` : ''}
            </table>
            ${renderVariations(shot.variations)}
          </div>
        `).join('')}
      </div>
    `;
  };

  // --- Assemble the full document ---
  const reportDate = formatDate(created_at);
  const summary = ai_analysis?.one_line_summary || '';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Video Analysis \u2014 ${sanitize(brand_name)} \u2014 Chefly</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&family=Syne:wght@600;700;800&family=Instrument+Serif&display=swap" rel="stylesheet">
  <style>
    /* === Reset & Base === */
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

    /* === Page Container === */
    .page {
      max-width: 820px;
      margin: 0 auto;
      padding: 48px 40px;
    }

    /* === Cover / Title Block === */
    .cover {
      padding-bottom: 40px;
      margin-bottom: 40px;
      border-bottom: 2px solid #e8e8ec;
    }

    .cover-brand-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 32px;
    }

    .logo-text {
      font-family: 'Syne', sans-serif;
      font-weight: 800;
      font-size: 1.1rem;
      letter-spacing: -0.02em;
      color: #6366f1;
    }

    .cover-date {
      font-size: 0.8rem;
      color: #71717a;
      font-weight: 500;
    }

    .cover-label {
      font-size: 0.73rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: #6366f1;
      margin-bottom: 12px;
    }

    .cover-title {
      font-family: 'Syne', sans-serif;
      font-size: 2.4rem;
      font-weight: 700;
      line-height: 1.15;
      color: #111118;
      margin-bottom: 10px;
      letter-spacing: -0.02em;
    }

    .cover-subtitle {
      font-family: 'Instrument Serif', serif;
      font-size: 1.25rem;
      color: #52525b;
      line-height: 1.5;
      max-width: 600px;
    }

    .cover-meta {
      display: flex;
      gap: 24px;
      margin-top: 24px;
      font-size: 0.8rem;
      color: #71717a;
    }

    .cover-meta strong {
      color: #3f3f46;
    }

    /* === Metrics Row === */
    .metrics-row {
      display: flex;
      gap: 2px;
      margin-bottom: 48px;
      background: #f4f4f5;
      border-radius: 10px;
      overflow: hidden;
    }

    .metric {
      flex: 1;
      padding: 20px 16px;
      text-align: center;
      background: #fafafa;
    }

    .metric:first-child { border-radius: 10px 0 0 10px; }
    .metric:last-child { border-radius: 0 10px 10px 0; }

    .metric-value {
      display: block;
      font-family: 'Syne', sans-serif;
      font-size: 1.6rem;
      font-weight: 700;
      color: #111118;
      line-height: 1.2;
      margin-bottom: 4px;
    }

    .metric-label {
      display: block;
      font-size: 0.7rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: #71717a;
    }

    /* === Contact Sheet === */
    .contact-sheet {
      margin-bottom: 48px;
      border-radius: 8px;
      overflow: hidden;
      border: 1px solid #e4e4e7;
    }

    .contact-sheet img {
      width: 100%;
      height: auto;
      display: block;
    }

    /* === Section Headers === */
    .section-header {
      display: flex;
      align-items: flex-start;
      gap: 16px;
      margin-bottom: 32px;
      padding-top: 8px;
    }

    .section-number {
      font-family: 'Syne', sans-serif;
      font-size: 2rem;
      font-weight: 800;
      color: #e4e4e7;
      line-height: 1;
      min-width: 48px;
    }

    .section-heading {
      font-family: 'Syne', sans-serif;
      font-size: 1.5rem;
      font-weight: 700;
      color: #111118;
      letter-spacing: -0.01em;
      line-height: 1.2;
    }

    .section-desc {
      font-size: 0.87rem;
      color: #71717a;
      margin-top: 4px;
    }

    .brief-header .section-number { color: #c4b5fd; }
    .brief-header .section-heading { color: #6d28d9; }

    /* === Subsections === */
    .subsection {
      margin-bottom: 28px;
    }

    .subsection-title {
      font-family: 'Plus Jakarta Sans', sans-serif;
      font-size: 0.85rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: #6366f1;
      margin-bottom: 10px;
      padding-bottom: 6px;
      border-bottom: 1px solid #ededf0;
    }

    /* === Body Text === */
    .body-text {
      font-size: 0.93rem;
      color: #3f3f46;
      line-height: 1.65;
      margin-bottom: 8px;
    }

    /* === Tags / Pills === */
    .hook-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 12px;
    }

    .tag {
      display: inline-block;
      font-size: 0.73rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      padding: 4px 10px;
      border-radius: 4px;
      background: #eef2ff;
      color: #4f46e5;
    }

    .tag-score {
      background: #ecfdf5;
      color: #059669;
    }

    .tag-muted {
      background: #f4f4f5;
      color: #52525b;
    }

    .pill-row {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }

    .pill {
      font-size: 0.8rem;
      font-weight: 500;
      padding: 5px 12px;
      border-radius: 20px;
      background: #f0f0ff;
      color: #4338ca;
      border: 1px solid #e0e0f7;
    }

    .pill-muted {
      background: #f4f4f5;
      color: #52525b;
      border-color: #e4e4e7;
    }

    /* === Data Table === */
    .data-table {
      width: 100%;
      border-collapse: collapse;
    }

    .data-table tr { border-bottom: 1px solid #f0f0f2; }
    .data-table tr:last-child { border-bottom: none; }

    .data-label {
      font-size: 0.8rem;
      font-weight: 600;
      color: #71717a;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      padding: 8px 16px 8px 0;
      width: 140px;
      vertical-align: top;
    }

    .data-value {
      font-size: 0.9rem;
      color: #27272a;
      padding: 8px 0;
    }

    /* === Beat List === */
    .beat-list {
      padding-left: 20px;
      font-size: 0.9rem;
      color: #3f3f46;
      line-height: 1.7;
    }

    .beat-list li {
      margin-bottom: 6px;
    }

    .beat-list li::marker {
      color: #a5b4fc;
      font-weight: 700;
    }

    /* === Insight Grid === */
    .insight-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 20px;
    }

    .insight-col { }

    .insight-heading {
      font-size: 0.78rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      padding-bottom: 6px;
      margin-bottom: 10px;
      border-bottom: 2px solid currentColor;
    }

    .accent-green { color: #059669; }
    .accent-amber { color: #d97706; }
    .accent-red { color: #dc2626; }

    .insight-list {
      list-style: none;
      padding: 0;
    }

    .insight-list li {
      font-size: 0.87rem;
      color: #3f3f46;
      line-height: 1.55;
      padding: 6px 0 6px 12px;
      border-left: 2px solid #e4e4e7;
      margin-bottom: 6px;
    }

    /* === Script Block === */
    .script-block {
      background: #fafafa;
      border: 1px solid #e4e4e7;
      border-radius: 8px;
      padding: 20px 24px;
      font-size: 0.85rem;
      line-height: 1.8;
    }

    .script-line { padding: 2px 0; }
    .script-vo { color: #6d28d9; font-weight: 500; }
    .script-visual { color: #4f46e5; }
    .script-default { color: #52525b; }

    /* === Shot Breakdown === */
    .shot-card {
      border: 1px solid #e4e4e7;
      border-radius: 8px;
      margin-bottom: 16px;
      overflow: hidden;
      page-break-inside: avoid;
    }

    .shot-header-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 10px 16px;
      background: #f8f8fa;
      border-bottom: 1px solid #e4e4e7;
    }

    .shot-number {
      font-family: 'Syne', sans-serif;
      font-weight: 700;
      font-size: 0.85rem;
      color: #4f46e5;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .shot-timing {
      font-size: 0.78rem;
      color: #71717a;
      font-weight: 500;
    }

    .shot-body {
      display: flex;
      gap: 16px;
      padding: 14px 16px;
      align-items: flex-start;
    }

    .shot-frame {
      width: 140px;
      height: auto;
      border-radius: 4px;
      flex-shrink: 0;
      border: 1px solid #e4e4e7;
    }

    .shot-details {
      flex: 1;
    }

    .shot-ocr {
      font-size: 0.82rem;
      color: #6b7280;
      margin-top: 6px;
      padding: 6px 10px;
      background: #f9fafb;
      border-left: 2px solid #a5b4fc;
      border-radius: 2px;
    }

    /* === Brief-specific Styles === */
    .concept-text {
      font-family: 'Instrument Serif', serif;
      font-size: 1.4rem;
      color: #111118;
      line-height: 1.45;
      margin-bottom: 8px;
    }

    .inspired-text {
      font-size: 0.85rem;
      color: #71717a;
      font-style: italic;
    }

    .brief-overview {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 12px;
      margin-bottom: 28px;
    }

    .brief-meta-item {
      background: #faf5ff;
      border: 1px solid #ede9fe;
      border-radius: 8px;
      padding: 14px;
    }

    .brief-meta-label {
      display: block;
      font-size: 0.7rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #7c3aed;
      margin-bottom: 4px;
    }

    .brief-meta-value {
      display: block;
      font-size: 0.9rem;
      color: #3f3f46;
      font-weight: 500;
    }

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

    .brief-shot {
      border: 1px solid #e4e4e7;
      border-radius: 8px;
      margin-bottom: 16px;
      overflow: hidden;
      page-break-inside: avoid;
    }

    .brief-shot-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 10px 16px;
      background: #faf5ff;
      border-bottom: 1px solid #ede9fe;
    }

    .brief-shot-num {
      font-family: 'Syne', sans-serif;
      font-weight: 700;
      font-size: 0.85rem;
      color: #7c3aed;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .brief-shot-dur {
      font-size: 0.78rem;
      color: #7c3aed;
      font-weight: 600;
      background: #ede9fe;
      padding: 3px 8px;
      border-radius: 4px;
    }

    .brief-shot-table {
      width: 100%;
      border-collapse: collapse;
      padding: 0;
    }

    .brief-shot-table tr { border-bottom: 1px solid #f4f4f5; }
    .brief-shot-table tr:last-child { border-bottom: none; }

    .brief-shot-table td {
      padding: 8px 16px;
      font-size: 0.88rem;
      color: #27272a;
      vertical-align: top;
    }

    .bst-label {
      font-size: 0.73rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: #71717a;
      width: 80px;
    }

    .bst-script {
      color: #6d28d9;
      font-style: italic;
      font-weight: 500;
    }

    .bst-note {
      color: #71717a;
      font-style: italic;
    }

    .variations-block {
      padding: 12px 16px;
      border-top: 1px solid #f0f0f2;
      background: #fcfcfd;
    }

    .variations-label {
      display: block;
      font-size: 0.7rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: #7c3aed;
      margin-bottom: 10px;
    }

    .variation-row {
      display: flex;
      gap: 12px;
      align-items: flex-start;
      padding: 6px 0;
      border-bottom: 1px solid #f4f4f5;
      font-size: 0.85rem;
    }

    .variation-row:last-child { border-bottom: none; }

    .variation-id {
      font-weight: 700;
      color: #7c3aed;
      font-size: 0.78rem;
      min-width: 20px;
      flex-shrink: 0;
      padding-top: 1px;
    }

    .variation-details {
      display: flex;
      flex-direction: column;
      gap: 2px;
      color: #3f3f46;
    }

    .variation-note {
      font-style: italic;
      color: #71717a;
    }

    /* === Footer === */
    .report-footer {
      margin-top: 60px;
      padding-top: 24px;
      border-top: 2px solid #e8e8ec;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .footer-brand {
      font-family: 'Syne', sans-serif;
      font-weight: 800;
      font-size: 0.9rem;
      color: #6366f1;
    }

    .footer-meta {
      font-size: 0.72rem;
      color: #a1a1aa;
      text-align: right;
    }

    /* === Page Break Utility === */
    .page-break {
      page-break-before: always;
      height: 0;
      margin: 0;
      padding: 0;
    }

    /* === Divider === */
    .section-divider {
      border: none;
      border-top: 1px solid #e8e8ec;
      margin: 48px 0 8px 0;
    }

    /* === Print Styles === */
    @media print {
      html { font-size: 13px; }

      body {
        background: #fff;
        color: #1e1e2a;
      }

      .page {
        max-width: 100%;
        padding: 24px 20px;
      }

      .contact-sheet img,
      .shot-frame {
        max-width: 100%;
      }

      .metrics-row {
        border: 1px solid #ddd;
      }

      .metric {
        background: #f9f9fb;
      }

      .shot-card,
      .brief-shot {
        page-break-inside: avoid;
      }

      .page-break {
        page-break-before: always;
      }

      .section-header {
        page-break-after: avoid;
      }

      .subsection {
        page-break-inside: avoid;
      }

      .report-footer {
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
      .cover-title { font-size: 1.8rem; }
      .metrics-row { flex-wrap: wrap; }
      .metric { flex: 1 0 45%; }
      .shot-body { flex-direction: column; }
      .shot-frame { width: 100%; }
      .insight-grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="page">

    <!-- ===== COVER ===== -->
    <div class="cover">
      <div class="cover-brand-bar">
        <span class="logo-text">Chefly</span>
        <span class="cover-date">${reportDate}</span>
      </div>
      <div class="cover-label">Video Analysis Report</div>
      <h1 class="cover-title">${sanitize(brand_name)} \u2014 Competitor Creative Analysis</h1>
      ${summary ? `<p class="cover-subtitle">${sanitize(summary)}</p>` : ''}
      <div class="cover-meta">
        <span><strong>Brand:</strong> ${sanitize(brand_name)}</span>
        ${page_name && page_name !== 'Unknown' ? `<span><strong>Page:</strong> ${sanitize(page_name)}</span>` : ''}
        <span><strong>Status:</strong> ${sanitize(status || 'Complete')}</span>
      </div>
    </div>

    <!-- ===== KEY METRICS ===== -->
    ${renderMetricsTable()}

    <!-- ===== CONTACT SHEET ===== -->
    ${contact_sheet_url ? `
      <div class="contact-sheet">
        <img src="${contact_sheet_url}" alt="Contact Sheet \u2014 Visual Timeline" />
      </div>
    ` : ''}

    <!-- ===== SECTION 1: CREATIVE ANALYSIS ===== -->
    <div class="section-header">
      <div class="section-number">01</div>
      <div>
        <h2 class="section-heading">Creative Analysis</h2>
        <p class="section-desc">AI-generated insights on hook, narrative, audience, and production</p>
      </div>
    </div>

    ${renderHook()}
    ${renderNarrativeArc()}
    ${renderCTA()}
    ${renderPillGroup('Selling Points', ai_analysis?.selling_points)}
    ${renderPillGroup('Emotional Drivers', ai_analysis?.emotional_drivers)}
    ${renderTargetAudience()}
    ${renderProductionStyle()}
    ${renderCompetitorInsights()}

    <!-- ===== SECTION 2: SCRIPT ===== -->
    <hr class="section-divider" />
    <div class="section-header">
      <div class="section-number">02</div>
      <div>
        <h2 class="section-heading">Script Timeline</h2>
        <p class="section-desc">Combined voiceover, visual cues, and on-screen text</p>
      </div>
    </div>

    ${renderScript()}

    <!-- ===== SECTION 3: SHOT BREAKDOWN ===== -->
    <div class="page-break"></div>
    <div class="section-header">
      <div class="section-number">03</div>
      <div>
        <h2 class="section-heading">Shot-by-Shot Breakdown</h2>
        <p class="section-desc">${total_shots || 0} shots analysed with reference frames</p>
      </div>
    </div>

    ${renderShotBreakdown()}

    <!-- ===== SECTION 4: CHEFLY BRIEF (optional) ===== -->
    ${renderBriefSection()}

    <!-- ===== FOOTER ===== -->
    <div class="report-footer">
      <span class="footer-brand">Chefly \u2014 Big Tasty Productions</span>
      <div class="footer-meta">
        Report ID: ${sanitize(id || 'N/A')}<br>
        Generated ${formatDate(new Date().toISOString())}
      </div>
    </div>

  </div>
</body>
</html>`;

  return html;
}
