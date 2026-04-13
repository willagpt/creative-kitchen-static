// Standalone UGC brief export — generates a clean HTML document for sharing or print-to-PDF

export function generateBriefHTML(brief, brandName = 'Chefly') {
  const sanitize = (text) => {
    if (!text) return ''
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  }

  const renderVariations = (variations) => {
    if (!variations || variations.length === 0) return ''
    return `
      <div style="margin-top: 12px; display: flex; flex-direction: column; gap: 8px;">
        <div style="font-size: 11px; font-weight: 600; color: #a855f7; text-transform: uppercase; letter-spacing: 0.5px;">Variations</div>
        ${variations.map(v => `
          <div style="background: #131318; border: 1px solid #2a2a34; border-radius: 6px; padding: 10px 12px;">
            <div style="font-size: 11px; font-weight: 700; color: #a855f7; margin-bottom: 6px;">Variation ${sanitize(v.label)}</div>
            <div style="display: flex; flex-direction: column; gap: 4px; font-size: 13px;">
              ${v.framing ? `<div><span style="color: #71717a; font-size: 11px; text-transform: uppercase; margin-right: 8px;">Framing</span> <span style="color: #e4e4e7;">${sanitize(v.framing)}</span></div>` : ''}
              ${v.action ? `<div><span style="color: #71717a; font-size: 11px; text-transform: uppercase; margin-right: 8px;">Action</span> <span style="color: #e4e4e7;">${sanitize(v.action)}</span></div>` : ''}
              ${v.notes ? `<div><span style="color: #71717a; font-size: 11px; text-transform: uppercase; margin-right: 8px;">Notes</span> <span style="color: #a0a0b0; font-style: italic;">${sanitize(v.notes)}</span></div>` : ''}
            </div>
          </div>
        `).join('')}
      </div>
    `
  }

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Chefly UGC Brief — ${sanitize(brief.concept || 'Production Brief')}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body {
      background: #0e0e11;
      color: #e4e4e7;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      -webkit-font-smoothing: antialiased;
    }
    .container { max-width: 800px; margin: 0 auto; padding: 40px 24px; }
    header { margin-bottom: 40px; padding-bottom: 24px; border-bottom: 1px solid #2a2a34; }
    .brand-tag {
      display: inline-block;
      font-size: 11px; font-weight: 700; text-transform: uppercase;
      letter-spacing: 1px; color: #6366f1; margin-bottom: 12px;
    }
    h1 { font-size: 28px; font-weight: 700; color: #fff; margin-bottom: 8px; line-height: 1.3; }
    .inspired { font-size: 14px; color: #71717a; font-style: italic; }
    .overview-grid {
      display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 12px; margin-bottom: 32px;
    }
    .overview-item { background: #1a1a22; border: 1px solid #2a2a34; border-radius: 8px; padding: 14px; }
    .overview-label { font-size: 11px; color: #71717a; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px; }
    .overview-value { font-size: 14px; color: #e4e4e7; font-weight: 500; }
    .section-title { font-size: 16px; font-weight: 700; color: #fff; margin-bottom: 16px; padding-bottom: 8px; border-bottom: 1px solid #2a2a34; }
    .tip {
      padding: 10px 14px; background: #1a1a22; border: 1px solid #2a2a34;
      border-left: 3px solid #6366f1; border-radius: 8px;
      font-size: 14px; color: #a0a0b0; line-height: 1.5; margin-bottom: 8px;
    }
    .shot { background: #1a1a22; border: 1px solid #2a2a34; border-radius: 12px; overflow: hidden; margin-bottom: 16px; }
    .shot-header {
      display: flex; justify-content: space-between; align-items: center;
      padding: 10px 14px; background: #131318; border-bottom: 1px solid #2a2a34;
    }
    .shot-number { font-size: 14px; font-weight: 700; color: #6366f1; text-transform: uppercase; letter-spacing: 0.5px; }
    .shot-duration { font-size: 12px; font-weight: 600; color: #a855f7; background: #a855f720; padding: 3px 8px; border-radius: 4px; }
    .shot-body { padding: 14px; display: flex; flex-direction: column; gap: 10px; }
    .shot-row { display: flex; gap: 12px; align-items: flex-start; }
    .shot-label { min-width: 80px; font-size: 11px; font-weight: 600; color: #71717a; text-transform: uppercase; letter-spacing: 0.5px; padding-top: 2px; flex-shrink: 0; }
    .shot-value { font-size: 14px; color: #e4e4e7; line-height: 1.5; }
    .script-line { color: #6366f1; font-style: italic; font-weight: 500; }
    .note-text { color: #71717a; font-style: italic; }
    footer { text-align: center; padding-top: 24px; border-top: 1px solid #2a2a34; margin-top: 48px; color: #71717a; font-size: 12px; }
    @media print {
      body { background: #fff; color: #000; }
      .container { max-width: 100%; padding: 20px; }
      h1, .section-title { color: #000; }
      .brand-tag, .shot-number { color: #4f46e5; }
      .shot, .overview-item, .tip { border-color: #ddd; background: #f9f9f9; }
      .shot-header { background: #eee; border-color: #ddd; }
      .shot-value, .overview-value { color: #333; }
      .shot-label, .overview-label, .inspired { color: #666; }
      .script-line { color: #4f46e5; }
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div class="brand-tag">Chefly UGC Brief</div>
      <h1>${sanitize(brief.concept)}</h1>
      ${brief.inspired_by ? `<p class="inspired">Inspired by: ${sanitize(brief.inspired_by)}</p>` : ''}
    </header>

    <div class="overview-grid">
      ${brief.target_duration ? `<div class="overview-item"><div class="overview-label">Duration</div><div class="overview-value">${sanitize(brief.target_duration)}</div></div>` : ''}
      ${brief.tone ? `<div class="overview-item"><div class="overview-label">Tone</div><div class="overview-value">${sanitize(brief.tone)}</div></div>` : ''}
      ${brief.music_direction ? `<div class="overview-item"><div class="overview-label">Music</div><div class="overview-value">${sanitize(brief.music_direction)}</div></div>` : ''}
      ${brief.pacing_notes ? `<div class="overview-item"><div class="overview-label">Pacing</div><div class="overview-value">${sanitize(brief.pacing_notes)}</div></div>` : ''}
    </div>

    ${brief.production_tips && brief.production_tips.length > 0 ? `
      <div class="section-title">Production Tips</div>
      <div style="margin-bottom: 32px;">
        ${brief.production_tips.map(tip => `<div class="tip">${sanitize(tip)}</div>`).join('')}
      </div>
    ` : ''}

    <div class="section-title">Shot List (${brief.shots?.length || 0} shots)</div>
    ${(brief.shots || []).map(shot => `
      <div class="shot">
        <div class="shot-header">
          <span class="shot-number">Shot ${shot.shot_number}</span>
          <span class="shot-duration">${sanitize(shot.duration_estimate)}</span>
        </div>
        <div class="shot-body">
          <div class="shot-row"><span class="shot-label">Framing</span><span class="shot-value">${sanitize(shot.framing)}</span></div>
          <div class="shot-row"><span class="shot-label">Action</span><span class="shot-value">${sanitize(shot.action)}</span></div>
          <div class="shot-row"><span class="shot-label">Script</span><span class="shot-value script-line">"${sanitize(shot.script_line)}"</span></div>
          ${shot.text_overlay ? `<div class="shot-row"><span class="shot-label">Overlay</span><span class="shot-value">${sanitize(shot.text_overlay)}</span></div>` : ''}
          ${shot.notes ? `<div class="shot-row"><span class="shot-label">Notes</span><span class="shot-value note-text">${sanitize(shot.notes)}</span></div>` : ''}
          ${renderVariations(shot.variations)}
        </div>
      </div>
    `).join('')}

    <footer>
      <p>Chefly UGC Brief — Generated ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
    </footer>
  </div>
</body>
</html>`

  return html
}
