export const CATEGORIES = [
  "Social Media",
  "Web",
  "Email",
  "Print",
  "Presentation",
  "Packaging",
  "Display",
  "Mobile",
  "Blog",
  "Advertising",
  "Promotional",
  "Product",
  "Event",
];

export const TEMPLATES = [
  { id: "sm-1", name: "Instagram Feed Post", category: "Social Media", width: 1080, height: 1080 },
  { id: "sm-2", name: "Instagram Story", category: "Social Media", width: 1080, height: 1920 },
  { id: "sm-3", name: "Facebook Cover", category: "Social Media", width: 820, height: 312 },
  { id: "sm-4", name: "Twitter Header", category: "Social Media", width: 1500, height: 500 },
  { id: "sm-5", name: "LinkedIn Post", category: "Social Media", width: 1200, height: 627 },
  { id: "sm-6", name: "TikTok Video", category: "Social Media", width: 1080, height: 1920 },
  { id: "web-1", name: "Hero Section", category: "Web", width: 1920, height: 1080 },
  { id: "web-2", name: "Featured Image", category: "Web", width: 1200, height: 600 },
  { id: "web-3", name: "Product Showcase", category: "Web", width: 800, height: 800 },
  { id: "web-4", name: "Landing Page Banner", category: "Web", width: 2560, height: 1440 },
  { id: "email-1", name: "Newsletter Header", category: "Email", width: 600, height: 300 },
  { id: "email-2", name: "Promotional Banner", category: "Email", width: 600, height: 400 },
  { id: "email-3", name: "Product Feature", category: "Email", width: 600, height: 600 },
  { id: "print-1", name: "Postcard", category: "Print", width: 600, height: 400 },
  { id: "print-2", name: "Flyer", category: "Print", width: 850, height: 1100 },
  { id: "print-3", name: "Brochure", category: "Print", width: 1700, height: 1100 },
  { id: "pres-1", name: "Title Slide", category: "Presentation", width: 1920, height: 1080 },
  { id: "pres-2", name: "Content Slide", category: "Presentation", width: 1920, height: 1080 },
  { id: "pres-3", name: "Closing Slide", category: "Presentation", width: 1920, height: 1080 },
  { id: "pkg-1", name: "Label", category: "Packaging", width: 800, height: 600 },
  { id: "pkg-2", name: "Box Design", category: "Packaging", width: 1200, height: 900 },
  { id: "disp-1", name: "Billboard", category: "Display", width: 2400, height: 1350 },
  { id: "disp-2", name: "Poster", category: "Display", width: 1080, height: 1620 },
  { id: "mob-1", name: "App Screenshot", category: "Mobile", width: 1080, height: 1920 },
  { id: "mob-2", name: "Mobile Ad", category: "Mobile", width: 320, height: 480 },
  { id: "blog-1", name: "Featured Image", category: "Blog", width: 1200, height: 675 },
  { id: "blog-2", name: "Thumbnail", category: "Blog", width: 1280, height: 720 },
  { id: "ads-1", name: "Google Ad", category: "Advertising", width: 300, height: 250 },
  { id: "ads-2", name: "Display Banner", category: "Advertising", width: 728, height: 90 },
  { id: "promo-1", name: "Sale Banner", category: "Promotional", width: 1200, height: 628 },
  { id: "promo-2", name: "Event Poster", category: "Promotional", width: 1080, height: 1440 },
  { id: "prod-1", name: "Product Photo", category: "Product", width: 1000, height: 1000 },
  { id: "prod-2", name: "Product Lifestyle", category: "Product", width: 1200, height: 800 },
  { id: "event-1", name: "Event Banner", category: "Event", width: 1920, height: 1080 },
  { id: "event-2", name: "Event Ticket", category: "Event", width: 800, height: 400 },
];

export function buildPrompt(template, brandDNA, customText) {
  const { brand_name = "", colors = [], style = "", photography_style = "", claims = [] } = brandDNA;
  const colorPalette = colors.length > 0 ? `color palette: ${colors.join(", ")}` : "";
  const claimsText = claims.length > 0 ? `brand claims: ${claims.join(", ")}` : "";

  let categoryContext = "";
  switch (template.category) {
    case "Social Media": categoryContext = "optimized for social media engagement, eye-catching, mobile-friendly"; break;
    case "Web": categoryContext = "web-optimized, professional, modern aesthetic, high quality"; break;
    case "Email": categoryContext = "email campaign, promotional, clear call-to-action, clean design"; break;
    case "Print": categoryContext = "print-ready, high-resolution, professional finish"; break;
    case "Presentation": categoryContext = "presentation slide, business professional, visual hierarchy"; break;
    case "Packaging": categoryContext = "product packaging, shelf-ready, premium appearance"; break;
    case "Display": categoryContext = "large-format display, impactful, attention-grabbing"; break;
    case "Mobile": categoryContext = "mobile optimized, thumb-stopping, vertical format"; break;
    case "Blog": categoryContext = "blog featured image, engaging visual, social shareable"; break;
    case "Advertising": categoryContext = "digital advertisement, conversion-focused, brand visibility"; break;
    case "Promotional": categoryContext = "promotional material, urgency-driven, sales-focused"; break;
    case "Product": categoryContext = "product photography, professional lighting, aspirational"; break;
    case "Event": categoryContext = "event marketing, exciting visual, clear details"; break;
    default: categoryContext = "professional marketing material";
  }

  const promptParts = [
    `${template.name} for ${brand_name}`,
    categoryContext,
    style && `style: ${style}`,
    photography_style && `photography style: ${photography_style}`,
    colorPalette,
    claimsText,
    "high quality, professional, marketing-ready",
    customText,
  ];

  return promptParts.filter((part) => part && part.trim()).join(", ");
}
