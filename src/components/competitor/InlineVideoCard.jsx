import { useState, useEffect, useRef } from 'react'

export default function InlineVideoCard({ src, onClick }) {
  const wrapRef = useRef(null)
  const vidRef = useRef(null)
  const [visible, setVisible] = useState(false)
  const [hasFrame, setHasFrame] = useState(false)
  const [failed, setFailed] = useState(false)
  const [playing, setPlaying] = useState(false)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const io = new IntersectionObserver(
      ([e]) => setVisible(e.isIntersecting),
      { rootMargin: '200px 0px', threshold: 0 }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    const v = vidRef.current
    if (!v) return
    if (visible && src && !failed) {
      if (!v.src || v.src !== src) { v.src = src; v.load() }
    } else if (!visible && v.src) {
      v.pause(); v.removeAttribute('src'); v.load()
      setPlaying(false)
    }
  }, [visible, src, failed])

  function handleVideoClick(e) {
    e.stopPropagation()
    const v = vidRef.current
    if (!v || !v.src) return
    if (v.paused) {
      v.muted = false
      v.play().catch(() => {})
      setPlaying(true)
    } else {
      v.pause()
      setPlaying(false)
    }
  }

  return (
    <div ref={wrapRef} className="ca-lazy-video-wrap">
      {!failed && (
        <video
          ref={vidRef}
          muted
          playsInline
          webkit-playsinline="true"
          preload="metadata"
          className={'ca-lazy-video' + (hasFrame ? ' loaded' : '')}
          onLoadedData={() => setHasFrame(true)}
          onError={() => setFailed(true)}
          onEnded={() => setPlaying(false)}
          onClick={handleVideoClick}
        />
      )}
      {(!hasFrame || failed) && (
        <div className="ca-video-placeholder-mini" onClick={handleVideoClick}>
          <div className="ca-video-play-btn">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21" /></svg>
          </div>
          {failed && <div className="ca-video-label">VIDEO</div>}
          {!failed && !hasFrame && visible && (
            <div className="ca-video-loading-dot"><span></span></div>
          )}
        </div>
      )}
      {hasFrame && !playing && !failed && (
        <div className="ca-video-play-overlay" onClick={handleVideoClick}>
          <div className="ca-video-play-btn">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21" /></svg>
          </div>
        </div>
      )}
      {hasFrame && (
        <button className="ca-card-detail-btn" onClick={onClick} title="View details">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
        </button>
      )}
    </div>
  )
}
