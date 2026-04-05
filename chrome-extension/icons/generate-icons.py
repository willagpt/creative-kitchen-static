#!/usr/bin/env python3
"""Generate Chrome extension icons for Creative Kitchen.

Run this script after cloning the repo to create the PNG icons:
    cd chrome-extension/icons
    python3 generate-icons.py

Requires: pip install Pillow
"""

from PIL import Image, ImageDraw, ImageFont
import os

def generate_icon(size):
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Orange rounded rectangle background (#f97316)
    radius = max(2, size // 8)
    draw.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill='#f97316')

    # White "CK" text
    font_size = max(6, size // 3)
    try:
        font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', font_size)
    except OSError:
        try:
            font = ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc', font_size)
        except OSError:
            font = ImageFont.load_default()

    text = 'CK'
    bbox = draw.textbbox((0, 0), text, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    x = (size - tw) // 2
    y = (size - th) // 2 - bbox[1]
    draw.text((x, y), text, fill='white', font=font)

    output = os.path.join(os.path.dirname(os.path.abspath(__file__)), f'icon{size}.png')
    img.save(output)
    print(f'  Created {output}')

if __name__ == '__main__':
    print('Generating Creative Kitchen extension icons...')
    for s in [16, 48, 128]:
        generate_icon(s)
    print('Done! Icons ready for Chrome extension.')
