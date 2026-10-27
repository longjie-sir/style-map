from PIL import Image
import os, sys
d = os.path.join(os.path.dirname(__file__), '..', 'shots')
keys = sys.argv[1].split(',')
cols = int(sys.argv[2]) if len(sys.argv) > 2 else 3
tw = 620
imgs = []
for k in keys:
    fp = os.path.join(d, f'style_{k}.png')
    if not os.path.exists(fp): continue
    im = Image.open(fp)
    h = int(im.height * tw / im.width)
    imgs.append((k, im.resize((tw, h), Image.LANCZOS)))
if not imgs: sys.exit('no images')
rows = (len(imgs) + cols - 1) // cols
tile_h = imgs[0][1].height
W, H = tw * cols, tile_h * rows
sheet = Image.new('RGB', (W, H), 'white')
for i, (k, im) in enumerate(imgs):
    sheet.paste(im, ((i % cols) * tw, (i // cols) * tile_h))
out = os.path.join(d, 'sheet.png')
sheet.save(out)
print(out, sheet.size)
