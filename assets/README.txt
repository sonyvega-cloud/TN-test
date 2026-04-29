Sem patří tvůj backdrop loop, přesně jako: bg-loop.mp4

Encode command (H.264, 20s, 1920x1080, 25fps, no audio):

ffmpeg -i source.mov \
  -c:v libx264 -preset slow -crf 20 \
  -pix_fmt yuv420p -r 25 \
  -vf "scale=1920:1080" -an \
  -movflags +faststart -t 20 \
  bg-loop.mp4

Pokud soubor chybí, Studio preview mód spadne na CSS gradient fallback.
