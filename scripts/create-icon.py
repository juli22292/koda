from PIL import Image, ImageDraw
from pathlib import Path

root = Path(__file__).resolve().parent.parent / 'resources'
root.mkdir(exist_ok=True)
s = 4
image = Image.new('RGBA', (256*s, 256*s), (0, 0, 0, 0))
d = ImageDraw.Draw(image)
d.rounded_rectangle((8*s, 8*s, 248*s, 248*s), radius=55*s, fill='#B9684B')
def stroke(points):
    d.line([(x*s,y*s) for x,y in points], fill='#FFFAF3', width=15*s, joint='curve')
    for x,y in (points[0], points[-1]):
        d.ellipse(((x-7.5)*s,(y-7.5)*s,(x+7.5)*s,(y+7.5)*s), fill='#FFFAF3')
stroke([(87,77),(42,128),(87,179)])
stroke([(169,77),(214,128),(169,179)])
stroke([(145,61),(112,195)])
image = image.resize((256,256), Image.Resampling.LANCZOS)
image.save(root / 'icon.png')
image.save(root / 'icon.ico', sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)])
