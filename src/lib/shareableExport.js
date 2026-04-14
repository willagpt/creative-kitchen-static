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
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const formatTime = (seconds) => {
    if (!seconds && seconds !== 0) return '0s';
    const mins = Math.floor(seconds / 60);
    const secs = (seconds % 60).toFixed(1);
    return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  };

  const sanitizeHTML = (text) => {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  };

  const renderMetricsBar = () => {
    const metrics = [
      { label: 'Duration', value: formatTime(duration_seconds) },
      { label: 'Total Shots', value: total_shots || '\u2014' },
      { label: 'Avg Shot Length', value: formatTime(avg_shot_duration) },
      { label: 'Cuts/Second', value: cuts_per_second ? cuts_per_second.toFixed(2) : '\u2014' },
      { label: 'Pacing', value: pacing_profile ? pacing_profile.charAt(0).toUpperCase() + pacing_profile.slice(1) : '\u2014' },
    ];

    return `
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; margin-bottom: 32px;">
        ${metrics
          .map(
            (m) => `
          <div style="background: #1a1a22; border: 1px solid #2a2a34; border-radius: 8px; padding: 16px; text-align: center;">
            <div style="font-size: 12px; color: #8a8a92; font-weight: 500; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px;">${sanitizeHTML(m.label)}</div>
            <div style="font-size: 24px; font-weight: 600; color: #ffffff;">${sanitizeHTML(String(m.value))}</div>
          </div>
        `
          )
          .join('')}
      </div>
    `;
  };

  const renderHook = () => {
    if (!ai_analysis?.hook) return '';
    const { text, type, effectiveness } = ai_analysis.hook;
    const effectColor =
      effectiveness === 'high'
        ? '#10b981'
        : effectiveness === 'medium'
          ? '#f59e0b'
          : '#ef4444';

    return `
      <div style="background: #1a1a22; border: 1px solid #2a2a34; border-radius: 8px; padding: 20px; margin-bottom: 20px;">
        <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 12px;">
          <span style="font-size: 12px; font-weight: 600; text-transform: uppercase; color: #6366f1; letter-spacing: 0.5px;">Hook</span>
          <span style="font-size: 11px; background: ${effectColor}; color: white; padding: 4px 8px; border-radius: 4px; font-weight: 500;">${sanitizeHTML(type || 'Unknown')}</span>
          <span style="font-size: 11px; color: ${effectColor}; font-weight: 500; margin-left: auto;">Effectiveness: ${sanitizeHTML(effectiveness || 'Unknown')}</span>
        </div>
        <p style="font-size: 14px; line-height: 1.6; color: #d1d1db; margin: 0;">${sanitizeHTML(text || '\u2014')}</p>
      </div>
    `;
  };

  const renderNarrativeArc = () => {
    if (!ai_analysis?.narrative_arc) return '';
    const { structure, beats } = ai_analysis.narrative_arc;

    const beatHTML = beats
      ?.map(
        (beat) => `
        <div style="background: #2a2a34; padding: 12px; border-radius: 6px; border-left: 3px solid #a855f7;">
          <div style="font-size: 12px; font-weight: 600; color: #a855f7; margin-bottom: 4px;">${sanitizeHTML(beat.name || 'Unknown')}</div>
          <div style="font-size: 13px; color: #a1a1ab;">${sanitizeHTML(beat.description || '\u2014')}</div>
        </div>
      `
      )
      .join('');

    return `
      <div style="background: #1a1a22; border: 1px solid #2a2a34; border-radius: 8px; padding: 20px; margin-bottom: 20px;">
        <div style="font-size: 12px; font-weight: 600; text-transform: uppercase; color: #6366f1; letter-spacing: 0.5px; margin-bottom: 16px;">Narrative Arc</div>
        <div style="background: #0e0e11; padding: 12px; border-radius: 6px; margin-bottom: 16px;">
          <div style="font-size: 13px; color: #d1d1db;"><strong>Structure:</strong> ${sanitizeHTML(structure || '\u2014')}</div>
        </div>
        <div style="display: grid; gap: 12px;">
          ${beatHTML || '<div style="color: #8a8a92;">No beats available</div>'}
        </div>
      </div>
    `;
  };

  const renderCTA = () => {
    if (!ai_analysis?.cta) return '';
    const { text, type, placement } = ai_analysis.cta;

    return `
      <div style="background: #1a1a22; border: 1px solid #2a2a34; border-radius: 8px; padding: 20px; margin-bottom: 20px;">
        <div style="font-size: 12px; font-weight: 600; text-transform: uppercase; color: #6366f1; letter-spacing: 0.5px; margin-bottom: 12px;">Call-to-Action</div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px;">
          <div>
            <div style="font-size: 11px; color: #8a8a92; margin-bottom: 4px;">Type</div>
            <div style="font-size: 14px; color: #ffffff; font-weight: 500;">${sanitizeHTML(type || '\u2014')}</div>
          </div>
          <div>
            <div style="font-size: 11px; color: #8a8a92; margin-bottom: 4px;">Placement</div>
            <div style="font-size: 14px; color: #ffffff; font-weight: 500;">${sanitizeHTML(placement || '\u2014')}</div>
          </div>
        </div>
        <p style="font-size: 14px; line-height: 1.6; color: #d1d1db; margin: 0;"><strong>Message:</strong> ${sanitizeHTML(text || '\u2014')}</p>
      </div>
    `;
  };

  const renderPills = (title, items, colorClass = 'indigo') => {
    if (!items || items.length === 0) return '';
    const bgColor = colorClass === 'purple' ? '#a855f7' : '#6366f1';
    const bgOpacity = 'rgba(99, 102, 241, 0.1)';

    return `
      <div style="margin-bottom: 20px;">
        <div style="font-size: 12px; font-weight: 600; text-transform: uppercase; color: #8a8a92; letter-spacing: 0.5px; margin-bottom: 12px;">${sanitizeHTML(title)}</div>
        <div style="display: flex; flex-wrap: wrap; gap: 8px;">
          ${items
            .map(
              (item) => `
            <span style="background: ${bgOpacity}; color: ${bgColor}; padding: 6px 12px; border-radius: 16px; font-size: 12px; font-weight: 500; border: 1px solid ${bgColor}40;">
              ${sanitizeHTML(item)}
            </span>
          `
            )
            .join('')}
        </div>
      </div>
    `;
  };

  const renderSellingPoints = () => {
    return renderPills('Selling Points', ai_analysis?.selling_points || [], 'indigo');
  };

  const renderEmotionalDrivers = () => {
    return renderPills('Emotional Drivers', ai_analysis?.emotional_drivers || [], 'purple');
  };

  const renderTargetAudience = () => {
    if (!ai_analysis?.target_audience) return '';
    const { primary, signals } = ai_analysis.target_audience;

    return `
      <div style="background: #1a1a22; border: 1px solid #2a2a34; border-radius: 8px; padding: 20px; margin-bottom: 20px;">
        <div style="font-size: 12px; font-weight: 600; text-transform: uppercase; color: #6366f1; letter-spacing: 0.5px; margin-bottom: 12px;">Target Audience</div>
        <div style="background: #0e0e11; padding: 12px; border-radius: 6px; margin-bottom: 12px;">
          <div style="font-size: 13px; color: #d1d1db;"><strong>Primary:</strong> ${sanitizeHTML(primary || '\u2014')}</div>
        </div>
        ${signals && signals.length > 0 ? `<div style="font-size: 12px; font-weight: 500; color: #8a8a92; margin-bottom: 8px;">Signals</div><div style="display: flex; flex-wrap: wrap; gap: 6px;">${signals.map((s) => `<span style="background: #2a2a34; color: #a1a1ab; padding: 4px 8px; border-radius: 4px; font-size: 12px;">${sanitizeHTML(s)}</span>`).join('')}</div>` : ''}
      </div>
    `;
  };

  const renderProductionStyle = () => {
    if (!ai_analysis?.production_style) return '';
    const { format, quality, music_pacing, text_overlays } = ai_analysis.production_style;

    const styleItems = [
      { label: 'Format', value: format },
      { label: 'Quality', value: quality },
      { label: 'Music Pacing', value: music_pacing },
      { label: 'Text Overlays', value: text_overlays },
    ];

    return `
      <div style="background: #1a1a22; border: 1px solid #2a2a34; border-radius: 8px; padding: 20px; margin-bottom: 20px;">
        <div style="font-size: 12px; font-weight: 600; text-transform: uppercase; color: #6366f1; letter-spacing: 0.5px; margin-bottom: 16px;">Production Style</div>
        <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px;">
          ${styleItems
            .map(
              (item) => `
            <div>
              <div style="font-size: 11px; color: #8a8a92; margin-bottom: 4px;">${sanitizeHTML(item.label)}</div>
              <div style="font-size: 13px; color: #d1d1db; font-weight: 500;">${sanitizeHTML(item.value || '\u2014')}</div>
            </div>
          `
            )
            .join('')}
        </div>
      </div>
    `;
  };

  const renderCompetitorInsights = () => {
    if (!ai_analysis?.competitor_insights) return '';
    const { what_works, what_to_steal, weaknesses } = ai_analysis.competitor_insights;

    const renderInsightSection = (title, items, bgColor) => {
      if (!items || items.length === 0) return '';
      return `
        <div>
          <div style="font-size: 12px; font-weight: 600; color: #ffffff; margin-bottom: 12px; padding-bottom: 8px; border-bottom: 2px solid ${bgColor};">${sanitizeHTML(title)}</div>
          <div style="display: grid; gap: 8px;">
            ${items
              .map(
                (item) => `
              <div style="background: ${bgColor}15; border-left: 3px solid ${bgColor}; padding: 10px; border-radius: 4px; font-size: 13px; color: #d1d1db; line-height: 1.5;">
                ${sanitizeHTML(item)}
              </div>
            `
              )
              .join('')}
          </div>
        </div>
      `;
    };

    return `
      <div style="background: #1a1a22; border: 1px solid #2a2a34; border-radius: 8px; padding: 20px; margin-bottom: 20px;">
        <div style="font-size: 12px; font-weight: 600; text-transform: uppercase; color: #6366f1; letter-spacing: 0.5px; margin-bottom: 20px;">Competitor Insights</div>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 20px;">
          ${renderInsightSection('What Works', what_works, '#10b981')}
          ${renderInsightSection('What to Steal', what_to_steal, '#f59e0b')}
          ${renderInsightSection('Weaknesses', weaknesses, '#ef4444')}
        </div>
      </div>
    `;
  };

  const renderCombinedScript = () => {
    if (!combined_script) return '';

    const lines = combined_script.split('\n').filter((line) => line.trim());
    return `
      <div style="background: #1a1a22; border: 1px solid #2a2a34; border-radius: 8px; padding: 20px; margin-bottom: 20px; overflow-x: auto;">
        <div style="font-size: 12px; font-weight: 600; text-transform: uppercase; color: #6366f1; letter-spacing: 0.5px; margin-bottom: 16px;">Combined Script</div>
        <div style="background: #0e0e11; border-radius: 6px; padding: 16px; font-family: 'Monaco', 'Menlo', monospace; font-size: 12px; line-height: 1.8;">
          ${lines
            .map((line) => {
              const isVoiceover = line.includes('VOICEOVER:');
              const isVisual = line.includes('VISUAL:');
              const color = isVoiceover ? '#a855f7' : isVisual ? '#6366f1' : '#a1a1ab';
              return `<div style="color: ${color};">${sanitizeHTML(line)}</div>`;
            })
            .join('')}
        </div>
      </div>
    `;
  };

  const renderShotBreakdown = () => {
    if (!shots || shots.length === 0) return '';

    return `
      <div style="background: #1a1a22; border: 1px solid #2a2a34; border-radius: 8px; padding: 20px; margin-bottom: 20px;">
        <div style="font-size: 12px; font-weight: 600; text-transform: uppercase; color: #6366f1; letter-spacing: 0.5px; margin-bottom: 20px;">Shot-by-Shot Breakdown</div>
        <div style="display: grid; gap: 16px;">
          ${shots
            .map(
              (shot) => `
            <div style="border: 1px solid #2a2a34; border-radius: 6px; overflow: hidden;">
              <div style="display: grid; grid-template-columns: 160px 1fr; gap: 16px; padding: 16px; align-items: start;">
                ${shot.frame_url ? `<img src="${shot.frame_url}" alt="Shot ${shot.shot_number}" style="width: 160px; height: auto; object-fit: contain; border-radius: 4px; background: #0e0e11;">` : '<div style="width: 160px; height: 100px; background: #2a2a34; border-radius: 4px; display: flex; align-items: center; justify-content: center; color: #8a8a92; font-size: 12px;">No Frame</div>'}
                <div>
                  <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 8px;">
                    <span style="font-weight: 600; color: #ffffff;">Shot ${shot.shot_number}</span>
                    <span style="font-size: 12px; background: #2a2a34; color: #a1a1ab; padding: 4px 8px; border-radius: 4px;">${formatTime(shot.duration)}</span>
                    <span style="font-size: 11px; color: #8a8a92;">${formatTime(shot.start_time)} \u2014 ${formatTime(shot.end_time)}</span>
                  </div>
                  ${shot.description ? `<div style="font-size: 13px; color: #d1d1db; margin-bottom: 8px; line-height: 1.5;"><strong>Description:</strong> ${sanitizeHTML(shot.description)}</div>` : ''}
                  ${shot.ocr_text ? `<div style="font-size: 12px; color: #a1a1ab; background: #0e0e11; padding: 8px; border-radius: 4px; border-left: 2px solid #6366f1;"><strong>OCR:</strong> ${sanitizeHTML(shot.ocr_text)}</div>` : ''}
                </div>
              </div>
            </div>
          `
            )
            .join('')}
        </div>
      </div>
    `;
  };

  // NEW: Render Chefly UGC Brief section if brief data is provided
  const renderBriefSection = () => {
    if (!brief) return '';

    const renderBriefVariations = (variations) => {
      if (!variations || variations.length === 0) return '';
      return `
        <div style="margin-top: 12px;">
          <div style="font-size: 11px; font-weight: 600; color: #a855f7; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px;">Variations</div>
          ${variations.map(v => `
            <div style="background: #131318; border: 1px solid #2a2a34; border-radius: 6px; padding: 10px 12px; margin-bottom: 6px;">
              <div style="font-size: 11px; font-weight: 700; color: #a855f7; margin-bottom: 6px;">Variation ${sanitizeHTML(v.label)}</div>
              <div style="display: flex; flex-direction: column; gap: 4px; font-size: 13px;">
                ${v.framing ? `<div><span style="color: #71717a; font-size: 11px; text-transform: uppercase; margin-right: 8px;">Framing</span> <span style="color: #e4e4e7;">${sanitizeHTML(v.framing)}</span></div>` : ''}
                ${v.action ? `<div><span style="color: #71717a; font-size: 11px; text-transform: uppercase; margin-right: 8px;">Action</span> <span style="color: #e4e4e7;">${sanitizeHTML(v.action)}</span></div>` : ''}
                ${v.notes ? `<div><span style="color: #71717a; font-size: 11px; text-transform: uppercase; margin-right: 8px;">Notes</span> <span style="color: #a0a0b0; font-style: italic;">${sanitizeHTML(v.notes)}</span></div>` : ''}
              </div>
            </div>
          `).join('')}
        </div>
      `;
    };

    return `
    <!-- Chefly UGC Brief -->
    <div class="section-title" style="border-bottom-color: #a855f7;">Chefly UGC Brief</div>
    <div class="section-content">
      <!-- Concept -->
      <div style="background: #1a1a22; border: 1px solid #2a2a34; border-radius: 8px; padding: 20px; margin-bottom: 20px;">
        <div style="font-size: 12px; font-weight: 600; text-transform: uppercase; color: #a855f7; letter-spacing: 0.5px; margin-bottom: 12px;">Creative Concept</div>
        <p style="font-size: 18px; font-weight: 600; color: #ffffff; margin: 0 0 8px 0; line-height: 1.4;">${sanitizeHTML(brief.concept)}</p>
        ${brief.inspired_by ? `<p style="font-size: 13px; color: #71717a; font-style: italic; margin: 0;">Inspired by: ${sanitizeHTML(brief.inspired_by)}</p>` : ''}
      </div>

      <!-- Overview Grid -->
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-bottom: 20px;">
        ${brief.target_duration ? `<div style="background: #1a1a22; border: 1px solid #2a2a34; border-radius: 8px; padding: 14px;"><div style="font-size: 11px; color: #71717a; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px;">Duration</div><div style="font-size: 14px; color: #e4e4e7; font-weight: 500;">${sanitizeHTML(brief.target_duration)}</div></div>` : ''}
        ${brief.tone ? `<div style="background: #1a1a22; border: 1px solid #2a2a34; border-radius: 8px; padding: 14px;"><div style="font-size: 11px; color: #71717a; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px;">Tone</div><div style="font-size: 14px; color: #e4e4e7; font-weight: 500;">${sanitizeHTML(brief.tone)}</div></div>` : ''}
        ${brief.music_direction ? `<div style="background: #1a1a22; border: 1px solid #2a2a34; border-radius: 8px; padding: 14px;"><div style="font-size: 11px; color: #71717a; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px;">Music</div><div style="font-size: 14px; color: #e4e4e7; font-weight: 500;">${sanitizeHTML(brief.music_direction)}</div></div>` : ''}
        ${brief.pacing_notes ? `<div style="background: #1a1a22; border: 1px solid #2a2a34; border-radius: 8px; padding: 14px;"><div style="font-size: 11px; color: #71717a; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px;">Pacing</div><div style="font-size: 14px; color: #e4e4e7; font-weight: 500;">${sanitizeHTML(brief.pacing_notes)}</div></div>` : ''}
      </div>

      <!-- Production Tips -->
      ${brief.production_tips && brief.production_tips.length > 0 ? `
        <div style="background: #1a1a22; border: 1px solid #2a2a34; border-radius: 8px; padding: 20px; margin-bottom: 20px;">
          <div style="font-size: 12px; font-weight: 600; text-transform: uppercase; color: #a855f7; letter-spacing: 0.5px; margin-bottom: 12px;">Production Tips</div>
          ${brief.production_tips.map(tip => `
            <div style="padding: 10px 14px; background: #0e0e11; border-left: 3px solid #a855f7; border-radius: 4px; font-size: 13px; color: #a1a1ab; line-height: 1.5; margin-bottom: 8px;">${sanitizeHTML(tip)}</div>
          `).join('')}
        </div>
      ` : ''}

      <!-- Shot List -->
      <div style="background: #1a1a22; border: 1px solid #2a2a34; border-radius: 8px; padding: 20px; margin-bottom: 20px;">
        <div style="font-size: 12px; font-weight: 600; text-transform: uppercase; color: #a855f7; letter-spacing: 0.5px; margin-bottom: 20px;">Shot List (${brief.shots?.length || 0} shots)</div>
        ${(brief.shots || []).map(shot => `
          <div style="border: 1px solid #2a2a34; border-radius: 8px; overflow: hidden; margin-bottom: 12px;">
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; background: #131318; border-bottom: 1px solid #2a2a34;">
              <span style="font-size: 14px; font-weight: 700; color: #a855f7; text-transform: uppercase; letter-spacing: 0.5px;">Shot ${shot.shot_number}</span>
              <span style="font-size: 12px; font-weight: 600; color: #a855f7; background: rgba(168, 85, 247, 0.12); padding: 3px 8px; border-radius: 4px;">${sanitizeHTML(shot.duration_estimate)}</span>
            </div>
            <div style="padding: 14px; display: flex; flex-direction: column; gap: 8px;">
              <div style="display: flex; gap: 12px;"><span style="min-width: 70px; font-size: 11px; font-weight: 600; color: #71717a; text-transform: uppercase;">Framing</span><span style="font-size: 14px; color: #e4e4e7;">${sanitizeHTML(shot.framing)}</span></div>
              <div style="display: flex; gap: 12px;"><span style="min-width: 70px; font-size: 11px; font-weight: 600; color: #71717a; text-transform: uppercase;">Action</span><span style="font-size: 14px; color: #e4e4e7;">${sanitizeHTML(shot.action)}</span></div>
              <div style="display: flex; gap: 12px;"><span style="min-width: 70px; font-size: 11px; font-weight: 600; color: #71717a; text-transform: uppercase;">Script</span><span style="font-size: 14px; color: #6366f1; font-style: italic; font-weight: 500;">"${sanitizeHTML(shot.script_line)}"</span></div>
              ${shot.text_overlay ? `<div style="display: flex; gap: 12px;"><span style="min-width: 70px; font-size: 11px; font-weight: 600; color: #71717a; text-transform: uppercase;">Overlay</span><span style="font-size: 14px; color: #e4e4e7;">${sanitizeHTML(shot.text_overlay)}</span></div>` : ''}
              ${shot.notes ? `<div style="display: flex; gap: 12px;"><span style="min-width: 70px; font-size: 11px; font-weight: 600; color: #71717a; text-transform: uppercase;">Notes</span><span style="font-size: 14px; color: #71717a; font-style: italic;">${sanitizeHTML(shot.notes)}</span></div>` : ''}
              ${renderBriefVariations(shot.variations)}
            </div>
          </div>
        `).join('')}
      </div>
    </div>
    `;
  };

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Video Analysis Report \u2014 ${sanitizeHTML(brand_name)}</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    html, body {
      background: #0e0e11;
      color: #ffffff;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }

    .container {
      max-width: 1200px;
      margin: 0 auto;
      padding: 40px 20px;
    }

    header {
      margin-bottom: 40px;
      padding-bottom: 32px;
      border-bottom: 1px solid #2a2a34;
    }

    .header-meta {
      display: flex;
      align-items: center;
      gap: 16px;
      margin-bottom: 16px;
      font-size: 12px;
      color: #8a8a92;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .header-meta span:not(:last-child)::after {
      content: '\u2022';
      margin-left: 16px;
      color: #2a2a34;
    }

    h1 {
      font-size: 40px;
      font-weight: 700;
      margin-bottom: 12px;
      line-height: 1.2;
    }

    .one-line-summary {
      font-size: 16px;
      color: #a1a1ab;
      line-height: 1.6;
      max-width: 800px;
    }

    .contact-sheet {
      margin-bottom: 40px;
      border-radius: 8px;
      overflow: hidden;
      border: 1px solid #2a2a34;
    }

    .contact-sheet img {
      width: 100%;
      height: auto;
      display: block;
      background: #1a1a22;
    }

    .section-title {
      font-size: 24px;
      font-weight: 700;
      margin-top: 40px;
      margin-bottom: 24px;
      padding-bottom: 12px;
      border-bottom: 2px solid #6366f1;
      color: #ffffff;
    }

    .section-content {
      margin-bottom: 40px;
    }

    @media (max-width: 768px) {
      .container {
        padding: 24px 16px;
      }

      h1 {
        font-size: 28px;
      }

      .section-title {
        font-size: 18px;
      }
    }

    @media print {
      body {
        background: white;
        color: black;
      }

      .container {
        max-width: 100%;
        padding: 20px;
      }

      h1 {
        color: black;
      }

      .one-line-summary {
        color: #333;
      }

      img {
        max-width: 100%;
      }

      .section-title {
        color: #000;
        border-bottom-color: #4f46e5;
      }
    }

    footer {
      text-align: center;
      padding-top: 32px;
      border-top: 1px solid #2a2a34;
      color: #8a8a92;
      font-size: 12px;
      margin-top: 60px;
    }
  </style>
</head>
<body>
  <div class="container">
    <!-- Header -->
    <header>
      <div class="header-meta">
        <span>${sanitizeHTML(brand_name)}</span>
        <span>${formatDate(created_at)}</span>
        <span style="text-transform: capitalize;">${sanitizeHTML(status || 'Complete')}</span>
      </div>
      <h1>Video Analysis Report</h1>
      <p class="one-line-summary">${sanitizeHTML(ai_analysis?.one_line_summary || 'Video analysis report for competitor ad creative.')}</p>
    </header>

    <!-- Contact Sheet -->
    ${
      contact_sheet_url
        ? `<div class="contact-sheet"><img src="${contact_sheet_url}" alt="Contact Sheet" /></div>`
        : ''
    }

    <!-- Metrics Bar -->
    <div class="section-content">
      ${renderMetricsBar()}
    </div>

    <!-- AI Analysis -->
    <div class="section-title">Creative Analysis</div>
    <div class="section-content">
      ${renderHook()}
      ${renderNarrativeArc()}
      ${renderCTA()}
      ${renderSellingPoints()}
      ${renderEmotionalDrivers()}
      ${renderTargetAudience()}
      ${renderProductionStyle()}
      ${renderCompetitorInsights()}
    </div>

    <!-- Combined Script -->
    <div class="section-title">Script Timeline</div>
    <div class="section-content">
      ${renderCombinedScript()}
    </div>

    <!-- Shot Breakdown -->
    <div class="section-title">Shot Analysis</div>
    <div class="section-content">
      ${renderShotBreakdown()}
    </div>

    <!-- Chefly UGC Brief (if available) -->
    ${renderBriefSection()}

    <!-- Footer -->
    <footer>
      <p>Generated by Creative Kitchen \u2014 Big Tasty Productions</p>
      <p style="margin-top: 8px; color: #6a6a72;">Report ID: ${sanitizeHTML(id || 'N/A')} \u2022 Analysis ID: ${sanitizeHTML(competitor_ad_id || 'N/A')}</p>
    </footer>
  </div>
</body>
</html>`;

  return html;
}
