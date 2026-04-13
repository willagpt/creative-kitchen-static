export const FORMAT_TAXONOMY = [
  'Product Hero',
  'Lifestyle In-Context',
  'Before/After Split',
  'Side-by-Side Comparison',
  'Testimonial/Quote Card',
  'Stat/Claim Card',
  'Ingredient Spotlight',
  'Multi-Product Grid',
  'Meme/Trend-Jack',
  'Text-Heavy Offer/Promo',
  'Editorial/Magazine',
  'Infographic/Explainer',
  'Screenshot/Social Proof',
  'UGC-Style Static',
  'Founder/Team Story',
  'Carousel Card'
]

export const S = {
  page: { padding: '24px', color: '#fff', minHeight: '100vh' },
  heading: { fontSize: '28px', fontWeight: '700', marginBottom: '8px' },
  sub: { fontSize: '14px', color: '#a1a1a1' },
  card: { backgroundColor: '#1a1a1a', border: '1px solid #333', borderRadius: '8px', padding: '20px' },
  sectionTitle: { fontSize: '16px', fontWeight: '600', marginBottom: '16px' },
  muted: { fontSize: '13px', color: '#71717a' },
  orangeBtn: {
    padding: '10px 16px', backgroundColor: '#f97316', color: '#fff',
    border: 'none', borderRadius: '6px', fontSize: '13px', fontWeight: '600', cursor: 'pointer'
  },
  ghostBtn: {
    padding: '8px 12px', backgroundColor: 'transparent', border: '1px solid #333',
    borderRadius: '4px', color: '#a1a1a1', fontSize: '12px', cursor: 'pointer'
  },
  tab: (active) => ({
    padding: '8px 16px', backgroundColor: 'transparent', border: 'none',
    borderBottom: active ? '2px solid #f97316' : '2px solid transparent',
    color: active ? '#f97316' : '#a1a1a1',
    fontSize: '13px', fontWeight: active ? '600' : '400', cursor: 'pointer'
  }),
  itemCard: (color) => ({
    padding: '10px 12px', backgroundColor: '#0a0a0a',
    borderLeft: `3px solid ${color}`, borderRadius: '4px'
  }),
  dashedCard: {
    padding: '10px 12px', backgroundColor: '#0a0a0a',
    border: '1px dashed #f97316', borderRadius: '4px', fontSize: '12px'
  }
}
