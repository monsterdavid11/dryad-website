"""Encode the features page's actual V1.1.0 footage, with player names blurred.

Usage: python tools/generate-gameplay-previews.py --ffmpeg /path/to/ffmpeg
Requires FFmpeg and ffprobe beside it. Does not modify the raw recordings.
"""
import argparse
import json
import subprocess
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--ffmpeg', default='ffmpeg')
args = parser.parse_args()
ffmpeg = args.ffmpeg
ffprobe = str(Path(ffmpeg).with_name('ffprobe' + Path(ffmpeg).suffix))
web = Path(__file__).resolve().parents[1]
raw = web.parent / 'assets/branding/Raw Video/V1.1.0'
output = web / 'public/videos'
clips = [
    ('farming', '2026-11-04 00-22-00.mp4', 18, 'Perimeter deployment and farming'),
    ('upgrades', '2026-10-31 02-51-31.mp4', 356, 'Wall selection and upgrades'),
    ('insights', '2026-10-31 03-01-28.mp4', 1064, 'Farming session tracker and resource changes'),
]
results = []
for name, source, start, description in clips:
    dest = output / f'{name}-v1-1-0.mp4'
    # Sanitize source coordinates before scaling; no added branding or captions.
    filters = ('[0:v]split[v][privacy];'
               '[privacy]crop=480:140:0:0,scale=12:4,scale=480:140:flags=neighbor,gblur=sigma=22[blur];'
               '[v][blur]overlay=0:0,scale=1280:720,setsar=1,format=yuv420p[out]')
    subprocess.run([ffmpeg, '-hide_banner', '-loglevel', 'error', '-y', '-ss', str(start),
                    '-t', '20', '-i', str(raw / source), '-filter_complex_threads', '2',
                    '-filter_complex', filters, '-map', '[out]', '-an', '-r', '30',
                    '-c:v', 'libx264', '-preset', 'slow', '-crf', '26', '-maxrate', '1800k',
                    '-bufsize', '3600k', '-threads', '4', '-movflags', '+faststart', str(dest)], check=True)
    poster = output / f'{name}-v1-1-0.webp'
    subprocess.run([ffmpeg, '-hide_banner', '-loglevel', 'error', '-y', '-ss', '2',
                    '-i', str(dest), '-frames:v', '1', '-c:v', 'libwebp', '-quality', '82',
                    str(poster)], check=True)
    meta = json.loads(subprocess.check_output([ffprobe, '-v', 'error', '-show_streams',
                                              '-show_format', '-of', 'json', str(dest)]))
    video = next(s for s in meta['streams'] if s['codec_type'] == 'video')
    assert (video['width'], video['height'], video['r_frame_rate']) == (1280, 720, '30/1')
    assert abs(float(meta['format']['duration']) - 20) < .1
    assert len(meta['streams']) == 1
    check = subprocess.run([ffmpeg, '-v', 'error', '-i', str(dest), '-f', 'null', '-'], capture_output=True)
    assert check.returncode == 0 and not check.stderr, check.stderr
    results.append(dict(file=dest.name, poster=poster.name, source=source, start_seconds=start,
                        duration_seconds=20, playback_speed=1, description=description,
                        bytes=dest.stat().st_size, decode_errors=0))
    print(f'Encoded and verified {dest.name}: {dest.stat().st_size:,} bytes', flush=True)
(output / 'gameplay-manifest.json').write_text(json.dumps(dict(
    privacy='Top-left source 480x140 area downsampled and blurred before scaling',
    format='1280x720 H.264, 30fps, silent, fast-start MP4', clips=results), indent=2) + '\n')
