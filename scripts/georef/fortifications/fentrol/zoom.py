"""Збільшена частина вирізки з сіткою кожні 10 px (підписи кожні 50) для читання вершин.
Запуск: zoom.py <вирізка.png> x0 y0 x1 y1 [масштаб] [вихід]"""
import sys
from PIL import Image, ImageDraw, ImageFont
path = sys.argv[1]; x0, y0, x1, y1 = map(int, sys.argv[2:6]); S = int(sys.argv[6]) if len(sys.argv) > 6 else 3
out = sys.argv[7] if len(sys.argv) > 7 else path.rsplit('.', 1)[0] + f'_z{x0}_{y0}.jpg'
im = Image.open(path).convert('RGB').crop((x0, y0, x1, y1))
im = im.resize(((x1 - x0) * S, (y1 - y0) * S), Image.LANCZOS)
d = ImageDraw.Draw(im, 'RGBA'); font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 13)
for v in range((x0 // 10 + 1) * 10, x1, 10):
    col = (0, 110, 255, 150) if v % 50 == 0 else (0, 110, 255, 45)
    d.line(((v - x0) * S, 0, (v - x0) * S, im.size[1]), fill=col)
    if v % 50 == 0: d.text(((v - x0) * S + 2, 2), str(v), fill=(0, 70, 255, 255), font=font)
for v in range((y0 // 10 + 1) * 10, y1, 10):
    col = (0, 110, 255, 150) if v % 50 == 0 else (0, 110, 255, 45)
    d.line((0, (v - y0) * S, im.size[0], (v - y0) * S), fill=col)
    if v % 50 == 0: d.text((2, (v - y0) * S + 2), str(v), fill=(0, 70, 255, 255), font=font)
im.save(out, quality=90); print(out, im.size)
